/**
 * Corte diario. No usa un modelo de lenguaje.
 * Si un paso falla, los demás siguen y el fallo queda en el registro.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const ROOT = new URL("../data/", import.meta.url);
const GAP_MS = 3000;
const HEADERS = { "User-Agent": "MeridianoCorte/1.0" };
const INCOMPATIBLE = /kings league|futsal|fútbol sala|futbol sala|beach soccer|fútbol playa|futbol playa|fútbol 7|futbol 7/i;
const YOUTH = /sub[-\s]?\d+|\bu1[7-9]\b|\bu2[0-3]\b|juvenil|reservas?/i;
const BUDGET_MS = 40 * 60 * 1000;
/** Partidos por corte a los que se les lee la pestaña Cuotas para el consenso (además del Combo). */
const ODDS_CAP = 60;
/** Las cuotas del consenso no pueden comerse más de este tiempo del corte. */
const ODDS_BUDGET_MS = 18 * 60 * 1000;
/** Tablas de posiciones que lee el corte de la noche: competición de la agenda → página de la liga en Flashscore. */
const STANDINGS_PAGES = [
  ["GERMANY: Bundesliga", "alemania/bundesliga"],
  ["ENGLAND: Premier League", "inglaterra/premier-league"],
  ["ITALY: Serie A", "italia/serie-a"],
  ["SPAIN: LaLiga", "espana/laliga"],
  ["FRANCE: Ligue 1", "francia/ligue-1"],
  ["NETHERLANDS: Eredivisie", "paises-bajos/eredivisie"],
  ["PORTUGAL: Liga Portugal", "portugal/liga-portugal"],
  ["BRAZIL: Serie A Betano", "brasil/serie-a"],
  ["ARGENTINA: Liga Profesional", "argentina/liga-profesional"],
  ["MEXICO: Liga MX", "mexico/liga-mx"],
  ["COLOMBIA: Primera A", "colombia/primera-a"],
  ["USA: MLS", "usa/mls"],
  ["ENGLAND: Championship", "inglaterra/championship"],
  ["GERMANY: 2. Bundesliga", "alemania/2-bundesliga"],
  ["SPAIN: LaLiga2", "espana/laliga2"],
  ["TURKEY: Super Lig", "turquia/super-lig"],
  ["BELGIUM: Jupiler Pro League", "belgica/jupiler-pro-league"],
];

/** Competiciones grandes sin Nivel A ni tabla que igual merecen consenso. */
const BIG_COMPETITION =
  /^(GERMANY: Bundesliga|ENGLAND: Premier League|SPAIN: LaLiga|FRANCE: Ligue 1|ITALY: Serie A|EUROPE: (Champions League|Europa League|Conference League)|SOUTH AMERICA: Copa (Libertadores|Sudamericana)|COLOMBIA: Primera A)(?: - .*)?$/i;

const data = (name) => new URL(name, ROOT);
const readJson = (name) => JSON.parse(readFileSync(data(name), "utf8"));
const readJsonOptional = (name, fallback) => {
  try {
    if (!existsSync(data(name))) return fallback;
    return readJson(name);
  } catch {
    return fallback;
  }
};
const writeJson = (name, value) => writeFileSync(data(name), JSON.stringify(value));

let lastFetch = 0;
const robots = new Map();
const reads = [];
const failures = [];

function bogotaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function bogotaStamp(date = new Date()) {
  const p = bogotaParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-05:00`;
}

function bogotaDay(offset = 0) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
  now.setDate(now.getDate() + offset);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ruleToRegExp(rule) {
  let source = "^";
  for (const char of rule) {
    if (char === "*") source += ".*";
    else if (char === "$") source += "$";
    else source += char.replace(/[.+?^{}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(source);
}

function parseRobots(text) {
  const disallow = [];
  let active = false;
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === "user-agent") active = value === "*";
    else if (active && key === "disallow" && value) disallow.push(ruleToRegExp(value));
  }
  return disallow;
}

async function pause() {
  const wait = GAP_MS - (Date.now() - lastFetch);
  if (lastFetch && wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastFetch = Date.now();
}

async function rulesFor(origin) {
  if (robots.has(origin)) return robots.get(origin);
  await pause();
  const response = await fetch(`${origin}/robots.txt`, { headers: HEADERS });
  const rules = parseRobots(await response.text());
  robots.set(origin, rules);
  reads.push({ url: `${origin}/robots.txt`, at: bogotaStamp(), status: response.status });
  return rules;
}

async function allowed(url) {
  const parsed = new URL(url);
  const rules = await rulesFor(parsed.origin);
  if (rules.some((rule) => rule.test(parsed.pathname))) {
    reads.push({ url, at: bogotaStamp(), skipped: "prohibido por robots.txt" });
    return false;
  }
  return true;
}

async function readPage(url) {
  if (!(await allowed(url))) return null;
  await pause();
  const response = await fetch(url, { headers: HEADERS, redirect: "follow" });
  reads.push({ url, at: bogotaStamp(), status: response.status });
  if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
  return response.text();
}

async function step(name, fn) {
  try {
    return await fn();
  } catch (error) {
    failures.push({ step: name, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

function parseLite(html) {
  const start = html.indexOf('id="score-data"');
  if (start < 0) return [];
  const rows = [];
  for (const league of html.slice(start).split("<h4>").slice(1)) {
    const end = league.indexOf("</h4>");
    if (end < 0) continue;
    const name = league.slice(0, end).split("<")[0].replace(/\s+/g, " ").trim();
    const body = league.slice(end);
    const match = /<span(?: class="live")?>([\s\S]*?)<\/span>\s*([\s\S]*?)<a href="\/partido\/([A-Za-z0-9]+)\/[^"]*" class="([^"]*)">([\s\S]*?)<\/a>/g;
    let row = match.exec(body);
    while (row) {
      const clock = row[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const teams = row[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (teams.includes(" - ")) {
        const [home, away] = teams.split(" - ").map((side) => side.trim());
        const score = row[5].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\u00a0/g, " ").trim();
        const odds = [];
        const tail = body.slice(row.index + row[0].length, row.index + row[0].length + 2500);
        const box = tail.match(/class="mobi-odds">\s*\[([\s\S]*?)\]/);
        if (box) {
          for (const number of box[1].matchAll(/>([0-9]+(?:\.[0-9]+)?)</g)) odds.push(Number(number[1]));
        }
        rows.push({
          league: name,
          clock,
          home,
          away,
          id: row[3],
          klass: row[4].split(" ")[0],
          score,
          suspended: clock.includes("Suspendido") || row[4].includes("canceled"),
          odds: odds.length >= 3 ? odds.slice(0, 3) : null,
        });
      }
      row = match.exec(body);
    }
  }
  return rows;
}

function finalScore(row) {
  if (!row || row.suspended || row.klass !== "fin") return null;
  const pair = row.score.replace(/\s/g, "").match(/^(\d+)-(\d+)$/);
  return pair ? [Number(pair[1]), Number(pair[2])] : null;
}

function clockOf(row) {
  const clock = row.clock.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(clock) ? clock : null;
}

function statusOf(row) {
  if (row.suspended) return "cancelado";
  if (finalScore(row)) return "finalizado";
  if (row.klass === "live") return "en-juego";
  return "por-jugar";
}

function shin(prices) {
  if (prices.some((price) => !(price > 1))) return null;
  const raw = prices.map((price) => 1 / price);
  const total = raw.reduce((sum, price) => sum + price, 0);
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 40; i += 1) {
    const z = (lo + hi) / 2;
    const probs = raw.map((q) => (Math.sqrt(z * z + (4 * (1 - z) * q * q) / total) - z) / (2 * (1 - z)));
    if (probs.reduce((sum, p) => sum + p, 0) > 1) lo = z;
    else hi = z;
  }
  const z = (lo + hi) / 2;
  const probs = raw.map((q) => (Math.sqrt(Math.max(0, z * z + (4 * (1 - z) * q * q) / total)) - z) / (2 * (1 - z)));
  const sum = probs.reduce((totalP, p) => totalP + p, 0);
  if (sum <= 0 || probs.some((p) => !(p > 0))) return null;
  return probs.map((p) => p / sum);
}

function fair(prices) {
  const model = shin(prices);
  if (model) return { method: "shin", probs: model };
  const raw = prices.map((price) => 1 / price);
  const sum = raw.reduce((total, price) => total + price, 0);
  if (sum <= 0) return null;
  return { method: "proporcional", probs: raw.map((price) => price / sum) };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function browserPages(jobs, stop) {
  const out = [];
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    failures.push({ step: "navegador", error: error instanceof Error ? error.message : String(error) });
    return jobs.map((job) => ({ ...job, failed: "navegador no disponible" }));
  }
  const page = await browser.newPage();
  try {
    for (const job of jobs) {
      if (typeof stop === "function" && stop()) break;
      if (!(await allowed(job.url))) {
        out.push({ ...job, failed: "prohibido por robots.txt" });
        continue;
      }
      await pause();
      try {
        await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        const result = await job.read(page);
        out.push({ ...job, ...result, url: page.url(), at: bogotaStamp() });
        reads.push({ url: page.url(), at: bogotaStamp(), kind: job.kind });
      } catch (error) {
        out.push({ ...job, failed: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}

async function clickTab(page, name) {
  const tab = page.locator("a,button").filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first();
  try {
    await tab.waitFor({ state: "visible", timeout: 8000 });
    await tab.click({ timeout: 4000 });
    await page.waitForTimeout(400);
    return true;
  } catch {
    return false;
  }
}

async function readFinishedSheet(page) {
  const pair = (text, label) => {
    const found = text.match(new RegExp(`([0-9]+(?:[.,][0-9]+)?)\\s*${label}\\s*([0-9]+(?:[.,][0-9]+)?)`, "i"));
    if (!found) return "NO DISPONIBLE";
    return [found[1].replace(",", "."), found[2].replace(",", ".")];
  };
  await page.waitForFunction(() => /Remates totales|Goles esperados|Córner|FINALIZADO|Finalizado/.test(document.body?.innerText || ""), { timeout: 8000 }).catch(() => undefined);
  let stats = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  if (!/Remates totales|Goles esperados|Córner/.test(stats)) {
    await clickTab(page, "Estadísticas");
    stats = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  }
  const opened = await clickTab(page, "Alineaciones");
  const lineupText = opened ? await page.locator("body").innerText({ timeout: 8000 }).catch(() => "") : "";
  let lineup = "NO DISPONIBLE";
  if (lineupText) {
    const start = lineupText.search(/SISTEMA DE JUEGO|ALINEACIONES INICIALES/);
    if (start >= 0) {
      const slice = lineupText.slice(start, start + 1800);
      const end = slice.search(/\nSUPLENTES|\nJUGADORES SUSTITUIDOS/);
      lineup = (end > 0 ? slice.slice(0, end) : slice).trim();
    }
  }
  return {
    xg: pair(stats, "Goles esperados \\(xG\\)"),
    corners: pair(stats, "Córner(?:es|s)?"),
    shots: pair(stats, "Remates totales"),
    lineup,
  };
}

async function readOddsTable(page) {
  return page.evaluate(() => {
    const table = document.querySelector(".oddsCell__odds");
    if (!table) return [];
    return [...table.querySelectorAll(".ui-table__body .ui-table__row")].map((row) => {
      const book = (row.querySelector("img[alt]")?.getAttribute("alt") || "").trim();
      const lineCell = row.querySelector("[class*='wclOddsCell--empty']");
      const line = lineCell ? (lineCell.textContent || "").trim() : null;
      const odds = [...row.querySelectorAll(".oddsCell__odd")].map((cell) => {
        const price = Number((cell.textContent || "").trim().replace(",", "."));
        const struck = /disabled|line-through|not-published|cross/i.test(String(cell.className));
        return { price, struck };
      }).filter((cell) => cell.price > 1);
      return {
        book,
        line: line || null,
        odds: odds.map((cell) => cell.price),
        struck: odds.some((cell) => cell.struck),
      };
    }).filter((row) => row.book && row.odds.length >= 2 && row.odds.length <= 3);
  });
}

async function readOdds(page) {
  const tab = page.locator("a,button").filter({ hasText: /^Cuotas$/ }).first();
  try {
    await tab.waitFor({ state: "visible", timeout: 8000 });
    await tab.click({ timeout: 4000 });
  } catch {
    /* la pestaña no estaba */
  }
  await page.waitForTimeout(600);
  const books = [];
  for (const market of [
    { label: "1X2", id: "1x2" },
    { label: "Más de/Menos de", id: "mas-menos" },
    { label: "Ambos equipos marcarán", id: "ambos" },
  ]) {
    await clickTab(page, market.label);
    for (const row of await readOddsTable(page)) books.push({ ...row, market: market.id });
  }
  return { books };
}

/** Lee la tabla general de una liga: equipo, PJ, G, E, P y goles "GF:GC". Solo filas que cuadran (PJ = G + E + P). */
async function readStandings(page) {
  await page.waitForSelector(".ui-table__row", { timeout: 12000 }).catch(() => undefined);
  const rows = await page.evaluate(() => {
    const out = [];
    for (const row of document.querySelectorAll(".ui-table__row")) {
      const link = row.querySelector(".tableCellParticipant__name, [class*='participantName'], a[href*='/equipo/']");
      const team = (link?.textContent || "").trim();
      if (!team) continue;
      // Primero celda por celda; si la página no usa celdas reconocibles, el texto visible de la fila.
      const cells = [...row.querySelectorAll("[class*='table__cell']")]
        .filter((cell) => !cell.querySelector("[class*='table__cell']"))
        .map((cell) => (cell.textContent || "").trim())
        .filter(Boolean);
      const at = cells.findIndex((cell) => cell.includes(team));
      const byCells = at >= 0 ? cells.slice(at + 1).join(" ") : "";
      const byText = (() => {
        const text = (row.innerText || "").replace(/\s+/g, " ");
        return text.slice(text.indexOf(team) + team.length);
      })();
      const pattern = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*:\s*(\d+)/;
      const found = byCells.match(pattern) || byText.match(pattern);
      if (!found) continue;
      out.push({ team, gp: +found[1], w: +found[2], d: +found[3], l: +found[4], gf: +found[5], ga: +found[6] });
    }
    return out;
  });
  const seen = new Set();
  return {
    rows: rows.filter((row) => {
      if (seen.has(row.team) || row.gp !== row.w + row.d + row.l) return false;
      seen.add(row.team);
      return true;
    }),
  };
}

/** Guarda las cuotas leídas en data/combo-odds.json, el archivo del que sale el consenso de la app. */
function storeOdds(results, started) {
  const file = readJsonOptional("combo-odds.json", { matches: [] });
  file.source = "www.flashscore.co pestaña Cuotas, fila a fila. Casa = alt del logo. Sin alt no entra. Lo escribe el corte diario.";
  // Siete días: alcanza para la Consulta reciente sin inflar el archivo que carga la app.
  const keep = Date.now() - 7 * 24 * 3600 * 1000;
  const byId = new Map((file.matches ?? []).filter((item) => Date.parse(item.readAtBogota ?? "") >= keep).map((item) => [item.id, item]));
  let stored = 0;
  for (const result of results ?? []) {
    if (!result?.id || !Array.isArray(result.books) || result.books.length === 0) continue;
    const pick = (market) => result.books.filter((book) => book.market === market);
    const cells = (book, withLine) => [
      ...(withLine ? [{ text: String(book.line ?? ""), withdrawn: false }] : []),
      ...book.odds.map((price) => ({ text: Number(price).toFixed(2), withdrawn: Boolean(book.struck) })),
    ];
    byId.set(result.id, {
      id: result.id,
      readAtBogota: result.at ?? started,
      markets: {
        "1X2": pick("1x2").filter((book) => book.odds.length === 3).map((book) => ({ house: book.book, cells: cells(book, false) })),
        overUnder: pick("mas-menos").filter((book) => book.line && (book.book === "Wplay.co" || book.line === "2.5")).map((book) => ({ house: book.book, cells: cells(book, true) })),
        btts: pick("ambos").map((book) => ({ house: book.book, cells: cells(book, false) })),
      },
    });
    stored += 1;
  }
  file.matches = [...byId.values()];
  writeJson("combo-odds.json", file);
  return stored;
}

/** Casas con 1X2 vigente en una lectura (para el registro de cobertura). */
function liveHouses(result) {
  return new Set((result?.books ?? []).filter((book) => book.market === "1x2" && !book.struck && book.odds.length === 3).map((book) => book.book)).size;
}

function usable(row) {
  if (!row || row.struck || !row.odds || row.odds.some((price) => !(price > 1))) return false;
  const margin = row.odds.reduce((sum, price) => sum + 1 / price, 0) - 1;
  return margin >= 0 && margin <= 0.15;
}

function outcomeName(market, index) {
  if (market === "1x2") return ["1", "X", "2"][index] ?? String(index);
  if (market === "mas-menos") return ["mas", "menos"][index] ?? String(index);
  return ["si", "no"][index] ?? String(index);
}

function marksFromOdds(match, rows, at) {
  const kickoffMs = Date.parse(match.kickoff);
  if (!Number.isFinite(kickoffMs) || kickoffMs - Date.now() <= 10 * 60 * 1000) return [];
  const live = [];
  for (const row of rows.filter(usable)) {
    if (row.market === "mas-menos") {
      const line = String(row.line ?? "").trim().replace(",", ".");
      if (!/^\d+(?:\.\d+)?$/.test(line) || row.odds.length !== 2) continue;
      live.push({ ...row, line });
    } else {
      live.push(row);
    }
  }
  const groups = new Map();
  for (const row of live) {
    const key = row.market === "mas-menos" ? `${row.market}|${row.line}` : `${row.market}|${row.odds.length}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const marks = [];
  for (const books of groups.values()) {
    if (books.length < 4) continue;
    for (const book of books) {
      const others = books.filter((row) => row.book !== book.book).slice(0, 12);
      if (others.length < 3) continue;
      const fairs = others.map((row) => fair(row.odds)).filter(Boolean);
      if (fairs.length < 3) continue;
      book.odds.forEach((price, index) => {
        const probs = fairs.map((item) => item.probs[index]).filter((value) => value > 0);
        if (probs.length < 3) return;
        const consensus = median(probs);
        const ev = consensus * price - 1;
        if (ev < 0.03) return;
        marks.push({
          matchId: match.id,
          home: match.home,
          away: match.away,
          kickoff: match.kickoff,
          market: book.market,
          line: book.line,
          outcome: outcomeName(book.market, index),
          outcomeIndex: index,
          house: book.book,
          odds: price,
          consensus,
          ev,
          method: "7.3",
          readAt: at,
          closingOdds: null,
          clv: null,
        });
      });
    }
  }
  return marks;
}

async function main() {
  // Un mismo corte (noche o mediodía) se hace una sola vez por día. Si GitHub o el disparador externo
  // lanzan otro igual ese día, termina sin tocar nada. FORZAR=si lo repite a propósito.
  const mode = process.env.CORTE === "mediodia" ? "mediodia" : "noche";
  const last = readJsonOptional("cut-coverage.json", {});
  const done = readJsonOptional("cut-done.json", {});
  if (process.env.FORZAR !== "si" && done[mode] === bogotaDay(0)) {
    console.log(`El corte de ${mode} del ${done[mode]} ya se hizo. No se repite.`);
    return;
  }
  const cutStartedMs = Date.now();
  const overBudget = () => Date.now() - cutStartedMs >= BUDGET_MS;
  const started = bogotaStamp();
  const noon = process.env.CORTE === "mediodia";
  const todayName = bogotaDay(0);
  const tomorrowName = bogotaDay(1);
  const yesterdayName = bogotaDay(-1);

  const todayHtml = await step("agenda-hoy", () => readPage("https://m.flashscore.co/?d=0&s=1"));
  const tomorrowHtml = await step("agenda-manana", () => readPage("https://m.flashscore.co/?d=1&s=1"));
  const oddsHtml = await step("cuotas-wplay", () => readPage("https://m.flashscore.co/?d=0&s=5"));
  const yesterdayHtml = await step("resultados-ayer", () => readPage("https://m.flashscore.co/?d=-1&s=3"));
  const today = todayHtml ? parseLite(todayHtml) : [];
  const tomorrow = tomorrowHtml ? parseLite(tomorrowHtml) : [];
  const oddsRows = oddsHtml ? parseLite(oddsHtml) : [];
  const yesterday = yesterdayHtml ? parseLite(yesterdayHtml) : [];

  const agenda = readJson("agenda.json");
  // Lite a veces nombra el país en español ("INGLATERRA: ..."). Todo se guarda con el prefijo en inglés.
  const { canonicalCompetition } = await import("../src/lib/football/places.ts");
  let renamed = 0;
  for (const row of agenda.matches) {
    const canonical = canonicalCompetition(row[2]);
    if (canonical !== row[2]) {
      row[2] = canonical;
      renamed += 1;
    }
  }
  for (const list of [today, tomorrow, oddsRows, yesterday]) for (const row of list) row.league = canonicalCompetition(row.league);
  const byId = new Map(agenda.matches.map((row) => [row[0], row]));
  // Conflictos de cortes anteriores que no se aplicaron: manda la lectura de la página de resultados de ayer.
  for (const item of last.scoreConflicts ?? []) {
    const stored = byId.get(item.id);
    if (!stored || item.source !== "ayer" || item.applied || !Array.isArray(item.read)) continue;
    stored[5] = "finalizado";
    stored[6] = item.read[0];
    stored[7] = item.read[1];
  }
  let updatedToday = 0;
  let addedToday = 0;
  let addedTomorrow = 0;
  let updatedYesterday = 0;
  const conflicts = [];

  const setFinal = (stored, score, source) => {
    if (stored[5] === "finalizado" && stored[6] != null && (stored[6] !== score[0] || stored[7] !== score[1])) {
      conflicts.push({ id: stored[0], stored: [stored[6], stored[7]], read: score, source, applied: source === "ayer" });
      // La página de resultados de ayer es la versión cerrada; la de hoy pudo leerse con el partido aún vivo.
      if (source !== "ayer") return false;
    }
    stored[5] = "finalizado";
    stored[6] = score[0];
    stored[7] = score[1];
    return true;
  };

  const apply = (row, day, allowNew) => {
    const score = finalScore(row);
    const stored = byId.get(row.id);
    if (stored) {
      if (day !== todayName) return;
      if (score) {
        if (setFinal(stored, score, "hoy")) updatedToday += 1;
      } else {
        stored[5] = statusOf(row);
        if (stored[5] !== "finalizado") {
          stored[6] = null;
          stored[7] = null;
        }
        updatedToday += 1;
      }
      return;
    }
    if (!allowNew) return;
    const clock = clockOf(row);
    if (!clock) return;
    const kickoff = `${day}T${clock}:00-05:00`;
    const next = [row.id, kickoff, row.league, row.home, row.away, score ? "finalizado" : statusOf(row), score ? score[0] : null, score ? score[1] : null, null, null];
    agenda.matches.push(next);
    byId.set(row.id, next);
    if (day === todayName) addedToday += 1;
    else addedTomorrow += 1;
  };
  for (const row of today) apply(row, todayName, true);
  for (const row of tomorrow) apply(row, tomorrowName, true);
  for (const row of yesterday) {
    const score = finalScore(row);
    if (!score) continue;
    const stored = byId.get(row.id);
    if (!stored) continue;
    if (setFinal(stored, score, "ayer")) updatedYesterday += 1;
  }
  for (const row of agenda.matches) {
    if ((row[6] != null || row[7] != null) && row[5] !== "finalizado") {
      row[6] = null;
      row[7] = null;
    }
  }
  agenda.fetchedAt = started;
  writeJson("agenda.json", agenda);

  const keptOdds = {};
  let discardedOdds = 0;
  for (const row of oddsRows) {
    if (!row.odds) continue;
    const margin = row.odds.reduce((sum, price) => sum + 1 / price, 0) - 1;
    if (row.klass === "sched" && margin >= 0 && margin <= 0.15) keptOdds[row.id] = row.odds;
    else discardedOdds += 1;
  }

  // Tablas de posiciones (solo el corte de la noche): base del Nivel B y nombres en español.
  let tablesRead = 0;
  if (!noon) {
    const tables = (await step("tablas", () => browserPages(STANDINGS_PAGES.map(([competition, path]) => ({
      id: competition,
      competition,
      kind: "tabla",
      url: `https://www.flashscore.co/futbol/${path}/clasificacion/`,
      read: readStandings,
    })), () => overBudget()))) ?? [];
    const file = readJsonOptional("standings-auto.json", { leagues: [] });
    const byCompetition = new Map((file.leagues ?? []).map((league) => [league.competition, league]));
    for (const table of tables) {
      if (!Array.isArray(table.rows) || table.rows.length < 6) continue;
      byCompetition.set(table.competition, { competition: table.competition, page: table.url, readAtBogota: table.at ?? started, rows: table.rows });
      tablesRead += 1;
    }
    file.source = "www.flashscore.co, tabla de cada liga en español. La escribe el corte de la noche.";
    file.leagues = [...byCompetition.values()];
    writeJson("standings-auto.json", file);
  }

  // Cuotas de varias casas ANTES de calcular: así la predicción guardada ya lleva el consenso (80 % mercado, 20 % modelo).
  const oddsTargets = (await step("cuotas-objetivo", async () => {
    const { leagueForCompetition } = await import("../src/lib/football/dixon.ts");
    const { tableRow } = await import("../src/lib/football/standings.ts");
    const list = [];
    for (const row of today) {
      if (row.klass !== "sched" || row.suspended) continue;
      if (INCOMPATIBLE.test(row.league) || YOUTH.test(`${row.league} ${row.home} ${row.away}`)) continue;
      const clock = clockOf(row);
      if (!clock) continue;
      const kickoff = `${todayName}T${clock}:00-05:00`;
      if (!(Date.parse(kickoff) - Date.now() > 10 * 60 * 1000)) continue;
      const competition = byId.get(row.id)?.[2] ?? row.league;
      const strong =
        leagueForCompetition(competition) ||
        (tableRow(competition, row.home) && tableRow(competition, row.away)) ||
        BIG_COMPETITION.test(competition);
      if (strong) list.push({ id: row.id, home: row.home, away: row.away, kickoff });
    }
    return list.sort((a, b) => a.kickoff.localeCompare(b.kickoff)).slice(0, ODDS_CAP);
  })) ?? [];
  const oddsStartedMs = Date.now();
  const consensusRead = (await step("cuotas-consenso", () => browserPages(oddsTargets.map((row) => ({
    ...row,
    kind: "cuotas",
    url: `https://www.flashscore.co/partido/${row.id}/`,
    read: async (page) => readOdds(page),
  })), () => Date.now() - oddsStartedMs >= ODDS_BUDGET_MS || overBudget()))) ?? [];
  const consensusStored = storeOdds(consensusRead, started);
  const readById = new Map(consensusRead.filter((row) => row.books).map((row) => [row.id, row]));

  const now = Date.now();
  const predictions = readJson("predictions.json");
  const sheetsSoFar = readJsonOptional("sheets-history.json", { byId: {} }).byId ?? {};
  const fresh = (await step("predicciones", async () => {
    const { buildCard, ENGINE_VERSION } = await import("../src/lib/football/card.ts");
    const rows = [];
    for (const row of today) {
      if (row.klass !== "sched" || row.suspended) continue;
      if (INCOMPATIBLE.test(row.league) || YOUTH.test(`${row.league} ${row.home} ${row.away}`)) continue;
      const clock = clockOf(row);
      if (!clock) continue;
      const kickoff = `${todayName}T${clock}:00-05:00`;
      const kickoffMs = Date.parse(kickoff);
      if (!Number.isFinite(kickoffMs) || kickoffMs - now < 10 * 60 * 1000) continue;
      const stored = byId.get(row.id);
      let card = null;
      try {
        card = buildCard(
          {
            id: row.id,
            kickoff,
            competition: stored?.[2] ?? row.league,
            home: row.home,
            away: row.away,
            fixtureId: stored?.[9] ?? null,
          },
          { wplay: keptOdds[row.id] ?? null, sheets: sheetsSoFar },
        );
      } catch {
        continue;
      }
      if (!card) continue;
      const sides = [
        ["home", row.home, card.published.home],
        ["draw", "Empate", card.published.draw],
        ["away", row.away, card.published.away],
      ].sort((a, b) => b[2] - a[2]);
      rows.push({
        id: `${row.id}@${started}`,
        matchId: row.id,
        home: row.home,
        away: row.away,
        competition: stored?.[2] ?? row.league,
        kickoff,
        calculatedAt: started,
        origin: "corte",
        level: card.level,
        engine: ENGINE_VERSION,
        lambdaHome: card.lambdaHome,
        lambdaAway: card.lambdaAway,
        model: card.model,
        consensus: card.consensus,
        published: card.published,
        marketWeight: card.marketWeight,
        probabilities: card.probabilities,
        pick: { key: sides[0][0], name: sides[0][1], probability: sides[0][2] },
        shadow: card.shadow,
        verifiedOdds: keptOdds[row.id] ? { source: "m.flashscore.co/?d=0&s=5", readAtBogota: started, wplay1x2: keptOdds[row.id] } : null,
        history: "mismo motor que la app: niveles A/B/C, Elo de selecciones y mezcla 80/20",
        afterKickoff: false,
        locked: true,
      });
    }
    return rows;
  })) ?? [];
  const seen = new Set();
  const combo = [];
  for (const row of [...fresh].sort((a, b) => a.kickoff.localeCompare(b.kickoff))) {
    if (combo.length >= 20 || seen.has(row.competition)) continue;
    seen.add(row.competition);
    combo.push(row);
    row.origin = "combo";
  }
  predictions.records.push(...fresh);
  writeJson("predictions.json", predictions);

  const comboPending = combo.filter((row) => !readById.has(row.matchId));
  const comboRead = await step("cuotas-combo", () => browserPages(comboPending.map((row) => ({
    id: row.matchId,
    home: row.home,
    away: row.away,
    kickoff: row.kickoff,
    kind: "cuotas",
    url: `https://www.flashscore.co/partido/${row.matchId}/`,
    read: async (page) => readOdds(page),
  }))));
  storeOdds(comboRead, started);
  const oddsRead = [
    ...combo.filter((row) => readById.has(row.matchId)).map((row) => ({ ...readById.get(row.matchId), kickoff: row.kickoff })),
    ...(comboRead ?? []),
  ];

  const registry = readJson("value-marks.json");
  const known = new Set(registry.marks.map((mark) => [mark.matchId, mark.market, mark.line ?? "", mark.house, mark.outcome].join("|")));
  const newMarks = [];
  for (const row of oddsRead ?? []) {
    if (!row.books) continue;
    for (const mark of marksFromOdds(row, row.books, started)) {
      const key = [mark.matchId, mark.market, mark.line ?? "", mark.house, mark.outcome].join("|");
      if (known.has(key)) continue;
      known.add(key);
      newMarks.push(mark);
    }
  }
  registry.marks.push(...newMarks);
  registry.checkedAt = started;

  let closingRead = 0;
  if (noon) {
    const open = registry.marks.filter((mark) => mark.closingOdds == null && Date.parse(mark.kickoff) > Date.now());
    const unique = [...new Map(open.map((mark) => [mark.matchId, mark])).values()];
    const closes = await step("cierre-12", () => browserPages(unique.map((mark) => ({
      id: mark.matchId,
      kind: "cierre",
      url: `https://www.flashscore.co/partido/${mark.matchId}/`,
      read: async (page) => ({ books: (await readOdds(page)).books }),
    }))));
    for (const row of closes ?? []) {
      if (!row.books) continue;
      for (const mark of registry.marks) {
        if (mark.matchId !== row.id || mark.closingOdds != null) continue;
        if (!(Date.parse(mark.kickoff) > Date.now())) continue;
        const same = row.books.find((book) => book.book === mark.house && book.market === (mark.market ?? "1x2") && (book.line ?? null) === (mark.line ?? null) && !book.struck);
        const index = Number.isInteger(mark.outcomeIndex) ? mark.outcomeIndex : mark.outcome === "X" || mark.side === "draw" ? 1 : mark.outcome === "2" || mark.outcome === "menos" || mark.outcome === "no" || mark.side === "away" ? (mark.market === "1x2" || !mark.market ? 2 : 1) : 0;
        const price = same?.odds?.[index];
        if (!(price > 1)) continue;
        mark.closingOdds = price;
        mark.clv = mark.odds / price - 1;
        mark.closedAt = started;
        closingRead += 1;
      }
    }
  } else {
    reads.push({ kind: "cierre-12", skipped: "CORTE no es mediodia" });
  }
  writeJson("value-marks.json", registry);

  const historyFile = readJsonOptional("sheets-history.json", { byId: {} });
  if (!historyFile.byId || typeof historyFile.byId !== "object") historyFile.byId = {};
  const yesterdayFile = readJsonOptional("sheets-yesterday.json", { sheets: [] });
  for (const sheet of yesterdayFile.sheets ?? []) {
    if (sheet?.id && !historyFile.byId[sheet.id]) historyFile.byId[sheet.id] = sheet;
  }
  const yesterdayFinished = yesterday.filter((row) => finalScore(row));
  const pending = yesterdayFinished.filter((row) => !sheetHasData(historyFile.byId[row.id]));
  const comboLeagues = new Set(combo.map((row) => row.competition));
  const publishedLeagues = new Set(oddsRows.filter((row) => row.odds).map((row) => row.league));
  const sheetRank = (row) => (comboLeagues.has(row.league) ? 0 : publishedLeagues.has(row.league) ? 1 : 2);
  pending.sort((a, b) => sheetRank(a) - sheetRank(b));
  let budgetHit = false;
  const sheets = pending.length
    ? await step("fichas-ayer", () => browserPages(pending.map((row) => ({
      id: row.id,
      home: row.home,
      away: row.away,
      kind: "ficha-finalizada",
      url: `https://www.flashscore.co/partido/${row.id}/`,
      read: readFinishedSheet,
    })), () => {
      if (!overBudget()) return false;
      budgetHit = true;
      return true;
    }))
    : [];
  let sheetsAdded = 0;
  for (const sheet of sheets ?? []) {
    if (!sheet?.id || sheet.failed) continue;
    const prev = historyFile.byId[sheet.id];
    if (sheetHasData(prev)) continue;
    if (!prev) sheetsAdded += 1;
    historyFile.byId[sheet.id] = sheet;
  }
  historyFile.updatedAt = started;
  historyFile.rule = "Acumulado por id de partido. Una ficha con datos no se vuelve a leer ni se borra.";
  writeJson("sheets-history.json", historyFile);
  writeJson("sheets-yesterday.json", {
    at: started,
    day: yesterdayName,
    sheets: yesterdayFinished.map((row) => historyFile.byId[row.id] ?? {
      id: row.id,
      home: row.home,
      away: row.away,
      kind: "ficha-finalizada",
      failed: "no leída",
    }),
  });

  const previousEval = readJsonOptional("evaluations.json", {});
  const evaluation = await step("evaluacion", async () => {
    const { evaluateRegistry } = await import("../src/lib/football/evaluate.ts");
    return evaluateRegistry({
      records: predictions.records,
      matches: agenda.matches,
      marks: registry.marks,
      previous: previousEval,
      at: bogotaStamp(),
    });
  });
  if (evaluation) writeJson("evaluations.json", evaluation);

  const coverage = {
    cut: todayName,
    startedAtBogota: started,
    finishedAtBogota: bogotaStamp(),
    noonCut: noon,
    corte: noon ? "mediodia" : "noche",
    agendaToday: today.length,
    agendaTomorrow: tomorrow.length,
    updatedToday,
    addedToday,
    addedTomorrow,
    updatedYesterday,
    scoreConflicts: conflicts,
    yesterdayFinished: yesterdayFinished.length,
    yesterdaySheets: (sheets ?? []).filter((sheet) => !sheet.failed).length,
    sheetsSkipped: yesterdayFinished.length - pending.length,
    sheetsAdded,
    sheetsDeferred: Math.max(0, pending.length - (sheets ?? []).length),
    budgetHit,
    sheetsHistory: Object.keys(historyFile.byId).length,
    oddsKept: Object.keys(keptOdds).length,
    oddsDiscardedByTest: discardedOdds,
    predictionsSaved: fresh.length,
    history: "mismo motor que la app",
    evaluated: evaluation?.evaluated ?? null,
    comparable: evaluation?.comparable ?? null,
    rpsPublished: evaluation?.rpsPublished ?? null,
    distance: evaluation?.distance ?? null,
    clvMean: evaluation?.clvMean ?? null,
    combo: combo.length,
    valueMarks: newMarks.length,
    closingOdds: closingRead,
    failures,
    reads: reads.length,
    tablesRead,
    competitionsRenamed: renamed,
    consensusTargets: oddsTargets.length,
    consensusRead: consensusStored,
    consensusWith3Houses: consensusRead.filter((row) => liveHouses(row) >= 3).length,
    predictionsWithConsensus: fresh.filter((row) => row.consensus).length,
  };
  writeJson("cut-coverage.json", coverage);
  // Queda marcado como hecho solo si se leyó la agenda del día.
  if (today.length > 0) writeJson("cut-done.json", { ...readJsonOptional("cut-done.json", {}), [noon ? "mediodia" : "noche"]: todayName });
  console.log(JSON.stringify(coverage, null, 2));
}

function sheetHasData(sheet) {
  return ["xg", "corners", "shots", "lineup"].some((key) => sheet?.[key] && sheet[key] !== "NO DISPONIBLE");
}

function sheetBlank(sheet) {
  return !sheetHasData(sheet);
}

async function repair() {
  const started = bogotaStamp();
  const preds = readJson("predictions.json");
  const combo = preds.records.filter((row) => row.calculatedAt === "2026-10-10T14:43:42-05:00" && row.origin === "combo" && Date.parse(row.kickoff) - Date.now() > 10 * 60 * 1000);
  const oddsRead = await step("cuotas-combo-abiertas", () => browserPages(combo.map((row) => ({
    id: row.matchId,
    home: row.home,
    away: row.away,
    kickoff: row.kickoff,
    kind: "cuotas",
    url: `https://www.flashscore.co/partido/${row.matchId}/`,
    read: async (page) => readOdds(page),
  }))));
  const registry = readJson("value-marks.json");
  const known = new Set(registry.marks.map((mark) => [mark.matchId, mark.market, mark.line ?? "", mark.house, mark.outcome].join("|")));
  const newMarks = [];
  let booksSeen = 0;
  for (const row of oddsRead ?? []) {
    booksSeen += Array.isArray(row.books) ? row.books.length : 0;
    if (!Array.isArray(row.books)) continue;
    for (const mark of marksFromOdds(row, row.books, started)) {
      const key = [mark.matchId, mark.market, mark.line ?? "", mark.house, mark.outcome].join("|");
      if (known.has(key)) continue;
      known.add(key);
      newMarks.push(mark);
    }
  }
  registry.marks.push(...newMarks);
  registry.checkedAt = started;
  writeJson("value-marks.json", registry);

  const file = readJson("sheets-yesterday.json");
  const empty = file.sheets.filter(sheetBlank);
  const reread = await step("fichas-vacias", () => browserPages(empty.map((sheet) => ({
    id: sheet.id,
    home: sheet.home,
    away: sheet.away,
    kind: "ficha-finalizada",
    url: `https://www.flashscore.co/partido/${sheet.id}/`,
    read: readFinishedSheet,
  }))));
  const byId = new Map((reread ?? []).map((sheet) => [sheet.id, sheet]));
  let filled = 0;
  for (const sheet of file.sheets) {
    const next = byId.get(sheet.id);
    if (!next || next.failed || sheetBlank(next)) continue;
    sheet.xg = next.xg;
    sheet.corners = next.corners;
    sheet.shots = next.shots;
    sheet.lineup = next.lineup;
    sheet.url = next.url ?? sheet.url;
    sheet.rereadAt = started;
    filled += 1;
  }
  writeJson("sheets-yesterday.json", file);

  const coverage = readJson("cut-coverage.json");
  coverage.finishedAtBogota = bogotaStamp();
  coverage.yesterdaySheets = file.sheets.filter((sheet) => !sheet.failed).length;
  coverage.yesterdaySheetsWithDetail = file.sheets.filter((sheet) => !sheetBlank(sheet)).length;
  coverage.sheetsReread = filled;
  coverage.sheetsStillBlank = file.sheets.filter(sheetBlank).length;
  coverage.valueMarks = newMarks.length;
  coverage.comboOddsBooks = booksSeen;
  coverage.comboOddsStillOpen = combo.length;
  coverage.failures = failures;
  coverage.note = "Las cuotas del Combo se leen antes de las fichas de ayer. Las fichas que quedaron vacías y las cuotas de partidos que seguían sin empezar se releyeron.";
  writeJson("cut-coverage.json", coverage);
  console.log(JSON.stringify(coverage, null, 2));
}

if (process.argv[2] === "repair") {
  repair().catch((error) => {
    failures.push({ step: "repair", error: error instanceof Error ? error.message : String(error) });
    console.error(error);
    process.exitCode = 1;
  });
} else {
  main().catch((error) => {
    failures.push({ step: "corte", error: error instanceof Error ? error.message : String(error) });
    try {
      writeJson("cut-coverage.json", {
        cut: bogotaDay(0),
        finishedAtBogota: bogotaStamp(),
        failures,
        fatal: true,
      });
    } catch {
      /* el registro no se pudo escribir */
    }
    console.error(error);
    process.exitCode = 1;
  });
}
