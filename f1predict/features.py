"""Feature engineering. Every feature for a race uses only information available before lights out."""
import numpy as np
import pandas as pd

FEATURES = [
    # Saturday performance
    "grid", "quali_pos", "quali_gap_pct", "teammate_quali_delta",
    # Driver form
    "drv_avg_finish_5", "drv_avg_points_5", "drv_dnf_rate_10", "drv_avg_gain_5",
    "drv_season_points", "drv_champ_rank", "drv_circuit_avg_finish", "drv_circuit_starts",
    "drv_experience",
    # Team (car) strength
    "con_avg_finish_5", "con_points_5", "con_season_avg_finish", "con_season_points",
    "con_dnf_rate_10", "con_avg_quali_5",
    "field_size",
]


def build_features(results, quali, upcoming=None):
    """results: past race rows. upcoming: optional rows (season, round, circuit, driver, constructor, ...) to predict."""
    df = results.copy()
    if upcoming is not None and len(upcoming):
        df = pd.concat([df, upcoming], ignore_index=True)

    q = quali[["season", "round", "driver", "quali_pos", "quali_best"]]
    df = df.drop(columns=[c for c in ("quali_pos", "quali_best") if c in df], errors="ignore")
    df = df.merge(q, on=["season", "round", "driver"], how="left")

    df = df.sort_values(["season", "round", "driver"]).reset_index(drop=True)
    df["race_id"] = df["season"] * 100 + df["round"]
    df["field_size"] = df.groupby("race_id")["driver"].transform("count")

    # Grid: pit-lane starts (0) go to the back; upcoming races use quali position as provisional grid.
    df["grid"] = df["grid"].where(df["grid"].notna(), df["quali_pos"])
    df.loc[df["grid"] == 0, "grid"] = df["field_size"]
    df["quali_pos"] = df["quali_pos"].fillna(df["grid"])

    pole = df.groupby("race_id")["quali_best"].transform("min")
    df["quali_gap_pct"] = (df["quali_best"] - pole) / pole * 100
    df.loc[df["quali_gap_pct"] > 7, "quali_gap_pct"] = np.nan  # wet/session-mismatch outliers

    team_best = df.groupby(["race_id", "constructor"])["quali_pos"].transform("sum")
    df["teammate_quali_delta"] = df["quali_pos"] - (team_best - df["quali_pos"])
    df.loc[df.groupby(["race_id", "constructor"])["driver"].transform("count") != 2, "teammate_quali_delta"] = np.nan

    df["dnf"] = (~df["finished"].astype("boolean")).astype(float)
    df.loc[df["position"].isna(), "dnf"] = np.nan
    df["gain"] = df["grid"] - df["position"]

    # Driver form (all strictly from earlier races)
    drv = df.groupby("driver")
    df["drv_avg_finish_5"] = drv["position"].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    df["drv_avg_points_5"] = drv["points"].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    df["drv_dnf_rate_10"] = drv["dnf"].transform(lambda s: s.shift(1).rolling(10, min_periods=1).mean())
    df["drv_avg_gain_5"] = drv["gain"].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    df["drv_experience"] = drv.cumcount()

    ds = df.groupby(["season", "driver"])["points"]
    df["drv_season_points"] = ds.transform(lambda s: s.shift(1).fillna(0).cumsum())
    df["drv_champ_rank"] = df.groupby("race_id")["drv_season_points"].rank(ascending=False, method="min")

    dc = df.groupby(["driver", "circuit"])["position"]
    df["drv_circuit_avg_finish"] = dc.transform(lambda s: s.shift(1).expanding().mean())
    df["drv_circuit_starts"] = df.groupby(["driver", "circuit"]).cumcount()

    # Constructor form: aggregate both cars per race, then roll over previous races
    con = (df.groupby(["race_id", "season", "constructor"])
             .agg(c_finish=("position", "mean"), c_points=("points", "sum"),
                  c_dnf=("dnf", "mean"), c_quali=("quali_pos", "mean"))
             .reset_index().sort_values("race_id"))
    cg = con.groupby("constructor")
    con["con_avg_finish_5"] = cg["c_finish"].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    con["con_points_5"] = cg["c_points"].transform(lambda s: s.shift(1).rolling(5, min_periods=1).sum())
    con["con_dnf_rate_10"] = cg["c_dnf"].transform(lambda s: s.shift(1).rolling(10, min_periods=1).mean())
    con["con_avg_quali_5"] = cg["c_quali"].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    csg = con.groupby(["season", "constructor"])
    con["con_season_avg_finish"] = csg["c_finish"].transform(lambda s: s.shift(1).expanding().mean())
    con["con_season_points"] = csg["c_points"].transform(lambda s: s.shift(1).fillna(0).cumsum())
    df = df.merge(con.drop(columns=["season", "c_finish", "c_points", "c_dnf", "c_quali"]),
                  on=["race_id", "constructor"], how="left")

    # Targets
    df["is_winner"] = (df["position"] == 1).astype(int)
    df["is_podium"] = (df["position"] <= 3).astype(int)
    df["relevance"] = (21 - df["position"]).clip(lower=0)
    return df
