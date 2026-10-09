"""F1 race outcome predictor.

Usage:
    python f1.py evaluate                      # walk-forward backtest on recent seasons
    python f1.py predict                       # predict the next race of the current season
    python f1.py predict --season 2026 --round 5   # (re)predict a specific race
"""
import argparse
import sys
import datetime as dt

import numpy as np
import pandas as pd

from f1predict.data import load_qualifying, load_results, load_schedule
from f1predict.features import build_features
from f1predict.model import F1Predictor, race_metrics

FIRST_SEASON = 2018
CURRENT_SEASON = dt.date.today().year


def load_all():
    seasons = list(range(FIRST_SEASON, CURRENT_SEASON + 1))
    return load_results(seasons), load_qualifying(seasons)


def backtest(test_seasons, results=None, quali=None, progress=True):
    """Walk-forward predictions for every race in test_seasons. Returns (predictions, last model)."""
    if results is None:
        results, quali = load_all()
    df = build_features(results, quali)
    races = sorted(df.loc[df["season"].isin(test_seasons), "race_id"].unique())
    preds = []
    # Walk forward: before each race, train on every race that came before it.
    for i, rid in enumerate(races):
        model = F1Predictor().fit(df[df["race_id"] < rid])
        preds.append(model.predict(df[df["race_id"] == rid]))
        if progress:
            print(f"\r  backtesting race {i + 1}/{len(races)}", end="", flush=True)
    if progress:
        print()
    pred = pd.concat(preds)
    pred["grid_order"] = pred.groupby("race_id")["grid"].rank(method="first")
    return pred, model


def evaluate(test_seasons):
    pred, model = backtest(test_seasons)

    for season in test_seasons:
        s = pred[pred["season"] == season]
        if s.empty:
            continue
        table = pd.DataFrame({"Model": race_metrics(s, "pred_pos"),
                              "Baseline (grid order)": race_metrics(s, "grid_order")})
        print(f"\n=== {season}  ({s['race_id'].nunique()} races) ===")
        print(table.rename(index={
            "winner_correct": "Winner correct", "podium_overlap": "Podium drivers correct",
            "exact_podium": "Exact podium order", "spearman": "Spearman rank corr",
            "mae_pos": "Mean abs. position error"}).round(3).to_string())

    # Probability calibration: does a "40% win chance" actually win ~40% of the time?
    bins = pd.cut(pred["win_prob"], [0, .1, .25, .5, .75, 1.0])
    cal = pred.groupby(bins, observed=True).agg(predicted=("win_prob", "mean"), actual=("is_winner", "mean"), n=("driver", "count"))
    print("\nWin-probability calibration (all test races):")
    print(cal.round(3).to_string())

    print("\nTop feature importances (ranker, latest model):")
    print(model.feature_importance().head(10).round(3).to_string())


def upcoming_rows(results, quali, season, rnd):
    sched = load_schedule(season)
    race = sched[sched["round"] == rnd]
    if race.empty:
        raise SystemExit(f"No round {rnd} in {season} schedule.")
    race = race.iloc[0]
    q = quali[(quali["season"] == season) & (quali["round"] == rnd)]
    if len(q):
        lineup = q[["driver", "driver_name", "code", "constructor"]]
        source = "qualifying"
    else:
        rid = results["season"] * 100 + results["round"]
        last = results[rid == rid.max()]
        lineup = last[["driver", "driver_name", "code", "constructor"]]
        source = "latest race lineup (qualifying not run yet; grid estimated from form)"
    rows = lineup.copy()
    for k in ("season", "round", "race_name", "circuit", "date"):
        rows[k] = race[k]
    for k in ("grid", "position", "points", "finished", "status"):
        rows[k] = np.nan
    return rows, race, source


def next_round(results, season):
    sched = load_schedule(season)
    done = results.loc[results["season"] == season, "round"]
    remaining = sched[~sched["round"].isin(done)]
    return int(remaining["round"].min()) if len(remaining) else None


def predict_race(season, rnd, results=None, quali=None):
    """Predict one race using only data from before it. Returns (predictions, race info, grid source, actual positions)."""
    if results is None:
        results, quali = load_all()
    if rnd is None:
        rnd = next_round(results, season)
        if rnd is None:
            raise SystemExit(f"The {season} season is complete. Use --season {season + 1} once its schedule is published.")

    past = results[(results["season"] * 100 + results["round"]) < season * 100 + rnd]
    upcoming, race, source = upcoming_rows(past, quali, season, rnd)
    df = build_features(past, quali, upcoming)

    rid = season * 100 + rnd
    target = df[df["race_id"] == rid].copy()
    if target["quali_pos"].isna().all():
        # No qualifying yet: estimate grid from each team's recent qualifying pace.
        est = target["con_avg_quali_5"].fillna(target["con_avg_quali_5"].max()) + target["drv_avg_finish_5"].fillna(15) * 0.01
        target["grid"] = target["quali_pos"] = est.rank(method="first")

    model = F1Predictor().fit(df[df["race_id"] < rid])
    out = model.predict(target)
    actual = results[(results["season"] == season) & (results["round"] == rnd)].set_index("driver")["position"]
    return out, race, source, actual


def predict(season, rnd):
    out, race, source, actual = predict_race(season, rnd)
    rnd = int(race["round"])
    print(f"\n{race['race_name']} {season} (round {rnd}, {race['date']}, circuit: {race['circuit']})")
    print(f"Lineup/grid source: {source}\n")
    view = out[["pred_pos", "driver_name", "constructor", "grid", "win_prob", "podium_prob"]].copy()
    view["grid"] = view["grid"].astype(int)
    view["win_prob"] = (view["win_prob"] * 100).round(1).astype(str) + "%"
    view["podium_prob"] = (view["podium_prob"] * 100).round(1).astype(str) + "%"
    if len(actual):
        view["Actual"] = out["driver"].map(actual).astype("Int64")
    print(view.rename(columns={"pred_pos": "Pred", "driver_name": "Driver", "constructor": "Team",
                               "grid": "Grid", "win_prob": "Win %", "podium_prob": "Podium %"}).to_string(index=False))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("evaluate")
    e.add_argument("--seasons", type=int, nargs="+", default=[2024, 2025, CURRENT_SEASON])
    pr = sub.add_parser("predict")
    pr.add_argument("--season", type=int, default=CURRENT_SEASON)
    pr.add_argument("--round", type=int, default=None)
    a = p.parse_args()
    if a.cmd == "evaluate":
        evaluate(sorted(set(a.seasons)))
    else:
        predict(a.season, a.round)


if __name__ == "__main__":
    main()
