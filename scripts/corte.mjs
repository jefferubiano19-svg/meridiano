/**
 * Corte diario. No usa un modelo de lenguaje.
 * Si un paso falla, los demás siguen y el fallo queda en el registro.
 */
import { spawnSync } from "node:child_process";
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
/** Horas hacia adelante de la búsqueda de valor de cada hora (cierre). */
const SCAN_HOURS = 6;
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

/**
 * Abre las páginas de `jobs` en un solo navegador, una tras otra. `again` (opcional): al final, con el navegador ya
 * caliente, vuelve a leer una vez las que no lo cumplan. Revisión del 12 nov 2026 con `cierres.json` → `lastRun`: las
 * páginas de cuotas llegan vacías sobre todo en los primeros minutos de cada navegador (p. ej. 7 primeras vacías y
 * luego 12 de 13 bien); un reintento con navegador nuevo vuelve a caer en esos primeros minutos.
 */
async function browserPages(jobs, stop, again) {
  const out = [];
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    failures.push({ step: "navegador", error: error instanceof Error ? error.message : String(error) });
    return jobs.map((job) => ({ ...job, failed: "navegador no disponible" }));
  }
  const page = await browser.newPage();
  // Flashscore pide las cuotas con la ubicación del visitante (geoIpCode). Los servidores de GitHub están en EE. UU.
  // y desde el 27 oct 2026 eso trae solo bet365.us (y nada en ligas colombianas). Meridiano es para apostar en
  // Colombia: se pide la vista de Colombia, que es la que ve cualquier usuario en Colombia (las 5 casas).
  await page
    .route(/global\.ds\.lsapp\.eu\/odds\//, (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("geoIpCode")) {
        url.searchParams.set("geoIpCode", "CO");
        url.searchParams.set("geoIpSubdivisionCode", "CODC");
      }
      return route.continue({ url: url.toString() });
    })
    .catch(() => undefined);
  // La pestaña Cuotas la decide el campo DX del feed dc_1_<partido> según la ubicación: desde EE. UU. no trae «OD»
  // en ligas que bet365.us no ofrece (Colombia, Uruguay, CAN…), aunque las casas colombianas sí las tengan; sin esa
  // pestaña la página no carga su comparador y la tabla sale vacía. Diagnóstico del 12 nov 2026 (diag.yml):
  // Pasto–Junior y Llaneros–Chicó con DX «PS,MC,HH,LT,TA,TV,DTF,SP», Curazao–Panamá con «PS,OD,HH,…». Se agrega «OD»
  // (lo que ve un usuario en Colombia); las cuotas siguen saliendo de la API con la vista de Colombia.
  await page
    .route(/flashscore\.ninja\/\d+\/x\/feed\/dc_1_/, async (route) => {
      try {
        const response = await route.fetch();
        const body = await response.text();
        const fixed = body.replace(/DX÷([^¬]*)/, (whole, list) =>
          list.split(",").includes("OD") ? whole : `DX÷${list ? `${list.split(",")[0]},OD${list.includes(",") ? `,${list.split(",").slice(1).join(",")}` : ""}` : "OD"}`,
        );
        await route.fulfill({ response, body: fixed });
      } catch {
        await route.continue().catch(() => undefined);
      }
    })
    .catch(() => undefined);
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
    if (typeof again === "function") {
      for (let index = 0; index < out.length; index += 1) {
        const first = out[index];
        if (!again(first) || first.failed === "prohibido por robots.txt" || first.failed === "empieza en menos de 10 minutos") continue;
        if (typeof stop === "function" && stop()) break;
        const job = jobs.find((item) => item.id === first.id && item.url === first.url) ?? jobs.find((item) => item.id === first.id);
        if (!job || (job.kind === "cuotas" && job.kickoff && Date.parse(job.kickoff) - Date.now() < PREMATCH_MS)) continue;
        await pause();
        try {
          await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30000 });
          const result = await job.read(page);
          out[index] = { ...job, ...result, url: page.url(), at: bogotaStamp(), retried: true };
          reads.push({ url: page.url(), at: bogotaStamp(), kind: job.kind });
        } catch (error) {
          out[index] = { ...first, retried: true, failed: error instanceof Error ? error.message : String(error) };
        }
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
    // Sin pestaña de Cuotas. Desde EE. UU. Flashscore la oculta en ligas que bet365.us no ofrece (p. ej. Colombia),
    // aunque las casas colombianas sí las tengan: se abre directamente la comparación 1X2 (con la vista de Colombia).
    // Si tampoco aparece la tabla, ninguna casa ofrece el partido y se sigue sin esperar más.
    const base = page.url().split("#")[0];
    await page.goto(`${base}#/comparacion-de-cuotas/1x2-cuotas/partido`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => undefined);
    const shown = await page.waitForSelector(".oddsCell__odds .ui-table__row", { timeout: 8000 }).then(() => true).catch(() => false);
    if (!shown) return { books: [], noOddsTab: true };
    const rows = (await readOddsTable(page)).filter((row) => row.odds.length === 3);
    return { books: rows.map((row) => ({ ...row, market: "1x2" })), viaHash: true };
  }
  await page.waitForTimeout(600);
  const books = [];
  let first = null;
  for (const market of markets) {
    const opened = await clickTab(page, market.label);
    // Si la pestaña no abrió, la tabla visible sigue siendo la anterior: no se lee (evita guardar 1X2 como "ambos marcan").
    if (!opened && market.id !== "1x2") continue;
    // La tabla llega de otra petición (la de cuotas con la vista de Colombia): se espera a que tenga filas.
    // Sin esta espera, las primeras páginas de cada navegador se leían vacías (diagnóstico del 28 oct 2026).
    await page.waitForSelector(".oddsCell__odds .ui-table__row", { timeout: 10000 }).catch(() => undefined);
    let rows = (await readOddsTable(page)).filter((row) => row.odds.length === (market.id === "1x2" ? 3 : 2));
    if (market.id === "1x2" && rows.length === 0) {
      // Último intento: la comparación 1X2 por dirección directa.
      const base = page.url().split("#")[0];
      await page.goto(`${base}#/comparacion-de-cuotas/1x2-cuotas/partido`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => undefined);
      await page.waitForSelector(".oddsCell__odds .ui-table__row", { timeout: 10000 }).catch(() => undefined);
      rows = (await readOddsTable(page)).filter((row) => row.odds.length === 3);
    }
    const signature = JSON.stringify(rows.map((row) => [row.book, row.odds]));
    if (market.id === "1x2") first = signature;
    else if (signature === first) continue;
    for (const row of rows) books.push({ ...row, market: market.id });
  }
  return { books };
}

/**
 * Doble oportunidad (1X · 12 · X2) y empate no válido (1 · 2). Se abren por la dirección de su pestaña
 * (/cuotas/doble-oportunidad/ y /cuotas/draw-no-bet/; hacer clic en la pestaña no abre). Se comprueba el encabezado
 * de la tabla («1X12X2» o «12») para no guardar la 1X2 con otro nombre. Filas incompletas (una casa sin alguna
 * cuota) se descartan: sin la posición no se sabe qué precio falta. Diagnóstico del 4 nov 2026 (diag.yml).
 */
const DOUBLE_MARKETS = [
  { label: "Doble oportunidad", id: "dc", head: "1X12X2", cells: 3 },
  { label: "Apuesta sin empate", id: "dnb", head: "12", cells: 2 },
];

async function readDoubleMarkets(page) {
  const links = await page
    .evaluate(() =>
      [...document.querySelectorAll("a")]
        .map((el) => ({ text: (el.textContent || "").trim(), href: el.getAttribute("href") }))
        .filter((item) => item.href && /^(Doble oportunidad|Apuesta sin empate)$/.test(item.text)),
    )
    .catch(() => []);
  const books = [];
  for (const market of DOUBLE_MARKETS) {
    const link = links.find((item) => item.text === market.label);
    if (!link) continue;
    const target = new URL(link.href, page.url()).toString();
    if (!(await allowed(target))) continue;
    await pause();
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => undefined);
    await page.waitForSelector(".oddsCell__odds .ui-table__row", { timeout: 8000 }).catch(() => undefined);
    const head = await page
      .evaluate(() => (document.querySelector(".oddsCell__odds .ui-table__header") || document.querySelector(".ui-table__header"))?.textContent || "")
      .catch(() => "");
    if (head.replace(/\s+/g, "").replace(/^Casa?de?Apuestas/i, "").replace(/^CasadeApuestas/i, "") !== market.head) continue;
    for (const row of await readOddsTable(page)) {
      if (row.odds.length === market.cells) books.push({ ...row, market: market.id });
    }
  }
  return books;
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

/**
 * Todas las selecciones de «Valor del día»: las del corte (data/valor-registro.json) y las de la búsqueda de cada
 * hora (data/valor-hora.json, la escribe cierre.yml). Van en archivos distintos para que el corte y el cierre, que
 * pueden correr al mismo tiempo, no choquen al guardar.
 */
function readPicks() {
  return [
    ...(readJsonOptional("valor-registro.json", { picks: [] }).picks ?? []),
    ...(readJsonOptional("valor-hora.json", { picks: [] }).picks ?? []),
  ];
}

/** Clave de una selección: partido y resultado (1X2) o partido, mercado y resultado (doble oportunidad, empate no válido). */
const pickKey = (pick) => (pick.market && pick.market !== "1x2" ? `${pick.matchId}|${pick.market}|${pick.outcomeIndex}` : `${pick.matchId}|${pick.outcomeIndex}`);

/** Texto de la selección para los correos. */
function pickSide(pick) {
  return pick.market === "dc"
    ? `Doble oportunidad: ${pick.outcomeIndex === 0 ? `${pick.home} o empate` : pick.outcomeIndex === 1 ? `${pick.home} o ${pick.away}` : `empate o ${pick.away}`}`
    : pick.market === "dnb"
      ? `Empate no válido: ${pick.outcomeIndex === 0 ? pick.home : pick.away}`
      : pick.outcomeIndex === 0
        ? pick.home
        : pick.outcomeIndex === 2
          ? pick.away
          : "Empate";
}
const num2 = (value) => Number(value).toFixed(2).replace(".", ",");
const pct1 = (value) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
const whenOf = (kickoff) => `${kickoff.slice(5, 10).split("-").reverse().join("/")} ${kickoff.slice(11, 16)}`;

/**
 * Comenta en el issue «Valor del día: selecciones nuevas» (GitHub le manda el correo al dueño por la mención).
 * Sin GITHUB_TOKEN (pruebas locales) no hace nada y devuelve false.
 */
async function commentValor(body) {
  const token = process.env.GITHUB_TOKEN || "";
  const repo = process.env.GITHUB_REPOSITORY || "";
  if (!token || !repo) return false;
  const gh = async (method, path, payload) => {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "meridiano-corte",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path.split("?")[0]} → ${response.status} ${text.slice(0, 120)}`);
    return text ? JSON.parse(text) : null;
  };
  const TITLE = "Valor del día: selecciones nuevas";
  const owner = repo.split("/")[0];
  const text = `@${owner} ${body}`;
  const issues = (await gh("GET", `/repos/${repo}/issues?state=open&per_page=50`)).filter((issue) => issue.title === TITLE && !issue.pull_request);
  if (issues[0]) await gh("POST", `/repos/${repo}/issues/${issues[0].number}/comments`, { body: text });
  else await gh("POST", `/repos/${repo}/issues`, { title: TITLE, body: text });
  return true;
}

/**
 * Aviso de «Valor del día»: selecciones nuevas que todavía no empiezan. `origin` dice de dónde salen (el corte o la
 * búsqueda de cada hora).
 */
async function notifyPicks(picks, origin = `corte ${CUT_MODE}, leídas desde las ${String(CUT_STARTED ?? "").slice(11, 16)}`) {
  const open = picks.filter((pick) => Date.parse(pick.kickoff) - Date.now() > PREMATCH_MS);
  if (open.length === 0) return { sent: false, picks: 0 };
  const minOf = (pick) => (pick.market === "dnb" ? (1.03 - (pick.pDraw ?? 0)) / pick.prob : 1.03 / pick.prob);
  // De mayor a menor probabilidad de cumplirse; «Alta» (40 % o más) es el nivel por defecto de la página.
  const sorted = [...open].sort((a, b) => b.prob - a.prob || a.kickoff.localeCompare(b.kickoff));
  const tier = (prob) => (prob >= 0.4 ? "**Alta**" : prob >= 0.25 ? "Media" : "Baja");
  const lines = sorted.map(
    (pick) =>
      `| ${whenOf(pick.kickoff)} | ${pick.home} – ${pick.away} | **${pickSide(pick)}** | ${pick.house} | ${num2(pick.odds)} | **${num2(minOf(pick))}** | ${pct1(pick.prob)} | ${tier(pick.prob)} |`,
  );
  const body = [
    `${sorted.length === 1 ? "1 selección nueva" : `${sorted.length} selecciones nuevas`} (${origin}).`,
    "",
    "| Inicio (Bogotá) | Partido | Selección | Casa | Cuota | Mínima | Se cumple | Nivel |",
    "|---|---|---|---|---|---|---|---|",
    ...lines,
    "",
    "Reglas: solo en esa casa y a la mínima o más; sola, nunca en combinada; una por partido; mismo monto pequeño. La cuota baja con las horas: si ya está debajo de la mínima, no tiene valor. Detalle y cuota vigente: https://meridiano-beige.vercel.app/valor",
    "",
    "_Lo escribe scripts/corte.mjs. No es una recomendación; la decisión sobre apostar queda para las 300 selecciones resueltas._",
  ].join("\n");
  const sent = await commentValor(body);
  return { sent, picks: sorted.length };
}

/**
 * Aviso «ya no tiene valor»: selecciones registradas que no han empezado y que en la lectura de cada hora ya no
 * pagan +3 % en ninguna casa colombiana. Una sola vez por selección (data/avisos.json).
 */
async function notifyLost(lost) {
  if (lost.length === 0) return { sent: false, picks: 0 };
  const lines = [...lost]
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
    .map(
      (item) =>
        `| ${whenOf(item.kickoff)} | ${item.home} – ${item.away} | ${pickSide(item)} | ${item.house} ${num2(item.odds)} | ${item.nowHouse} ${num2(item.nowOdds)} | ${num2(item.nowMin)} |`,
    );
  const body = [
    `**Ya no tienen valor** (lectura de las ${String(lost[0].readAt ?? "").slice(11, 16)}): ${lost.length === 1 ? "esta selección ya no se debe apostar" : `estas ${lost.length} selecciones ya no se deben apostar`}.`,
    "",
    "| Inicio (Bogotá) | Partido | Selección | Avisada a | Mejor cuota ahora | Mínima ahora |",
    "|---|---|---|---|---|---|",
    ...lines,
    "",
    "La mejor cuota de las casas colombianas quedó por debajo de la mínima (consenso actual + 3 %). Siguen en la medición con la cuota con que se registraron.",
  ].join("\n");
  const sent = await commentValor(body);
  return { sent, picks: lost.length };
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
        // Doble oportunidad y empate no válido se leen en su propio paso (storeDouble): se conservan.
        ...(previous.dc ? { dc: previous.dc } : {}),
        ...(previous.dnb ? { dnb: previous.dnb } : {}),
      },
      ...(byId.get(result.id)?.doubleReadAt ? { doubleReadAt: byId.get(result.id).doubleReadAt } : {}),
    });
    stored += 1;
  }
  file.matches = [...byId.values()];
  writeJson("combo-odds.json", file);
  return stored;
}

/** Guarda doble oportunidad y empate no válido en data/combo-odds.json, junto a la 1X2 del mismo partido. */
function storeDouble(results, started) {
  const file = readJsonOptional("combo-odds.json", { matches: [] });
  const byId = new Map((file.matches ?? []).map((item) => [item.id, item]));
  let stored = 0;
  for (const result of results ?? []) {
    const books = (result?.books ?? []).filter(colombian);
    const item = byId.get(result?.id);
    if (!item || books.length === 0) continue;
    const cells = (book) => book.odds.map((price) => ({ text: Number(price).toFixed(2), withdrawn: Boolean(book.struck) }));
    item.markets = {
      ...(item.markets ?? {}),
      dc: books.filter((book) => book.market === "dc").map((book) => ({ house: book.book, cells: cells(book) })),
      dnb: books.filter((book) => book.market === "dnb").map((book) => ({ house: book.book, cells: cells(book) })),
    };
    item.doubleReadAt = result.at ?? started;
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

  // Doble oportunidad y empate no válido (5 nov 2026): solo partidos con 3+ casas colombianas en 1X2, por empezar en
  // las próximas 30 h, de lo más próximo a lo más lejano; máximo 120 y 25 min, sin pasar el presupuesto del corte.
  const doubleTargets = consensusRead
    .filter((row) => (row.books ?? []).filter(colombian).filter((book) => book.market === "1x2" && !book.struck).length >= 3)
    .filter((row) => {
      const left = Date.parse(row.kickoff ?? "") - Date.now();
      return left > 30 * 60 * 1000 && left <= 30 * 3600 * 1000;
    })
    .sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)))
    .slice(0, 120);
  const doubleStartedMs = Date.now();
  const doubleRead = (await step("cuotas-dobles", () => browserPages(doubleTargets.map((row) => ({
    id: row.id,
    home: row.home,
    away: row.away,
    kickoff: row.kickoff,
    kind: "cuotas",
    url: `https://www.flashscore.co/partido/${row.id}/`,
    // Los enlaces de doble oportunidad y empate no válido aparecen solo con la pestaña Cuotas abierta (corte del 5 nov:
    // 0 de 120 leídos sin abrirla): primero se abre con el lector 1X2 y luego se leen los mercados dobles.
    read: async (page) => {
      const opened = await readOdds(page, ONLY_1X2);
      if (opened.noOddsTab) return { books: [] };
      return { books: await readDoubleMarkets(page) };
    },
  })), () => Date.now() - doubleStartedMs >= 25 * 60 * 1000 || overBudget()))) ?? [];
  const doubleStored = storeDouble(doubleRead, started);

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
  let favoritesAdded = 0;
  const newPicks = [];
  await step("valor-del-dia", async () => {
    const { consensusFromOffers, bestFromOffers, valuePicks, doublePicks, favoritePick } = await import("../src/lib/football/valor.ts");
    // «Favorito con valor» (en prueba): registro aparte, no se mezcla con «Valor del día».
    const favFile = readJsonOptional("favoritos-registro.json", { picks: [] });
    favFile.rule =
      "«Favorito con valor» EN PRUEBA (5 nov 2026): favorito de 65 %+ según la corrección de favoritos fuertes (favorites.ts) cuya mejor cuota paga entre +3 % y +15 % sobre esa probabilidad. Una fila por partido, la primera vez que aparece; no se edita. No es «Valor del día».";
    favFile.picks = Array.isArray(favFile.picks) ? favFile.picks : [];
    const favSeen = new Set(favFile.picks.map((pick) => pick.matchId));
    const stored = readJsonOptional("combo-odds.json", { matches: [] }).matches ?? [];
    const registro = readJsonOptional("valor-registro.json", { picks: [] });
    registro.rule =
      "Selecciones de «Valor del día» (mejor cuota de 3+ casas entre +3 % y +15 % sobre el consenso de las casas; desde el 5 nov 2026, regla v2: solo resultados de 40 % o más). Una fila por partido, mercado y resultado, guardada la primera vez que aparece; no se edita.";
    registro.picks = Array.isArray(registro.picks) ? registro.picks : [];
    // Clave: partido y resultado (1X2, como antes) o partido, mercado y resultado (doble oportunidad, empate no válido).
    const keyOf = pickKey;
    // También las que ya encontró la búsqueda de cada hora (valor-hora.json): no se registran dos veces.
    const seen = new Set(readPicks().map(keyOf));
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
        newPicks.push({ matchId: item.id, home: row[3], away: row[4], competition: row[2], kickoff: row[1], outcomeIndex: pick.outcomeIndex, prob: pick.prob, house: pick.house, odds: pick.odds, ev: pick.ev });
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
          // v2 (5 nov 2026): solo 40 % o más de probabilidad (valor.ts → VALUE_MIN_PROB).
          rule: "v2",
        });
        valuePicksAdded += 1;
      }
      const fav = favoritePick(probs, best, offers.length, { home: row[3], away: row[4], competition: row[2] });
      if (fav && !favSeen.has(item.id)) {
        favSeen.add(item.id);
        favFile.picks.push({ matchId: item.id, home: row[3], away: row[4], competition: row[2], kickoff: row[1], market: "1x2", ...fav, readAt: item.readAtBogota ?? null, savedAt: started });
        favoritesAdded += 1;
      }
      // Doble oportunidad y empate no válido, con el mismo consenso 1X2.
      const doubleOffers = (key, cells) =>
        (item.markets?.[key] ?? [])
          .filter(colombian)
          .filter((book) => Array.isArray(book.cells) && book.cells.length === cells && !book.cells.some((cell) => cell.withdrawn))
          .map((book) => ({ house: String(book.house).replace(/\.(co|latam|com)$/i, ""), odds: book.cells.map((cell) => Number(cell.text)) }));
      for (const pick of doublePicks(probs, doubleOffers("dc", 3), doubleOffers("dnb", 2))) {
        const key = keyOf({ matchId: item.id, market: pick.market, outcomeIndex: pick.outcomeIndex });
        if (seen.has(key)) continue;
        seen.add(key);
        const base = { matchId: item.id, home: row[3], away: row[4], competition: row[2], kickoff: row[1], market: pick.market, outcomeIndex: pick.outcomeIndex, prob: pick.prob, pDraw: pick.pDraw, house: pick.house, odds: pick.odds, ev: pick.ev };
        newPicks.push(base);
        registro.picks.push({ ...base, readAt: item.doubleReadAt ?? item.readAtBogota ?? null, savedAt: started, rule: "v2" });
        valuePicksAdded += 1;
      }
    }
    writeJson("valor-registro.json", registro);
    writeJson("favoritos-registro.json", favFile);
  });
  // Aviso por correo apenas hay selecciones nuevas (la ventaja se pierde si la cuota baja antes de apostar).
  await step("aviso-valor", () => notifyPicks(newPicks));

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
    favoritesAdded,
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
    doubleTargets: doubleTargets.length,
    doubleStored,
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
  // Listas «Partido hoy» y «Partido» como quedan publicadas con estos datos (proceso aparte: lee data/ nuevo).
  if (today.length > 0) {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-ts.mjs", "scripts/listas.mjs", mode], {
      encoding: "utf8",
      timeout: 5 * 60 * 1000,
    });
    if (run.status !== 0) console.error("listas:", (run.stderr || run.error?.message || "").slice(0, 400));
    else console.log((run.stdout || "").trim());
  }
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
      picks: readPicks(),
      favorites: readJsonOptional("favoritos-registro.json", { picks: [] }).picks ?? [],
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
  const picks = readPicks();
  const targets = [
    ...new Map(
      [...(registry.marks ?? []), ...picks]
        .filter((mark) => ["1x2", "dc", "dnb"].includes(mark.market ?? "1x2"))
        .filter((mark) => {
          const left = Date.parse(mark.kickoff) - now;
          return left > PREMATCH_MS && left <= 130 * 60 * 1000;
        })
        .map((mark) => [mark.matchId, mark]),
    ).values(),
  ];
  // Cuota vigente: las selecciones de «Valor del día» que empiezan entre 130 min y 24 h se releen cada hora
  // (data/vigentes.json) para que la página diga si siguen con valor y a qué cuota. Las 15 más próximas.
  const closingIds = new Set(targets.map((mark) => mark.matchId));
  const refresh = [
    ...new Map(
      picks
        .filter((pick) => !closingIds.has(pick.matchId))
        .filter((pick) => {
          const left = Date.parse(pick.kickoff) - now;
          return left > 130 * 60 * 1000 && left <= 24 * 3600 * 1000;
        })
        .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
        .map((pick) => [pick.matchId, pick]),
    ).values(),
  ].slice(0, 15);
  // Búsqueda de valor de cada hora: partidos con 3+ casas colombianas en el corte que empiezan entre 130 min y 6 h y
  // que no se leen ya arriba. Primero los que llevan más tiempo sin leerse (vigentes.json), luego los más próximos.
  // Hasta 25. Las selecciones que aparezcan se registran (valor-hora.json) y se avisan por correo: la cuota del corte
  // tiene hasta 15 h y para entonces muchas ya perdieron el valor.
  const previous = readJsonOptional("vigentes.json", { byMatch: {} }).byMatch ?? {};
  const agendaRows = readJsonOptional("agenda.json", { matches: [] }).matches ?? [];
  const rowById = new Map(agendaRows.map((row) => [row[0], row]));
  const busy = new Set([...closingIds, ...refresh.map((pick) => pick.matchId)]);
  const housesOf = (item) =>
    (item.markets?.["1X2"] ?? []).filter(colombian).filter((book) => Array.isArray(book.cells) && book.cells.length >= 3 && !book.cells.some((cell) => cell.withdrawn)).length;
  const scan = (readJsonOptional("combo-odds.json", { matches: [] }).matches ?? [])
    .filter((item) => !busy.has(item.id) && housesOf(item) >= 3)
    .map((item) => rowById.get(item.id))
    .filter((row) => row && row[5] === "por-jugar")
    .filter((row) => {
      const left = Date.parse(row[1]) - now;
      return left > 130 * 60 * 1000 && left <= SCAN_HOURS * 3600 * 1000;
    })
    .sort((a, b) => String(previous[a[0]]?.readAt ?? "").localeCompare(String(previous[b[0]]?.readAt ?? "")) || a[1].localeCompare(b[1]))
    .slice(0, 25)
    .map((row) => ({ matchId: row[0], kickoff: row[1] }));
  console.log(
    `cierre: ${targets.length} partidos por empezar en 10-130 min; ${refresh.length} selecciones para cuota vigente; ${scan.length} partidos en la búsqueda de valor.`,
  );
  if (targets.length === 0 && refresh.length === 0 && scan.length === 0) return;
  // Partidos con selección de doble oportunidad o empate no válido: también esos mercados (para la cuota vigente).
  const doubleIds = new Set(picks.filter((pick) => pick.market === "dc" || pick.market === "dnb").map((pick) => pick.matchId));
  const job = (mark) => ({
    id: mark.matchId,
    kickoff: mark.kickoff,
    kind: "cuotas",
    url: `https://www.flashscore.co/partido/${mark.matchId}/`,
    read: async (page) => {
      const result = await readOdds(page, ONLY_1X2);
      if (!doubleIds.has(mark.matchId) || result.noOddsTab) return result;
      return { ...result, books: [...(result.books ?? []), ...(await readDoubleMarkets(page))] };
    },
  });
  const goodRead = (row) => (row?.books ?? []).filter(colombian).filter((book) => book.market === "1x2" && !book.struck).length >= 3;
  const all = [...targets, ...refresh, ...scan];
  // Tope de 15 min para la vuelta principal (el cierre va primero; la búsqueda, al final, es lo que se recorta).
  const t0 = Date.now();
  // Las lecturas sin 3 casas se repiten una vez al final con el navegador ya caliente (ver browserPages).
  let read = await browserPages(all.map(job), () => Date.now() - t0 > 18 * 60 * 1000, (row) => !goodRead(row));
  // Si el cierre sigue sin 3 casas: hasta 2 intentos más con un navegador nuevo.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // Los reintentos son solo para el cierre (la medición); la cuota vigente se vuelve a leer en una hora.
    const missing = targets.filter((mark) => !goodRead(read.find((row) => row.id === mark.matchId)));
    if (!missing.length) break;
    console.log(`cierre: reintento ${attempt} para ${missing.length} partido(s) sin 3 casas.`);
    const again = await browserPages(missing.map(job));
    read = [...read.filter((row) => !missing.some((mark) => mark.matchId === row.id)), ...again];
  }
  const current = readJsonOptional("vigentes.json", { byMatch: {} });
  current.rule =
    "Última lectura 1X2 (casas colombianas) de cada selección de «Valor del día» que no ha empezado: la escribe cierre.yml cada hora. Solo informa; la medición usa cierres.json.";
  current.byMatch = Object.fromEntries(Object.entries(current.byMatch ?? {}).filter(([, row]) => Date.parse(row?.kickoff ?? "") >= now - 24 * 3600 * 1000));
  let saved = 0;
  let refreshed = 0;
  for (const row of read) {
    const books = (row.books ?? [])
      .filter(colombian)
      .filter((book) => book.market === "1x2" && Array.isArray(book.odds) && book.odds.length === 3 && !book.struck)
      .map((book) => ({ house: book.book, odds: book.odds }));
    if (!books.length) continue;
    const doubles = (row.books ?? []).filter(colombian).filter((book) => (book.market === "dc" || book.market === "dnb") && !book.struck);
    current.byMatch[row.id] = {
      kickoff: row.kickoff,
      readAt: started,
      books,
      ...(doubles.length
        ? {
            double: {
              dc: doubles.filter((book) => book.market === "dc").map((book) => ({ house: book.book, odds: book.odds })),
              dnb: doubles.filter((book) => book.market === "dnb").map((book) => ({ house: book.book, odds: book.odds })),
            },
          }
        : {}),
    };
    refreshed += 1;
    if (!closingIds.has(row.id)) continue;
    file.byMatch[row.id] = { kickoff: row.kickoff, readAt: started, books };
    saved += 1;
  }
  current.updatedAt = started;
  writeJson("vigentes.json", current);

  // «Valor del día» con la lectura de esta hora: selecciones nuevas (solo partidos a más de 130 min, para que la
  // lectura del registro no sea la misma del cierre con que se mide) y avisos de las que perdieron el valor.
  let added = 0;
  let lostCount = 0;
  try {
    const { consensusFromOffers, bestFromOffers, valuePicks, doublePicks } = await import("../src/lib/football/valor.ts");
    const hourFile = readJsonOptional("valor-hora.json", { picks: [] });
    hourFile.rule =
      "Selecciones de «Valor del día» (regla v2) que encontró la búsqueda de cada hora (cierre.yml) en partidos que empiezan entre 130 min y 6 h y que el corte no había registrado. Mismas reglas que valor-registro.json; source = hora. Una fila por partido, mercado y resultado; no se edita.";
    hourFile.picks = Array.isArray(hourFile.picks) ? hourFile.picks : [];
    const registered = readPicks();
    const seen = new Set(registered.map(pickKey));
    const avisos = readJsonOptional("avisos.json", { lost: {} });
    avisos.rule = "Selecciones de «Valor del día» ya avisadas por correo como «ya no tiene valor» (una vez cada una). Se borran 3 días después del partido.";
    avisos.lost = Object.fromEntries(Object.entries(avisos.lost ?? {}).filter(([, item]) => Date.parse(item?.kickoff ?? "") >= now - 3 * 24 * 3600 * 1000));
    const fresh = [];
    const lost = [];
    const short = (house) => String(house).replace(/\.(co|latam|com)$/i, "");
    for (const row of read) {
      if (!(Date.parse(row.kickoff) - Date.now() > PREMATCH_MS)) continue;
      const usable = (row.books ?? []).filter(colombian).filter((book) => !book.struck && Array.isArray(book.odds));
      const offers = usable.filter((book) => book.market === "1x2" && book.odds.length === 3).map((book) => ({ house: short(book.book), odds: book.odds }));
      if (offers.length < 3) continue;
      const probs = consensusFromOffers(offers);
      const best = bestFromOffers(offers);
      if (!probs || !best) continue;
      const dc = usable.filter((book) => book.market === "dc" && book.odds.length === 3).map((book) => ({ house: short(book.book), odds: book.odds }));
      const dnb = usable.filter((book) => book.market === "dnb" && book.odds.length === 2).map((book) => ({ house: short(book.book), odds: book.odds }));
      const agendaRow = rowById.get(row.id);
      // Nuevas: solo fuera de la ventana del cierre.
      if (agendaRow && !closingIds.has(row.id) && Date.parse(row.kickoff) - now > 130 * 60 * 1000) {
        const found = [
          ...valuePicks(probs, best, offers.length).map((pick) => ({ market: "1x2", ...pick })),
          ...doublePicks(probs, dc, dnb),
        ];
        for (const pick of found) {
          const key = pickKey({ matchId: row.id, market: pick.market, outcomeIndex: pick.outcomeIndex });
          if (seen.has(key)) continue;
          seen.add(key);
          const base = {
            matchId: row.id,
            home: agendaRow[3],
            away: agendaRow[4],
            competition: agendaRow[2],
            kickoff: agendaRow[1],
            ...(pick.market !== "1x2" ? { market: pick.market, pDraw: pick.pDraw } : {}),
            outcomeIndex: pick.outcomeIndex,
            prob: pick.prob,
            house: pick.house,
            odds: pick.odds,
            ev: pick.ev,
          };
          fresh.push(base);
          hourFile.picks.push({ ...base, readAt: started, savedAt: started, rule: "v2", source: "hora" });
        }
      }
      // Ya no tiene valor: selecciones v2 registradas de este partido cuya mejor cuota colombiana de ahora quedó por
      // debajo de la mínima calculada con el consenso de ahora (+3 %). Solo con 3+ casas leídas.
      const [home, draw, away] = probs;
      for (const pick of registered.filter((item) => item.matchId === row.id && item.rule === "v2")) {
        const market = pick.market ?? "1x2";
        if (market !== "1x2" && (market === "dc" ? dc : dnb).length === 0) continue;
        const key = pickKey(pick);
        if (avisos.lost[key]) continue;
        const prob = market === "1x2" ? probs[pick.outcomeIndex] : market === "dc" ? [home + draw, home + away, draw + away][pick.outcomeIndex] : pick.outcomeIndex === 0 ? home : away;
        const nowMin = market === "dnb" ? (1.03 - draw) / prob : 1.03 / prob;
        const pool = market === "1x2" ? offers : market === "dc" ? dc : dnb;
        const slot = market === "dnb" ? (pick.outcomeIndex === 0 ? 0 : 1) : pick.outcomeIndex;
        const top = pool.reduce((acc, offer) => (offer.odds[slot] > (acc?.odds ?? 0) ? { house: offer.house, odds: offer.odds[slot] } : acc), null);
        // Con la mínima redondeada a 2 decimales, como se muestra: 1,14 contra 1,1401 no se avisa (12 nov 2026).
        if (!top || top.odds + 0.005 >= nowMin) continue;
        avisos.lost[key] = { kickoff: pick.kickoff, at: started, odds: top.odds, minOdds: Number(nowMin.toFixed(3)) };
        lost.push({ ...pick, market, readAt: started, nowHouse: top.house, nowOdds: top.odds, nowMin });
      }
    }
    added = fresh.length;
    lostCount = lost.length;
    writeJson("valor-hora.json", hourFile);
    writeJson("avisos.json", avisos);
    if (fresh.length) {
      try {
        await notifyPicks(fresh, `búsqueda de cada hora, leídas a las ${started.slice(11, 16)}`);
      } catch (error) {
        console.log(`cierre: el aviso de selecciones nuevas falló: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (lost.length) {
      try {
        await notifyLost(lost);
      } catch (error) {
        console.log(`cierre: el aviso «ya no tiene valor» falló: ${error instanceof Error ? error.message : error}`);
      }
    }
  } catch (error) {
    console.log(`cierre: la búsqueda de valor falló: ${error instanceof Error ? error.message : error}`);
  }
  file.updatedAt = started;
  // Registro de la última vuelta (para revisar fallas sin acceso a los logs de GitHub).
  file.lastRun = {
    at: started,
    targets: targets.length,
    saved,
    refresh: refresh.length,
    refreshed,
    scan: scan.length,
    retried: read.filter((row) => row.retried).length,
    retriedOk: read.filter((row) => row.retried && goodRead(row)).length,
    added,
    lost: lostCount,
    rows: read.map((row) => ({
      id: row.id,
      failed: row.failed ?? null,
      noOddsTab: Boolean(row.noOddsTab),
      ...(row.retried ? { retried: true } : {}),
      books: (row.books ?? []).map((book) => `${book.book}:${book.market}:${(book.odds ?? []).join("/")}${book.struck ? "x" : ""}`),
    })),
  };
  writeJson("cierres.json", file);
  console.log(`cierre: ${saved} de ${targets.length} cierres guardados; ${refreshed} cuotas vigentes.`);
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
  const forced = String(process.env.DIAG_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const targets = forced.length ? rows.filter((r) => forced.includes(r[0])) : [...far.slice(0, 6), ...near.slice(0, 2)];
  const read = await browserPages(
    targets.map((r) => ({
      id: r[0],
      kickoff: r[1],
      label: `${r[3]} – ${r[4]} (${r[2]})`,
      kind: "cuotas",
      url: `https://www.flashscore.co/partido/${r[0]}/`,
      read: async (page) => {
        const requests = [];
        const onResponse = async (res) => {
          const url = res.url();
          if (!/odds|geo|bookmaker|lsapp|graphql|feed/i.test(url)) return;
          let body = "";
          try {
            body = (await res.text()).slice(0, 240);
          } catch {
            body = "?";
          }
          requests.push({ t: Date.now(), url: url.slice(0, 260), status: res.status(), body });
        };
        page.on("response", onResponse);
        const t0 = Date.now();
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
        // Mercados dobles con el mismo lector del corte (readDoubleMarkets).
        const doubles = await readDoubleMarkets(page).catch((error) => [{ error: String(error) }]);
        const extra = [{ label: "dobles", opened: true, url: page.url(), head: [], rows: doubles.map((book) => (book.error ? book.error : `${book.market} ${book.book}:${book.odds.join("/")}${book.struck ? "x" : ""}`)) }];
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
          env: null,
          extra,
          ms: Date.now() - t0,
          requests: (page.off("response", onResponse), requests.map((item) => ({ ...item, t: item.t - t0 }))),
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
