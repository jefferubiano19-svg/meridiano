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
/** Tiempo total del corte. GitHub Actions es gratis en repositorios públicos; el job tiene 150 min. */
const BUDGET_MS = 120 * 60 * 1000;
/** Hora de inicio del corte en curso (para el registro si el corte se cae). */
let CUT_STARTED = null;
/** Turno: noche (00:15), mediodia (12:00) o tarde (17:00, opcional). */
const CUT_MODE = ["mediodia", "tarde"].includes(process.env.CORTE) ? process.env.CORTE : "noche";
/** Partidos por corte a los que se les lee la pestaña Cuotas para el consenso (además del Combo). */
const ODDS_CAP = 450;
/** Las cuotas del consenso no pueden comerse más de este tiempo del corte. */
const ODDS_BUDGET_MS = 90 * 60 * 1000;
/** Una cuota solo cuenta si se lee al menos este tiempo antes del inicio. */
const PREMATCH_MS = 10 * 60 * 1000;
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
    // Primero todas las filas con su posición: la caja de cuotas de un partido solo se busca
    // entre ese partido y el siguiente. Antes se buscaba en los 2.500 caracteres siguientes y,
    // si el partido no traía cuotas, se quedaba con las del partido de abajo (error del 13 oct 2026).
    const found = [];
    for (let hit = match.exec(body); hit; hit = match.exec(body)) found.push(hit);
    for (let index = 0; index < found.length; index += 1) {
      const row = found[index];
      const nextStart = index + 1 < found.length ? found[index + 1].index : body.length;
      const clock = row[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const teams = row[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (teams.includes(" - ")) {
        const [home, away] = teams.split(" - ").map((side) => side.trim());
        const score = row[5].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\u00a0/g, " ").trim();
        const odds = [];
        const tail = body.slice(row.index + row[0].length, nextStart);
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
      // Cuotas: si el partido está por empezar, no se lee (serían cuotas en vivo).
      if (job.kind === "cuotas" && job.kickoff && Date.parse(job.kickoff) - Date.now() < PREMATCH_MS) {
        out.push({ ...job, failed: "empieza en menos de 10 minutos" });
        continue;
      }
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

const ALL_MARKETS = [
  { label: "1X2", id: "1x2" },
  { label: "Más de/Menos de", id: "mas-menos" },
  { label: "Ambos equipos marcarán", id: "ambos" },
];
/** Solo 1X2: es lo que decide el ganador y se lee en un tercio del tiempo (sin esperar pestañas que no existen). */
const ONLY_1X2 = [ALL_MARKETS[0]];

/*
 * Revisión del 13 oct 2026 con los datos guardados: de 937 filas de "ambos marcan", 933 eran en realidad
 * la tabla 1X2 (la pestaña no abría), y "más/menos goles" nunca guardó una sola fila. Hasta verificar esos
 * lectores con la página real, el corte solo lee 1X2: es lo único confirmado y lo que decide al ganador.
 */
const READ_MARKETS = ONLY_1X2;

async function readOdds(page, markets = READ_MARKETS) {
  const tab = page.locator("a,button").filter({ hasText: /^Cuotas$/ }).first();
  try {
    await tab.waitFor({ state: "visible", timeout: 8000 });
    await tab.click({ timeout: 4000 });
  } catch {
    // Sin pestaña de Cuotas ninguna casa ofrece el partido: se sigue con el siguiente en vez de esperar
    // otros ~20 s por la pestaña 1X2 y la tabla (revisión del 17 oct 2026: los cortes se quedaban sin tiempo).
    return { books: [], noOddsTab: true };
  }
  await page.waitForTimeout(600);
  const books = [];
  let first = null;
  for (const market of markets) {
    const opened = await clickTab(page, market.label);
    // Si la pestaña no abrió, la tabla visible sigue siendo la anterior: no se lee (evita guardar 1X2 como "ambos marcan").
    if (!opened && market.id !== "1x2") continue;
    const rows = (await readOddsTable(page)).filter((row) => row.odds.length === (market.id === "1x2" ? 3 : 2));
    const signature = JSON.stringify(rows.map((row) => [row.book, row.odds]));
    if (market.id === "1x2") first = signature;
    else if (signature === first) continue;
    for (const row of rows) books.push({ ...row, market: market.id });
  }
  return { books };
}

/** Lee la tabla general de una liga: equipo, PJ, G, E, P y goles "GF:GC". Solo filas que cuadran (PJ = G + E + P). */
async function readStandings(page) {
  await page.waitForSelector(".ui-table__row", { timeout: 12000 }).catch(() => undefined);
  const rows = await page.evaluate(() => {
    const out = [];
    for (const row of document.querySelectorAll(".ui-table__row")) {
      // El primer enlace /equipo/ de la fila es el escudo (sin texto): por eso las tablas salían vacías
      // (corte del 14 oct 2026: 17 tablas con 18-20 filas visibles y 0 guardadas). Se toma el primer
      // candidato con texto y, si ninguno lo tiene, el atributo title del enlace del escudo.
      const links = [...row.querySelectorAll(".tableCellParticipant__name, [class*='participantName'], a[href*='/equipo/']")];
      const named = links.map((el) => (el.textContent || "").trim()).find(Boolean);
      const titled = links.map((el) => (el.getAttribute("title") || "").trim()).find(Boolean);
      const team = named || titled || "";
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
  // Diagnóstico: qué vio el lector en la página (para corregirlo si una tabla sale vacía).
  const debug = await page
    .evaluate(() => {
      const first = document.querySelector(".ui-table__row");
      return {
        title: document.title,
        tableRows: document.querySelectorAll(".ui-table__row").length,
        anyTable: document.querySelectorAll("[class*='table']").length,
        firstRow: first ? (first.innerText || first.textContent || "").replace(/\s+/g, " ").slice(0, 160) : null,
        firstRowHtml: first ? first.outerHTML.slice(0, 600) : null,
      };
    })
    .catch((error) => ({ error: String(error) }));
  const seen = new Set();
  return {
    debug,
    rows: rows.filter((row) => {
      if (seen.has(row.team) || row.gp !== row.w + row.d + row.l) return false;
      seen.add(row.team);
      return true;
    }),
  };
}

/** Guarda las cuotas leídas en data/combo-odds.json, el archivo del que sale el consenso de la app. */
/**
 * Las 5 casas colombianas que usa Meridiano. Flashscore a veces muestra otras según el país desde donde se consulta
 * (los servidores de GitHub están en EE. UU.: aparecía bet365.us). Cualquier otra casa se descarta al leer.
 */
const HOUSES = /^(wplay\.co|betano\.co|stake\.latam|bwin\.co|betplay)$/i;
const colombian = (book) => HOUSES.test(String(book?.book ?? book?.house ?? "").trim());

function storeOdds(results, started) {
  const file = readJsonOptional("combo-odds.json", { matches: [] });
  file.source = "www.flashscore.co pestaña Cuotas, fila a fila. Casa = alt del logo. Sin alt no entra. Lo escribe el corte diario.";
  // Siete días: alcanza para la Consulta reciente sin inflar el archivo que carga la app.
  const keep = Date.now() - 7 * 24 * 3600 * 1000;
  const byId = new Map((file.matches ?? []).filter((item) => Date.parse(item.readAtBogota ?? "") >= keep).map((item) => [item.id, item]));
  // Fuera las filas de "ambos marcan" que no tienen exactamente 2 cuotas (eran copias del 1X2).
  for (const item of byId.values()) {
    if (item?.markets?.btts) item.markets.btts = item.markets.btts.filter((row) => Array.isArray(row.cells) && row.cells.length === 2);
  }
  let stored = 0;
  for (const raw of results ?? []) {
    const result = raw && Array.isArray(raw.books) ? { ...raw, books: raw.books.filter(colombian) } : raw;
    if (!result?.id || !Array.isArray(result.books) || result.books.length === 0) continue;
    const pick = (market) => result.books.filter((book) => book.market === market);
    const cells = (book, withLine) => [
      ...(withLine ? [{ text: String(book.line ?? ""), withdrawn: false }] : []),
      ...book.odds.map((price) => ({ text: Number(price).toFixed(2), withdrawn: Boolean(book.struck) })),
    ];
    const previous = byId.get(result.id)?.markets ?? {};
    const overUnder = pick("mas-menos").filter((book) => book.line && (book.book === "Wplay.co" || book.line === "2.5")).map((book) => ({ house: book.book, cells: cells(book, true) }));
    const btts = pick("ambos").map((book) => ({ house: book.book, cells: cells(book, false) }));
    byId.set(result.id, {
      id: result.id,
      readAtBogota: result.at ?? started,
      markets: {
        "1X2": pick("1x2").filter((book) => book.odds.length === 3).map((book) => ({ house: book.book, cells: cells(book, false) })),
        // Una lectura solo de 1X2 no borra las líneas de goles que ya se tenían.
        overUnder: overUnder.length ? overUnder : (previous.overUnder ?? []),
        btts: btts.length ? btts : (previous.btts ?? []),
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
  for (const row of rows.filter(usable).filter(colombian)) {
    if (row.market === "mas-menos") {
      const line = String(row.line ?? "").trim().replace(",", ".");
      if (!/^\d+(?:\.\d+)?$/.test(line) || row.odds.length !== 2) continue;
      live.push({ ...row, line });
    } else {
      live.push(row);
    }
  }
  const groups = new Map();
  const expected = { "1x2": 3, "mas-menos": 2, ambos: 2 };
  for (const row of live) {
    if (row.odds.length !== expected[row.market]) continue;
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
  return saneMarks(marks);
}

/** Valor esperado máximo creíble entre casas. Más que esto, en la práctica, es un error de lectura o una cuota vieja. */
const MAX_EV = 0.15;

/**
 * Filtro de cordura de las marcas de valor (no inventar valor):
 *  - fuera las de valor esperado mayor a 15 %;
 *  - fuera todas las de un mercado si las casas marcan resultados distintos a la vez
 *    (unas dicen que paga de más el local y otras la visita: datos contradictorios).
 */
function saneMarks(marks) {
  const byGroup = new Map();
  for (const mark of marks) {
    const key = [mark.matchId, mark.market ?? "1x2", mark.line ?? ""].join("|");
    const list = byGroup.get(key) ?? [];
    list.push(mark);
    byGroup.set(key, list);
  }
  const kept = [];
  for (const list of byGroup.values()) {
    const outcomes = new Set(list.map((mark) => mark.outcomeIndex ?? mark.outcome ?? mark.side));
    if (outcomes.size > 1) continue;
    for (const mark of list) if (!(mark.ev > MAX_EV)) kept.push(mark);
  }
  return kept;
}

/** Limpia el registro con las mismas reglas (idempotente) y anula cierres tomados en la misma lectura de la marca. */
function cleanRegistry(registry) {
  const before = registry.marks.length;
  const valid = registry.marks.filter((mark) => {
    if (mark.market === "ambos" && Number(mark.outcomeIndex) > 1) return false;
    return true;
  });
  const legacy = valid.filter((mark) => !mark.market);
  const current = saneMarks(valid.filter((mark) => mark.market));
  let reopened = 0;
  for (const mark of current) {
    if (mark.closingOdds == null) continue;
    const gap = Date.parse(mark.closedAt ?? "") - Date.parse(mark.readAt ?? "");
    if (!(gap >= 60 * 60 * 1000)) {
      mark.closingOdds = null;
      mark.clv = null;
      delete mark.closedAt;
      reopened += 1;
    }
  }
  registry.marks = [...legacy, ...current];
  return { removed: before - registry.marks.length, reopened };
}

async function main() {
  // Un mismo corte (noche o mediodía) se hace una sola vez por día. Si GitHub o el disparador externo
  // lanzan otro igual ese día, termina sin tocar nada. FORZAR=si lo repite a propósito.
  const mode = CUT_MODE;
  const last = readJsonOptional("cut-coverage.json", {});
  const done = readJsonOptional("cut-done.json", {});
  if (process.env.FORZAR !== "si" && done[mode] === bogotaDay(0)) {
    console.log(`El corte de ${mode} del ${done[mode]} ya se hizo. No se repite.`);
    return;
  }
  const cutStartedMs = Date.now();
  const overBudget = () => Date.now() - cutStartedMs >= BUDGET_MS;
  const started = bogotaStamp();
  CUT_STARTED = started;
  // Mediodía y tarde se comportan igual (sin tablas); la tarde existe para leer cuotas más cerca de los partidos de la noche.
  const noon = mode !== "noche";
  const todayName = bogotaDay(0);
  const tomorrowName = bogotaDay(1);
  const yesterdayName = bogotaDay(-1);

  const todayHtml = await step("agenda-hoy", () => readPage("https://m.flashscore.co/?d=0&s=1"));
  const tomorrowHtml = await step("agenda-manana", () => readPage("https://m.flashscore.co/?d=1&s=1"));
  const oddsHtml = await step("cuotas-wplay", () => readPage("https://m.flashscore.co/?d=0&s=5"));
  const oddsTomorrowHtml = await step("cuotas-wplay-manana", () => readPage("https://m.flashscore.co/?d=1&s=5"));
  const yesterdayHtml = await step("resultados-ayer", () => readPage("https://m.flashscore.co/?d=-1&s=3"));
  // Hace 2 días: recupera resultados que un corte atrasado o saltado no alcanzó a leer.
  const twoDaysHtml = await step("resultados-anteayer", () => readPage("https://m.flashscore.co/?d=-2&s=3"));
  const today = todayHtml ? parseLite(todayHtml) : [];
  const tomorrow = tomorrowHtml ? parseLite(tomorrowHtml) : [];
  const oddsRows = oddsHtml ? parseLite(oddsHtml) : [];
  const yesterday = yesterdayHtml ? parseLite(yesterdayHtml) : [];
  const twoDays = twoDaysHtml ? parseLite(twoDaysHtml) : [];

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
  for (const list of [today, tomorrow, oddsRows, yesterday, twoDays]) for (const row of list) row.league = canonicalCompetition(row.league);
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
  // Anteayer: solo completa partidos que siguen sin resultado; no corrige marcadores ya guardados.
  let recoveredTwoDays = 0;
  for (const row of twoDays) {
    const score = finalScore(row);
    if (!score) continue;
    const stored = byId.get(row.id);
    if (!stored || stored[5] === "finalizado") continue;
    stored[5] = "finalizado";
    stored[6] = score[0];
    stored[7] = score[1];
    recoveredTwoDays += 1;
  }
  // Sin resultado publicado: partidos de hace 3 días o más que siguen "por-jugar" después de que las páginas
  // de resultados de ayer y anteayer los tuvieron a su alcance (aplazados, suspendidos o sin dato en Flashscore).
  // No se inventa el resultado: quedan como "sin-resultado", fuera de las listas y de la evaluación.
  // Si una lectura posterior trae el marcador, la recuperación de anteayer lo completa.
  let markedNoResult = 0;
  if (yesterdayHtml && twoDaysHtml) {
    const lastChecked = bogotaDay(-2);
    for (const row of agenda.matches) {
      if (row[5] === "por-jugar" && String(row[1]).slice(0, 10) < lastChecked) {
        row[5] = "sin-resultado";
        markedNoResult += 1;
      }
    }
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
  let tablesDebug = null;
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
    tablesDebug = tables.map((table) => ({
      competition: table.competition,
      url: table.url ?? null,
      failed: table.failed ?? null,
      rowsKept: Array.isArray(table.rows) ? table.rows.length : 0,
      ...(table.debug ?? {}),
    }));
    file.source = "www.flashscore.co, tabla de cada liga en español. La escribe el corte de la noche.";
    file.leagues = [...byCompetition.values()];
    writeJson("standings-auto.json", file);
  }

  // Nivel B: ratings globales con todos los resultados conocidos hasta ahora (agenda ya actualizada y tablas leídas).
  let ratingsInfo = null;
  await step("ratings", async () => {
    const { ratingGames, useRatings } = await import("../src/lib/football/recent.ts");
    const { fitRatings } = await import("../src/lib/football/ratings.ts");
    const games = ratingGames();
    const fit = fitRatings(games, Date.now());
    fit.rule = "Ratings globales del Nivel B. Los calcula cada corte con los partidos anteriores a ese momento.";
    writeJson("ratings.json", fit);
    useRatings(fit);
    ratingsInfo = { games: fit.games, teams: Object.keys(fit.teams).length };
  });

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
      // Todos los partidos de hoy por empezar. Primero los de liga fuerte, luego los que traen cuota en la Lite.
      list.push({ id: row.id, home: row.home, away: row.away, kickoff, rank: strong ? 0 : keptOdds[row.id] ? 1 : 2, full: Boolean(strong) });
    }
    // Mañana: los partidos que una casa ya ofrece (cuota en la Lite), solo 1X2, después de todos los de hoy.
    for (const row of oddsTomorrowHtml ? parseLite(oddsTomorrowHtml) : []) {
      if (row.klass !== "sched" || !row.odds) continue;
      if (INCOMPATIBLE.test(row.league) || YOUTH.test(`${row.league} ${row.home} ${row.away}`)) continue;
      const clock = clockOf(row);
      if (!clock) continue;
      list.push({ id: row.id, home: row.home, away: row.away, kickoff: `${tomorrowName}T${clock}:00-05:00`, rank: 3, full: false });
    }
    // Por rango y luego por hora: lo que empieza antes se lee antes (las cuotas cuentan hasta 10 min antes del inicio).
    return list
      .sort((a, b) => a.rank - b.rank || a.kickoff.localeCompare(b.kickoff))
      .slice(0, ODDS_CAP)
      .map(({ rank, ...row }) => row);
  })) ?? [];
  const tomorrowTargets = oddsTargets.filter((row) => row.kickoff.startsWith(tomorrowName)).length;
  const oddsStartedMs = Date.now();
  const consensusRead = (await step("cuotas-consenso", () => browserPages(oddsTargets.map((row) => ({
    ...row,
    kind: "cuotas",
    url: `https://www.flashscore.co/partido/${row.id}/`,
    read: async (page) => readOdds(page, READ_MARKETS),
  })), () => Date.now() - oddsStartedMs >= ODDS_BUDGET_MS || overBudget()))) ?? [];
  const consensusStored = storeOdds(consensusRead, started);
  const readById = new Map(consensusRead.filter((row) => row.books).map((row) => [row.id, row]));

  // Cuotas 1X2 de Wplay (Lite) de partidos por empezar: la app las usa como mercado cuando no hay 3 casas.
  const wplayFile = readJsonOptional("wplay-odds.json", { byId: {} });
  const keepWplay = Date.now() - 3 * 24 * 3600 * 1000;
  const { cleanWplay, WPLAY_READER_VERSION } = await import("../src/lib/football/wplay-clean.ts");
  // Fuera las filas viejas copiadas de otro partido por el lector anterior (ver wplay-clean.ts).
  const wplayCleaned = cleanWplay(
    Object.fromEntries(Object.entries(wplayFile.byId ?? {}).filter(([, row]) => Date.parse(row?.readAt ?? "") >= keepWplay)),
  );
  wplayFile.byId = wplayCleaned.kept;
  // Un partido que en esta lectura sale sin cuota pierde la que tenía guardada (la casa la retiró o era copiada).
  let wplayWithdrawn = 0;
  for (const row of [...oddsRows, ...(oddsTomorrowHtml ? parseLite(oddsTomorrowHtml) : [])]) {
    if (!row.odds && wplayFile.byId[row.id]) {
      delete wplayFile.byId[row.id];
      wplayWithdrawn += 1;
    }
  }
  // Mañana: solo para saber qué partidos ofrece la casa y mostrar el mercado; no entra a predicciones de hoy.
  for (const row of oddsTomorrowHtml ? parseLite(oddsTomorrowHtml) : []) {
    if (!row.odds || row.klass !== "sched") continue;
    const margin = row.odds.reduce((sum, price) => sum + 1 / price, 0) - 1;
    if (margin >= 0 && margin <= 0.15) wplayFile.byId[row.id] = { odds: row.odds, readAt: started, v: WPLAY_READER_VERSION };
  }
  for (const [id, odds] of Object.entries(keptOdds)) wplayFile.byId[id] = { odds, readAt: started, v: WPLAY_READER_VERSION };
  wplayFile.source = "m.flashscore.co/?d=0&s=5 (cuotas 1X2 de Wplay de la versión Lite). La escribe el corte.";
  writeJson("wplay-odds.json", wplayFile);

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
      // Elegible si faltaban 10+ minutos al empezar el corte: todos los datos que usa se leyeron antes del inicio.
      if (!Number.isFinite(kickoffMs) || kickoffMs - cutStartedMs < PREMATCH_MS) continue;
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
        marketSource: card.marketSource,
        probabilities: card.probabilities,
        pick: { key: sides[0][0], name: sides[0][1], probability: sides[0][2] },
        shadow: card.shadow,
        verifiedOdds: keptOdds[row.id] ? { source: "m.flashscore.co/?d=0&s=5", readAtBogota: started, wplay1x2: keptOdds[row.id] } : null,
        history: "mismo motor que la app: niveles A/B/C/M, Elo de selecciones y mezcla 80/20",
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
  const marksCleaned = cleanRegistry(registry);
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
        // Un cierre leído en el mismo corte que la marca no es un cierre: CLV 0 por construcción.
        if (!(Date.parse(started) - Date.parse(mark.readAt ?? "") >= 60 * 60 * 1000)) continue;
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

  // «Valor del día»: cada selección se guarda la primera vez que aparece (no se edita), para medir si gana.
  // Mismas reglas que la página /valor (src/lib/football/valor.ts), con las cuotas guardadas en combo-odds.json.
  let valuePicksAdded = 0;
  await step("valor-del-dia", async () => {
    const { consensusFromOffers, bestFromOffers, valuePicks } = await import("../src/lib/football/valor.ts");
    const stored = readJsonOptional("combo-odds.json", { matches: [] }).matches ?? [];
    const registro = readJsonOptional("valor-registro.json", { picks: [] });
    registro.rule =
      "Selecciones de «Valor del día» (mejor cuota de 3+ casas entre +3 % y +15 % sobre el consenso de las casas). Una fila por partido y resultado, guardada la primera vez que aparece; no se edita.";
    registro.picks = Array.isArray(registro.picks) ? registro.picks : [];
    const seen = new Set(registro.picks.map((pick) => `${pick.matchId}|${pick.outcomeIndex}`));
    for (const item of stored) {
      const row = byId.get(item.id);
      if (!row || row[5] !== "por-jugar" || !(Date.parse(row[1]) - Date.now() > PREMATCH_MS)) continue;
      const offers = (item.markets?.["1X2"] ?? [])
        .filter(colombian)
        .filter((book) => Array.isArray(book.cells) && book.cells.length >= 3 && !book.cells.slice(0, 3).some((cell) => cell.withdrawn))
        .map((book) => ({ house: String(book.house).replace(/\.(co|latam|com)$/i, ""), odds: book.cells.slice(0, 3).map((cell) => Number(cell.text)) }));
      const probs = consensusFromOffers(offers);
      const best = bestFromOffers(offers);
      if (!probs || !best) continue;
      for (const pick of valuePicks(probs, best, offers.length)) {
        const key = `${item.id}|${pick.outcomeIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        registro.picks.push({
          matchId: item.id,
          home: row[3],
          away: row[4],
          competition: row[2],
          kickoff: row[1],
          outcomeIndex: pick.outcomeIndex,
          prob: pick.prob,
          house: pick.house,
          odds: pick.odds,
          ev: pick.ev,
          readAt: item.readAtBogota ?? null,
          savedAt: started,
        });
        valuePicksAdded += 1;
      }
    }
    writeJson("valor-registro.json", registro);
  });

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
    corte: mode,
    agendaToday: today.length,
    agendaTomorrow: tomorrow.length,
    updatedToday,
    addedToday,
    addedTomorrow,
    updatedYesterday,
    recoveredTwoDays,
    markedNoResult,
    scoreConflicts: conflicts,
    yesterdayFinished: yesterdayFinished.length,
    yesterdaySheets: (sheets ?? []).filter((sheet) => !sheet.failed).length,
    sheetsSkipped: yesterdayFinished.length - pending.length,
    sheetsAdded,
    sheetsDeferred: Math.max(0, pending.length - (sheets ?? []).length),
    budgetHit,
    sheetsHistory: Object.keys(historyFile.byId).length,
    oddsKept: Object.keys(keptOdds).length,
    wplayCopiedDropped: wplayCleaned.dropped.length,
    valuePicksAdded,
    wplayWithdrawn,
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
    valueMarksRemoved: marksCleaned.removed,
    valueMarksReopened: marksCleaned.reopened,
    closingOdds: closingRead,
    failures,
    reads: reads.length,
    tablesRead,
    tablesDebug,
    competitionsRenamed: renamed,
    consensusTargets: oddsTargets.length,
    consensusTomorrowTargets: tomorrowTargets,
    consensusTomorrowRead: consensusRead.filter((row) => row.books && String(row.kickoff ?? "").startsWith(tomorrowName)).length,
    consensusRead: consensusStored,
    oddsAttempted: consensusRead.length,
    oddsNoTab: consensusRead.filter((row) => row.noOddsTab).length,
    oddsFailed: consensusRead.filter((row) => row.failed).length,
    consensusWith3Houses: consensusRead.filter((row) => liveHouses(row) >= 3).length,
    predictionsWithConsensus: fresh.filter((row) => row.consensus).length,
    predictionsWithWplay: fresh.filter((row) => row.marketSource === "wplay").length,
    predictionsByLevel: fresh.reduce((acc, row) => ({ ...acc, [row.level]: (acc[row.level] ?? 0) + 1 }), {}),
    ratingsGames: ratingsInfo?.games ?? null,
    ratingsTeams: ratingsInfo?.teams ?? null,
  };
  writeJson("cut-coverage.json", coverage);
  await finishCut(coverage, last);
  // Queda marcado como hecho solo si se leyó la agenda del día.
  if (today.length > 0) writeJson("cut-done.json", { ...readJsonOptional("cut-done.json", {}), [mode]: todayName });
  console.log(JSON.stringify(coverage, null, 2));
}

/** Agrega el corte al registro (últimos 90) y recalcula la revisión automática (data/review.json). */
async function finishCut(coverage, previous = null) {
  try {
    const log = readJsonOptional("cut-log.json", { cuts: [] });
    log.rule = "Una fila por corte terminado (noche 00:15, mediodía 12:00, hora de Bogotá). La escribe el corte. Se conservan los últimos 90.";
    const rowOf = (coverage) => ({
        cut: coverage.cut ?? null,
        corte: coverage.corte ?? null,
        startedAtBogota: coverage.startedAtBogota ?? null,
        finishedAtBogota: coverage.finishedAtBogota ?? null,
        fatal: coverage.fatal ?? null,
        budgetHit: coverage.budgetHit ?? null,
        predictionsSaved: coverage.predictionsSaved ?? null,
        predictionsWithConsensus: coverage.predictionsWithConsensus ?? null,
        predictionsWithWplay: coverage.predictionsWithWplay ?? null,
        consensusTargets: coverage.consensusTargets ?? null,
        consensusWith3Houses: coverage.consensusWith3Houses ?? null,
        tablesRead: coverage.tablesRead ?? null,
        updatedYesterday: coverage.updatedYesterday ?? null,
        failures: Array.isArray(coverage.failures) ? coverage.failures.length : 0,
        scoreConflicts: Array.isArray(coverage.scoreConflicts) ? coverage.scoreConflicts.length : (coverage.scoreConflicts ?? 0),
    });
    const cuts = log.cuts ?? [];
    const known = new Set(cuts.map((row) => row.startedAtBogota));
    // El corte anterior pudo correr con código viejo que no escribía este registro: se agrega si falta.
    if (previous?.startedAtBogota && !known.has(previous.startedAtBogota)) cuts.push(rowOf(previous));
    cuts.push(rowOf(coverage));
    log.cuts = cuts.slice(-90);
    writeJson("cut-log.json", log);
    const { buildReview } = await import("../src/lib/football/review.ts");
    const review = buildReview({
      now: Date.now(),
      cuts: log.cuts,
      predictions: readJsonOptional("predictions.json", { records: [] }).records ?? [],
      evaluations: readJsonOptional("evaluations.json", {}),
      marks: readJsonOptional("value-marks.json", { marks: [] }).marks ?? [],
      closings: readJsonOptional("cierres.json", { byMatch: {} }).byMatch ?? {},
      picks: readJsonOptional("valor-registro.json", { picks: [] }).picks ?? [],
      agenda: readJsonOptional("agenda.json", { matches: [] }).matches ?? [],
      standings: readJsonOptional("standings-auto.json", { leagues: [] }).leagues ?? [],
    });
    writeJson("review.json", review);
  } catch (error) {
    console.error("revisión automática:", error);
  }
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

/**
 * Cierre (CORTE=cierre, cierre.yml cada hora): para los partidos con marca de valor que empiezan entre 10 y 130 min,
 * lee la tabla 1X2 de las casas y la guarda en data/cierres.json (último dato antes del inicio). No toca ningún otro
 * archivo ni el candado de los cortes. Con esto la revisión mide si las marcas le ganan al precio de cierre (CLV).
 */
async function cierre() {
  const started = bogotaStamp();
  const now = Date.now();
  const registry = readJsonOptional("value-marks.json", { marks: [] });
  const file = readJsonOptional("cierres.json", { byMatch: {} });
  file.rule =
    "Cuotas 1X2 de las casas leídas entre 10 y 130 min antes del inicio de los partidos con marca de valor o de «Valor del día». Las escribe cierre.yml cada hora; queda la última lectura antes del inicio. 30 días.";
  const keep = now - 30 * 24 * 3600 * 1000;
  file.byMatch = Object.fromEntries(Object.entries(file.byMatch ?? {}).filter(([, row]) => Date.parse(row?.kickoff ?? "") >= keep));
  const picks = readJsonOptional("valor-registro.json", { picks: [] }).picks ?? [];
  const targets = [
    ...new Map(
      [...(registry.marks ?? []), ...picks]
        .filter((mark) => (mark.market ?? "1x2") === "1x2")
        .filter((mark) => {
          const left = Date.parse(mark.kickoff) - now;
          return left > PREMATCH_MS && left <= 130 * 60 * 1000;
        })
        .map((mark) => [mark.matchId, mark]),
    ).values(),
  ];
  console.log(`cierre: ${targets.length} partidos con marca o «Valor del día» por empezar en 10-130 min.`);
  if (targets.length === 0) return;
  const read = await browserPages(
    targets.map((mark) => ({
      id: mark.matchId,
      kickoff: mark.kickoff,
      kind: "cuotas",
      url: `https://www.flashscore.co/partido/${mark.matchId}/`,
      read: async (page) => readOdds(page, ONLY_1X2),
    })),
  );
  let saved = 0;
  for (const row of read) {
    const books = (row.books ?? [])
      .filter(colombian)
      .filter((book) => book.market === "1x2" && Array.isArray(book.odds) && book.odds.length === 3 && !book.struck)
      .map((book) => ({ house: book.book, odds: book.odds }));
    if (!books.length) continue;
    file.byMatch[row.id] = { kickoff: row.kickoff, readAt: started, books };
    saved += 1;
  }
  file.updatedAt = started;
  writeJson("cierres.json", file);
  console.log(`cierre: ${saved} de ${targets.length} guardados.`);
}

/**
 * Diagnóstico de la lectura de cuotas (CORTE=diag, a mano con diag.yml). Lee 12 partidos por empezar: 4 cercanos
 * (como el cierre) y 8 de ligas grandes más lejanos (como el corte), y guarda lo que vio el navegador en
 * data/diag-cuotas.json: título, si hubo pestaña Cuotas, filas y casas antes del filtro colombiano, y un trozo
 * del texto visible cuando no hay tabla. No toca ningún otro archivo.
 */
async function diagCuotas() {
  const agenda = readJsonOptional("agenda.json", {});
  const rows = [];
  (function walk(x) {
    if (Array.isArray(x)) {
      if (typeof x[0] === "string" && /^\d{4}-/.test(String(x[1] ?? ""))) rows.push(x);
      else x.forEach(walk);
    } else if (x && typeof x === "object") Object.values(x).forEach(walk);
  })(agenda);
  const now = Date.now();
  const open = rows.filter((r) => r[5] === "por-jugar" && Date.parse(r[1]) - now > 15 * 60 * 1000 && Date.parse(r[1]) - now < 36 * 3600 * 1000);
  const near = open.filter((r) => Date.parse(r[1]) - now <= 130 * 60 * 1000).slice(0, 4);
  const big = /ENGLAND: Premier|SPAIN: LaLiga|ITALY: Serie A|GERMANY: Bundesliga|FRANCE: Ligue 1|COLOMBIA|ARGENTINA|BRAZIL|MEXICO|PORTUGAL|NETHERLANDS|UEFA|CONMEBOL|CHAMPIONS/i;
  const far = open.filter((r) => Date.parse(r[1]) - now > 130 * 60 * 1000 && big.test(String(r[2]))).slice(0, 8);
  const targets = [...far.slice(0, 2), ...near.slice(0, 1)];
  const read = await browserPages(
    targets.map((r) => ({
      id: r[0],
      kickoff: r[1],
      label: `${r[3]} – ${r[4]} (${r[2]})`,
      kind: "cuotas",
      url: `https://www.flashscore.co/partido/${r[0]}/`,
      read: async (page) => {
        const requests = [];
        page.on("request", (req) => {
          const url = req.url();
          if (/odds|geo|bookmaker|lsapp|graphql/i.test(url)) requests.push(url.slice(0, 300));
        });
        const env = await page
          .evaluate(() => {
            const out = {};
            for (const key of Object.keys(window)) {
              if (!/geo|country|environment|config|bookmaker/i.test(key)) continue;
              try { out[key] = JSON.stringify(window[key]).slice(0, 600); } catch { out[key] = "?"; }
            }
            const html = document.documentElement.outerHTML;
            const geo = html.match(/.{0,120}geo.{0,160}/gi) ?? [];
            return { keys: out, geo: geo.slice(0, 8) };
          })
          .catch((error) => ({ error: String(error) }));
        const title = await page.title().catch(() => "");
        const result = await readOdds(page, ONLY_1X2);
        const seen = await page
          .evaluate(() => ({
            hasOddsTable: Boolean(document.querySelector(".oddsCell__odds")),
            tableRows: document.querySelectorAll(".oddsCell__odds .ui-table__body .ui-table__row").length,
            imgAlts: [...document.querySelectorAll(".oddsCell__odds img[alt]")].map((img) => img.getAttribute("alt")).slice(0, 12),
            tabs: [...document.querySelectorAll("a,button")].map((el) => (el.textContent || "").trim()).filter((t) => t && t.length < 30).slice(0, 40),
            text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 700),
          }))
          .catch((error) => ({ error: String(error) }));
        return {
          title,
          noOddsTab: Boolean(result.noOddsTab),
          books: (result.books ?? []).map((b) => ({ book: b.book, market: b.market, odds: b.odds, struck: b.struck })),
          colombian: (result.books ?? []).filter(colombian).length,
          seen,
          env,
          requests: requests.slice(0, 25),
        };
      },
    })),
  );
  writeJson("diag-cuotas.json", {
    at: bogotaStamp(),
    rule: "Diagnóstico de la lectura de cuotas (CORTE=diag). Solo informa.",
    rows: read.map(({ read: _read, ...row }) => row),
  });
  console.log(`diag: ${read.length} partidos; con casas colombianas: ${read.filter((r) => r.colombian > 0).length}`);
}

if (process.env.CORTE === "diag") {
  diagCuotas().catch((error) => {
    console.error("diag:", error);
    process.exitCode = 1;
  });
} else if (process.env.CORTE === "cierre") {
  cierre().catch((error) => {
    console.error("cierre:", error);
    process.exitCode = 1;
  });
} else if (process.argv[2] === "repair") {
  repair().catch((error) => {
    failures.push({ step: "repair", error: error instanceof Error ? error.message : String(error) });
    console.error(error);
    process.exitCode = 1;
  });
} else {
  main().catch(async (error) => {
    failures.push({ step: "corte", error: error instanceof Error ? error.message : String(error) });
    const fatal = {
      cut: bogotaDay(0),
      corte: CUT_MODE,
      startedAtBogota: CUT_STARTED,
      finishedAtBogota: bogotaStamp(),
      failures,
      fatal: true,
    };
    try {
      writeJson("cut-coverage.json", fatal);
    } catch {
      /* el registro no se pudo escribir */
    }
    await finishCut(fatal);
    console.error(error);
    process.exitCode = 1;
  });
}
