import oddsFile from "../../../data/combo-odds.json";
import wplayFile from "../../../data/wplay-odds.json";
import { cleanWplay, type WplayRow } from "./wplay-clean";
import { shin } from "./engine";
import { nationForMatch } from "./nations";
import type { RecentAnalysis } from "./recent-math";
import type { MatchAnalysis, ThreeWay } from "./types";

/**
 * Peso del mercado cuando solo hay una casa (Wplay): 80 % Wplay sin margen y 20 % modelo.
 * Evidencia: 427 partidos limpios, la mezcla baja el RPS frente al modelo (−0,0165, IC 95 % −0,025 a −0,008);
 * el mejor peso medido fue 0,76.
 */
export const MARKET_WEIGHT = 0.8;

/**
 * Peso del consenso de 3+ casas: 1 (se publica el consenso solo; el modelo queda como referencia y para «revisar»).
 * Evidencia del 15 oct 2026, 257 partidos jugados con consenso y modelo guardados antes del inicio:
 *  - RPS por peso: 0,8 → 0,1963; 0,9 → 0,1944; 1,0 → 0,1929 (mejora en cada paso).
 *  - Consenso solo contra la mezcla 0,8: −0,0034 (IC 95 % −0,0054 a −0,0014).
 *  - Mitad más antigua para elegir, mitad más reciente para probar: la más antigua elige 1,0 y en la más reciente
 *    1,0 también gana (0,1747 contra 0,1808).
 *  - Gana en todos los niveles (A 40, B 207, selecciones 10) y acierta más al favorito (54,1 % contra 52,9 %).
 * La revisión sigue midiendo la mezcla 0,8 como sombra (review.ts, «modelBlend») por si el modelo llega a aportar.
 */
export const CONSENSUS_WEIGHT = 1;

type OddsCell = { text: string; withdrawn: boolean };
type OddsRow = { house: string; cells: OddsCell[] };
type OddsMatch = {
  id: string;
  readAtBogota: string | null;
  markets: { "1X2"?: OddsRow[]; overUnder?: OddsRow[]; btts?: OddsRow[] };
};

const matches = (oddsFile as { matches: OddsMatch[] }).matches;

export interface BookPrice {
  house: string;
  home: number;
  draw: number;
  away: number;
  fair: ThreeWay;
}

export interface Publication {
  model: ThreeWay;
  consensus: ThreeWay | null;
  published: ThreeWay;
  books: number;
  readAt: string | null;
  weight: number;
  gap: number;
  values: { house: string; side: "home" | "draw" | "away"; odds: number; ev: number }[];
  review: string | null;
  /** De dónde sale la parte de mercado de la publicada: consenso de 3+ casas, solo Wplay, o ninguna. */
  marketSource: "consenso" | "wplay" | null;
  /** Probabilidad sin margen del mercado usado (consenso o Wplay). */
  market: ThreeWay | null;
}

// Sin las filas copiadas de otro partido por el lector viejo (ver wplay-clean.ts).
const WPLAY = cleanWplay((wplayFile as unknown as { byId?: Record<string, WplayRow> }).byId ?? {}).kept;

/** Cuotas 1X2 de Wplay (versión Lite) sin margen, si el corte las leyó antes del inicio. */
function wplayFair(matchId: string): ThreeWay | null {
  const row = WPLAY[matchId];
  if (!row || !Array.isArray(row.odds) || row.odds.length < 3) return null;
  return shin(row.odds[0], row.odds[1], row.odds[2]);
}

function logit(p: number): number {
  const x = Math.min(0.99, Math.max(0.01, p));
  return Math.log(x / (1 - x));
}

function expit(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalize(p: ThreeWay): ThreeWay {
  const sum = p.home + p.draw + p.away;
  return { home: p.home / sum, draw: p.draw / sum, away: p.away / sum };
}

function booksOf(matchId: string): { rows: BookPrice[]; readAt: string | null } {
  const match = matches.find((item) => item.id === matchId);
  if (!match) return { rows: [], readAt: null };
  const rows: BookPrice[] = [];
  for (const row of match.markets["1X2"] ?? []) {
    const cells = row.cells.slice(0, 3);
    if (cells.length < 3 || cells.some((cell) => cell.withdrawn)) continue;
    const home = Number(cells[0].text);
    const draw = Number(cells[1].text);
    const away = Number(cells[2].text);
    if (!(home > 1 && draw > 1 && away > 1)) continue;
    const fair = shin(home, draw, away);
    if (!fair) continue;
    rows.push({ house: row.house, home, draw, away, fair });
  }
  return { rows, readAt: match.readAtBogota };
}

function consensusOf(rows: BookPrice[]): ThreeWay | null {
  if (rows.length < 3) return null;
  return normalize({
    home: median(rows.map((row) => row.fair.home)),
    draw: median(rows.map((row) => row.fair.draw)),
    away: median(rows.map((row) => row.fair.away)),
  });
}

export function blendMarket(model: ThreeWay, consensus: ThreeWay, weight = MARKET_WEIGHT): ThreeWay {
  if (weight >= 1) return normalize(consensus);
  return normalize({
    home: expit(weight * logit(consensus.home) + (1 - weight) * logit(model.home)),
    draw: expit(weight * logit(consensus.draw) + (1 - weight) * logit(model.draw)),
    away: expit(weight * logit(consensus.away) + (1 - weight) * logit(model.away)),
  });
}

function bookValues(rows: BookPrice[]): Publication["values"] {
  const marks: Publication["values"] = [];
  for (const row of rows) {
    const others = consensusOf(rows.filter((item) => item.house !== row.house));
    if (!others) continue;
    const sides = [
      { side: "home" as const, odds: row.home, p: others.home },
      { side: "draw" as const, odds: row.draw, p: others.draw },
      { side: "away" as const, odds: row.away, p: others.away },
    ];
    for (const side of sides) {
      const ev = side.p * side.odds - 1;
      // Más de 15 % sobre el consenso de las demás casas, en la práctica, es un error de lectura o una cuota vieja.
      if (ev >= 0.03 && ev <= 0.15) marks.push({ house: row.house, side: side.side, odds: side.odds, ev });
    }
  }
  // Si las casas marcan resultados distintos a la vez, los datos se contradicen: no hay marca.
  if (new Set(marks.map((mark) => mark.side)).size > 1) return [];
  return marks.sort((a, b) => b.ev - a.ev);
}

function poissonOver(line: number, total: number): number {
  const threshold = Math.floor(line);
  let term = Math.exp(-total);
  let under = 0;
  for (let goals = 0; goals <= threshold; goals += 1) {
    under += term;
    term *= total / (goals + 1);
  }
  return 1 - under;
}

function marketTotal(matchId: string): number | null {
  const match = matches.find((item) => item.id === matchId);
  const rows = (match?.markets.overUnder ?? []).filter(
    (row) => row.house === "Wplay.co" && row.cells.length >= 3 && !row.cells[1].withdrawn && !row.cells[2].withdrawn,
  );
  const lines: { line: number; over: number }[] = [];
  for (const row of rows) {
    const line = Number(row.cells[0].text);
    const over = Number(row.cells[1].text);
    const under = Number(row.cells[2].text);
    if (!(line > 0 && over > 1 && under > 1)) continue;
    const mass = 1 / over + 1 / under;
    lines.push({ line, over: 1 / over / mass });
  }
  if (lines.length < 3) return null;
  let best = 2.5;
  let score = Infinity;
  for (let total = 0.4; total <= 6.01; total += 0.05) {
    const error = lines.reduce((sum, item) => {
      const gap = poissonOver(item.line, total) - item.over;
      return sum + gap * gap;
    }, 0);
    if (error < score) {
      score = error;
      best = total;
    }
  }
  return best;
}

/**
 * Probabilidad publicada.
 * Con 3+ casas vigentes: el consenso (CONSENSUS_WEIGHT = 1, desde el 15 oct 2026). Sin consenso pero con la cuota de Wplay leída
 * antes del inicio: 80 % Wplay sin margen y 20 % modelo (la sombra "wplay" bajó el RPS de la publicada
 * en 543 partidos evaluados: −0,0154, IC 95 % −0,024 a −0,007; regla de la sección 9.2).
 * Sin ninguno de los dos, queda el modelo.
 */
export function publication(matchId: string, model: ThreeWay, modelTotal?: number | null): Publication {
  const { rows, readAt } = booksOf(matchId);
  const consensus = consensusOf(rows);
  const wplay = consensus ? null : wplayFair(matchId);
  const market = consensus ?? wplay;
  const weight = consensus ? CONSENSUS_WEIGHT : wplay ? MARKET_WEIGHT : 0;
  const published = market ? blendMarket(model, market, weight) : model;
  // El aviso "revisar" solo se calcula contra el consenso de 3+ casas, como antes.
  const gap = consensus
    ? Math.max(
        Math.abs(model.home - consensus.home),
        Math.abs(model.draw - consensus.draw),
        Math.abs(model.away - consensus.away),
      )
    : 0;
  let review: string | null = gap > 0.1 ? "Revisar: el modelo y el consenso difieren más de 10 puntos." : null;
  const implied = marketTotal(matchId);
  if (implied != null && modelTotal != null && Math.abs(modelTotal - implied) > 0.6) {
    review = `Revisar: los goles del modelo (${modelTotal.toFixed(2)}) y los de la escalera de Wplay (${implied.toFixed(2)}) difieren más de 0,6.`;
  }
  return {
    model,
    consensus,
    published,
    books: rows.length,
    readAt: consensus ? readAt : wplay ? (WPLAY[matchId]?.readAt ?? null) : readAt,
    weight,
    marketSource: consensus ? "consenso" : wplay ? "wplay" : null,
    market,
    gap,
    values: bookValues(rows),
    review,
  };
}

/**
 * Partido sin modelo (equipos sin historial) pero con cuotas: se publica el mercado solo (Nivel M).
 * Es la mejor probabilidad disponible para ese partido; no hay modelo que mezclar.
 */
export function marketOnly(matchId: string): Publication | null {
  const { rows, readAt } = booksOf(matchId);
  const consensus = consensusOf(rows);
  const wplay = consensus ? null : wplayFair(matchId);
  const market = consensus ?? wplay;
  if (!market) return null;
  return {
    model: market,
    consensus,
    published: market,
    books: rows.length,
    readAt: consensus ? readAt : (WPLAY[matchId]?.readAt ?? null),
    weight: 1,
    marketSource: consensus ? "consenso" : "wplay",
    market,
    gap: 0,
    values: bookValues(rows),
    review: null,
  };
}

/** true si hay cuotas de mercado para el partido (3+ casas o Wplay): es decir, una casa lo ofrece. */
export function hasMarketOdds(matchId: string): boolean {
  if (WPLAY[matchId]) return true;
  return booksOf(matchId).rows.length > 0;
}

export function fairOf(p: number): number {
  return Math.min(28.57, Math.max(1.09, 1 / Math.max(p, 0.035)));
}

export function presentAnalysis(matchId: string, analysis: MatchAnalysis, kickoff?: string): MatchAnalysis {
  const nation = nationForMatch(matchId);
  const model = nation?.p1x2 ?? analysis.p1x2;
  const lambdaHome = nation?.lambdaHome ?? analysis.lambdaHome;
  const lambdaAway = nation?.lambdaAway ?? analysis.lambdaAway;
  const pub = publication(matchId, model, lambdaHome + lambdaAway);
  const open = !kickoff || Date.parse(kickoff) - Date.now() > 10 * 60 * 1000;
  const revisar = pub.gap > 0.1;
  const best = open && !revisar ? pub.values[0] : undefined;
  const sideName = best?.side === "home" ? "local" : best?.side === "away" ? "visita" : "empate";
  const valueNote = revisar
    ? `Revisar: el modelo puro y el consenso difieren más de 10 puntos (${(pub.gap * 100).toFixed(1)}). No es valor.`
    : best
      ? `Valor en ${best.house}, ${sideName}, cuota ${best.odds.toFixed(2)}: ${(best.ev * 100).toFixed(1)}% sobre el consenso de las otras casas. No es una recomendación.`
      : pub.review;
  return {
    ...analysis,
    lambdaHome,
    lambdaAway,
    pOver25: nation?.pOver25 ?? analysis.pOver25,
    pUnder25: nation ? 1 - nation.pOver25 : analysis.pUnder25,
    pBttsYes: nation?.pBttsYes ?? analysis.pBttsYes,
    pBttsNo: nation ? 1 - nation.pBttsYes : analysis.pBttsNo,
    p1x2: pub.published,
    modelPure: model,
    fair: {
      ...analysis.fair,
      home: fairOf(pub.published.home),
      draw: fairOf(pub.published.draw),
      away: fairOf(pub.published.away),
    },
    eloHome: nation?.eloHome ?? analysis.eloHome,
    eloAway: nation?.eloAway ?? analysis.eloAway,
    valueFlag: revisar ? "revisar" : best ? "valor" : pub.review ? "revisar" : analysis.valueFlag,
    valueSide: best?.side ?? analysis.valueSide,
    valueGap: revisar ? pub.gap : best ? best.ev : analysis.valueGap,
    valueNote,
    reasons: nation
      ? [
          ...analysis.reasons,
          `Sección 5.4: Elo de eloratings.net, ${nation.eloHome} contra ${nation.eloAway}. Temperatura 0,95, estimada antes de 2025 y probada en 2025-2026.`,
        ]
      : analysis.reasons,
  };
}

export function presentRecent(matchId: string, analysis: RecentAnalysis): RecentAnalysis {
  const nation = nationForMatch(matchId);
  const model = nation?.p1x2 ?? analysis.p1x2;
  const pub = publication(matchId, model, (nation?.lambdaHome ?? analysis.lambdaHome) + (nation?.lambdaAway ?? analysis.lambdaAway));
  return {
    ...analysis,
    lambdaHome: nation?.lambdaHome ?? analysis.lambdaHome,
    lambdaAway: nation?.lambdaAway ?? analysis.lambdaAway,
    pOver25: nation?.pOver25 ?? analysis.pOver25,
    pUnder25: nation ? 1 - nation.pOver25 : analysis.pUnder25,
    pBttsYes: nation?.pBttsYes ?? analysis.pBttsYes,
    pBttsNo: nation ? 1 - nation.pBttsYes : analysis.pBttsNo,
    p1x2: pub.published,
    fairHome: fairOf(pub.published.home),
    fairDraw: fairOf(pub.published.draw),
    fairAway: fairOf(pub.published.away),
  };
}
