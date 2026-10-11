"""Misma lista de partidos de 2026/27 para el Nivel A anterior y el actual."""

import json
import math
from datetime import datetime, timedelta
from importlib.machinery import SourceFileLoader
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIT = SourceFileLoader("fitdixon", str(ROOT / "scripts/fit-dixon.py")).load_module()
CAL = SourceFileLoader("cal92", str(ROOT / "scripts/calibration-92.py")).load_module()
REPORT = json.loads((ROOT / "data/dixon-report.json").read_text())
PUBLISHED = set(json.loads((ROOT / "data/dixon.json").read_text())["leagues"])
RECENT = json.loads((ROOT / "data/home-advantage.json").read_text())
MAIN = [
    "epl", "championship", "league-one", "league-two", "conference", "scotland",
    "scotland-champ", "scotland-l1", "scotland-l2", "bundesliga", "bundesliga2",
    "seriea", "serieb", "laliga", "laliga2", "ligue1", "ligue2", "eredivisie",
    "belgium", "portugal", "turkey", "greece",
]
START = datetime(2026, 8, 1)
XI = math.log(2) / 120


def decayed(samples, day):
    weight = value = 0.0
    for seen, goals in samples:
        span = (day - seen).days
        if span < 0:
            continue
        w = math.exp(-XI * span)
        weight += w
        value += w * goals
    return (value + 8 * 1.25) / (weight + 8)


def current_probs(model, row, recent, market_lambda):
    home = model["teams"].get(row["home"])
    away = model["teams"].get(row["away"])
    if not home or not away:
        return None
    lh = math.exp(min(2, max(-2, home["att"] - away["def"] + recent)))
    la = math.exp(min(2, max(-2, away["att"] - home["def"])))
    lh = 0.5 * lh + 0.5 * market_lambda[0]
    la = 0.5 * la + 0.5 * market_lambda[1]
    return FIT.matrix_probs(min(4, max(0.2, lh)), min(4, max(0.2, la)), model["rho"])


def run_league(item):
    name, code, reg = item
    rows = FIT.load(code)
    solved = {}
    for row in CAL.load(code):
        solved[(row["date"], row["home"], row["away"])] = row["solved"]
    recent = RECENT[name]
    home_for, home_against = {}, {}
    away_for, away_against = {}, {}
    for key in set(row["home"] for row in rows) | set(row["away"] for row in rows):
        home_for[key] = []
        home_against[key] = []
        away_for[key] = []
        away_against[key] = []
    included = []
    missing = []
    dates = sorted({row["date"] for row in rows if START <= row["date"] < FIT.ASOF})
    cache = None
    cache_until = datetime.min
    seen = {}
    for row in rows:
        if row["date"] >= FIT.ASOF:
            if row["date"] >= START:
                missing.append({"date": row["date"].date().isoformat(), "home": row["home"], "away": row["away"], "reason": "posterior al corte del 4 oct 2026"})
            continue
        price = solved.get((row["date"], row["home"], row["away"]))
        if START <= row["date"]:
            past = [item for item in rows if item["date"] < row["date"]]
            key = (row["date"], row["home"], row["away"])
            if len(past) < 150:
                missing.append({"date": row["date"].date().isoformat(), "home": row["home"], "away": row["away"], "reason": "la liga todavía no tiene 150 partidos anteriores"})
            else:
                if row["date"] >= cache_until or cache is None:
                    cache = FIT.fit(past, row["date"], reg)
                    cache_until = row["date"] + timedelta(days=7)
                pred = FIT.predict(cache, row["home"], row["away"]) if cache else None
                if not cache:
                    missing.append({"date": row["date"].date().isoformat(), "home": row["home"], "away": row["away"], "reason": "el ajuste de esa semana no convergió"})
                elif not pred:
                    left = cache["teams"].get(row["home"])
                    right = cache["teams"].get(row["away"])
                    who = row["home"] if not left or left["n"] < 6 else row["away"]
                    missing.append({"date": row["date"].date().isoformat(), "home": row["home"], "away": row["away"], "reason": f"{who} tiene menos de 6 partidos en el modelo de esa semana"})
                elif not row["market"]:
                    missing.append({"date": row["date"].date().isoformat(), "home": row["home"], "away": row["away"], "reason": "sin cuota de cierre de Bet365"})
                else:
                    mh = decayed(home_for[row["home"]], row["date"])
                    da = decayed(away_against[row["away"]], row["date"])
                    ma = decayed(away_for[row["away"]], row["date"])
                    dh = decayed(home_against[row["home"]], row["date"])
                    old = FIT.matrix_probs(pred[0], pred[1], cache["rho"])
                    new = current_probs(cache, row, recent, ((mh + da) / 2, (ma + dh) / 2))
                    included.append({
                        "old": FIT.rps(old, row["hg"], row["ag"]),
                        "new": FIT.rps(new, row["hg"], row["ag"]),
                        "shin": FIT.rps(row["market"], row["hg"], row["ag"]),
                    })
                    if key in seen:
                        missing.append({"date": row["date"].date().isoformat(), "home": row["home"], "away": row["away"], "reason": "fila repetida; el conteo anterior la sumó dos veces y esta tabla también"})
                    seen[key] = True
        if price:
            home_for[row["home"]].append((row["date"], price[0]))
            home_against[row["home"]].append((row["date"], price[1]))
            away_for[row["away"]].append((row["date"], price[1]))
            away_against[row["away"]].append((row["date"], price[0]))
    print(name, len(included), len(missing), flush=True)
    return {"league": name, "included": included, "missing": missing}


def pack(rows):
    if not rows:
        return None
    n = len(rows)
    old = sum(row["old"] for row in rows) / n
    new = sum(row["new"] for row in rows) / n
    shin = sum(row["shin"] for row in rows) / n
    return {
        "n": n,
        "anterior": old,
        "actual": new,
        "shin": shin,
        "distanciaAnterior": abs(old - shin),
        "distancia": abs(new - shin),
    }


def why_not(name):
    if name in PUBLISHED:
        return "sí"
    row = REPORT[name]
    tune = next(item for item in row["tune"] if item["reg"] == row["reg"])
    hold = row["holdout"]
    reasons = []
    if tune["rpsBaseline"] is None or not (tune["rpsModel"] < tune["rpsBaseline"]):
        reasons.append("en 2025/26 no bajó el RPS del respaldo")
    if not hold or hold["n"] < 20:
        reasons.append("2026/27 tiene menos de 20 partidos")
    elif hold["rpsBaseline"] is None or not (hold["rpsModel"] < hold["rpsBaseline"]):
        reasons.append("en 2026/27 no bajó el RPS del respaldo")
    return "; ".join(reasons) or "no pasó el control"


def main():
    jobs = [(name, FIT.LEAGUES[name], REPORT[name]["reg"]) for name in MAIN]
    with Pool(4) as pool:
        built = pool.map(run_league, jobs)
    order = {name: item for name, item in zip(MAIN, built) if False}
    by_name = {item["league"]: item for item in built}
    table = []
    all_rows = []
    for name in MAIN:
        item = by_name[name]
        summary = pack(item["included"])
        summary["league"] = name
        summary["nivelA"] = why_not(name)
        table.append(summary)
        all_rows.extend(item["included"])
    weighted = pack(all_rows)
    simple = {
        "anterior": sum(row["anterior"] for row in table) / len(table),
        "actual": sum(row["actual"] for row in table) / len(table),
        "shin": sum(row["shin"] for row in table) / len(table),
        "distancia": sum(row["distancia"] for row in table) / len(table),
        "distanciaAnterior": sum(row["distanciaAnterior"] for row in table) / len(table),
    }
    out = {"table": table, "weighted": weighted, "simple": simple, "missing": {item["league"]: item["missing"] for item in built}}
    path = ROOT / "data/same-matches.json"
    path.write_text(json.dumps(out))
    for row in table:
        print(f"{row['league']:16} {row['n']:4} {row['anterior']:.4f} {row['actual']:.4f} {row['shin']:.4f} {row['distancia']:.4f} {row['nivelA']}")
    print("weighted", weighted)
    print("simple", simple)


if __name__ == "__main__":
    main()
