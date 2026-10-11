"""Lee el cupón público de Wplay. Si un mercado no está en el HTML, queda vacío."""

import json
import re
import ssl
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
CTX = ssl.create_default_context()
LEAGUES = [
    "/es/t/19311/Colombia-Primera-A",
    "/es/t/19296/Argentina-Liga-Profesional",
    "/es/t/19342/Argentina-Primera-Nacional",
    "/es/t/30760/Argentina-Torneo-Federal",
    "/es/t/32319/Argentina-Womens-League",
    "/es/t/19398/Uruguay-Primera-Division",
    "/es/t/26834/Uruguay-Segunda-Division",
    "/es/t/29773/Jamaica-Premier-League",
    "/es/t/19919/Guatemala-Liga-Nacional",
    "/es/t/20059/El-Salvador-Primera-Division",
    "/es/t/27598/Panama-Liga-Panamena",
    "/es/t/31634/Venezuela-Segunda-Division",
    "/es/t/601779/CONCACAF-Liga-de-Naciones",
    "/es/t/795780/Bolivia-Copa-Division-Profesional",
    "/es/t/19503/Canada-Premier-League",
    "/es/t/48170/Dominican-Republic-Liga-Dominicana-de-Futbol",
    "/es/t/2434899/Mexico-Liga-MX-Femenil",
    "/es/t/26652/Chile-Primera-B",
    "/es/t/27222/Chile-Segunda-Division",
    "/es/t/2412787/Elite-International-Friendlies",
    "/es/t/556801/UEFA-Nations-League",
]


def get(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "es-CO"})
    with urllib.request.urlopen(request, timeout=25, context=CTX) as response:
        return response.read().decode("utf-8", "ignore")


def probe(url: str) -> str:
    try:
        request = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(request, timeout=15, context=CTX) as response:
            body = response.read(400).decode("utf-8", "ignore")
            return f"{url} respondió {response.status}: {re.sub(r'<[^>]+>', ' ', body)[:140]}"
    except Exception as error:
        return f"{url} no entregó el cupón: {error.__class__.__name__}"


def coupon_rows(html: str) -> list[dict]:
    rows = []
    for match in re.finditer(r'data-ev_id="(\d+)">\s*<span class="time">([^<]+)</span>\s*<span class="date">([^<]+)</span>', html):
        event_id, clock, day = match.group(1), match.group(2).strip(), match.group(3).strip()
        if day not in {"04 Oct", "05 Oct"}:
            continue
        block = html[match.start() : match.start() + 3500]
        names = re.findall(r'class="seln-name">([^<]+)', block)
        draw = re.findall(r'class="seln-draw-label">([^<]+)', block)
        prices = [float(value) for value in re.findall(r'class="price dec" style="">([0-9.]+)', block)]
        href = re.search(r'href="(/es/e/\d+/[^"]+)"', block)
        if len(names) < 2 or len(prices) < 3 or not draw:
            continue
        rows.append(
            {
                "eventId": event_id,
                "wplayTime": f"{day} {clock}",
                "home": names[0].strip(),
                "away": names[1].strip(),
                "homeOdd": prices[0],
                "drawOdd": prices[1],
                "awayOdd": prices[2],
                "url": "https://apuestas.wplay.co" + href.group(1).split("?")[0] if href else None,
                "provider": "Wplay",
            }
        )
    return rows


def extras(html: str) -> dict:
    def market(name: str) -> str:
        found = re.search(rf'class="mkt-name">\s*{re.escape(name)}\s*</span>', html)
        if not found:
            return ""
        nxt = html.find('class="mkt-name"', found.end())
        return html[found.start() : nxt if nxt > 0 else found.start() + 12000]

    both = market("Ambos Equipos Anotan")
    both_names = re.findall(r'class="seln-name">([^<]+)', both)
    both_prices = [float(value) for value in re.findall(r'class="price dec" style="">([0-9.]+)', both)]
    yes = no = None
    for name, price in zip(both_names, both_prices):
        if name.strip().lower() == "si":
            yes = price
        elif name.strip().lower() == "no":
            no = price
    totals = market("Total Goles Más/Menos de")
    over = under = None
    for title, price in re.findall(
        r'title="\s*([0-9.]+)\s*"[\s\S]{0,500}?class="price dec" style="">([0-9.]+)',
        totals,
    ):
        if title != "2.5":
            continue
        if over is None:
            over = float(price)
        else:
            under = float(price)
            break
    corners = None
    corner_over = None
    corner_under = None
    corner_line = None
    corner_name = re.search(r'class="mkt-name">\s*(Tiros de esquina más/Menos de \(([0-9.]+)\))', html)
    if corner_name:
        corners = corner_name.group(1).strip()
        corner_line = float(corner_name.group(2))
        block = market(corners)
        prices = [float(value) for value in re.findall(r'class="price dec" style="">([0-9.]+)', block)]
        if len(prices) >= 2:
            corner_over, corner_under = prices[0], prices[1]
    return {
        "bttsYes": yes,
        "bttsNo": no,
        "over25": over,
        "under25": under,
        "cornersMarket": corners,
        "cornersLine": corner_line,
        "cornersOver": corner_over,
        "cornersUnder": corner_under,
    }


rows = []
for league in LEAGUES:
    try:
        rows.extend(coupon_rows(get("https://apuestas.wplay.co" + league)))
    except Exception as error:
        print("league fail", league, type(error).__name__)

unique = {}
for row in rows:
    unique[row["eventId"]] = row
rows = list(unique.values())
print("coupon rows", len(rows))


def fill(row: dict) -> dict:
    if not row.get("url"):
        return row
    try:
        row.update(extras(get(row["url"])))
    except Exception:
        row["extraError"] = True
    return row


with ThreadPoolExecutor(max_workers=6) as pool:
    rows = list(pool.map(fill, rows))

notes = [
    probe("https://www.betano.co/"),
    probe("https://betplay.com.co/apuestas"),
    probe("https://www.rushbet.co/pages/sports/"),
]
out = {
    "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
    "source": "https://apuestas.wplay.co/",
    "notes": notes,
    "quotes": rows,
}
(ROOT / "data/book-odds.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))
print("saved", len(rows))
for note in notes:
    print(note[:180])
