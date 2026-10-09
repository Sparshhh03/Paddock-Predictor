"""Models: a regularised LambdaRank model blended with logistic regression for finishing order,
plus logistic models for (well-calibrated) win / podium probabilities.

Backtesting showed bigger gradient-boosted models overfit and gave overconfident probabilities;
F1 results are noisy, so simple models generalise better."""
import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .features import FEATURES

# Compact feature set for the linear models.
LINEAR_FEATURES = ["grid", "quali_gap_pct", "con_avg_finish_5", "drv_avg_points_5",
                   "con_season_points", "drv_dnf_rate_10"]

SEED = 42


def _sample_weight(df):
    # Recent seasons matter more (regulation changes, team evolution).
    latest = df["season"].max()
    return 0.75 ** (latest - df["season"])


def _logit():
    return make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000))


class F1Predictor:
    def _lin_X(self, df):
        return df[LINEAR_FEATURES].fillna(self.medians)

    def fit(self, train):
        train = train.sort_values("race_id")
        X, w = train[FEATURES], _sample_weight(train)
        groups = train.groupby("race_id", sort=False).size().values

        self.ranker = lgb.LGBMRanker(
            n_estimators=200, learning_rate=0.03, num_leaves=7, min_child_samples=50,
            subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
            label_gain=[i * i for i in range(31)], random_state=SEED, verbose=-1)
        self.ranker.fit(X, train["relevance"].astype(int), group=groups, sample_weight=w)

        self.medians = train[LINEAR_FEATURES].median()
        Xl = self._lin_X(train)
        fit_w = {"logisticregression__sample_weight": w}
        self.win_clf = _logit().fit(Xl, train["is_winner"], **fit_w)
        self.pod_clf = _logit().fit(Xl, train["is_podium"], **fit_w)
        return self

    def predict(self, race_df):
        out = race_df.copy()
        rank_score = pd.Series(self.ranker.predict(out[FEATURES]), index=out.index)
        Xl = self._lin_X(out)
        win = pd.Series(self.win_clf.predict_proba(Xl)[:, 1], index=out.index)
        pod = pd.Series(self.pod_clf.predict_proba(Xl)[:, 1], index=out.index)
        by_race = out["race_id"]
        # Normalise per race: exactly one winner, three podium places.
        out["win_prob"] = win / win.groupby(by_race).transform("sum")
        out["podium_prob"] = (pod / pod.groupby(by_race).transform("sum") * 3).clip(upper=1)
        # Final order: average of the two models' within-race percentile ranks.
        pct = lambda s: s.groupby(by_race).rank(pct=True)
        out["score"] = pct(rank_score) + pct(pod)
        out["pred_pos"] = out.groupby("race_id")["score"].rank(ascending=False, method="first").astype(int)
        return out.sort_values(["race_id", "pred_pos"])

    def feature_importance(self):
        imp = self.ranker.booster_.feature_importance("gain")
        return pd.Series(imp / imp.sum(), index=FEATURES).sort_values(ascending=False)


def race_metrics(pred, order_col):
    """Score one predicted ordering column against actual results, per race."""
    rows = []
    for rid, r in pred.groupby("race_id"):
        r = r.sort_values(order_col)
        actual_top3 = set(r.loc[r["position"] <= 3, "driver"])
        pred_top3 = set(r["driver"].iloc[:3])
        rows.append({
            "winner_correct": r["position"].iloc[0] == 1,
            "podium_overlap": len(actual_top3 & pred_top3) / 3,
            "exact_podium": list(r["driver"].iloc[:3]) == list(r.sort_values("position")["driver"].iloc[:3]),
            "spearman": spearmanr(r[order_col], r["position"]).statistic,
            "mae_pos": np.abs(r[order_col].rank() - r["position"]).mean(),
        })
    return pd.DataFrame(rows).mean()
