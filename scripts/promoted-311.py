"""Experimento: los 311 partidos con el historial de la división anterior. No se publica."""

import math
from datetime import datetime, timedelta
from importlib.machinery import SourceFileLoader
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIT = SourceFileLoader("fitdixon311", str(ROOT / "scripts/fit-dixon.py")).load_module()
START = datetime(2026, 8, 1)
PREV = {
    "epl": "championship",
    "championship": "league-one",
    "league-one": "league-two",
    "league-two": "conference",
    "scotland": "scotland-champ",
    "scotland-champ": "scotland-l1",
    "scotland-l1": "scotland-l2",
    "bundesliga": "bundesliga2",
    "seriea": "serieb",
    "laliga": "laliga2",
    "ligue1": "ligue2",
}
JOBS = [
    "epl", "championship", "league-one", "league-two", "conference",
    "scotland-champ", "scotland-l1", "scotland-l2", "bundesliga", "bundesliga2",
    "serieb", "laliga", "laliga2", "ligue1", "ligue2", "eredivisie",
    "belgium", "portugal", "turkey", "greece",
]


def mean_goals(rows, day):
    goals = games = 0
    for row in rows:
        if row["date"] >= day:
            break
        goals += row["hg"] + row["ag"]
        games += 2
    return goals / games if games else 1.25


def side(model, team, opponent_def, home):
    row = model["teams"].get(team) if model else None
    if not row or row["n"] < 6:
        return None
    return math.exp(min(2, max(-2, row["att"] - opponent_def + home)))


def run(name):
    code = FIT.LEAGUES[name]
    reg = 0.05
    rows = FIT.load(code)
    previous_name = PREV.get(name)
    lower_rows = FIT.load(FIT.LEAGUES[previous_name]) if previous_name else []
    cache = lower_cache = None
    cache_until = lower_until = datetime.min
    used = missed = base_n = paired_model = 0
    model_r = base_r = shin_r = 0.0
    shin_n = 0
    why = {}
    for row in rows:
        if row["date"] < START or row["date"] >= FIT.ASOF:
            continue
        past = [item for item in rows if item["date"] < row["date"]]
        if len(past) < 150:
            why["sin 150 partidos"] = why.get("sin 150 partidos", 0) + 1
            continue
        if row["date"] >= cache_until or cache is None:
            cache = FIT.fit(past, row["date"], reg)
            cache_until = row["date"] + timedelta(days=7)
        if FIT.predict(cache, row["home"], row["away"]) if cache else None:
            continue
        if not cache:
            why["ajuste fallido"] = why.get("ajuste fallido", 0) + 1
            continue
        lower = None
        if lower_rows and (row["date"] >= lower_until or lower_cache is None):
            lower_past = [item for item in lower_rows if item["date"] < row["date"]]
            lower_cache = FIT.fit(lower_past, row["date"], reg) if len(lower_past) >= 150 else None
            lower_until = row["date"] + timedelta(days=7)
        lower = lower_cache
        home = cache["teams"].get(row["home"])
        away = cache["teams"].get(row["away"])
        home_short = not home or home["n"] < 6
        away_short = not away or away["n"] < 6
        if not previous_name:
            why["sin división anterior en football-data"] = why.get("sin división anterior en football-data", 0) + 1
            missed += 1
            continue
        scale = mean_goals(rows, row["date"]) / mean_goals(lower_rows, row["date"])
        lh = la = None
        if home_short and not away_short and lower:
            low = lower["teams"].get(row["home"])
            if low and low["n"] >= 6:
                lh = scale * math.exp(min(2, max(-2, low["att"] - away["def"] + cache["home"])))
                la = math.exp(min(2, max(-2, away["att"] - low["def"]))) / scale
        elif away_short and not home_short and lower:
            low = lower["teams"].get(row["away"])
            if low and low["n"] >= 6:
                lh = math.exp(min(2, max(-2, home["att"] - low["def"] + cache["home"]))) / scale
                la = scale * math.exp(min(2, max(-2, low["att"] - home["def"])))
        elif home_short and away_short and lower:
            left = lower["teams"].get(row["home"])
            right = lower["teams"].get(row["away"])
            if left and right and left["n"] >= 6 and right["n"] >= 6:
                pred = FIT.predict(lower, row["home"], row["away"])
                if pred:
                    lh, la = pred
        if lh is None or la is None:
            why["el equipo no tiene 6 partidos en la división anterior"] = why.get("el equipo no tiene 6 partidos en la división anterior", 0) + 1
            missed += 1
            continue
        probs = FIT.matrix_probs(min(4, max(0.2, lh)), min(4, max(0.2, la)), cache["rho"])
        model_r += FIT.rps(probs, row["hg"], row["ag"])
        used += 1
        base = FIT.baseline(past, row["home"], row["away"])
        if base:
            base_r += FIT.rps(base, row["hg"], row["ag"])
            paired_model += FIT.rps(probs, row["hg"], row["ag"])
            base_n += 1
        if row["market"]:
            shin_r += FIT.rps(row["market"], row["hg"], row["ag"])
            shin_n += 1
    print(name, used, missed, flush=True)
    return {"league": name, "used": used, "missed": missed, "model": model_r, "pairedModel": paired_model, "base": base_r, "baseN": base_n, "shin": shin_r, "shinN": shin_n, "why": why}


def main():
    with Pool(4) as pool:
        rows = pool.map(run, JOBS)
    used = sum(row["used"] for row in rows)
    model = sum(row["model"] for row in rows)
    base = sum(row["base"] for row in rows)
    paired = sum(row["pairedModel"] for row in rows)
    base_n = sum(row["baseN"] for row in rows)
    shin = sum(row["shin"] for row in rows)
    shin_n = sum(row["shinN"] for row in rows)
    missed = sum(row["missed"] for row in rows)
    summary = {
        "used": used,
        "missed": missed,
        "rpsModel": model / used if used else None,
        "rpsModelOnBaselineMatches": paired / base_n if base_n else None,
        "rpsBaseline": base / base_n if base_n else None,
        "baselineMatches": base_n,
        "rpsShin": shin / shin_n if shin_n else None,
        "shinMatches": shin_n,
        "betterThanBaseline": bool(base_n and paired / base_n < base / base_n),
    }
    print(summary)
    for row in rows:
        if row["used"] or row["missed"]:
            print(row["league"], row["used"], row["missed"], row["why"])


if __name__ == "__main__":
    main()
