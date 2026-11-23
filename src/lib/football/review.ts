/* ---------------------------------------------------------------------------
 * Revisión automática de Meridiano. La calcula el corte con los archivos de /data
 * y la guarda en data/review.json; la página Modelo la muestra.
 * Reemplaza la revisión semanal manual: salud de los cortes, cobertura, evaluación
 * con intervalo de confianza, valor y CLV, sombras, calibración y anomalías.
 * Solo mide: no cambia ningún parámetro ni ninguna predicción.
 * ------------------------------------------------------------------------- */

import { rivalScores, shin } from "./engine";
import { COLOMBIAN_HOUSE, expectedValue, medianConsensus, settle, type Outcome, type Selection } from "./mercados";

export type Light = "verde" | "amarillo" | "rojo" | "gris";

type Way = { home: number; draw: number; away: number };

export interface CutRow {
  cut: string | null;
  corte: string | null;
  startedAtBogota: string | null;
  finishedAtBogota?: string | null;
  fatal?: boolean | null;
  failures?: number;
  scoreConflicts?: number;
  predictionsSaved?: number | null;
  predictionsWithConsensus?: number | null;
}

export interface PredictionRow {
  id: string;
  matchId: string;
  kickoff: string;
  calculatedAt: string;
  level?: string;
  lambdaHome?: number;
  lambdaAway?: number;
  published?: Way | null;
  consensus?: Way | null;
  model?: Way | null;
  verifiedOdds?: { readAtBogota?: string; wplay1x2?: unknown } | null;
}

export interface ByMatch {
  matchId: string;
  rowId: string | null;
  actual: "home" | "draw" | "away";
  comparable: boolean;
  rpsModel: number | null;
  rpsPublished: number | null;
  rpsConsensus: number | null;
  publishedRps?: number | null;
  shadowRps?: Record<string, number | null>;
  modelRps?: number | null;
  marketSource?: string | null;
  /** Marcador [local, visita] del partido evaluado. */
  score?: unknown;
}

export interface ReviewInput {
  now: number;
  cuts: CutRow[];
  predictions: PredictionRow[];
  evaluations: { byMatch?: ByMatch[]; goal?: number };
  marks: {
    clv?: number | null;
    closingOdds?: number | null;
    house?: string;
    matchId?: string;
    market?: string | null;
    outcomeIndex?: number;
    odds?: number;
    kickoff?: string;
  }[];
  /** data/valor-registro.json → picks: selecciones de «Valor del día». */
  picks?: { matchId?: string; house?: string; outcomeIndex?: number; odds?: number; kickoff?: string; market?: string | null }[];
  /** «Favorito con valor» en prueba (data/favoritos-registro.json). */
  favorites?: { matchId?: string; house?: string; outcomeIndex?: number; odds?: number; kickoff?: string; market?: string | null }[];
  /** data/cierres.json → byMatch: cuotas 1X2 de las casas leídas poco antes del inicio. */
  closings?: Record<string, { readAt?: string; kickoff?: string; books?: { house: string; odds: number[] }[] }>;
  agenda: [string, string, string, string, string, string, number | null, number | null, unknown, unknown][];
  standings: { competition: string; rows: { team: string; gp: number; w?: number; d?: number; l?: number; gf: number; ga: number }[] }[];
}

export interface Stat {
  n: number;
  mean: number | null;
  low: number | null;
  high: number | null;
}

export interface Review {
  generatedAt: string;
  window: { from: string; to: string };
  cuts: {
    light: Light;
    expected: number;
    done: number;
    late: number;
    fatal: number;
    list: { when: string; corte: string; delayMin: number | null; predictions: number | null; withConsensus: number | null; failures: number }[];
  };
  coverage: {
    week: { total: number; byLevel: Record<string, number>; withConsensus: number };
    previous: { total: number; byLevel: Record<string, number>; withConsensus: number };
  };
  evaluation: {
    light: Light;
    stage: "muestra insuficiente" | "lectura preliminar" | "medición formal";
    evaluated: number;
    comparable: number;
    goal: number;
    rpsModel: number | null;
    rpsPublished: number | null;
    rpsConsensus: number | null;
    distance: Stat;
    byLevel: { level: string; n: number; rpsPublished: number | null; comparable: number; distance: Stat }[];
  };
  value: { marks: number; withClose: number; clv: Stat; stage: string };
  /**
   * Resultado de las marcas de valor 1X2: retorno real apostando 1 a cada una (con IC 95 %), y contra el cierre:
   * clvHouse = cuota / cuota de la misma casa al cierre − 1; evClose = cuota × probabilidad del consenso de cierre − 1.
   * evClose es la mejor estimación de si la marca tenía ventaja real; el retorno real necesita cientos de apuestas.
   */
  valueResults: { settled: number; roi: Stat; closed: number; clvHouse: Stat; evClose: Stat; verdict: string };
  /** Lo mismo para las selecciones de «Valor del día» (data/valor-registro.json). */
  pickResults: { settled: number; roi: Stat; closed: number; clvHouse: Stat; evClose: Stat; verdict: string };
  /** Lo mismo solo con las selecciones de cuota menor a 4 (filtro de la página /valor). */
  pickResultsLow: { settled: number; roi: Stat; closed: number; clvHouse: Stat; evClose: Stat; verdict: string };
  /** «Valor del día» por nivel de probabilidad: histórico completo y solo desde que se fijó la regla (forward). */
  /** Regla v2 de «Valor del día» (desde el 5 nov 2026): total y por mercado. */
  pickRuleV2: {
    all: { settled: number; roi: Stat; closed: number; clvHouse: Stat; evClose: Stat; verdict: string };
    byMarket: { market: "1x2" | "dc" | "dnb"; results: { settled: number; roi: Stat; closed: number; clvHouse: Stat; evClose: Stat; verdict: string } }[];
    /** Por origen: el corte (3 al día) o la búsqueda de cada hora (desde el 11 nov 2026, 130 min a 6 h antes). */
    bySource: { source: "corte" | "hora"; results: { settled: number; roi: Stat; closed: number; clvHouse: Stat; evClose: Stat; verdict: string } }[];
  };
  /** «Favorito con valor» en prueba: lo que manda es el resultado real (roi). */
  favoriteResults: { settled: number; roi: Stat; closed: number; clvHouse: Stat; evClose: Stat; verdict: string };
  pickTiers: {
    key: string;
    label: string;
    since: string;
    all: { settled: number; roi: Stat; closed: number; clvHouse: Stat; evClose: Stat; verdict: string };
    forward: { settled: number; roi: Stat; closed: number; clvHouse: Stat; evClose: Stat; verdict: string };
  }[];
  shadows: { key: string; label: string; n: number; diff: Stat }[];
  /** Partidos publicados con Wplay como mercado (sin 3 casas): publicada contra modelo solo. */
  wplayMarket: { n: number; rpsPublished: number | null; rpsModel: number | null; diff: Stat; excludedCopied: number };
  /** Sombra: mezcla 80 % consenso + 20 % modelo contra el consenso solo, en los mismos partidos. Negativa: el modelo aporta. */
  modelBlend: { n: number; diff: Stat };
  calibration: { label: string; n: number; expected: number | null; observed: number | null }[];
  /**
   * «El rival marca»: probabilidad de que el no favorito haga al menos un gol (de la 1X2 publicada) contra lo
   * que pasó. Brier contra una constante (la frecuencia real) y calibración por tramos. Solo mide.
   */
  rivalGoal: {
    n: number;
    rate: number | null;
    brier: number | null;
    brierConstant: number | null;
    buckets: { label: string; n: number; expected: number | null; observed: number | null }[];
  };
  anomalies: { light: Light; items: { key: string; label: string; count: number; examples: string[] }[] };
}

const DAY = 24 * 3600 * 1000;

function stat(values: number[]): Stat {
  const n = values.length;
  if (n === 0) return { n, mean: null, low: null, high: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) return { n, mean, low: null, high: null };
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1));
  const half = (1.96 * sd) / Math.sqrt(n);
  return { n, mean, low: mean - half, high: mean + half };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stageOf(n: number): Review["evaluation"]["stage"] {
  if (n >= 500) return "medición formal";
  if (n >= 150) return "lectura preliminar";
  return "muestra insuficiente";
}

/** Hora programada del corte (Bogotá) para su fecha: noche 00:15, mediodía 12:00. */
function scheduledMs(row: CutRow): number | null {
  if (!row.cut) return null;
  const clock = row.corte === "mediodia" ? "12:00" : row.corte === "tarde" ? "17:00" : "00:15";
  const ms = Date.parse(`${row.cut}T${clock}:00-05:00`);
  return Number.isFinite(ms) ? ms : null;
}

function bogotaDay(ms: number): string {
  return new Date(ms - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Mercado y resultado de una fila del registro (sin mercado = 1X2). */
function selectionOf(mark: { market?: string | null; outcomeIndex?: number }): Selection {
  return { market: (mark.market ?? "1x2") as Selection["market"], outcomeIndex: mark.outcomeIndex as Outcome } as Selection;
}

/* ---- 1. Cortes de los últimos 7 días completos (14 esperados) y su semáforo ----------------------------- */

const HOUR = 3600 * 1000;

function startedMs(row: CutRow): number {
  return Date.parse(row.startedAtBogota ?? "");
}

/** Cortes que empezaron dentro de la ventana [from, now]. */
function recentCuts(cuts: CutRow[], from: number, now: number): CutRow[] {
  return cuts.filter((row) => {
    const start = startedMs(row);
    return Number.isFinite(start) && start >= from && start <= now;
  });
}

/** Fila de la lista de cortes: retraso en minutos contra la hora programada. */
function cutEntry(row: CutRow): Review["cuts"]["list"][number] {
  const scheduled = scheduledMs(row);
  return {
    when: row.startedAtBogota ?? "",
    corte: row.corte ?? "",
    delayMin: scheduled != null ? Math.round((startedMs(row) - scheduled) / 60000) : null,
    predictions: row.predictionsSaved ?? null,
    withConsensus: row.predictionsWithConsensus ?? null,
    failures: row.failures ?? 0,
  };
}

/** Turnos esperados («fecha|corte»): los de la ventana, desde el primer corte registrado y con al menos 1 hora de margen. */
function expectedSlots(cuts: CutRow[], from: number, now: number): Set<string> {
  const firstStart = Math.min(...cuts.map(startedMs).filter(Number.isFinite));
  const slots = new Set<string>();
  for (let day = Date.parse(`${bogotaDay(from)}T00:00:00-05:00`); day <= now; day += DAY) {
    for (const [clock, corte] of [["00:15", "noche"], ["12:00", "mediodia"]]) {
      const date = bogotaDay(day + 6 * HOUR);
      const at = Date.parse(`${date}T${clock}:00-05:00`);
      if (at >= from && at >= firstStart - HOUR && at <= now - HOUR) slots.add(`${date}|${corte}`);
    }
  }
  return slots;
}

/** Rojo: algún corte fatal o 3+ turnos sin correr. Amarillo: falta alguno o alguno llegó más de 15 min tarde. */
function cutsLightOf(fatal: number, missing: number, late: number): Light {
  if (fatal > 0 || missing >= 3) return "rojo";
  return missing > 0 || late > 0 ? "amarillo" : "verde";
}

/** Salud de los cortes de la semana: esperados, hechos, tardes, fatales y semáforo. */
export function cutsSummary(cuts: CutRow[], from: number, now: number): Review["cuts"] {
  const recent = recentCuts(cuts, from, now);
  const list = recent.map(cutEntry);
  const ran = new Set(recent.map((row) => `${row.cut}|${row.corte}`));
  const expected = [...expectedSlots(cuts, from, now)];
  const done = expected.filter((slot) => ran.has(slot)).length;
  const late = list.filter((row) => row.delayMin != null && row.delayMin > 15).length;
  const fatal = recent.filter((row) => row.fatal).length;
  return { light: cutsLightOf(fatal, expected.length - done, late), expected: expected.length, done, late, fatal, list };
}

/* ---- 2. Cobertura: predicciones guardadas esta semana y la anterior --------------------------------------- */

type Coverage = Review["coverage"]["week"];

/** Predicciones calculadas en [start, end): total, por nivel y cuántas tenían consenso. */
function coverageFor(predictions: PredictionRow[], start: number, end: number): Coverage {
  const rows = predictions.filter((row) => {
    const at = Date.parse(row.calculatedAt);
    return at >= start && at < end;
  });
  const byLevel: Record<string, number> = {};
  for (const row of rows) byLevel[row.level ?? "?"] = (byLevel[row.level ?? "?"] ?? 0) + 1;
  return { total: rows.length, byLevel, withConsensus: rows.filter((row) => row.consensus).length };
}

/* ---- 3. Evaluación: RPS publicada contra el consenso, con IC 95 % y etapa --------------------------------- */

type Evaluation = Review["evaluation"];

/** Predicciones por id de fila (la última gana si un id se repite). */
function predictionIndex(predictions: PredictionRow[]): Map<string, PredictionRow> {
  return new Map(predictions.map((row) => [row.id, row]));
}

/** ¿El partido se puede comparar con el consenso? */
function withConsensus(rows: ByMatch[]): ByMatch[] {
  return rows.filter((row) => row.comparable && row.rpsPublished != null && row.rpsConsensus != null);
}

/** RPS publicada − RPS del consenso en partidos comparables: negativa = la publicada le gana al consenso. */
function consensusDistance(comparable: ByMatch[]): Stat {
  return stat(comparable.map((row) => (row.rpsPublished as number) - (row.rpsConsensus as number)));
}

/** Evaluados agrupados por el nivel de su predicción («?» sin fila o sin nivel), en orden de aparición. */
function groupByLevel(byMatch: ByMatch[], rowById: Map<string, PredictionRow>): Map<string, ByMatch[]> {
  const levels = new Map<string, ByMatch[]>();
  for (const row of byMatch) {
    const level = (row.rowId && rowById.get(row.rowId)?.level) || "?";
    const bucket = levels.get(level) ?? [];
    bucket.push(row);
    levels.set(level, bucket);
  }
  return levels;
}

function levelEntry(level: string, rows: ByMatch[]): Evaluation["byLevel"][number] {
  const comparable = withConsensus(rows);
  return {
    level,
    n: rows.length,
    rpsPublished: mean(rows.map((row) => row.publishedRps ?? row.rpsPublished).filter((v): v is number => v != null)),
    comparable: comparable.length,
    distance: consensusDistance(comparable),
  };
}

/** Gris con muestra insuficiente; verde si el IC entero está bajo cero, rojo si está sobre cero, si no amarillo. */
function evaluationLight(stage: Evaluation["stage"], distance: Stat): Light {
  if (stage === "muestra insuficiente" || distance.high == null || distance.low == null) return "gris";
  if (distance.high < 0) return "verde";
  return distance.low > 0 ? "rojo" : "amarillo";
}

export function evaluationOf(byMatch: ByMatch[], rowById: Map<string, PredictionRow>, goal: number): Evaluation {
  const comparable = withConsensus(byMatch);
  const distance = consensusDistance(comparable);
  const stage = stageOf(comparable.length);
  return {
    light: evaluationLight(stage, distance),
    stage,
    evaluated: byMatch.length,
    comparable: comparable.length,
    goal,
    rpsModel: mean(comparable.map((row) => row.rpsModel).filter((v): v is number => v != null)),
    rpsPublished: mean(comparable.map((row) => row.rpsPublished as number)),
    rpsConsensus: mean(comparable.map((row) => row.rpsConsensus as number)),
    distance,
    byLevel: [...groupByLevel(byMatch, rowById).entries()].map(([level, rows]) => levelEntry(level, rows)).sort((a, b) => a.level.localeCompare(b.level)),
  };
}

/* ---- 4. Valor y CLV de las marcas (cierre guardado en la marca) ------------------------------------------ */

function valueOf(marks: MarkRow[]): Review["value"] {
  const closed = marks.filter((mark) => typeof mark.clv === "number" && (mark.closingOdds ?? 0) > 1);
  return {
    marks: marks.length,
    withClose: closed.length,
    clv: stat(closed.map((mark) => mark.clv as number)),
    stage: closed.length >= 100 ? "con muestra" : "sin conclusión (menos de 100 marcas con cierre)",
  };
}

/* ---- 5. Sombras contra la publicada, en los mismos partidos ---------------------------------------------- */

const SHADOW_LABELS: Record<string, string> = {
  wplay: "Wplay (hasta 12 oct)",
  xg: "xG",
  clubElo: "Elo clubes",
  season: "Temporada BetPlay",
};

/** RPS publicada del partido (la guardada aparte si existe). */
function publishedRpsOf(row: ByMatch): number | null | undefined {
  return row.publishedRps ?? row.rpsPublished;
}

/** ¿El partido entra en la sombra? Desde el 13 oct la mezcla con Wplay ya es la publicada cuando no hay consenso. */
function inShadow(row: ByMatch, key: string): boolean {
  return row.shadowRps?.[key] != null && publishedRpsOf(row) != null && !(key === "wplay" && row.marketSource === "wplay");
}

/**
 * Sombra − publicada por sombra. La sombra «favoritos» (corrección de favoritos fuertes, 5 nov 2026) se quitó el
 * 11 nov 2026: en 3.419 partidos no mejoró la RPS publicada.
 */
function shadowsOf(byMatch: ByMatch[]): Review["shadows"] {
  return Object.keys(SHADOW_LABELS).map((key) => {
    const pairs = byMatch.filter((row) => inShadow(row, key));
    return {
      key,
      label: SHADOW_LABELS[key],
      n: pairs.length,
      diff: stat(pairs.map((row) => (row.shadowRps?.[key] as number) - (publishedRpsOf(row) as number))),
    };
  });
}

/**
 * Partidos cuyas cuotas de Wplay eran copiadas de otro partido (lector anterior al 14 oct 2026): misma hora de
 * lectura y mismas 3 cuotas en partidos distintos. Medirlas sería medir un error de lectura.
 */
function copiedWplay(predictions: PredictionRow[]): Set<string> {
  const groups = new Map<string, Set<string>>();
  for (const row of predictions) {
    const odds = row.verifiedOdds?.wplay1x2;
    if (!Array.isArray(odds) || !odds.every((value) => typeof value === "number")) continue;
    const key = `${row.verifiedOdds?.readAtBogota ?? ""}|${odds.join("/")}`;
    const set = groups.get(key) ?? new Set<string>();
    set.add(row.matchId);
    groups.set(key, set);
  }
  return new Set([...groups.values()].filter((set) => set.size > 1).flatMap((set) => [...set]));
}

/** Partidos publicados con Wplay como mercado (sin 3 casas): publicada contra modelo solo, sin los copiados. */
function wplayMarketOf(byMatch: ByMatch[], predictions: PredictionRow[]): Review["wplayMarket"] {
  const copied = copiedWplay(predictions);
  const all = byMatch.filter((row) => row.marketSource === "wplay" && row.publishedRps != null && row.modelRps != null);
  const rows = all.filter((row) => !copied.has(row.matchId));
  return {
    excludedCopied: all.length - rows.length,
    n: rows.length,
    rpsPublished: mean(rows.map((row) => row.publishedRps as number)),
    rpsModel: mean(rows.map((row) => row.modelRps as number)),
    diff: stat(rows.map((row) => (row.publishedRps as number) - (row.modelRps as number))),
  };
}

/* ---- 5b. Sombra del modelo: ¿la mezcla 0,8 le gana al consenso solo? (desde el 15 oct se publica el consenso) */

/** RPS de una 1X2 contra el resultado. */
function outcomeRps(p: Way, actual: string): number {
  const o = [actual === "home" ? 1 : 0, actual === "draw" ? 1 : 0, actual === "away" ? 1 : 0];
  const c1 = p.home - o[0];
  const c2 = p.home + p.draw - o[0] - o[1];
  return (c1 * c1 + c2 * c2) / 2;
}

/** Log-odds con la probabilidad recortada a [0,01, 0,99]. */
function logit(x: number): number {
  const v = Math.min(0.99, Math.max(0.01, x));
  return Math.log(v / (1 - v));
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Mezcla en log-odds 80 % mercado + 20 % modelo, normalizada. */
function blend(model: Way, market: Way): Way {
  const raw = {
    home: logistic(0.8 * logit(market.home) + 0.2 * logit(model.home)),
    draw: logistic(0.8 * logit(market.draw) + 0.2 * logit(model.draw)),
    away: logistic(0.8 * logit(market.away) + 0.2 * logit(model.away)),
  };
  const sum = raw.home + raw.draw + raw.away;
  return { home: raw.home / sum, draw: raw.draw / sum, away: raw.away / sum };
}

/** RPS de la mezcla − RPS del consenso, en los partidos con modelo y consenso. Negativa: el modelo aporta. */
function modelBlendOf(byMatch: ByMatch[], rowById: Map<string, PredictionRow>): Review["modelBlend"] {
  const diffs: number[] = [];
  for (const row of byMatch) {
    const pred = row.rowId ? rowById.get(row.rowId) : undefined;
    if (!pred?.model || !pred?.consensus) continue;
    diffs.push(outcomeRps(blend(pred.model, pred.consensus), row.actual) - outcomeRps(pred.consensus, row.actual));
  }
  return { n: diffs.length, diff: stat(diffs) };
}

/* ---- 6. Calibración: probabilidad publicada del favorito contra lo que pasó ------------------------------ */

type Side = "home" | "draw" | "away";
type Bin = { low: number; high: number; p: number[]; hit: number };

/** Resultado más probable de la 1X2 y su probabilidad (en empate gana el primero: local, empate, visita). */
function favoriteOf(way: Way): [Side, number] {
  const sides: [Side, number][] = [
    ["home", way.home],
    ["draw", way.draw],
    ["away", way.away],
  ];
  return sides.sort((a, b) => b[1] - a[1])[0];
}

/** Tramo [low, low + 0,1) de la probabilidad; 90 % o más va al último. Menos de 30 %: ninguno. */
function binOf(bins: Bin[], p: number): Bin | undefined {
  return bins.find((item) => p >= item.low && p < item.high) ?? (p >= 0.9 ? bins[bins.length - 1] : undefined);
}

/** Por tramo de la probabilidad del favorito: cuántos, la media dicha y cuántas veces ganó el favorito. */
export function calibrationOf(byMatch: ByMatch[], rowById: Map<string, PredictionRow>): Review["calibration"] {
  const bins: Bin[] = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((low) => ({ low, high: low + 0.1, p: [], hit: 0 }));
  for (const row of byMatch) {
    const way = row.rowId ? rowById.get(row.rowId)?.published : undefined;
    if (!way) continue;
    const [side, p] = favoriteOf(way);
    const bin = binOf(bins, p);
    if (!bin) continue;
    bin.p.push(p);
    if (row.actual === side) bin.hit += 1;
  }
  return bins.map((bin) => ({
    label: `${Math.round(bin.low * 100)}–${Math.round(bin.high * 100)} %`,
    n: bin.p.length,
    expected: mean(bin.p),
    observed: bin.p.length ? bin.hit / bin.p.length : null,
  }));
}

/* ---- 7. Anomalías de datos ------------------------------------------------------------------------------- */

type Anomalies = Review["anomalies"];

/** Lo que miran las verificaciones de datos. `recent`: cortes de la semana; `from`, `now`: la ventana. */
export interface AnomalyInput {
  agenda: AgendaRow[];
  predictions: PredictionRow[];
  standings: ReviewInput["standings"];
  recent: CutRow[];
  from: number;
  now: number;
}

const SPANISH_PREFIX =
  /^(ALEMANIA|INGLATERRA|ESPAÑA|FRANCIA|ITALIA|PAÍSES BAJOS|BÉLGICA|TURQUÍA|BRASIL|MÉXICO|ESTADOS UNIDOS|ESCOCIA|SUIZA|EUROPA|SUDAMÉRICA|ÁFRICA|MUNDIAL|GRECIA|RUSIA|SUECIA|NORUEGA|DINAMARCA|POLONIA|UCRANIA|CROACIA|EGIPTO|MARRUECOS|ARGELIA|JAPÓN|COREA DEL SUR|ARABIA SAUDÍ|PERÚ|PANAMÁ|REPÚBLICA CHECA|HUNGRÍA|SUDÁFRICA):/;

function matchLabel(row: AgendaRow): string {
  return `${row[0]} ${row[1].slice(0, 16)} ${row[3]} - ${row[4]}`;
}

function repeatedIds(agenda: AgendaRow[]): string[] {
  const ids = new Map<string, number>();
  for (const row of agenda) ids.set(row[0], (ids.get(row[0]) ?? 0) + 1);
  return [...ids.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

function weekPredictions(data: AnomalyInput): PredictionRow[] {
  return data.predictions.filter((row) => Date.parse(row.calculatedAt) >= data.from);
}

function sumIsOff(way: Way | null | undefined): boolean {
  return way != null && Math.abs(way.home + way.draw + way.away - 1) > 0.001;
}

function goalsOutOfRange(row: PredictionRow): boolean {
  return [row.lambdaHome, row.lambdaAway].some((v) => typeof v === "number" && (v < 0.2 - 1e-9 || v > 4 + 1e-9));
}

function badTableRows(standings: ReviewInput["standings"]): string[] {
  return standings.flatMap((table) =>
    table.rows.filter((row) => row.w != null && row.d != null && row.l != null && row.gp !== row.w + row.d + row.l).map((row) => `${table.competition}: ${row.team}`),
  );
}

/** Verificaciones en el orden en que se muestran: clave, texto y las filas que fallan. */
const ANOMALY_CHECKS: { key: string; label: string; rows: (data: AnomalyInput) => string[] }[] = [
  {
    key: "prefijo",
    label: "Competiciones con el país en español",
    rows: (data) => data.agenda.filter((row) => SPANISH_PREFIX.test(row[2])).map((row) => `${row[0]} ${row[2]}`),
  },
  {
    key: "por-jugar-viejo",
    label: "Partidos 'por-jugar' que empezaron hace más de 48 horas",
    rows: (data) =>
      data.agenda.filter((row) => row[5] === "por-jugar" && Date.parse(row[1]) < data.now - 2 * DAY && Date.parse(row[1]) >= data.now - 9 * DAY).map(matchLabel),
  },
  {
    key: "sin-resultado",
    label: "Partidos sin resultado publicado en Flashscore (aplazados o sin dato; informativo, no se evalúan)",
    rows: (data) => data.agenda.filter((row) => row[5] === "sin-resultado" && Date.parse(row[1]) >= data.now - 9 * DAY).map(matchLabel),
  },
  { key: "id-repetido", label: "Ids repetidos en la agenda", rows: (data) => repeatedIds(data.agenda) },
  {
    key: "despues-inicio",
    label: "Predicciones guardadas después del inicio",
    rows: (data) => weekPredictions(data).filter((row) => Date.parse(row.calculatedAt) >= Date.parse(row.kickoff)).map((row) => row.id),
  },
  {
    key: "suma",
    label: "Probabilidades publicadas que no suman 1",
    rows: (data) => weekPredictions(data).filter((row) => sumIsOff(row.published)).map((row) => row.id),
  },
  {
    key: "goles",
    label: "Goles esperados fuera de 0,20 a 4,00",
    rows: (data) => weekPredictions(data).filter(goalsOutOfRange).map((row) => row.id),
  },
  { key: "tablas", label: "Filas de tablas con PJ ≠ G + E + P", rows: (data) => badTableRows(data.standings) },
  {
    key: "conflictos",
    label: "Marcadores corregidos por la página de resultados de ayer",
    rows: (data) => data.recent.flatMap((row) => (row.scoreConflicts ? [`${row.startedAtBogota}: ${row.scoreConflicts}`] : [])),
  },
];

/** Informativos: correcciones de marcador (el sistema funcionando) y partidos sin resultado publicado. */
const INFORMATIVE = ["conflictos", "sin-resultado"];
/** Errores que ponen el semáforo en rojo. */
const SEVERE = ["despues-inicio", "suma", "id-repetido"];

/** Verde sin anomalías serias; rojo si alguna es grave; si no, amarillo. */
function anomaliesLightOf(items: Anomalies["items"]): Light {
  const serious = items.filter((item) => !INFORMATIVE.includes(item.key) && item.count > 0).length;
  if (serious === 0) return "verde";
  return items.some((item) => SEVERE.includes(item.key) && item.count > 0) ? "rojo" : "amarillo";
}

export function anomaliesOf(data: AnomalyInput): Anomalies {
  const items = ANOMALY_CHECKS.map(({ key, label, rows }) => {
    const found = rows(data);
    return { key, label, count: found.length, examples: found.slice(0, 5) };
  });
  return { light: anomaliesLightOf(items), items };
}

/* ---- Medición del dinero: liquidación y comparación con el cierre ---------------------------------------- */

/** Fila del registro de marcas, de «Valor del día» o de «Favorito con valor». */
export type MarkRow = ReviewInput["marks"][number];
type AgendaRow = ReviewInput["agenda"][number];
type Closings = NonNullable<ReviewInput["closings"]>;
type CloseBook = { house: string; odds: number[] };

/** Resultado de un grupo de selecciones (ver `Review["valueResults"]`). */
export type Results = Review["pickResults"];

/** Agenda por id de partido (la última fila gana si un id se repite). */
export function agendaIndex(agenda: AgendaRow[]): Map<string, AgendaRow> {
  return new Map(agenda.map((row) => [row[0], row]));
}

/** Casa sin dominio y en minúsculas: «Betano.co» y «betano» son la misma. */
function houseKey(house: string | undefined): string {
  return String(house ?? "").replace(/\.(co|latam|com)$/i, "").toLowerCase();
}

/** ¿La fila se puede medir? 1X2 y, desde el 5 nov 2026, doble oportunidad (dc) y empate no válido (dnb). */
function measurable(mark: MarkRow): boolean {
  return ["1x2", "dc", "dnb"].includes(mark.market ?? "1x2") && Boolean(mark.matchId) && Number(mark.odds) > 1 && Number.isInteger(mark.outcomeIndex);
}

/** Filas medibles, una por partido, mercado, casa y resultado (la primera que aparece). */
function uniqueMeasurable(list: MarkRow[]): MarkRow[] {
  const seen = new Set<string>();
  return list.filter((mark) => {
    if (!measurable(mark)) return false;
    const key = `${mark.matchId}|${mark.market ?? "1x2"}|${houseKey(mark.house)}|${mark.outcomeIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Resultado 1X2 de un partido finalizado con marcador; null si todavía no se puede liquidar. */
function winnerOf(row: AgendaRow | undefined): Outcome | null {
  if (!row || row[5] !== "finalizado" || row[6] == null || row[7] == null) return null;
  return row[6] > row[7] ? 0 : row[6] === row[7] ? 1 : 2;
}

/** Ganancia o pérdida apostando 1 a cada selección de un partido ya jugado. */
function settledPnl(marks: MarkRow[], agendaById: Map<string, AgendaRow>): number[] {
  const pnl: number[] = [];
  for (const mark of marks) {
    const winner = winnerOf(agendaById.get(mark.matchId as string));
    if (winner != null) pnl.push(settle(selectionOf(mark), mark.odds as number, winner));
  }
  return pnl;
}

/** Libros del cierre de las 5 casas colombianas (una lectura desde EE. UU. puede traer otras, como bet365.us). */
function colombianBooks(books: CloseBook[] | undefined): CloseBook[] {
  return (books ?? []).filter((book) => COLOMBIAN_HOUSE.test(String(book.house).trim()));
}

/** Cuota contra la misma casa al cierre − 1 (solo 1X2); null sin esa casa o sin cuota válida. */
function clvHouseOf(mark: MarkRow, books: CloseBook[]): number | null {
  if ((mark.market ?? "1x2") !== "1x2") return null;
  const same = books.find((book) => houseKey(book.house) === houseKey(mark.house));
  const index = mark.outcomeIndex as number;
  return same && same.odds[index] > 1 ? (mark.odds as number) / same.odds[index] - 1 : null;
}

/**
 * Valor contra el consenso de cierre (3+ casas); null con menos. Mismo consenso que al registrar (mediana
 * normalizada) en los tres mercados. Hasta el 23 nov 2026 el 1X2 usaba las medianas sin normalizar (suman 1 ± 2 %);
 * con los datos de ese día el valor al cierre cambia de +4,29 % a +4,25 % (205 cierres).
 */
function evCloseOf(mark: MarkRow, books: CloseBook[]): number | null {
  const fairs = books.map((book) => shin(book.odds[0], book.odds[1], book.odds[2])).filter((f): f is NonNullable<typeof f> => Boolean(f));
  if (fairs.length < 3) return null;
  const closing = medianConsensus(fairs) as [number, number, number];
  return expectedValue(selectionOf(mark), closing, mark.odds as number);
}

/** Comparación de cada selección con su cierre: misma casa (clvHouse) y consenso de cierre (evClose). */
function closingComparison(marks: MarkRow[], closings: Closings): { clvHouse: number[]; evClose: number[] } {
  const clvHouse: number[] = [];
  const evClose: number[] = [];
  for (const mark of marks) {
    const books = colombianBooks(closings[mark.matchId as string]?.books);
    if (!books.length) continue;
    const house = clvHouseOf(mark, books);
    if (house != null) clvHouse.push(house);
    const ev = evCloseOf(mark, books);
    if (ev != null) evClose.push(ev);
  }
  return { clvHouse, evClose };
}

/** Lectura del valor al cierre: 30 cierres para una primera lectura (puede cambiar), 100 para decidir. */
export function verdictOf(evClose: Stat): string {
  const n = evClose.n;
  if (n < 30) return `sin conclusión: ${n} con cierre de 3+ casas (hacen falta 30 para una primera lectura y 100 para decidir)`;
  const wins = evClose.low != null && evClose.low > 0;
  const loses = evClose.high != null && evClose.high < 0;
  if (n < 100) {
    if (wins) return `primera lectura favorable: le ganan al cierre en ${n} (preliminar; se confirma con 100)`;
    if (loses) return `primera lectura desfavorable: pierden contra el cierre en ${n} (preliminar; se confirma con 100)`;
    return `primera lectura: todavía no se distingue de cero en ${n} (se decide con 100)`;
  }
  if (wins) return "le ganan al cierre: hay ventaja medida";
  if (loses) return "pierden contra el cierre: no hay ventaja";
  return "todavía no se distingue de cero";
}

/**
 * Medición de un grupo de selecciones: retorno real apostando 1 a cada una (roi) y comparación con el cierre
 * (clvHouse, evClose). Las filas repetidas (mismo partido, mercado, casa y resultado) cuentan una vez.
 * Pura: no cambia la lista, la agenda ni los cierres.
 */
export function resultsOf(list: MarkRow[], agendaById: Map<string, AgendaRow>, closings: Closings): Results {
  const marks = uniqueMeasurable(list);
  const pnl = settledPnl(marks, agendaById);
  const { clvHouse, evClose } = closingComparison(marks, closings);
  const evStat = stat(evClose);
  return { settled: pnl.length, roi: stat(pnl), closed: evClose.length, clvHouse: stat(clvHouse), evClose: evStat, verdict: verdictOf(evStat) };
}

/** Mide un grupo de selecciones con la agenda y los cierres ya fijados (`resultsOf` parcialmente aplicada). */
export type Measure = (list: MarkRow[]) => Results;

/** Campos de una selección de «Valor del día» que no tienen las marcas. */
type PickRow = MarkRow & { rule?: string; source?: string; prob?: number; savedAt?: string };

/** Origen de una selección: la búsqueda de cada hora o el corte (lo que no dice «hora»). */
function sourceOf(pick: PickRow): "corte" | "hora" {
  return pick.source === "hora" ? "hora" : "corte";
}

/** Regla v2 (5 nov 2026): solo 40 %+ y, además de 1X2, doble oportunidad y empate no válido. Total, por mercado y por origen. */
export function pickRuleV2Of(picks: PickRow[], measure: Measure): Review["pickRuleV2"] {
  const v2 = picks.filter((pick) => pick.rule === "v2");
  return {
    all: measure(v2),
    byMarket: (["1x2", "dc", "dnb"] as const).map((market) => ({ market, results: measure(v2.filter((pick) => (pick.market ?? "1x2") === market)) })),
    bySource: (["corte", "hora"] as const).map((source) => ({ source, results: measure(v2.filter((pick) => sourceOf(pick) === source)) })),
  };
}

/**
 * Niveles de probabilidad de «Valor del día» (regla fijada el 5 nov 2026): todo el histórico y, aparte, solo lo
 * registrado desde ese día, que es la prueba limpia (el corte de 40 % se eligió mirando el histórico).
 */
const TIER_SINCE = "2026-11-05";

/** Tramos acumulados, como los filtros de la página: «40 % o más» y «25 % o más» (incluye la anterior). */
const TIERS = [
  { key: "alta", label: "40 % o más", min: 0.4 },
  { key: "media", label: "25 % o más", min: 0.25 },
  { key: "todas", label: "todas", min: 0 },
];

export function pickTiersOf(picks: PickRow[], measure: Measure): Review["pickTiers"] {
  return TIERS.map((tier) => {
    const inTier = picks.filter((pick) => Number(pick.prob) >= tier.min);
    return {
      key: tier.key,
      label: tier.label,
      all: measure(inTier),
      since: TIER_SINCE,
      forward: measure(inTier.filter((pick) => String(pick.savedAt ?? "") >= TIER_SINCE)),
    };
  });
}

/* ---- «El rival marca»: probabilidad de que el no favorito haga gol contra su marcador ---------------------- */

type RivalRow = { p: number; y: number };

/** Tramos de la probabilidad dicha (el último llega hasta 1,01 para que entre el 100 %). */
const RIVAL_BUCKETS: [number, number, string][] = [
  [0, 0.6, "menos de 60 %"],
  [0.6, 0.7, "60–70 %"],
  [0.7, 0.8, "70–80 %"],
  [0.8, 0.9, "80–90 %"],
  [0.9, 1.01, "90 % o más"],
];

/** Lo dicho (p) y lo que pasó (y = 1 si el no favorito marcó) de un partido evaluado; null sin 1X2 o sin marcador. */
function rivalRowOf(ev: ByMatch, rowById: Map<string, PredictionRow>): RivalRow | null {
  const published = ev.rowId ? rowById.get(ev.rowId)?.published : undefined;
  const score = ev.score;
  if (!published || !Array.isArray(score) || score.length < 2) return null;
  const rival = rivalScores(published);
  if (!rival) return null;
  return { p: rival.p, y: Number(rival.side === "home" ? score[0] : score[1]) >= 1 ? 1 : 0 };
}

/** Brier contra la frecuencia real (una constante) y calibración por tramos. */
export function rivalGoalOf(byMatch: ByMatch[], rowById: Map<string, PredictionRow>): Review["rivalGoal"] {
  const rows = byMatch.map((ev) => rivalRowOf(ev, rowById)).filter((row): row is RivalRow => row != null);
  const rate = mean(rows.map((row) => row.y));
  return {
    n: rows.length,
    rate,
    brier: mean(rows.map((row) => (row.p - row.y) ** 2)),
    brierConstant: rate == null ? null : mean(rows.map((row) => (rate - row.y) ** 2)),
    buckets: RIVAL_BUCKETS.map(([low, high, label]) => {
      const part = rows.filter((row) => row.p >= low && row.p < high);
      return { label, n: part.length, expected: mean(part.map((row) => row.p)), observed: mean(part.map((row) => row.y)) };
    }),
  };
}

/* ---- Ensamblador ---------------------------------------------------------------------------------------- */

/** Revisión de la semana que termina en `input.now`. Solo mide: no cambia nada de lo que recibe. */
export function buildReview(input: ReviewInput): Review {
  const now = input.now;
  const from = now - 7 * DAY;
  const byMatch = input.evaluations.byMatch ?? [];
  const rowById = predictionIndex(input.predictions);
  const agendaById = agendaIndex(input.agenda);
  const measure: Measure = (list) => resultsOf(list, agendaById, input.closings ?? {});
  const picks = input.picks ?? [];
  return {
    generatedAt: new Date(now).toISOString(),
    window: { from: bogotaDay(from), to: bogotaDay(now) },
    cuts: cutsSummary(input.cuts, from, now),
    coverage: { week: coverageFor(input.predictions, from, now + 1), previous: coverageFor(input.predictions, from - 7 * DAY, from) },
    evaluation: evaluationOf(byMatch, rowById, input.evaluations.goal ?? 500),
    value: valueOf(input.marks),
    valueResults: measure(input.marks),
    pickResults: measure(picks),
    // Filtro «cuota menor a 4» de la página /valor (anterior a la regla v2): la misma medición solo con esas.
    pickResultsLow: measure(picks.filter((pick) => Number(pick.odds) < 4)),
    pickTiers: pickTiersOf(picks, measure),
    pickRuleV2: pickRuleV2Of(picks, measure),
    // «Favorito con valor» (en prueba): resultado real apostando lo mismo a cada uno.
    favoriteResults: measure(input.favorites ?? []),
    shadows: shadowsOf(byMatch),
    wplayMarket: wplayMarketOf(byMatch, input.predictions),
    modelBlend: modelBlendOf(byMatch, rowById),
    calibration: calibrationOf(byMatch, rowById),
    rivalGoal: rivalGoalOf(byMatch, rowById),
    anomalies: anomaliesOf({ agenda: input.agenda, predictions: input.predictions, standings: input.standings, recent: recentCuts(input.cuts, from, now), from, now }),
  };
}
