"""Experimento 9.3.1. No publica el modelo. Mide si la fuerza implícita del cierre acerca el RPS al mercado."""

import csv
import json
import math
from datetime import datetime
from pathlib import Path

XI = math.log(2) / 120
SRC = Path("/tmp/fd")
ROOT = Path(__file__).resolve().parents[1]
ASOF = datetime(2026, 10, 4)
TUNE = (datetime(2025, 8, 1), datetime(2026, 6, 1))
HOLD = (datetime(2026, 8, 1), ASOF)
RHO = -0.08
PRIOR = 8.0

BOOKS = [
    ("Bet365", "B365CH", "B365CD", "B365CA"),
    ("Pinnacle", "PPCH", "PPCD", "PPCA"),
    ("Bwin", "BWCH", "BWCD", "BWCA"),
    ("Betfair", "BFDCH", "BFDCD", "BFDCA"),
    ("BetVictor", "BVCH", "BVCD", "BVCA"),
    ("Pinnacle2", "PSCH", "PSCD", "PSCA"),
    ("BetfairEx", "BFECH", "BFECD", "BFECA"),
]
LEAGUES = {
    "Premier": "E0",
    "Championship": "E1",
    "League One": "E2",
    "League Two": "E3",
    "Conference": "EC",
    "Escocia": "SC0",
    "Escocia Champ.": "SC1",
    "Escocia L1": "SC2",
    "Escocia L2": "SC3",
    "Bundesliga": "D1",
    "2. Bundesliga": "D2",
    "Serie A": "I1",
    "Serie B": "I2",
    "LaLiga": "SP1",
    "LaLiga 2": "SP2",
    "Ligue 1": "F1",
    "Ligue 2": "F2",
    "Eredivisie": "N1",
    "Bélgica": "B1",
    "Portugal": "P1",
    "Turquía": "T1",
    "Grecia": "G1",
}


def shin(h, d, a):
    if not (h > 1 and d > 1 and a > 1):
        return None
    margin = (1 / h + 1 / d + 1 / a) - 1
    if margin < 0 or margin > 0.15:
        return None
    raw = [1 / h, 1 / d, 1 / a]
    total = sum(raw)
    lo, hi = 0.0, 0.4
    for _ in range(40):
        z = (lo + hi) / 2
        probs = []
        for q in raw:
            inner = z * z + 4 * (1 - z) * q * q / total
            probs.append((math.sqrt(max(inner, 0)) - z) / (2 * (1 - z)))
        if sum(probs) > 1:
            lo = z
        else:
            hi = z
    z = (lo + hi) / 2
    probs = []
    for q in raw:
        inner = z * z + 4 * (1 - z) * q * q / total
        probs.append((math.sqrt(max(inner, 0)) - z) / (2 * (1 - z)))
    s = sum(probs)
    if s <= 0 or any(p <= 0 for p in probs):
        return None
    return (probs[0] / s, probs[1] / s, probs[2] / s)


def median(values):
    ordered = sorted(values)
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


def consensus(row):
    fair = []
    seen = set()
    for name, h, d, a in BOOKS:
        if name in seen or h not in row or not row[h]:
            continue
        try:
            price = shin(float(row[h]), float(row[d]), float(row[a]))
        except ValueError:
            continue
        if not price:
            continue
        seen.add(name)
        fair.append(price)
    if len(fair) < 3:
        return None
    probs = (
        median([item[0] for item in fair]),
        median([item[1] for item in fair]),
        median([item[2] for item in fair]),
    )
    total = sum(probs)
    return (probs[0] / total, probs[1] / total, probs[2] / total)


def parse_date(value):
    return datetime.strptime(value.strip(), "%d/%m/%Y")


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
                day = parse_date(row["Date"])
                hg, ag = int(raw_hg), int(raw_ag)
            except ValueError:
                continue
            price = consensus(row)
            rows.append({
                "date": day,
                "home": home,
                "away": away,
                "hg": hg,
                "ag": ag,
                "market": price,
                "solved": solve(price[0], price[2]) if price else None,
            })
    rows.sort(key=lambda item: item["date"])
    return rows


def solve(ph, pa):
    best = None
    score = 1e9
    for ih in range(2, 36, 2):
        lh = ih / 10
        for ia in range(2, 36, 2):
            la = ia / 10
            p = matrix_probs(lh, la, 0)
            err = (p[0] - ph) ** 2 + (p[2] - pa) ** 2
            if err < score:
                score = err
                best = (lh, la)
    return best


def matrix_probs(lh, la, rho):
    ph = pd = pa = mass = 0.0
    for hg in range(0, 8):
        for ag in range(0, 8):
            tau = 1.0
            if hg == 0 and ag == 0:
                tau = 1 - lh * la * rho
            elif hg == 1 and ag == 0:
                tau = 1 + la * rho
            elif hg == 0 and ag == 1:
                tau = 1 + lh * rho
            elif hg == 1 and ag == 1:
                tau = 1 - rho
            p = math.exp(-lh - la) * lh**hg / math.factorial(hg) * la**ag / math.factorial(ag) * max(tau, 1e-6)
            mass += p
            if hg > ag:
                ph += p
            elif hg == ag:
                pd += p
            else:
                pa += p
    return ph / mass, pd / mass, pa / mass


def rps(probs, hg, ag):
    outcome = (1, 0, 0) if hg > ag else (0, 1, 0) if hg == ag else (0, 0, 1)
    c1 = probs[0] - outcome[0]
    c2 = probs[0] + probs[1] - outcome[0] - outcome[1]
    return 0.5 * (c1 * c1 + c2 * c2)


def decayed(samples, asof, prior):
    weight = value = 0.0
    for day, number in samples:
        days = (asof - day).days
        if days < 0:
            continue
        w = math.exp(-XI * days)
        weight += w
        value += w * number
    return (value + PRIOR * prior) / (weight + PRIOR)


def predict_pair(attack, defense, other_attack, other_defense, asof, prior):
    return (
        decayed(attack, asof, prior),
        decayed(defense, asof, prior),
        decayed(other_attack, asof, prior),
        decayed(other_defense, asof, prior),
    )


def evaluate(rows, start, end, weight):
    goal_home = {}
    goal_away = {}
    mkt_home_for = {}
    mkt_home_against = {}
    mkt_away_for = {}
    mkt_away_against = {}
    model_r = market_r = goals_r = 0.0
    n = 0
    prior_goals = 1.25
    prior_mkt = 1.25
    for row in rows:
        if row["date"] >= start and row["date"] < end and row["market"] and n == 0:
            priced = [item for item in rows if item["date"] < start and item["market"]]
            if priced:
                prior_mkt = sum(item["solved"][0] for item in priced[-200:]) / min(200, len(priced))
            played = [item for item in rows if item["date"] < start]
            if played:
                prior_goals = sum(item["hg"] + item["ag"] for item in played) / len(played) / 2
        if start <= row["date"] < end and row["market"]:
            home, away = row["home"], row["away"]
            gh = decayed(goal_home.get(home, []), row["date"], prior_goals)
            ga = decayed(goal_away.get(away, []), row["date"], prior_goals)
            ah = decayed(goal_away.get(home, []), row["date"], prior_goals)
            aa = decayed(goal_home.get(away, []), row["date"], prior_goals)
            lh_g = (gh + aa) / 2
            la_g = (ga + ah) / 2
            mh = decayed(mkt_home_for.get(home, []), row["date"], prior_mkt)
            ma = decayed(mkt_away_for.get(away, []), row["date"], prior_mkt)
            dh = decayed(mkt_home_against.get(home, []), row["date"], prior_mkt)
            da = decayed(mkt_away_against.get(away, []), row["date"], prior_mkt)
            lh = (1 - weight) * lh_g + weight * (mh + da) / 2
            la = (1 - weight) * la_g + weight * (ma + dh) / 2
            lh = min(4, max(0.2, lh))
            la = min(4, max(0.2, la))
            probs = matrix_probs(lh, la, RHO)
            goal_probs = matrix_probs(min(4, max(0.2, lh_g)), min(4, max(0.2, la_g)), RHO)
            model_r += rps(probs, row["hg"], row["ag"])
            goals_r += rps(goal_probs, row["hg"], row["ag"])
            market_r += rps(row["market"], row["hg"], row["ag"])
            n += 1
        goal_home.setdefault(row["home"], []).append((row["date"], row["hg"]))
        goal_away.setdefault(row["away"], []).append((row["date"], row["ag"]))
        if row["market"]:
            solved = row["solved"]
            mkt_home_for.setdefault(row["home"], []).append((row["date"], solved[0]))
            mkt_home_against.setdefault(row["home"], []).append((row["date"], solved[1]))
            mkt_away_for.setdefault(row["away"], []).append((row["date"], solved[1]))
            mkt_away_against.setdefault(row["away"], []).append((row["date"], solved[0]))
    if not n:
        return None
    return {"n": n, "model": model_r / n, "goals": goals_r / n, "market": market_r / n}


def main():
    report = {}
    for name, code in LEAGUES.items():
        rows = load(code)
        tune = []
        for weight in (0.25, 0.5, 0.75):
            score = evaluate(rows, *TUNE, weight)
            tune.append({"weight": weight, **(score or {})})
        usable = [item for item in tune if item.get("model") is not None]
        best = min(usable, key=lambda item: abs(item["model"] - item["market"])) if usable else None
        hold = evaluate(rows, *HOLD, best["weight"]) if best else None
        goals_hold = hold["goals"] if hold else None
        adopted = bool(
            hold
            and best
            and hold["n"] >= 20
            and abs(hold["model"] - hold["market"]) < abs(hold["goals"] - hold["market"])
        )
        report[name] = {"tune": tune, "weight": best["weight"] if best else None, "holdout": hold, "adopted": adopted}
        print(name, "w", report[name]["weight"], "hold", hold, "adopta", adopted, flush=True)
    out = ROOT / "data/exp1-report.json"
    out.write_text(json.dumps({"experiment": "9.3.1 fuerza implícita del cierre", "adopted": False, "leagues": report}, ensure_ascii=False))
    print("adopted any", any(item["adopted"] for item in report.values()))


if __name__ == "__main__":
    main()
