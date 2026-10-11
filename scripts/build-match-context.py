"""Contexto previo al pitido. No usa un partido con fecha igual o posterior."""

import json
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
snap = json.loads((ROOT / "data/snapshot.json").read_text())
sheets = json.loads((ROOT / "data/sheets.json").read_text())["byFixture"]
names = {team["id"]: team["name"] for team in snap["teams"]}
HALF_LIFE_DAYS = 120


def norm(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return "".join(ch for ch in text.lower() if ch.isalnum())


def parse_score(score: str | None):
    if not score:
        return None
    parts = score.replace("–", "-").replace("—", "-").split("-")
    if len(parts) != 2:
        return None
    try:
        return int(parts[0].strip()), int(parts[1].strip())
    except ValueError:
        return None


def goals_for_side(row):
    parsed = parse_score(row.get("score"))
    if not parsed:
        return None
    home_goals, away_goals = parsed
    if row.get("side") == "home":
        return home_goals, away_goals
    if row.get("side") == "away":
        return away_goals, home_goals
    return None


def prior_rows(history, kickoff):
    rows = []
    for row in history or []:
        ts = row.get("ts")
        if not isinstance(ts, (int, float)) or ts >= kickoff:
            continue
        parsed = goals_for_side(row)
        if not parsed:
            continue
        rows.append((ts, parsed[0], parsed[1], row))
    rows.sort(key=lambda item: item[0], reverse=True)
    return rows[:10]


def decay(rows, kickoff):
    weighted_for = 0.0
    weighted_against = 0.0
    weight = 0.0
    for ts, gf, ga, _row in rows:
        age_days = max(0.0, (kickoff - ts) / 86400)
        w = 0.5 ** (age_days / HALF_LIFE_DAYS)
        weighted_for += w * gf
        weighted_against += w * ga
        weight += w
    if weight <= 0 or len(rows) < 4:
        return None, None
    return weighted_for / weight, weighted_against / weight


def lineup_ok(record):
    players = record.get("players") or []
    return sum(1 for player in players if player.get("role") == "titular") >= 11


def h2h(history, opponent, kickoff):
    target = norm(opponent)
    n = 0
    gf = 0
    ga = 0
    for row in history or []:
        ts = row.get("ts")
        if not isinstance(ts, (int, float)) or ts >= kickoff or kickoff - ts > 3 * 365 * 86400:
            continue
        other = row.get("away") if row.get("side") == "home" else row.get("home")
        if norm(str(other or "")) != target:
            continue
        parsed = goals_for_side(row)
        if not parsed:
            continue
        n += 1
        gf += parsed[0]
        ga += parsed[1]
    return n, gf, ga


by_fixture = {}
leaks = 0
for fixture in snap["fixtures"]:
    sheet = sheets.get(fixture["id"])
    if not sheet:
        continue
    kickoff = datetime.fromisoformat(fixture["kickoff"].replace("Z", "+00:00")).timestamp()
    home_rows = prior_rows(sheet["home"].get("history"), kickoff)
    away_rows = prior_rows(sheet["away"].get("history"), kickoff)
    if any(ts >= kickoff for ts, *_ in home_rows + away_rows):
        leaks += 1
    home_for, home_against = decay(home_rows, kickoff)
    away_for, away_against = decay(away_rows, kickoff)
    home_rest = round((kickoff - home_rows[0][0]) / 86400, 2) if home_rows else None
    away_rest = round((kickoff - away_rows[0][0]) / 86400, 2) if away_rows else None
    h2h_n, h2h_gf, h2h_ga = h2h(sheet["home"].get("history"), names.get(fixture["awayId"], ""), kickoff)
    by_fixture[fixture["id"]] = {
        "homeRest": home_rest,
        "awayRest": away_rest,
        "homeFor": None if home_for is None else round(home_for, 3),
        "homeAgainst": None if home_against is None else round(home_against, 3),
        "homeN": len(home_rows),
        "awayFor": None if away_for is None else round(away_for, 3),
        "awayAgainst": None if away_against is None else round(away_against, 3),
        "awayN": len(away_rows),
        "lineupHome": lineup_ok(sheet["home"]),
        "lineupAway": lineup_ok(sheet["away"]),
        "h2hN": h2h_n,
        "h2hHomeGf": h2h_gf,
        "h2hAwayGf": h2h_ga,
    }

out = {
    "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
    "rule": "Solo partidos con marca de tiempo anterior al inicio. Vida media de 120 dias. Sin xG por fecha: el decaimiento usa goles.",
    "byFixture": by_fixture,
}
(ROOT / "data/match-context.json").write_text(json.dumps(out, ensure_ascii=False))
print("contexts", len(by_fixture), "leaks", leaks)
