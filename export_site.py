"""Export model predictions + backtest stats to site/data.json for the web dashboard.

Run again after each qualifying session or race, then republish the site.
    python export_site.py
"""
import datetime as dt
import json
import sys
from pathlib import Path

import pandas as pd

from f1 import CURRENT_SEASON, backtest, load_all, next_round, predict_race
from f1predict.data import load_schedule
from f1predict.model import race_metrics

OUT = Path(__file__).resolve().parent / "site" / "data.json"
BACKTEST_SEASONS = [2024, 2025, CURRENT_SEASON]

FEATURE_LABELS = {
    "grid": "Starting grid slot", "quali_pos": "Qualifying position", "quali_gap_pct": "Gap to pole (%)",
    "teammate_quali_delta": "Quali vs teammate", "drv_avg_finish_5": "Driver avg finish (last 5)",
    "drv_avg_points_5": "Driver points (last 5)", "drv_dnf_rate_10": "Driver DNF rate",
    "drv_avg_gain_5": "Places gained on Sunday", "drv_season_points": "Driver season points",
    "drv_champ_rank": "Championship position", "drv_circuit_avg_finish": "Track history",
    "drv_circuit_starts": "Starts at this track", "drv_experience": "Career starts",
    "con_avg_finish_5": "Team avg finish (last 5)", "con_points_5": "Team points (last 5)",
    "con_season_avg_finish": "Team season avg finish", "con_season_points": "Team season points",
    "con_dnf_rate_10": "Team DNF rate", "con_avg_quali_5": "Team quali pace (last 5)", "field_size": "Field size",
}


def r3(x):
    return None if pd.isna(x) else round(float(x), 4)


def race_rows(pred, actual=None):
    rows = []
    for _, r in pred.sort_values("pred_pos").iterrows():
        act = r["position"] if actual is None else actual.get(r["driver"])
        rows.append({
            "pred": int(r["pred_pos"]), "driver": r["driver"], "name": r["driver_name"],
            "code": r.get("code") or r["driver_name"].split()[-1][:3].upper(),
            "team": r["constructor"], "grid": int(r["grid"]),
            "win": r3(r["win_prob"]), "podium": r3(r["podium_prob"]),
            "actual": None if act is None or pd.isna(act) else int(act),
        })
    return rows


def metrics_dict(m):
    return {k: r3(v) for k, v in m.items()}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    results, quali = load_all()
    sched = load_schedule(CURRENT_SEASON).set_index("round")

    print("Backtesting (walk-forward)...")
    pred, model = backtest(BACKTEST_SEASONS, results, quali)

    seasons = {}
    for season in BACKTEST_SEASONS:
        s = pred[pred["season"] == season]
        if len(s):
            seasons[str(season)] = {"races": int(s["race_id"].nunique()),
                                    "model": metrics_dict(race_metrics(s, "pred_pos")),
                                    "grid": metrics_dict(race_metrics(s, "grid_order"))}

    bins = pd.cut(pred["win_prob"], [0, .1, .25, .5, .75, 1.0])
    cal = pred.groupby(bins, observed=True).agg(predicted=("win_prob", "mean"), actual=("is_winner", "mean"), n=("driver", "count"))
    calibration = [{"bin": f"{int(b.left * 100)}–{int(b.right * 100)}%", "predicted": r3(c.predicted),
                    "actual": r3(c.actual), "n": int(c.n)} for b, c in cal.iterrows()]
    imp = model.feature_importance().head(10)
    importance = [{"feature": f, "label": FEATURE_LABELS.get(f, f), "value": r3(v)} for f, v in imp.items()]

    # Every completed race this season, as predicted before it happened.
    races, track = [], []
    cur = pred[pred["season"] == CURRENT_SEASON]
    for rnd, r in cur.groupby("round"):
        info = sched.loc[rnd]
        mp = race_metrics(r, "pred_pos")
        gp = race_metrics(r, "grid_order")
        winner = r.loc[r["position"] == 1].iloc[0]
        races.append({
            "round": int(rnd), "name": info["race_name"], "circuit": info["circuit_name"],
            "locality": info["locality"], "country": info["country"], "date": info["date"], "time": info["time"],
            "status": "completed", "grid_source": "Official starting grid", "rows": race_rows(r),
        })
        track.append({"round": int(rnd), "name": info["race_name"], "country": info["country"],
                      "winner": winner["code"], "winner_team": winner["constructor"],
                      "model_winner": bool(mp["winner_correct"]), "grid_winner": bool(gp["winner_correct"]),
                      "model_podium": round(mp["podium_overlap"] * 3), "grid_podium": round(gp["podium_overlap"] * 3)})

    nxt = next_round(results, CURRENT_SEASON)
    if nxt is not None:
        print(f"Predicting round {nxt}...")
        out, race, source, _ = predict_race(CURRENT_SEASON, nxt, results, quali)
        info = sched.loc[nxt]
        races.append({
            "round": nxt, "name": info["race_name"], "circuit": info["circuit_name"],
            "locality": info["locality"], "country": info["country"], "date": info["date"], "time": info["time"],
            "status": "upcoming",
            "grid_source": "Qualifying result" if source == "qualifying" else "Estimated grid (qualifying not run yet)",
            "rows": race_rows(out, actual={}),
        })

    calendar = [{"round": int(rnd), "name": i["race_name"], "country": i["country"], "date": i["date"]}
                for rnd, i in sched.iterrows() if nxt is not None and rnd > nxt]

    data = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "season": CURRENT_SEASON,
        "next_round": nxt,
        "races": races,
        "calendar": calendar,
        "season_track": track,
        "backtest": {"seasons": seasons, "calibration": calibration, "importance": importance},
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {OUT} ({len(races)} races)")


if __name__ == "__main__":
    main()
