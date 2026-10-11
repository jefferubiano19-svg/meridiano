import oddsFile from "../../../data/combo-odds.json";
import { shin } from "./engine";
import { nationForMatch } from "./nations";
import type { RecentAnalysis } from "./recent-math";
import type { MatchAnalysis, ThreeWay } from "./types";

/** Fijo hasta que el backtest elija otro. Sección 7.2. */
export const MARKET_WEIGHT = 0.8;

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

export function blendMarket(model: ThreeWay, consensus: ThreeWay): ThreeWay {
  return normalize({
    home: expit(MARKET_WEIGHT * logit(consensus.home) + (1 - MARKET_WEIGHT) * logit(model.home)),
    draw: expit(MARKET_WEIGHT * logit(consensus.draw) + (1 - MARKET_WEIGHT) * logit(model.draw)),
    away: expit(MARKET_WEIGHT * logit(consensus.away) + (1 - MARKET_WEIGHT) * logit(model.away)),
  });
}

function blend(model: ThreeWay, consensus: ThreeWay): ThreeWay {
  return blendMarket(model, consensus);
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
      if (ev >= 0.03) marks.push({ house: row.house, side: side.side, odds: side.odds, ev });
    }
  }
  return marks;
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

/** Probabilidad publicada. Sin 3 casas vigentes, queda el modelo. */
export function publication(matchId: string, model: ThreeWay, modelTotal?: number | null): Publication {
  const { rows, readAt } = booksOf(matchId);
  const consensus = consensusOf(rows);
  const published = consensus ? blend(model, consensus) : model;
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
    readAt,
    weight: consensus ? MARKET_WEIGHT : 0,
    gap,
    values: bookValues(rows),
    review,
  };
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
