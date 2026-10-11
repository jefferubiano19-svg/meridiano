"""Calibración 9.2 y experimento 1 dentro del Nivel A. No publica nada por sí solo."""

import csv
import json
import math
import sys
from collections import defaultdict
from datetime import datetime
from importlib.machinery import SourceFileLoader
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = Path("/tmp/fd")
FIT = SourceFileLoader("fitdixon", str(ROOT / "scripts/fit-dixon.py")).load_module()
XI = math.log(2) / 120
TUNE = (datetime(2025, 8, 1), datetime(2026, 6, 1))
HOLD = (datetime(2026, 8, 1), datetime(2026, 10, 5))
BOOKS = [
    ("Bet365", "B365CH", "B365CD", "B365CA"),
    ("Pinnacle", "PPCH", "PPCD", "PPCA"),
    ("Bwin", "BWCH", "BWCD", "BWCA"),
    ("Betfair", "BFDCH", "BFDCD", "BFDCA"),
    ("BetVictor", "BVCH", "BVCD", "BVCA"),
    ("Pinnacle2", "PSCH", "PSCD", "PSCA"),
    ("BetfairEx", "BFECH", "BFECD", "BFECA"),
]


def median(values):
    ordered = sorted(values)
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


def prices(row):
    fair = []
    seen = set()
    for name, h, d, a in BOOKS:
        if name in seen or not row.get(h):
            continue
        try:
            price = FIT.shin(float(row[h]), float(row[d]), float(row[a]))
        except (TypeError, ValueError):
            continue
        if price:
            seen.add(name)
            fair.append(price)
    if not fair:
        return None
    probs = tuple(median([item[i] for item in fair]) for i in range(3))
    total = sum(probs)
    return (probs[0] / total, probs[1] / total, probs[2] / total), len(fair)


def consensus(row):
    priced = prices(row)
    if not priced or priced[1] < 3:
        return None
    return priced[0]


def solve(ph, pa):
    best = None
    score = 1e9
    for ih in range(2, 36, 2):
        lh = ih / 10
        for ia in range(2, 36, 2):
            la = ia / 10
            p = FIT.matrix_probs(lh, la, 0)
            err = (p[0] - ph) ** 2 + (p[2] - pa) ** 2
            if err < score:
                score = err
                best = (lh, la)
    return best


def load(code):
    rows = []
    paths = [SRC / f"{season}-{code}.csv" for season in ("2324", "2425", "2526", "2627")]
    paths.append(SRC / f"new-{code}.csv")
    for path in paths:
        if not path.exists():
            continue
        for row in csv.DictReader(path.open(encoding="utf-8-sig")):
            home = row.get("HomeTeam") or row.get("Home")
            away = row.get("AwayTeam") or row.get("Away")
            raw_hg = row.get("FTHG") or row.get("HG")
            raw_ag = row.get("FTAG") or row.get("AG")
            if not home or not away or not raw_hg or not raw_ag or not row.get("Date"):
                continue
            try:
                day = datetime.strptime(row["Date"].strip(), "%d/%m/%Y")
                hg, ag = int(raw_hg), int(raw_ag)
            except ValueError:
                continue
            priced = prices(row)
            rows.append({
                "date": day,
                "home": home,
                "away": away,
                "hg": hg,
                "ag": ag,
                "market": priced[0] if priced and priced[1] >= 3 else None,
                "shin": priced[0] if priced else None,
                "solved": solve(priced[0][0], priced[0][2]) if priced and priced[1] >= 3 else None,
            })
    rows.sort(key=lambda item: item["date"])
    return rows


def decayed(samples, asof, prior):
    weight = value = 0.0
    for day, number in samples:
        days = (asof - day).days
        if days < 0:
            continue
        w = math.exp(-XI * days)
        weight += w
        value += w * number
    return (value + 8 * prior) / (weight + 8)


def season_key(day):
    return day.year if day.month >= 7 else day.year - 1


def probs_of(lh, la, rho=-0.08):
    return FIT.matrix_probs(min(4, max(0.2, lh)), min(4, max(0.2, la)), rho)


def sharpen(probs, temperature):
    scaled = [math.log(max(p, 1e-6)) / temperature for p in probs]
    top = max(scaled)
    weights = [math.exp(item - top) for item in scaled]
    total = sum(weights)
    return tuple(item / total for item in weights)


def fit_league(item):
    name, code = item
    rows = load(code)
    model = FIT.fit([row for row in rows if row["date"] < TUNE[0]], TUNE[0], 0.01)
    print(name, "fit", "ok" if model else "no", len(rows), flush=True)
    return name, rows, model


def walk(rows, model):
    goal_home, goal_away = defaultdict(list), defaultdict(list)
    season = defaultdict(lambda: [0, 0, 0, 0, 0, 0])
    mkt_home_for, mkt_home_against = defaultdict(list), defaultdict(list)
    mkt_away_for, mkt_away_against = defaultdict(list), defaultdict(list)
    out = {"A": [], "B": [], "C": [], "Aplus": []}
    prior = 1.25
    seen_goals = 0.0
    seen_n = 0
    for row in rows:
        if seen_n:
            prior = seen_goals / seen_n / 2
        home, away, day = row["home"], row["away"], row["date"]
        in_window = TUNE[0] <= day < TUNE[1] or HOLD[0] <= day < HOLD[1]
        window = "tune" if day < datetime(2026, 7, 1) else "hold"
        if in_window:
            gh = decayed(goal_home[home], day, prior)
            ga = decayed(goal_away[away], day, prior)
            ah = decayed(goal_away[home], day, prior)
            aa = decayed(goal_home[away], day, prior)
            factor = 1.0
            out["C"].append((window, probs_of((gh + aa) / 2 * factor, (ga + ah) / 2), row))
            key = season_key(day)
            sh = season[(home, key, "h")]
            sa = season[(away, key, "a")]
            if sh[2] >= 4 and sa[2] >= 4:
                out["B"].append((window, probs_of((sh[0] / sh[2] + sa[1] / sa[2]) / 2, (sa[0] / sa[2] + sh[1] / sh[2]) / 2), row))
            if model:
                lambdas = FIT.predict(model, home, away)
                if lambdas:
                    pure = probs_of(*lambdas, model["rho"])
                    out["A"].append((window, pure, row, lambdas))
                    mh = decayed(mkt_home_for[home], day, prior)
                    da = decayed(mkt_away_against[away], day, prior)
                    ma = decayed(mkt_away_for[away], day, prior)
                    dh = decayed(mkt_home_against[home], day, prior)
                    out["Aplus"].append((window, lambdas, ((mh + da) / 2, (ma + dh) / 2), row, model["rho"]))
        goal_home[home].append((day, row["hg"]))
        goal_away[away].append((day, row["ag"]))
        bucket = season[(home, season_key(day), "h")]
        bucket[0] += row["hg"]
        bucket[1] += row["ag"]
        bucket[2] += 1
        visitor = season[(away, season_key(day), "a")]
        visitor[0] += row["ag"]
        visitor[1] += row["hg"]
        visitor[2] += 1
        if row["solved"]:
            mkt_home_for[home].append((day, row["solved"][0]))
            mkt_home_against[home].append((day, row["solved"][1]))
            mkt_away_for[away].append((day, row["solved"][1]))
            mkt_away_against[away].append((day, row["solved"][0]))
        seen_goals += row["hg"] + row["ag"]
        seen_n += 1
    return out


def favorite(probs, row):
    index = max(range(3), key=lambda i: probs[i])
    outcome = 0 if row["hg"] > row["ag"] else 1 if row["hg"] == row["ag"] else 2
    return probs[index], 1 if index == outcome else 0, FIT.rps(probs, row["hg"], row["ag"])


def bins_of(items):
    groups = defaultdict(lambda: [0, 0.0, 0.0])
    for window, probs, row, *_ in items:
        if window != "hold":
            continue
        pred, hit, _ = favorite(probs, row)
        key = min(9, int(pred * 10))
        groups[key][0] += 1
        groups[key][1] += pred
        groups[key][2] += hit
    return [
        {"bin": f"{key * 10}-{(key + 1) * 10}", "n": values[0], "pred": round(values[1] / values[0], 3), "real": round(values[2] / values[0], 3)}
        for key, values in sorted(groups.items())
        if values[0] >= 15
    ]


def rps_of(items, window, temperature=1):
    total = n = 0.0
    market = 0.0
    market_n = 0
    for item in items:
        if item[0] != window:
            continue
        probs = sharpen(item[1], temperature) if temperature != 1 else item[1]
        _, _, score = favorite(probs, item[2])
        total += score
        n += 1
        if item[2]["market"]:
            market += FIT.rps(item[2]["market"], item[2]["hg"], item[2]["ag"])
            market_n += 1
    if not n:
        return None
    return {"n": int(n), "rps": total / n, "market": market / market_n if market_n else None, "marketN": market_n}


def paired(items, window, temperature=1, field="shin"):
    model = market = 0.0
    n = 0
    for item in items:
        price = item[2].get(field)
        if item[0] != window or not price:
            continue
        probs = sharpen(item[1], temperature) if temperature != 1 else item[1]
        model += FIT.rps(probs, item[2]["hg"], item[2]["ag"])
        market += FIT.rps(price, item[2]["hg"], item[2]["ag"])
        n += 1
    if not n:
        return None
    return {"n": n, "rps": model / n, "market": market / n, "distance": abs(model - market) / n}


def audit(items):
    band = []
    for window, probs, row, *_ in items:
        if window != "hold":
            continue
        pred, hit, _ = favorite(probs, row)
        if 0.7 <= pred < 0.8:
            side = max(range(3), key=lambda i: probs[i])
            swapped = 1 if (2 if row["hg"] > row["ag"] else 0 if row["hg"] < row["ag"] else 1) == side else 0
            band.append((pred, hit, swapped, side, row, probs))
    home = [item for item in band if item[3] == 0]
    away = [item for item in band if item[3] == 2]
    draw = [item for item in band if item[3] == 1]
    def rate(group):
        return {"n": len(group), "hit": round(sum(item[1] for item in group) / len(group), 3)} if group else {"n": 0}
    return {
        "n": len(band),
        "hit": round(sum(item[1] for item in band) / len(band), 3) if band else None,
        "hitIfScoresSwapped": round(sum(item[2] for item in band) / len(band), 3) if band else None,
        "homeFavorite": rate(home),
        "awayFavorite": rate(away),
        "drawFavorite": rate(draw),
        "examples": [
            {
                "date": item[4]["date"].date().isoformat(),
                "home": item[4]["home"],
                "away": item[4]["away"],
                "score": f"{item[4]['hg']}-{item[4]['ag']}",
                "p": [round(p, 3) for p in item[5]],
            }
            for item in sorted(band, key=lambda item: item[0], reverse=True)[:8]
        ],
    }


def best_temperature(items):
    best = (1.0, rps_of(items, "tune"))
    for step in range(12, 28):
        temperature = step / 20
        score = rps_of(items, "tune", temperature)
        if score and (best[1] is None or score["rps"] < best[1]["rps"]):
            best = (temperature, score)
    return best


def blend_rows(items, weight):
    built = []
    for window, lambdas, market_lambda, row, rho in items:
        lh = (1 - weight) * lambdas[0] + weight * market_lambda[0]
        la = (1 - weight) * lambdas[1] + weight * market_lambda[1]
        built.append((window, probs_of(lh, la, rho), row))
    return built


def main():
    leagues = list(FIT.LEAGUES.items())
    with Pool(4) as pool:
        fitted = pool.map(fit_league, leagues)
    levels = {"A": [], "B": [], "C": []}
    plus = []
    for name, rows, model in fitted:
        walked = walk(rows, model)
        for key in levels:
            levels[key].extend(walked[key])
        plus.extend(walked["Aplus"])
    report = {"levels": {}, "temperature": {}, "experiment": {}}
    for key, items in levels.items():
        chosen = best_temperature(items)
        hold = rps_of(items, "hold")
        hold_t = rps_of(items, "hold", chosen[0]) if chosen[1] else None
        report["levels"][key] = {
            "bins": bins_of(items),
            "tune": rps_of(items, "tune"),
            "holdout": hold,
            "temperature": chosen[0],
            "holdoutWithTemperature": hold_t,
            "adopted": bool(hold and hold_t and hold["n"] >= 500 and hold_t["rps"] < hold["rps"]),
            "audit70": audit(items) if key == "A" else None,
            "pairedHoldout": paired(items, "hold"),
            "pairedHoldoutTemperature": paired(items, "hold", chosen[0]),
        }
        print(key, "T", chosen[0], "hold", hold, "withT", hold_t, flush=True)
    base = [(item[0], probs_of(*item[1], item[4]), item[3]) for item in plus]
    tune_choice = []
    for weight in (0, 0.25, 0.5, 0.75):
        built = blend_rows(plus, weight) if weight else base
        tune_choice.append({"weight": weight, "paired": paired(built, "tune"), "pairedT": paired(built, "tune", 1.35)})
    hold_choice = []
    for weight in (0, 0.25, 0.5, 0.75):
        built = blend_rows(plus, weight) if weight else base
        hold_choice.append({
            "weight": weight,
            "paired": paired(built, "hold"),
            "pairedT": paired(built, "hold", 1.35),
        })
    report["experiment"] = {"chosenOn": "2025/26", "tune": tune_choice, "holdout": hold_choice}
    path = ROOT / "data/calibration-92.json"
    path.write_text(json.dumps(report, ensure_ascii=False))
    print("wrote", path)


if __name__ == "__main__":
    main()
