#!/usr/bin/env python3
"""Descarga partidos y tablas reales. No inventa cifras."""

import json
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

OUT = Path("/workspace/data/snapshot.json")
UA = {"User-Agent": "Mozilla/5.0"}

LEAGUES = [
    ("col.1", "colombia", "2026-10-03", "2026-10-12"),
    ("arg.1", "argentina", "2026-10-03", "2026-10-12"),
    ("bra.1", "brasileirao", "2026-10-03", "2026-10-12"),
    ("eng.1", "epl", "2026-10-09", "2026-10-14"),
    ("esp.1", "laliga", "2026-10-09", "2026-10-14"),
    ("ger.1", "bundesliga", "2026-10-09", "2026-10-14"),
    ("ita.1", "seriea", "2026-10-09", "2026-10-14"),
    ("fra.1", "ligue1", "2026-10-09", "2026-10-14"),
    ("mex.1", "ligamx", "2026-10-09", "2026-10-14"),
    ("usa.1", "mls", "2026-10-03", "2026-10-12"),
    ("ned.1", "eredivisie", "2026-10-09", "2026-10-14"),
    ("por.1", "portugal", "2026-10-09", "2026-10-14"),
    ("uefa.champions", "ucl", "2026-10-13", "2026-10-14"),
    ("uefa.nations", "selecciones", "2026-10-03", "2026-10-06"),
    ("fifa.friendly", "selecciones", "2026-10-03", "2026-10-06"),
]


def get(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as res:
        return json.load(res)


def dates(start: str, end: str):
    a = date.fromisoformat(start)
    b = date.fromisoformat(end)
    cur = a
    while cur <= b:
        yield cur.strftime("%Y%m%d")
        cur += timedelta(days=1)


def american(raw):
    if raw is None:
        return None
    text = str(raw).replace("+", "").strip()
    if not text or text in {"OFF", "EV"}:
        return None
    try:
        n = int(text)
    except ValueError:
        return None
    if n == 0:
        return None
    if n > 0:
        return round(1 + n / 100, 2)
    return round(1 + 100 / abs(n), 2)


def stat_map(stats):
    out = {}
    for item in stats or []:
        out[item.get("name")] = item.get("value")
    return out


def pull_standings(slug: str, league_id: str, teams: dict):
    try:
        data = get(f"https://site.api.espn.com/apis/v2/sports/soccer/{slug}/standings")
    except Exception as exc:
        print("standings fail", slug, exc)
        return
    children = data.get("children") or []
    blocks = children or [data]
    for block in blocks:
        standings = (block.get("standings") or {})
        entries = standings.get("entries") or []
        if not entries and "standings" not in block:
            continue
        label = block.get("name") or data.get("name") or slug
        for entry in entries:
            team = entry["team"]
            if slug == "uefa.champions" and team["id"] in teams:
                continue
            stats = stat_map(entry.get("stats"))
            gp = int(stats.get("gamesPlayed") or 0)
            teams[team["id"]] = {
                "id": team["id"],
                "name": team.get("displayName") or team.get("name"),
                "short": team.get("abbreviation") or team["id"],
                "leagueId": league_id,
                "gp": gp,
                "w": int(stats.get("wins") or 0),
                "d": int(stats.get("ties") or 0),
                "l": int(stats.get("losses") or 0),
                "gf": int(stats.get("pointsFor") or 0),
                "ga": int(stats.get("pointsAgainst") or 0),
                "pts": int(stats.get("points") or 0),
                "form": "",
                "table": label,
                "source": f"ESPN standings {slug}",
            }
        if entries:
            print(f"  table {slug} {label}: {len(entries)}")


def pull_fixtures(slug: str, league_id: str, start: str, end: str, fixtures: list, teams: dict):
    for day in dates(start, end):
        url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard?dates={day}"
        try:
            data = get(url)
        except Exception as exc:
            print("scoreboard fail", slug, day, exc)
            continue
        for event in data.get("events") or []:
            comp = (event.get("competitions") or [None])[0]
            if not comp:
                continue
            status = ((comp.get("status") or {}).get("type") or {})
            state = status.get("name") or ""
            if state in {"STATUS_CANCELED", "STATUS_POSTPONED"}:
                continue
            if status.get("completed"):
                continue
            comps = comp.get("competitors") or []
            home = next((t for t in comps if t.get("homeAway") == "home"), None)
            away = next((t for t in comps if t.get("homeAway") == "away"), None)
            if not home or not away:
                continue
            for side in (home, away):
                tid = side["team"]["id"]
                if tid not in teams:
                    teams[tid] = {
                        "id": tid,
                        "name": side["team"].get("displayName"),
                        "short": side["team"].get("abbreviation") or tid,
                        "leagueId": league_id,
                        "gp": 0,
                        "w": 0,
                        "d": 0,
                        "l": 0,
                        "gf": 0,
                        "ga": 0,
                        "pts": 0,
                        "form": side.get("form") if isinstance(side.get("form"), str) else "",
                        "table": "",
                        "source": f"ESPN scoreboard {slug}",
                    }
                elif isinstance(side.get("form"), str) and side["form"]:
                    teams[tid]["form"] = side["form"]
            market = None
            odds = (comp.get("odds") or [None])[0]
            if odds and odds.get("provider"):
                ml = odds.get("moneyline") or {}
                total = odds.get("total") or {}
                market = {
                    "provider": odds["provider"].get("name") or "ESPN",
                    "home": american(((ml.get("home") or {}).get("close") or {}).get("odds")),
                    "draw": american(((ml.get("draw") or {}).get("close") or {}).get("odds")),
                    "away": american(((ml.get("away") or {}).get("close") or {}).get("odds")),
                    "over": american((((total.get("over") or {}).get("close") or {}).get("odds"))),
                    "under": american((((total.get("under") or {}).get("close") or {}).get("odds"))),
                    "line": odds.get("overUnder"),
                }
            note = None
            notes = comp.get("notes") or []
            if notes and isinstance(notes[0], dict):
                note = notes[0].get("headline")
            season = event.get("season") or {}
            season_type = (event.get("seasonType") or {}) if isinstance(event.get("seasonType"), dict) else {}
            round_name = season_type.get("name") or season.get("slug") or slug
            group = (comp.get("group") or {}).get("name")
            if group:
                round_name = f"{round_name} · {group}"
            fixtures.append(
                {
                    "id": event["id"],
                    "leagueId": league_id,
                    "competition": slug,
                    "kickoff": event["date"],
                    "homeId": home["team"]["id"],
                    "awayId": away["team"]["id"],
                    "venue": (comp.get("venue") or {}).get("fullName") or "",
                    "round": round_name,
                    "note": note,
                    "status": state,
                    "market": market,
                    "source": "ESPN scoreboard",
                }
            )
        time.sleep(0.05)


def pull_split(team_id: str, league_slug: str, season_hint: str):
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league_slug}/teams/{team_id}/schedule"
    data = get(url)
    hint = (season_hint or "").lower()

    def consume(events, strict: bool):
        home = {"gp": 0, "gf": 0, "ga": 0}
        away = {"gp": 0, "gf": 0, "ga": 0}
        recent = []
        for event in events:
            comp = (event.get("competitions") or [None])[0]
            if not comp:
                continue
            status = ((comp.get("status") or {}).get("type") or {})
            if not status.get("completed"):
                continue
            season_type = ((event.get("seasonType") or {}).get("name") or "").lower()
            if strict and hint and season_type and hint not in season_type and season_type not in hint:
                continue
            sides = comp.get("competitors") or []
            me = next((s for s in sides if s.get("id") == team_id or (s.get("team") or {}).get("id") == team_id), None)
            opp = next((s for s in sides if s is not me), None)
            if not me or not opp:
                continue
            try:
                gf = int(float((me.get("score") or {}).get("value")))
                ga = int(float((opp.get("score") or {}).get("value")))
            except (TypeError, ValueError):
                continue
            bucket = home if me.get("homeAway") == "home" else away
            bucket["gp"] += 1
            bucket["gf"] += gf
            bucket["ga"] += ga
            recent.append((event["date"], "W" if gf > ga else "D" if gf == ga else "L"))
        recent.sort()
        return home, away, "".join(mark for _, mark in recent[-5:])

    events = data.get("events") or []
    home, away, form = consume(events, True)
    if home["gp"] + away["gp"] == 0:
        home, away, form = consume(events, False)
    return home, away, form


def main():
    teams = {}
    fixtures = []
    for slug, league_id, _a, _b in LEAGUES:
        if slug != "fifa.friendly":
            pull_standings(slug, league_id, teams)
    for slug, league_id, start, end in LEAGUES:
        print("fixtures", slug)
        pull_fixtures(slug, league_id, start, end, fixtures, teams)
    # dedupe fixtures
    seen = set()
    unique = []
    for fixture in fixtures:
        if fixture["id"] in seen:
            continue
        seen.add(fixture["id"])
        unique.append(fixture)
    need = sorted({tid for f in unique for tid in (f["homeId"], f["awayId"])})
    print("schedules", len(need))
    slug_for = {}
    for slug, league_id, _a, _b in LEAGUES:
        slug_for.setdefault(league_id, slug)
    for index, tid in enumerate(need):
        team = teams[tid]
        slug = slug_for.get(team["leagueId"], "fifa.friendly")
        if team["leagueId"] == "selecciones":
            slug = "uefa.nations"
        try:
            home, away, form = pull_split(tid, slug, team.get("table") or "")
        except Exception:
            try:
                home, away, form = pull_split(tid, "fifa.friendly", "")
            except Exception as exc:
                print(" schedule fail", tid, exc)
                continue
        team["home"] = home
        team["away"] = away
        if form:
            team["form"] = form
        if team["gp"] == 0:
            team["gp"] = home["gp"] + away["gp"]
            team["gf"] = home["gf"] + away["gf"]
            team["ga"] = home["ga"] + away["ga"]
        if index % 20 == 0:
            print("  split", index, team["name"])
        time.sleep(0.08)
    payload = {
        "fetchedAt": "2026-10-03T06:40:00Z",
        "sources": [
            "https://site.api.espn.com/apis/site/v2/sports/soccer",
            "https://site.api.espn.com/apis/v2/sports/soccer",
            "https://es.besoccer.com/ (tablero del 3 oct 2026; las fichas de equipo devolvieron 406)",
        ],
        "teams": list(teams.values()),
        "fixtures": unique,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False))
    print("wrote", OUT, "teams", len(teams), "fixtures", len(unique))


if __name__ == "__main__":
    main()
