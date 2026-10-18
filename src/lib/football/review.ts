/* ---------------------------------------------------------------------------
 * Revisión automática de Meridiano. La calcula el corte con los archivos de /data
 * y la guarda en data/review.json; la página Modelo la muestra.
 * Reemplaza la revisión semanal manual: salud de los cortes, cobertura, evaluación
 * con intervalo de confianza, valor y CLV, sombras, calibración y anomalías.
 * Solo mide: no cambia ningún parámetro ni ninguna predicción.
 * ------------------------------------------------------------------------- */

import { shin } from "./engine";

export type Light = "verde" | "amarillo" | "rojo" | "gris";

type Way = { home: number; draw: number; away: number };

interface CutRow {
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

interface PredictionRow {
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

interface ByMatch {
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
  shadows: { key: string; label: string; n: number; diff: Stat }[];
  /** Partidos publicados con Wplay como mercado (sin 3 casas): publicada contra modelo solo. */
  wplayMarket: { n: number; rpsPublished: number | null; rpsModel: number | null; diff: Stat; excludedCopied: number };
  /** Sombra: mezcla 80 % consenso + 20 % modelo contra el consenso solo, en los mismos partidos. Negativa: el modelo aporta. */
  modelBlend: { n: number; diff: Stat };
  calibration: { label: string; n: number; expected: number | null; observed: number | null }[];
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

const SPANISH_PREFIX =
  /^(ALEMANIA|INGLATERRA|ESPAÑA|FRANCIA|ITALIA|PAÍSES BAJOS|BÉLGICA|TURQUÍA|BRASIL|MÉXICO|ESTADOS UNIDOS|ESCOCIA|SUIZA|EUROPA|SUDAMÉRICA|ÁFRICA|MUNDIAL|GRECIA|RUSIA|SUECIA|NORUEGA|DINAMARCA|POLONIA|UCRANIA|CROACIA|EGIPTO|MARRUECOS|ARGELIA|JAPÓN|COREA DEL SUR|ARABIA SAUDÍ|PERÚ|PANAMÁ|REPÚBLICA CHECA|HUNGRÍA|SUDÁFRICA):/;

export function buildReview(input: ReviewInput): Review {
  const now = input.now;
  const from = now - 7 * DAY;

  // 1. Cortes de los últimos 7 días completos (14 esperados).
  const recent = input.cuts.filter((row) => {
    const start = Date.parse(row.startedAtBogota ?? "");
    return Number.isFinite(start) && start >= from && start <= now;
  });
  const list = recent.map((row) => {
    const start = Date.parse(row.startedAtBogota ?? "");
    const scheduled = scheduledMs(row);
    return {
      when: row.startedAtBogota ?? "",
      corte: row.corte ?? "",
      delayMin: scheduled != null ? Math.round((start - scheduled) / 60000) : null,
      predictions: row.predictionsSaved ?? null,
      withConsensus: row.predictionsWithConsensus ?? null,
      failures: row.failures ?? 0,
    };
  });
  const slots = new Set(recent.map((row) => `${row.cut}|${row.corte}`));
  // Turnos esperados: los de la ventana, desde el primer corte registrado y con al menos 1 hora de margen.
  const firstStart = Math.min(...input.cuts.map((row) => Date.parse(row.startedAtBogota ?? "")).filter(Number.isFinite));
  const expectedSlots = new Set<string>();
  for (let day = Date.parse(`${bogotaDay(from)}T00:00:00-05:00`); day <= now; day += DAY) {
    for (const [clock, corte] of [["00:15", "noche"], ["12:00", "mediodia"]]) {
      const date = bogotaDay(day + 6 * 3600 * 1000);
      const at = Date.parse(`${date}T${clock}:00-05:00`);
      if (at >= from && at >= firstStart - 3600 * 1000 && at <= now - 3600 * 1000) expectedSlots.add(`${date}|${corte}`);
    }
  }
  const expected = expectedSlots.size;
  const done = [...expectedSlots].filter((slot) => slots.has(slot)).length;
  const late = list.filter((row) => row.delayMin != null && row.delayMin > 15).length;
  const fatal = recent.filter((row) => row.fatal).length;
  const missing = expected - done;
  const cutsLight: Light = fatal > 0 || missing >= 3 ? "rojo" : missing > 0 || late > 0 ? "amarillo" : "verde";

  // 2. Cobertura: predicciones guardadas esta semana y la anterior.
  const coverageFor = (start: number, end: number) => {
    const rows = input.predictions.filter((row) => {
      const at = Date.parse(row.calculatedAt);
      return at >= start && at < end;
    });
    const byLevel: Record<string, number> = {};
    for (const row of rows) byLevel[row.level ?? "?"] = (byLevel[row.level ?? "?"] ?? 0) + 1;
    return { total: rows.length, byLevel, withConsensus: rows.filter((row) => row.consensus).length };
  };

  // 3. Evaluación.
  const byMatch = input.evaluations.byMatch ?? [];
  const rowById = new Map(input.predictions.map((row) => [row.id, row]));
  const comparable = byMatch.filter((row) => row.comparable && row.rpsPublished != null && row.rpsConsensus != null);
  const distance = stat(comparable.map((row) => (row.rpsPublished as number) - (row.rpsConsensus as number)));
  const levels = new Map<string, ByMatch[]>();
  for (const row of byMatch) {
    const level = (row.rowId && rowById.get(row.rowId)?.level) || "?";
    const bucket = levels.get(level) ?? [];
    bucket.push(row);
    levels.set(level, bucket);
  }
  const byLevel = [...levels.entries()]
    .map(([level, rows]) => {
      const withConsensus = rows.filter((row) => row.comparable && row.rpsPublished != null && row.rpsConsensus != null);
      return {
        level,
        n: rows.length,
        rpsPublished: mean(rows.map((row) => row.publishedRps ?? row.rpsPublished).filter((v): v is number => v != null)),
        comparable: withConsensus.length,
        distance: stat(withConsensus.map((row) => (row.rpsPublished as number) - (row.rpsConsensus as number))),
      };
    })
    .sort((a, b) => a.level.localeCompare(b.level));
  const stage = stageOf(comparable.length);
  let evalLight: Light = "gris";
  if (stage !== "muestra insuficiente" && distance.high != null && distance.low != null) {
    evalLight = distance.high < 0 ? "verde" : distance.low > 0 ? "rojo" : "amarillo";
  }

  // 4. Valor y CLV.
  const closed = input.marks.filter((mark) => typeof mark.clv === "number" && (mark.closingOdds ?? 0) > 1);
  const clv = stat(closed.map((mark) => mark.clv as number));

  // 4b. Resultado real de las marcas 1X2 y de «Valor del día», y comparación con el cierre (data/cierres.json).
  const agendaById = new Map(input.agenda.map((row) => [row[0], row]));
  const houseKey = (house: string | undefined) => String(house ?? "").replace(/\.(co|latam|com)$/i, "").toLowerCase();
  const resultsOf = (list: ReviewInput["marks"]) => {
    const seenMark = new Set<string>();
    const marks1x2 = list.filter((mark) => {
      if ((mark.market ?? "1x2") !== "1x2" || !mark.matchId || !(Number(mark.odds) > 1) || !Number.isInteger(mark.outcomeIndex)) return false;
      const key = `${mark.matchId}|${houseKey(mark.house)}|${mark.outcomeIndex}`;
      if (seenMark.has(key)) return false;
      seenMark.add(key);
      return true;
    });
    const pnl: number[] = [];
    for (const mark of marks1x2) {
      const row = agendaById.get(mark.matchId as string);
      if (!row || row[5] !== "finalizado" || row[6] == null || row[7] == null) continue;
      const winner = row[6] > row[7] ? 0 : row[6] === row[7] ? 1 : 2;
      pnl.push(winner === mark.outcomeIndex ? (mark.odds as number) - 1 : -1);
    }
    const clvHouse: number[] = [];
    const evClose: number[] = [];
    for (const mark of marks1x2) {
      const close = input.closings?.[mark.matchId as string];
      if (!close?.books?.length) continue;
      const same = close.books.find((book) => houseKey(book.house) === houseKey(mark.house));
      const index = mark.outcomeIndex as number;
      if (same && same.odds[index] > 1) clvHouse.push((mark.odds as number) / same.odds[index] - 1);
      const fairs = close.books.map((book) => shin(book.odds[0], book.odds[1], book.odds[2])).filter((f): f is NonNullable<typeof f> => Boolean(f));
      if (fairs.length >= 3) {
        const key = (["home", "draw", "away"] as const)[index];
        const sorted = fairs.map((f) => f[key]).sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const p = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        evClose.push((mark.odds as number) * p - 1);
      }
    }
    const evStat = stat(evClose);
    const verdict =
      evClose.length < 30
        ? `sin conclusión: ${evClose.length} con cierre de 3+ casas (hacen falta 30 para una primera lectura y 100 para decidir)`
        : evStat.low != null && evStat.low > 0
          ? "le ganan al cierre: hay ventaja medida"
          : evStat.high != null && evStat.high < 0
            ? "pierden contra el cierre: no hay ventaja"
            : "todavía no se distingue de cero";
    return { settled: pnl.length, roi: stat(pnl), closed: evClose.length, clvHouse: stat(clvHouse), evClose: evStat, verdict };
  };
  const valueResults = resultsOf(input.marks);
  const pickResults = resultsOf(input.picks ?? []);

  // 5. Sombras contra la publicada, en los mismos partidos.
  const shadowLabels: Record<string, string> = {
    wplay: "Wplay (hasta 12 oct)",
    xg: "xG",
    clubElo: "Elo clubes",
    season: "Temporada BetPlay",
  };
  const shadows = Object.keys(shadowLabels).map((key) => {
    // Desde el 13 oct la mezcla con Wplay ya es la publicada cuando no hay consenso: esos partidos no cuentan como sombra.
    const pairs = byMatch.filter(
      (row) =>
        row.shadowRps?.[key] != null &&
        (row.publishedRps ?? row.rpsPublished) != null &&
        !(key === "wplay" && row.marketSource === "wplay"),
    );
    return {
      key,
      label: shadowLabels[key],
      n: pairs.length,
      diff: stat(pairs.map((row) => (row.shadowRps?.[key] as number) - ((row.publishedRps ?? row.rpsPublished) as number))),
    };
  });

  // Fuera las predicciones cuyas cuotas de Wplay eran copiadas de otro partido (lector anterior al 14 oct 2026):
  // misma hora de lectura y mismas 3 cuotas en partidos distintos. Medirlas sería medir un error de lectura.
  const oddsGroups = new Map<string, Set<string>>();
  for (const row of input.predictions) {
    const odds = row.verifiedOdds?.wplay1x2;
    if (!Array.isArray(odds) || !odds.every((value) => typeof value === "number")) continue;
    const key = `${row.verifiedOdds?.readAtBogota ?? ""}|${odds.join("/")}`;
    const set = oddsGroups.get(key) ?? new Set<string>();
    set.add(row.matchId);
    oddsGroups.set(key, set);
  }
  const copied = new Set<string>();
  for (const set of oddsGroups.values()) if (set.size > 1) for (const id of set) copied.add(id);
  const wplayAll = byMatch.filter((row) => row.marketSource === "wplay" && row.publishedRps != null && row.modelRps != null);
  const wplayRows = wplayAll.filter((row) => !copied.has(row.matchId));
  const wplayMarket = {
    excludedCopied: wplayAll.length - wplayRows.length,
    n: wplayRows.length,
    rpsPublished: mean(wplayRows.map((row) => row.publishedRps as number)),
    rpsModel: mean(wplayRows.map((row) => row.modelRps as number)),
    diff: stat(wplayRows.map((row) => (row.publishedRps as number) - (row.modelRps as number))),
  };

  // 5b. Sombra del modelo: ¿la mezcla 0,8 le gana al consenso solo? (desde el 15 oct se publica el consenso solo).
  const outcomeRps = (p: Way, actual: string) => {
    const o = [actual === "home" ? 1 : 0, actual === "draw" ? 1 : 0, actual === "away" ? 1 : 0];
    const c1 = p.home - o[0];
    const c2 = p.home + p.draw - o[0] - o[1];
    return (c1 * c1 + c2 * c2) / 2;
  };
  const lg = (x: number) => {
    const v = Math.min(0.99, Math.max(0.01, x));
    return Math.log(v / (1 - v));
  };
  const ex = (x: number) => 1 / (1 + Math.exp(-x));
  const mix = (model: Way, market: Way): Way => {
    const raw = {
      home: ex(0.8 * lg(market.home) + 0.2 * lg(model.home)),
      draw: ex(0.8 * lg(market.draw) + 0.2 * lg(model.draw)),
      away: ex(0.8 * lg(market.away) + 0.2 * lg(model.away)),
    };
    const sum = raw.home + raw.draw + raw.away;
    return { home: raw.home / sum, draw: raw.draw / sum, away: raw.away / sum };
  };
  const blendDiffs: number[] = [];
  for (const row of byMatch) {
    const pred = row.rowId ? rowById.get(row.rowId) : undefined;
    if (!pred?.model || !pred?.consensus) continue;
    blendDiffs.push(outcomeRps(mix(pred.model, pred.consensus), row.actual) - outcomeRps(pred.consensus, row.actual));
  }
  const modelBlend = { n: blendDiffs.length, diff: stat(blendDiffs) };

  // 6. Calibración: probabilidad publicada del favorito contra lo que pasó.
  const bins = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((low) => ({ low, high: low + 0.1, p: [] as number[], hit: 0 }));
  for (const row of byMatch) {
    const pred = row.rowId ? rowById.get(row.rowId) : undefined;
    const way = pred?.published;
    if (!way) continue;
    const sides: ["home" | "draw" | "away", number][] = [
      ["home", way.home],
      ["draw", way.draw],
      ["away", way.away],
    ];
    const [side, p] = sides.sort((a, b) => b[1] - a[1])[0];
    const bin = bins.find((item) => p >= item.low && p < item.high) ?? (p >= 0.9 ? bins[bins.length - 1] : undefined);
    if (!bin) continue;
    bin.p.push(p);
    if (row.actual === side) bin.hit += 1;
  }
  const calibration = bins.map((bin) => ({
    label: `${Math.round(bin.low * 100)}–${Math.round(bin.high * 100)} %`,
    n: bin.p.length,
    expected: mean(bin.p),
    observed: bin.p.length ? bin.hit / bin.p.length : null,
  }));

  // 7. Anomalías de datos.
  const items: Review["anomalies"]["items"] = [];
  const push = (key: string, label: string, rows: string[]) => items.push({ key, label, count: rows.length, examples: rows.slice(0, 5) });
  push(
    "prefijo",
    "Competiciones con el país en español",
    input.agenda.filter((row) => SPANISH_PREFIX.test(row[2])).map((row) => `${row[0]} ${row[2]}`),
  );
  push(
    "por-jugar-viejo",
    "Partidos 'por-jugar' que empezaron hace más de 48 horas",
    input.agenda
      .filter((row) => row[5] === "por-jugar" && Date.parse(row[1]) < now - 2 * DAY && Date.parse(row[1]) >= now - 9 * DAY)
      .map((row) => `${row[0]} ${row[1].slice(0, 16)} ${row[3]} - ${row[4]}`),
  );
  push(
    "sin-resultado",
    "Partidos sin resultado publicado en Flashscore (aplazados o sin dato; informativo, no se evalúan)",
    input.agenda
      .filter((row) => row[5] === "sin-resultado" && Date.parse(row[1]) >= now - 9 * DAY)
      .map((row) => `${row[0]} ${row[1].slice(0, 16)} ${row[3]} - ${row[4]}`),
  );
  const ids = new Map<string, number>();
  for (const row of input.agenda) ids.set(row[0], (ids.get(row[0]) ?? 0) + 1);
  push("id-repetido", "Ids repetidos en la agenda", [...ids.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  const weekRows = input.predictions.filter((row) => Date.parse(row.calculatedAt) >= from);
  push(
    "despues-inicio",
    "Predicciones guardadas después del inicio",
    weekRows.filter((row) => Date.parse(row.calculatedAt) >= Date.parse(row.kickoff)).map((row) => row.id),
  );
  push(
    "suma",
    "Probabilidades publicadas que no suman 1",
    weekRows
      .filter((row) => row.published && Math.abs(row.published.home + row.published.draw + row.published.away - 1) > 0.001)
      .map((row) => row.id),
  );
  push(
    "goles",
    "Goles esperados fuera de 0,20 a 4,00",
    weekRows
      .filter((row) => [row.lambdaHome, row.lambdaAway].some((v) => typeof v === "number" && (v < 0.2 - 1e-9 || v > 4 + 1e-9)))
      .map((row) => row.id),
  );
  push(
    "tablas",
    "Filas de tablas con PJ ≠ G + E + P",
    input.standings.flatMap((table) =>
      table.rows
        .filter((row) => row.w != null && row.d != null && row.l != null && row.gp !== row.w + row.d + row.l)
        .map((row) => `${table.competition}: ${row.team}`),
    ),
  );
  push(
    "conflictos",
    "Marcadores corregidos por la página de resultados de ayer",
    recent.flatMap((row) => (row.scoreConflicts ? [`${row.startedAtBogota}: ${row.scoreConflicts}`] : [])),
  );
  // Informativos: correcciones de marcador (el sistema funcionando) y partidos sin resultado publicado.
  const serious = items.filter((item) => !["conflictos", "sin-resultado"].includes(item.key) && item.count > 0).length;
  const anomaliesLight: Light = serious === 0 ? "verde" : items.some((item) => ["despues-inicio", "suma", "id-repetido"].includes(item.key) && item.count > 0) ? "rojo" : "amarillo";

  return {
    generatedAt: new Date(now).toISOString(),
    window: { from: bogotaDay(from), to: bogotaDay(now) },
    cuts: { light: cutsLight, expected, done, late, fatal, list },
    coverage: { week: coverageFor(from, now + 1), previous: coverageFor(from - 7 * DAY, from) },
    evaluation: {
      light: evalLight,
      stage,
      evaluated: byMatch.length,
      comparable: comparable.length,
      goal: input.evaluations.goal ?? 500,
      rpsModel: mean(comparable.map((row) => row.rpsModel).filter((v): v is number => v != null)),
      rpsPublished: mean(comparable.map((row) => row.rpsPublished as number)),
      rpsConsensus: mean(comparable.map((row) => row.rpsConsensus as number)),
      distance,
      byLevel,
    },
    value: {
      marks: input.marks.length,
      withClose: closed.length,
      clv,
      stage: closed.length >= 100 ? "con muestra" : "sin conclusión (menos de 100 marcas con cierre)",
    },
    valueResults,
    pickResults,
    shadows,
    wplayMarket,
    modelBlend,
    calibration,
    anomalies: { light: anomaliesLight, items },
  };
}
