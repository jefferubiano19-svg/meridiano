"""Calibración de la conversión Elo, estimada antes de 2025 y probada en 2025-2026."""

import csv
import json
import math
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

ROOT = Path(__file__).resolve().parents[1]
CUT = datetime(2025, 1, 1)
END = datetime(2026, 10, 5)


def page_names():
    names = {}
    for line in Path("/tmp/en.teams.tsv").read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts[0]) != 2:
            continue
        names[parts[0]] = [part for part in parts[1:] if part and not part.startswith("in ")]
    extra = {
        "United States": "US",
        "USA": "US",
        "Czech Republic": "CZ",
        "Republic of Ireland": "IE",
        "Ireland": "IE",
        "Ivory Coast": "CI",
        "Côte d'Ivoire": "CI",
        "DR Congo": "CD",
        "Congo DR": "CD",
        "South Korea": "KR",
        "Korea Republic": "KR",
        "North Korea": "KP",
        "China PR": "CN",
        "Bosnia and Herzegovina": "BA",
        "Turkey": "TR",
        "Türkiye": "TR",
        "Cape Verde": "CV",
        "Cabo Verde": "CV",
        "The Gambia": "GM",
        "Gambia": "GM",
        "Kyrgyzstan": "KG",
        "Kyrgyz Republic": "KG",
    }
    lookup = {}
    for code, labels in names.items():
        for label in labels:
            lookup[label] = code
    for label, code in extra.items():
        if code in names:
            lookup[label] = code
    return lookup


def elo_history():
    history = defaultdict(dict)
    for path in Path("/tmp/elo").glob("*.tsv"):
        code = path.stem
        last = None
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            fields = line.split("\t")
            if len(fields) < 12:
                continue
            try:
                day = datetime(int(fields[0]), int(fields[1]), int(fields[2]))
                post = int(fields[10]) if fields[3] == code else int(fields[11])
            except ValueError:
                continue
            if fields[3] != code and fields[4] != code:
                continue
            if last is not None:
                history[code][day.date().isoformat()] = last
            last = post
    return history


def fit(sample):
    hg = np.array([row[0] for row in sample], float)
    ag = np.array([row[1] for row in sample], float)
    diff = np.array([(row[2] - row[3]) / 400 for row in sample], float)
    home = np.array([row[4] for row in sample], float)

    def nll(theta):
        mu, adv, gamma = theta
        lh = np.exp(np.clip(mu + adv * home + gamma * diff, -3, 2))
        la = np.exp(np.clip(mu - gamma * diff, -3, 2))
        return float(np.sum(lh - hg * np.log(lh) + la - ag * np.log(la)))

    result = minimize(nll, [0.1, 0.25, 0.7], method="Nelder-Mead")
    return {"mu": float(result.x[0]), "home": float(result.x[1]), "gamma": float(result.x[2]), "n": len(sample)}


def probs(fit_row, elo_home, elo_away, home_flag):
    diff = (elo_home - elo_away) / 400
    lh = math.exp(min(2, max(-3, fit_row["mu"] + fit_row["home"] * home_flag + fit_row["gamma"] * diff)))
    la = math.exp(min(2, max(-3, fit_row["mu"] - fit_row["gamma"] * diff)))
    lh, la = min(4, max(0.2, lh)), min(4, max(0.2, la))
    ph = pd = pa = mass = 0.0
    for hg in range(11):
        for ag in range(11):
            tau = 1.0
            if hg == 0 and ag == 0:
                tau = 1 - lh * la * -0.08
            elif hg == 1 and ag == 0:
                tau = 1 + la * -0.08
            elif hg == 0 and ag == 1:
                tau = 1 + lh * -0.08
            elif hg == 1 and ag == 1:
                tau = 1 - -0.08
            p = math.exp(-lh - la) * lh**hg / math.factorial(hg) * la**ag / math.factorial(ag) * max(tau, 1e-6)
            mass += p
            if hg > ag:
                ph += p
            elif hg == ag:
                pd += p
            else:
                pa += p
    return ph / mass, pd / mass, pa / mass


def scaled(model, row, temperature):
    raw = probs(model, row[2], row[3], row[4])
    if temperature == 1:
        return raw
    logits = [math.log(max(p, 1e-6)) / temperature for p in raw]
    top = max(logits)
    weights = [math.exp(item - top) for item in logits]
    total = sum(weights)
    return tuple(item / total for item in weights)


def rps(probabilities, row):
    outcome = (1, 0, 0) if row[0] > row[1] else (0, 1, 0) if row[0] == row[1] else (0, 0, 1)
    first = probabilities[0] - outcome[0]
    second = probabilities[0] + probabilities[1] - outcome[0] - outcome[1]
    return 0.5 * (first * first + second * second)
    groups = defaultdict(lambda: [0, 0.0, 0.0])
    for hg, ag, elo_home, elo_away, home_flag in rows:
        p = probs(model, elo_home, elo_away, home_flag)
        index = max(range(3), key=lambda i: p[i])
        outcome = 0 if hg > ag else 1 if hg == ag else 2
        key = min(9, int(p[index] * 10))
        groups[key][0] += 1
        groups[key][1] += p[index]
        groups[key][2] += 1 if index == outcome else 0
    return [
        {"bin": f"{key * 10}-{(key + 1) * 10}", "n": values[0], "pred": round(values[1] / values[0], 3), "real": round(values[2] / values[0], 3)}
        for key, values in sorted(groups.items())
        if values[0]
    ]


def bins(rows, model, temperature=1):
    groups = defaultdict(lambda: [0, 0.0, 0.0])
    total = 0.0
    for row in rows:
        p = scaled(model, row, temperature)
        index = max(range(3), key=lambda i: p[i])
        outcome = 0 if row[0] > row[1] else 1 if row[0] == row[1] else 2
        key = min(9, int(p[index] * 10))
        groups[key][0] += 1
        groups[key][1] += p[index]
        groups[key][2] += 1 if index == outcome else 0
        total += rps(p, row)
    return {
        "rps": total / len(rows) if rows else None,
        "bins": [
            {
                "bin": f"{key * 10}-{(key + 1) * 10}",
                "n": values[0],
                "pred": round(values[1] / values[0], 3),
                "real": round(values[2] / values[0], 3),
            }
            for key, values in sorted(groups.items())
            if values[0] >= 20
        ],
    }


def main():
    lookup = page_names()
    history = elo_history()
    train, test = [], []
    missing = defaultdict(int)
    used = 0
    with Path("/tmp/international_results.csv").open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            day = datetime.strptime(row["date"], "%Y-%m-%d")
            if day.year < 2010 or day >= END:
                continue
            if any(token in row["tournament"] for token in ("U-1", "U-2", "Olympic")):
                continue
            home = lookup.get(row["home_team"])
            away = lookup.get(row["away_team"])
            if not home or not away:
                missing[row["home_team"] if not home else row["away_team"]] += 1
                continue
            elo_home = history[home].get(day.date().isoformat())
            elo_away = history[away].get(day.date().isoformat())
            if elo_home is None or elo_away is None:
                continue
            item = (int(row["home_score"]), int(row["away_score"]), elo_home, elo_away, 0.0 if row["neutral"] == "TRUE" else 1.0)
            used += 1
            (train if day < CUT else test).append(item)
    model = fit(train)
    options = []
    tested_grid = []
    for step in range(16, 25):
        temperature = step / 20
        score = bins(train, model, temperature)
        options.append((temperature, score["rps"]))
        tested_grid.append((temperature, bins(test, model, temperature)["rps"]))
    below = [item for item in options if item[0] < 1]
    chosen = min(below, key=lambda item: item[1])
    plain = bins(test, model, 1)
    tested = bins(test, model, chosen[0])
    report = {
        "source": "github.com/martj42/international_results y Elo previo de eloratings.net",
        "fit": model,
        "train": len(train),
        "test": len(test),
        "temperature": chosen[0],
        "trainRps": options,
        "without": plain,
        "with": tested,
        "testRps": tested_grid,
        "adopt": False,
        "unmatched": sorted(missing.items(), key=lambda item: -item[1])[:8],
    }
    Path("/tmp/elo-calibration.json").write_text(json.dumps(report, ensure_ascii=False))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
