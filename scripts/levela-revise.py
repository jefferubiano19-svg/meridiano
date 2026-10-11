"""Temperatura del Nivel A con peso 0,5, ventaja de local reciente y distancia por grupo."""

import json
import math
from datetime import datetime
from importlib.machinery import SourceFileLoader
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
cal = SourceFileLoader("cal92", str(ROOT / "scripts/calibration-92.py")).load_module()
FIT = cal.FIT
MAIN = {
    "epl", "championship", "league-one", "league-two", "conference", "scotland",
    "scotland-champ", "scotland-l1", "scotland-l2", "bundesliga", "bundesliga2",
    "seriea", "serieb", "laliga", "laliga2", "ligue1", "ligue2", "eredivisie",
    "belgium", "portugal", "turkey", "greece",
}


def fit_league(item):
    name, code = item
    rows = cal.load(code)
    for row in rows:
        row["league"] = name
    model = FIT.fit([row for row in rows if row["date"] < cal.TUNE[0]], cal.TUNE[0], 0.01)
    print(name, "ok" if model else "no", flush=True)
    return name, rows, model


def recent_home(rows):
    scored = against = 0.0
    for row in rows:
        if row["date"] >= datetime(2026, 8, 1):
            continue
        year = row["date"].year if row["date"].month >= 8 else row["date"].year - 1
        weight = {2025: 4, 2024: 2, 2023: 1}.get(year, 0.5)
        scored += weight * row["hg"]
        against += weight * row["ag"]
    if scored <= 0 or against <= 0:
        return None
    return math.log(scored / against)


def predict_home(model, home, away, advantage):
    left = model["teams"].get(home)
    right = model["teams"].get(away)
    if not left or not right or left["n"] < 6 or right["n"] < 6:
        return None
    return (
        math.exp(min(2, max(-2, left["att"] - right["def"] + advantage))),
        math.exp(min(2, max(-2, right["att"] - left["def"]))),
    )


def blend(window, lambdas, market_lambda, row, rho):
    home = 0.5 * lambdas[0] + 0.5 * market_lambda[0]
    away = 0.5 * lambdas[1] + 0.5 * market_lambda[1]
    return window, cal.probs_of(home, away, rho), row


def search_temperature(items):
    found = []
    for step in range(14, 31):
        temperature = step / 20
        score = cal.paired(items, "tune", temperature)
        if score:
            found.append((temperature, score))
    by_distance = min(found, key=lambda item: item[1]["distance"])
    by_rps = min(found, key=lambda item: item[1]["rps"])
    return by_distance, by_rps, found


def main():
    with Pool(4) as pool:
        fitted = pool.map(fit_league, list(FIT.LEAGUES.items()))
    variant = []
    recent = []
    advantages = []
    for name, rows, model in fitted:
        if not model:
            continue
        walked = cal.walk(rows, model)
        for item in walked["Aplus"]:
            variant.append(blend(*item))
        advantage = recent_home(rows)
        advantages.append({"league": name, "fitted": round(model["home"], 3), "recent": None if advantage is None else round(advantage, 3)})
        if advantage is None:
            continue
        for window, lambdas, market_lambda, row, rho in walked["Aplus"]:
            adjusted = predict_home(model, row["home"], row["away"], advantage)
            if adjusted and window == "hold":
                recent.append(blend(window, adjusted, market_lambda, row, rho))
                variant_hold = blend(window, lambdas, market_lambda, row, rho)
                variant_hold[2]["paired"] = True
    base = [item for item in variant if item[2].get("paired")]
    chosen, by_rps, grid = search_temperature(variant)
    hold_plain = cal.paired(variant, "hold", 1)
    hold_temp = cal.paired(variant, "hold", chosen[0])
    report = {
        "temperatureChosenOn": "2025/26",
        "objective": "distancia al Shin en los mismos partidos",
        "temperature": chosen[0],
        "tune": chosen[1],
        "rpsTemperature": by_rps[0],
        "holdoutWithout": hold_plain,
        "holdoutWith": hold_temp,
        "publishTemperature": bool(hold_temp and hold_plain and hold_temp["distance"] < hold_plain["distance"]),
        "groups": {},
        "home": {
            "advantages": advantages,
            "without": cal.paired(base, "hold", 1),
            "withRecent": cal.paired(recent, "hold", 1),
        },
    }
    for label, names in (("main", MAIN), ("extra", set(FIT.LEAGUES) - MAIN)):
        subset = [item for item in variant if item[2].get("league") in names]
        report["groups"][label] = {
            "without": cal.paired(subset, "hold", 1),
            "with": cal.paired(subset, "hold", chosen[0]),
        }
    path = ROOT / "data/levela-revise.json"
    path.write_text(json.dumps(report, ensure_ascii=False))
    print(json.dumps({k: report[k] for k in ("temperature", "tune", "holdoutWithout", "holdoutWith", "publishTemperature", "groups", "home")}, ensure_ascii=False, indent=2)[:4000])


if __name__ == "__main__":
    main()
