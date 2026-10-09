"""Download and cache F1 race results, qualifying and schedules from the Jolpica (Ergast-compatible) API."""
import json
import time
from pathlib import Path

import pandas as pd
import requests

API = "https://api.jolpi.ca/ergast/f1"
CACHE = Path(__file__).resolve().parent.parent / "data"
PAGE = 100


def _get(url, params=None, retries=5):
    for attempt in range(retries):
        r = requests.get(url, params=params, timeout=30)
        if r.status_code == 429:  # rate limited: back off
            time.sleep(2 ** attempt * 2)
            continue
        r.raise_for_status()
        time.sleep(0.3)  # stay under the API burst limit
        return r.json()["MRData"]
    raise RuntimeError(f"Rate limited too many times: {url}")


def _fetch_paged(season, endpoint, table_key):
    """Fetch every page of e.g. /2024/results.json and merge races."""
    races, offset = {}, 0
    while True:
        data = _get(f"{API}/{season}/{endpoint}.json", {"limit": PAGE, "offset": offset})
        for race in data["RaceTable"]["Races"]:
            key = int(race["round"])
            if key in races:
                races[key][table_key].extend(race[table_key])
            else:
                races[key] = race
        offset += PAGE
        if offset >= int(data["total"]):
            break
    return [races[k] for k in sorted(races)]


def _cached(season, endpoint, table_key, refresh):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"{endpoint}_{season}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    races = _fetch_paged(season, endpoint, table_key)
    path.write_text(json.dumps(races))
    return races


def _quali_seconds(t):
    if not t:
        return None
    try:
        if ":" in t:
            m, s = t.split(":")
            return int(m) * 60 + float(s)
        return float(t)
    except ValueError:
        return None


def load_results(seasons, refresh_current=True):
    current = max(seasons)
    rows = []
    for season in seasons:
        refresh = refresh_current and season == current
        for race in _cached(season, "results", "Results", refresh):
            for res in race["Results"]:
                status = res.get("status", "")
                rows.append({
                    "season": int(race["season"]),
                    "round": int(race["round"]),
                    "race_name": race["raceName"],
                    "circuit": race["Circuit"]["circuitId"],
                    "date": race["date"],
                    "driver": res["Driver"]["driverId"],
                    "driver_name": f'{res["Driver"]["givenName"]} {res["Driver"]["familyName"]}',
                    "code": res["Driver"].get("code", res["Driver"]["familyName"][:3].upper()),
                    "constructor": res["Constructor"]["constructorId"],
                    "grid": int(res["grid"]),
                    "position": int(res["position"]),
                    "points": float(res["points"]),
                    "status": status,
                    "finished": status == "Finished" or status.startswith("+") or status == "Lapped",
                })
    return pd.DataFrame(rows)


def load_qualifying(seasons, refresh_current=True):
    current = max(seasons)
    rows = []
    for season in seasons:
        refresh = refresh_current and season == current
        for race in _cached(season, "qualifying", "QualifyingResults", refresh):
            for q in race["QualifyingResults"]:
                times = [_quali_seconds(q.get(k)) for k in ("Q1", "Q2", "Q3")]
                times = [t for t in times if t]
                rows.append({
                    "season": int(race["season"]),
                    "round": int(race["round"]),
                    "driver": q["Driver"]["driverId"],
                    "driver_name": f'{q["Driver"]["givenName"]} {q["Driver"]["familyName"]}',
                    "code": q["Driver"].get("code", q["Driver"]["familyName"][:3].upper()),
                    "constructor": q["Constructor"]["constructorId"],
                    "quali_pos": int(q["position"]),
                    "quali_best": min(times) if times else None,
                })
    return pd.DataFrame(rows)


def load_standings(season):
    """Current driver and constructor championship tables (points include sprints)."""
    def table(endpoint, key):
        lists = _get(f"{API}/{season}/{endpoint}.json")["StandingsTable"]["StandingsLists"]
        return lists[0][key] if lists else []

    drivers = [{
        "pos": int(s["position"]) if s.get("position") else None,
        "points": float(s["points"]),
        "wins": int(s["wins"]),
        "driver": s["Driver"]["driverId"],
        "code": s["Driver"].get("code", s["Driver"]["familyName"][:3].upper()),
        "name": f'{s["Driver"]["givenName"]} {s["Driver"]["familyName"]}',
        "number": s["Driver"].get("permanentNumber"),
        "nationality": s["Driver"].get("nationality"),
        "team": s["Constructors"][-1]["constructorId"] if s["Constructors"] else None,
    } for s in table("driverstandings", "DriverStandings")]
    constructors = [{
        "pos": int(s["position"]) if s.get("position") else None,
        "points": float(s["points"]),
        "wins": int(s["wins"]),
        "team": s["Constructor"]["constructorId"],
        "name": s["Constructor"]["name"],
        "nationality": s["Constructor"].get("nationality"),
    } for s in table("constructorstandings", "ConstructorStandings")]
    return drivers, constructors


def load_schedule(season):
    data = _get(f"{API}/{season}.json", {"limit": 100})
    return pd.DataFrame([{
        "season": int(r["season"]),
        "round": int(r["round"]),
        "race_name": r["raceName"],
        "circuit": r["Circuit"]["circuitId"],
        "circuit_name": r["Circuit"]["circuitName"],
        "locality": r["Circuit"]["Location"]["locality"],
        "country": r["Circuit"]["Location"]["country"],
        "date": r["date"],
        "time": r.get("time", ""),
    } for r in data["RaceTable"]["Races"]])
