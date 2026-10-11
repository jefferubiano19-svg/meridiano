#!/usr/bin/env python3
"""xG y córners de FotMob, Elo de selecciones de EloRatings. No inventa huecos."""

import gzip
import json
import re
import unicodedata
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path

SNAP = Path("/workspace/data/snapshot.json")
UA = {"User-Agent": "Mozilla/5.0"}

LEAGUE_IDS = {
    "epl": [47],
    "laliga": [87],
    "bundesliga": [54],
    "seriea": [55],
    "ligue1": [53],
    "eredivisie": [57],
    "portugal": [61],
    "ligamx": [230],
    "mls": [130],
    "brasileirao": [268],
    "argentina": [112],
    "colombia": [274],
    "ucl": [42],
    "selecciones": [9806, 9807, 9808, 9809],
}


def get(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as res:
        raw = res.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw


def norm(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    text = text.lower().replace("&", " and ")
    for word in ("fc", "cf", "sc", "afc", "ac"):
        text = re.sub(rf"\b{word}\b", " ", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


ALIASES = {
    "atletico junior": "junior",
    "deportes tolima": "tolima",
    "boyaca chico": "chico",
    "platense": "club atletico platense",
    "cologne": "1 koln",
    "tsg hoffenheim": "hoffenheim",
    "lafc": "los angeles",
    "estrela": "estrela da amadora",
    "c d nacional": "nacional",
    "lask linz": "lask",
    "viking fk": "viking",
    "republic of ireland": "ireland",
    "kyrgyz republic": "kyrgyzstan",
    "congo dr": "dr congo",
    "jaguares de cordoba": "jaguares",
    "fortaleza ceif": "fortaleza",
    "independiente santa fe": "santa fe",
    "atletico bucaramanga": "bucaramanga",
    "estudiantes de la plata": "estudiantes",
    "talleres cordoba": "talleres",
    "union santa fe": "union",
    "instituto cordoba": "instituto",
    "central cordoba santiago del estero": "central cordoba",
    "belgrano cordoba": "belgrano",
    "gimnasia la plata": "gimnasia",
    "sarmiento junin": "sarmiento",
    "red bull bragantino": "bragantino",
    "bayern munich": "bayern munchen",
    "mainz": "mainz 05",
    "fc cologne": "koln",
    "1 fc union berlin": "union berlin",
    "as roma": "roma",
    "internazionale": "inter",
    "as monaco": "monaco",
    "stade rennais": "rennes",
    "aj auxerre": "auxerre",
    "guadalajara": "chivas",
    "pumas unam": "pumas",
    "tigres uanl": "tigres",
    "d c united": "dc united",
    "feyenoord rotterdam": "feyenoord",
    "ajax amsterdam": "ajax",
    "academico de viseu": "academico viseu",
    "deportivo": "deportivo a coruna",
    "czechia": "czech republic",
    "turkey": "turkiye",
    "turkiye": "turkey",
    "bosnia herzegovina": "bosnia and herzegovina",
    "cucuta deportivo": "cucuta",
    "jaguares de cordoba": "cd jaguares",
    "central cordoba santiago del estero": "central cordoba de santiago",
    "gimnasia la plata": "gimnasia lp",
    "red bull bragantino": "rb bragantino",
    "alaves": "deportivo alaves",
    "cape verde islands": "cape verde",
}

def load_elo():
    teams = {}
    for line in Path("/tmp/en.teams.tsv").read_text(errors="ignore").splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            teams[parts[0]] = parts[1]
    elo = {}
    for line in Path("/tmp/World.tsv").read_text(errors="ignore").splitlines():
        fields = line.split("\t")
        if len(fields) < 4:
            continue
        code = fields[2]
        name = teams.get(code)
        if not name:
            continue
        elo[norm(name)] = int(fields[3])
    return elo


def main():
    published: dict[str, dict] = {}
    for league_id, ids in LEAGUE_IDS.items():
        for fid in ids:
            raw = json.loads(get(f"https://www.fotmob.com/api/data/leagues?id={fid}"))
            corner_url = None
            xg_url = None
            xga_url = None
            for group in (raw.get("stats") or {}).get("teams") or []:
                header = group.get("header")
                if header == "Corners":
                    corner_url = group.get("fetchAllUrl")
                elif header == "Expected goals":
                    xg_url = group.get("fetchAllUrl")
                elif header == "xG conceded":
                    xga_url = group.get("fetchAllUrl")

            def stat_map(url: str | None) -> dict[str, tuple[float, int]]:
                if not url:
                    return {}
                payload = json.loads(get(url))
                lists = payload.get("TopLists") if isinstance(payload, dict) else None
                entries = []
                if lists:
                    entries = lists[0].get("StatList") or []
                out = {}
                for item in entries:
                    name = item.get("ParticipantName")
                    if not name or item.get("StatValue") is None:
                        continue
                    out[norm(name)] = (float(item["StatValue"]), int(item.get("MatchesPlayed") or 0))
                return out

            xg_map = stat_map(xg_url)
            xga_map = stat_map(xga_url)
            corner_map = stat_map(corner_url)
            print(f"fotmob {fid} {league_id} xg {len(xg_map)} xga {len(xga_map)} corners {len(corner_map)}")
            names = set(xg_map) | set(xga_map) | set(corner_map)
            for key in names:
                xg = xg_map.get(key)
                xga = xga_map.get(key)
                corners = corner_map.get(key)
                played = next((item[1] for item in (xg, xga, corners) if item and item[1]), 0)
                record = {
                    "leagueId": league_id,
                    "xg": xg[0] if xg else None,
                    "xga": xga[0] if xga else None,
                    "played": (xg or xga or (0, 0))[1],
                    "corners": corners[0] if corners else None,
                    "cornersPlayed": corners[1] if corners else None,
                    "source": f"FotMob league {fid}",
                }
                previous = published.get(key)
                if previous and previous["leagueId"] != "ucl" and league_id == "ucl":
                    continue
                published[key] = record

    elo = load_elo()
    snap = json.loads(SNAP.read_text())
    matched_xg = matched_corners = matched_elo = 0
    missing = []
    for team in snap["teams"]:
        key = norm(team["name"])
        keys = [key]
        if key in ALIASES:
            keys.append(ALIASES[key])
        hit = next((published[k] for k in keys if k in published), None)
        if hit is None:
            best = None
            best_score = 0.0
            for other, record in published.items():
                if record["leagueId"] != team["leagueId"] and not (
                    team["leagueId"] == "ucl" or record["leagueId"] == "ucl"
                ):
                    continue
                score = SequenceMatcher(None, key, other).ratio()
                if score > best_score:
                    best_score = score
                    best = record
            if best is not None and best_score >= 0.84:
                hit = best
                print(f"  fuzzy {team['name']} -> {best_score:.2f} {hit['source']}")
        team["xg"] = None
        team["xga"] = None
        team["xgPlayed"] = None
        team["corners"] = None
        team["cornersPlayed"] = None
        team["statsSource"] = None
        team["elo"] = None
        team["eloSource"] = None
        if hit:
            if hit.get("xg") is not None and hit.get("played"):
                team["xg"] = round(float(hit["xg"]), 2)
                team["xga"] = round(float(hit["xga"]), 2) if hit.get("xga") is not None else None
                team["xgPlayed"] = int(hit["played"])
                team["statsSource"] = hit["source"]
                matched_xg += 1
            if hit.get("corners") is not None and hit.get("cornersPlayed"):
                team["corners"] = round(float(hit["corners"]), 1)
                team["cornersPlayed"] = int(hit["cornersPlayed"])
                team["statsSource"] = hit["source"]
                matched_corners += 1
        if team["leagueId"] == "selecciones":
            rating = next((elo[k] for k in keys if k in elo), None)
            if rating is None and key.endswith(" republic"):
                rating = elo.get(key.replace(" republic", ""))
            if rating is not None:
                team["elo"] = rating
                team["eloSource"] = "eloratings.net World.tsv"
                matched_elo += 1
        if team["xg"] is None or (team["leagueId"] == "selecciones" and team["elo"] is None):
            missing.append(f"{team['name']} [{team['leagueId']}] xg={team['xg']} elo={team['elo']}")
    snap["sources"] = [
        "ESPN scoreboard y standings, 3 oct 2026",
        "FotMob xG y córners a favor por equipo",
        "https://www.eloratings.net/World.tsv Elo de selecciones",
        "BeSoccer: tablero del 3 oct; fichas de equipo HTTP 406",
        "ClubElo api.clubelo.com HTTP 502, sin Elo de clubes publicado ese día",
    ]
    SNAP.write_text(json.dumps(snap, ensure_ascii=False))
    print("xg", matched_xg, "corners", matched_corners, "elo", matched_elo, "teams", len(snap["teams"]))
    print("MISSING sample")
    for line in missing[:40]:
        print(" ", line)


if __name__ == "__main__":
    main()
