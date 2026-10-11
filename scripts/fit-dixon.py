"""Dixon-Coles por liga con football-data.co.uk. No publica si el RPS no baja."""

import csv
import json
import math
from datetime import datetime
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import gammaln

ROOT = Path(__file__).resolve().parents[1]
SRC = Path("/tmp/fd")
XI = math.log(2) / 120
ASOF = datetime(2026, 10, 4)
LEAGUES = {
    "epl": "E0",
    "championship": "E1",
    "league-one": "E2",
    "league-two": "E3",
    "conference": "EC",
    "scotland": "SC0",
    "scotland-champ": "SC1",
    "scotland-l1": "SC2",
    "scotland-l2": "SC3",
    "bundesliga": "D1",
    "bundesliga2": "D2",
    "seriea": "I1",
    "serieb": "I2",
    "laliga": "SP1",
    "laliga2": "SP2",
    "ligue1": "F1",
    "ligue2": "F2",
    "eredivisie": "N1",
    "belgium": "B1",
    "portugal": "P1",
    "turkey": "T1",
    "greece": "G1",
    "argentina": "ARG",
    "austria": "AUT",
    "brazil": "BRA",
    "china": "CHN",
    "denmark": "DNK",
    "finland": "FIN",
    "ireland": "IRL",
    "japan": "JPN",
    "mexico": "MEX",
    "norway": "NOR",
    "poland": "POL",
    "romania": "ROU",
    "russia": "RUS",
    "sweden": "SWE",
    "switzerland": "SWZ",
    "usa": "USA",
}
SEASONS = ["2324", "2425", "2526", "2627"]
ALIAS = {
    "epl": {
        "Arsenal": ["Arsenal"],
        "Aston Villa": ["Aston Villa"],
        "AFC Bournemouth": ["Bournemouth", "AFC Bournemouth"],
        "Brentford": ["Brentford"],
        "Brighton & Hove Albion": ["Brighton", "Brighton & Hove Albion"],
        "Chelsea": ["Chelsea"],
        "Coventry City": ["Coventry", "Coventry City"],
        "Crystal Palace": ["Crystal Palace"],
        "Everton": ["Everton"],
        "Fulham": ["Fulham"],
        "Hull City": ["Hull", "Hull City"],
        "Ipswich Town": ["Ipswich", "Ipswich Town"],
        "Leeds United": ["Leeds", "Leeds United", "Leeds Utd"],
        "Liverpool": ["Liverpool"],
        "Manchester City": ["Man City", "Manchester City"],
        "Manchester United": ["Man United", "Manchester United", "Manchester Utd"],
        "Newcastle United": ["Newcastle", "Newcastle United"],
        "Nottingham Forest": ["Nott'm Forest", "Nottingham Forest"],
        "Sunderland": ["Sunderland"],
        "Tottenham Hotspur": ["Tottenham", "Tottenham Hotspur"],
    },
    "laliga": {
        "Alavés": ["Alaves", "Alavés"],
        "Athletic Club": ["Ath Bilbao", "Athletic Club"],
        "Atlético Madrid": ["Ath Madrid", "Atlético Madrid", "Atlético de Madrid"],
        "Barcelona": ["Barcelona"],
        "Real Betis": ["Betis", "Real Betis"],
        "Celta Vigo": ["Celta", "Celta Vigo"],
        "Elche": ["Elche"],
        "Espanyol": ["Espanol", "Espanyol"],
        "Getafe": ["Getafe"],
        "Deportivo": ["La Coruna", "Deportivo"],
        "Levante": ["Levante"],
        "Málaga": ["Malaga", "Málaga"],
        "Osasuna": ["Osasuna"],
        "Real Madrid": ["Real Madrid"],
        "Racing Santander": ["Santander", "Racing Santander"],
        "Sevilla": ["Sevilla"],
        "Real Sociedad": ["Sociedad", "Real Sociedad"],
        "Valencia": ["Valencia"],
        "Rayo Vallecano": ["Vallecano", "Rayo Vallecano"],
        "Villarreal": ["Villarreal"],
    },
    "seriea": {
        "AC Milan": ["Milan", "AC Milan"],
        "AS Roma": ["Roma", "AS Roma"],
        "Atalanta": ["Atalanta"],
        "Bologna": ["Bologna"],
        "Cagliari": ["Cagliari"],
        "Como": ["Como"],
        "Fiorentina": ["Fiorentina"],
        "Frosinone": ["Frosinone"],
        "Genoa": ["Genoa"],
        "Internazionale": ["Inter", "Internazionale"],
        "Juventus": ["Juventus"],
        "Lazio": ["Lazio"],
        "Lecce": ["Lecce"],
        "Monza": ["Monza"],
        "Napoli": ["Napoli"],
        "Parma": ["Parma"],
        "Sassuolo": ["Sassuolo"],
        "Torino": ["Torino"],
        "Udinese": ["Udinese"],
        "Venezia": ["Venezia"],
    },
    "bundesliga": {
        "FC Augsburg": ["Augsburg", "FC Augsburg"],
        "Bayern Munich": ["Bayern Munich"],
        "Borussia Dortmund": ["Dortmund", "Borussia Dortmund"],
        "Eintracht Frankfurt": ["Ein Frankfurt", "Eintracht Frankfurt"],
        "SV Elversberg": ["Elversberg", "SV Elversberg"],
        "FC Cologne": ["FC Koln", "FC Cologne"],
        "SC Freiburg": ["Freiburg", "SC Freiburg"],
        "Hamburg SV": ["Hamburg", "Hamburg SV"],
        "TSG Hoffenheim": ["Hoffenheim", "TSG Hoffenheim"],
        "Bayer Leverkusen": ["Leverkusen", "Bayer Leverkusen"],
        "Borussia Mönchengladbach": ["M'gladbach", "Borussia Mönchengladbach"],
        "Mainz": ["Mainz"],
        "SC Paderborn 07": ["Paderborn", "SC Paderborn 07"],
        "RB Leipzig": ["RB Leipzig"],
        "Schalke 04": ["Schalke 04"],
        "VfB Stuttgart": ["Stuttgart", "VfB Stuttgart"],
        "1. FC Union Berlin": ["Union Berlin", "1. FC Union Berlin"],
        "Werder Bremen": ["Werder Bremen"],
    },
    "ligue1": {
        "AJ Auxerre": ["Auxerre", "AJ Auxerre"],
        "Angers": ["Angers"],
        "Brest": ["Brest"],
        "Le Havre AC": ["Le Havre", "Le Havre AC"],
        "Le Mans": ["Le Mans"],
        "Lens": ["Lens"],
        "Lille": ["Lille"],
        "Lorient": ["Lorient"],
        "Lyon": ["Lyon"],
        "Marseille": ["Marseille"],
        "AS Monaco": ["Monaco", "AS Monaco"],
        "Nice": ["Nice"],
        "Paris FC": ["Paris FC"],
        "Paris Saint-Germain": ["Paris SG", "Paris Saint-Germain"],
        "Stade Rennais": ["Rennes", "Stade Rennais"],
        "Strasbourg": ["Strasbourg"],
        "Toulouse": ["Toulouse"],
        "Troyes": ["Troyes"],
    },
}


def parse_date(value: str) -> datetime:
    return datetime.strptime(value.strip(), "%d/%m/%Y")


def load(code: str) -> list[dict]:
    rows = []
    paths = [SRC / f"{season}-{code}.csv" for season in SEASONS]
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
                hg = int(raw_hg)
                ag = int(raw_ag)
                day = parse_date(row["Date"])
            except ValueError:
                continue
            odds = None
            try:
                h = float(row.get("B365H") or row.get("B365CH") or "")
                d = float(row.get("B365D") or row.get("B365CD") or "")
                a = float(row.get("B365A") or row.get("B365CA") or "")
                if h > 1 and d > 1 and a > 1:
                    margin = (1 / h + 1 / d + 1 / a) - 1
                    if 0 <= margin <= 0.15:
                        odds = shin(h, d, a)
            except (TypeError, ValueError):
                odds = None
            rows.append(
                {
                    "date": day,
                    "home": home,
                    "away": away,
                    "hg": hg,
                    "ag": ag,
                    "market": odds,
                }
            )
    rows.sort(key=lambda item: item["date"])
    return rows


def shin(h: float, d: float, a: float) -> tuple[float, float, float] | None:
    raw = [1 / h, 1 / d, 1 / a]
    total = sum(raw)
    lo, hi = 0.0, 0.4
    for _ in range(40):
        z = (lo + hi) / 2
        probs = []
        for q in raw:
            inner = z * z + 4 * (1 - z) * q * q / total
            probs.append((math.sqrt(inner) - z) / (2 * (1 - z)) if z < 0.999 else q / total)
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


def rps(probs: tuple[float, float, float], hg: int, ag: int) -> float:
    outcome = (1, 0, 0) if hg > ag else (0, 1, 0) if hg == ag else (0, 0, 1)
    c1 = probs[0] - outcome[0]
    c2 = probs[0] + probs[1] - outcome[0] - outcome[1]
    return 0.5 * (c1 * c1 + c2 * c2)


def fit(rows: list[dict], asof: datetime, reg: float) -> dict | None:
    names = sorted({row["home"] for row in rows} | {row["away"] for row in rows})
    if len(names) < 8 or len(rows) < 150:
        return None
    index = {name: i for i, name in enumerate(names)}
    n = len(names)
    dates = np.array([(asof - row["date"]).days for row in rows], dtype=float)
    weights = np.exp(-XI * np.clip(dates, 0, None))
    hg = np.array([row["hg"] for row in rows])
    ag = np.array([row["ag"] for row in rows])
    hi = np.array([index[row["home"]] for row in rows])
    ai = np.array([index[row["away"]] for row in rows])

    def unpack(theta: np.ndarray):
        att = np.zeros(n)
        deff = np.zeros(n)
        att[:-1] = theta[: n - 1]
        att[-1] = -att[:-1].sum()
        deff[:-1] = theta[n - 1 : 2 * (n - 1)]
        deff[-1] = -deff[:-1].sum()
        home = theta[-2]
        rho = theta[-1]
        return att, deff, home, rho

    def objective(theta: np.ndarray) -> float:
        att, deff, home, rho = unpack(theta)
        lh = np.exp(np.clip(att[hi] - deff[ai] + home, -2, 2))
        la = np.exp(np.clip(att[ai] - deff[hi], -2, 2))
        tau = np.ones(len(rows))
        tau = np.where((hg == 0) & (ag == 0), 1 - lh * la * rho, tau)
        tau = np.where((hg == 1) & (ag == 0), 1 + la * rho, tau)
        tau = np.where((hg == 0) & (ag == 1), 1 + lh * rho, tau)
        tau = np.where((hg == 1) & (ag == 1), 1 - rho, tau)
        if np.any(tau <= 0.01) or np.any(lh < 0.05) or np.any(la < 0.05):
            return 1e6
        logp = np.log(tau) + hg * np.log(lh) - lh - gammaln(hg + 1) + ag * np.log(la) - la - gammaln(ag + 1)
        penalty = reg * (np.sum(att * att) + np.sum(deff * deff))
        return float(-np.sum(weights * logp) + penalty)

    theta0 = np.zeros(2 * (n - 1) + 2)
    theta0[-2] = 0.2
    theta0[-1] = -0.05
    bounds = [(None, None)] * (2 * (n - 1)) + [(0.0, 0.6), (-0.2, 0.1)]
    result = minimize(objective, theta0, method="L-BFGS-B", bounds=bounds, options={"maxiter": 80})
    if not result.success and result.fun > 1e5:
        return None
    att, deff, home, rho = unpack(result.x)
    counts: dict[str, int] = {name: 0 for name in names}
    for row in rows:
        counts[row["home"]] += 1
        counts[row["away"]] += 1
    return {
        "home": float(home),
        "rho": float(rho),
        "teams": {
            name: {"att": float(att[i]), "def": float(deff[i]), "n": counts[name]}
            for i, name in enumerate(names)
        },
    }


def predict(model: dict, home: str, away: str) -> tuple[float, float] | None:
    th = model["teams"].get(home)
    ta = model["teams"].get(away)
    if not th or not ta or th["n"] < 6 or ta["n"] < 6:
        return None
    lh = math.exp(min(2, max(-2, th["att"] - ta["def"] + model["home"])))
    la = math.exp(min(2, max(-2, ta["att"] - th["def"])))
    return lh, la


def matrix_probs(lh: float, la: float, rho: float) -> tuple[float, float, float]:
    ph = pd = pa = mass = 0.0
    for hg in range(0, 11):
        for ag in range(0, 11):
            tau = 1.0
            if hg == 0 and ag == 0:
                tau = 1 - lh * la * rho
            elif hg == 1 and ag == 0:
                tau = 1 + la * rho
            elif hg == 0 and ag == 1:
                tau = 1 + lh * rho
            elif hg == 1 and ag == 1:
                tau = 1 - rho
            if tau <= 0:
                tau = 1e-6
            p = math.exp(-lh) * lh**hg / math.factorial(hg) * math.exp(-la) * la**ag / math.factorial(ag) * tau
            mass += p
            if hg > ag:
                ph += p
            elif hg == ag:
                pd += p
            else:
                pa += p
    return ph / mass, pd / mass, pa / mass


def baseline(history: list[dict], home: str, away: str) -> tuple[float, float, float] | None:
    def rate(team: str, attack: bool, venue: str | None) -> tuple[float, int]:
        goals = games = 0
        for row in history:
            if venue == "home" and row["home"] != team:
                continue
            if venue == "away" and row["away"] != team:
                continue
            if venue is None and team not in (row["home"], row["away"]):
                continue
            if team == row["home"]:
                goals += row["hg"] if attack else row["ag"]
            else:
                goals += row["ag"] if attack else row["hg"]
            games += 1
        return (goals / games if games else 1.25), games

    hf, hn = rate(home, True, "home")
    ha, _ = rate(home, False, "home")
    af, an = rate(away, True, "away")
    aa, _ = rate(away, False, "away")
    if hn < 6:
        hf, hn = rate(home, True, None)
        ha, _ = rate(home, False, None)
    if an < 6:
        af, an = rate(away, True, None)
        aa, _ = rate(away, False, None)
    if hn < 1 or an < 1:
        return None
    league = []
    for row in history:
        league.append(row["hg"] + row["ag"])
    avg = (sum(league) / len(league) / 2) if league else 1.25

    def shrink(obs: float, n: int) -> float:
        return (n * obs + 6 * avg) / (n + 6)

    lh = shrink(hf, hn) * shrink(aa, an) / avg if avg else shrink(hf, hn)
    la = shrink(af, an) * shrink(ha, hn) / avg if avg else shrink(af, an)
    lh = min(4, max(0.2, lh))
    la = min(4, max(0.2, la))
    return matrix_probs(lh, la, -0.08)


def walk(rows: list[dict], reg: float, start: datetime, end: datetime) -> dict:
    model_r = base_r = mkt_r = 0.0
    n = nb = nm = 0
    dates = sorted({row["date"] for row in rows if start <= row["date"] < end})
    weeks: list[datetime] = []
    for day in dates:
        if not weeks or (day - weeks[-1]).days >= 7:
            weeks.append(day)
    cache: dict | None = None
    cache_until = datetime.min
    for day in dates:
        past = [row for row in rows if row["date"] < day]
        if len(past) < 150:
            continue
        if day >= cache_until or cache is None:
            cache = fit([row for row in rows if row["date"] < day], day, reg)
            cache_until = day + __import__("datetime").timedelta(days=7)
        todays = [row for row in rows if row["date"] == day]
        for row in todays:
            if not cache:
                continue
            pred = predict(cache, row["home"], row["away"])
            if not pred:
                continue
            probs = matrix_probs(pred[0], pred[1], cache["rho"])
            model_r += rps(probs, row["hg"], row["ag"])
            n += 1
            base = baseline(past, row["home"], row["away"])
            if base:
                base_r += rps(base, row["hg"], row["ag"])
                nb += 1
            if row["market"]:
                mkt_r += rps(row["market"], row["hg"], row["ag"])
                nm += 1
    return {
        "n": n,
        "rpsModel": model_r / n if n else None,
        "rpsBaseline": base_r / nb if nb else None,
        "rpsMarket": mkt_r / nm if nm else None,
        "nMarket": nm,
    }


def main() -> None:
    import sys
    chosen = set(sys.argv[1:])
    existing_path = ROOT / "data/dixon.json"
    existing = json.loads(existing_path.read_text()) if existing_path.exists() else {}
    report = dict(existing.get("report") or {})
    published = dict(existing.get("leagues") or {})
    items = [(league, code) for league, code in LEAGUES.items() if not chosen or league in chosen]
    for league, code in items:
        rows = load(code)
        print(league, "rows", len(rows), flush=True)
        tune = []
        for reg in (0.01, 0.05):
            score = walk(rows, reg, datetime(2025, 8, 1), datetime(2026, 6, 1))
            tune.append({"reg": reg, **score})
            print(" tune", reg, score, flush=True)
        usable = [item for item in tune if item["rpsModel"] is not None]
        best = min(usable, key=lambda item: item["rpsModel"]) if usable else None
        holdout = walk(rows, best["reg"], datetime(2026, 8, 1), ASOF) if best else None
        print(" holdout", holdout, flush=True)
        best_tune = next((item for item in tune if best and item["reg"] == best["reg"]), None)
        improved = bool(
            best
            and best_tune
            and best_tune["rpsBaseline"] is not None
            and best_tune["rpsModel"] < best_tune["rpsBaseline"]
            and holdout
            and holdout["n"] >= 20
            and holdout["rpsBaseline"] is not None
            and holdout["rpsModel"] < holdout["rpsBaseline"]
        )
        hold_n = holdout["n"] if holdout else 0
        already = league in published
        if hold_n >= 300:
            model = fit([row for row in rows if row["date"] < ASOF], ASOF, best["reg"] if best else 0.05)
            if improved and model:
                aliases = ALIAS.get(league)
                teams = {}
                if aliases:
                    for canonical, names in aliases.items():
                        source = next((name for name in names if name in model["teams"]), None)
                        if not source:
                            continue
                        row = model["teams"][source]
                        teams[canonical] = {**row, "also": names}
                else:
                    for name, row in model["teams"].items():
                        teams[name] = {**row, "also": [name]}
                published[league] = {"home": model["home"], "rho": model["rho"], "teams": teams}
            elif league in published:
                del published[league]
        report[league] = {
            "tune": tune,
            "holdout": holdout,
            "published": league in published,
            "reg": best["reg"] if best else None,
            "rows": len(rows),
            "oos": hold_n,
            "reviewAt": 300,
            "keptUntil300": hold_n < 300 and already,
        }
        (ROOT / "data/dixon-report.json").write_text(json.dumps(report, ensure_ascii=False))
        out = {
            "source": "https://www.football-data.co.uk/",
            "seasons": SEASONS,
            "fetchedAt": "2026-10-05T02:45-05:00",
            "xiPerDay": XI,
            "halfLifeDays": 120,
            "asof": "2026-10-04",
            "rule": "Nivel A solo si el RPS baja en la ventana de ajuste 2025/26 y también en 2026/27 hasta el 4 oct, medido con datos anteriores a cada fecha.",
            "leagues": published,
            "report": report,
        }
        existing_path.write_text(json.dumps(out, ensure_ascii=False))
    print("published", [league for league, row in report.items() if row.get("published")])


if __name__ == "__main__":
    main()
