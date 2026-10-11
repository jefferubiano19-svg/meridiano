import { dixonColes } from "./recent-math";
import type { ConfidenceLabel, ScoreCell, ThreeWay } from "./types";

const MAX_GOALS = 10;

export interface Adjustment {
  key: string;
  value: number;
  note: string;
}

export interface ValueCall {
  flag: "valor" | "revisar" | "sin-margen" | "sin-cuota";
  side: "home" | "draw" | "away" | null;
  gap: number | null;
}

function poisson(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let term = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) term *= lambda / i;
  return term;
}

export function clampLambda(value: number): number {
  return Math.min(4, Math.max(0.2, value));
}

/** Matriz 0-0 a 6-6 más la cola hasta 8, para que el 1X2 sume 1. */
export function scoreboard(lambdaHome: number, lambdaAway: number, rho = -0.08): {
  p1x2: ThreeWay;
  pOver25: number;
  pBttsYes: number;
  matrix: ScoreCell[];
  topScores: ScoreCell[];
} {
  const cells: ScoreCell[] = [];
  let mass = 0;
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pOver25 = 0;
  let pBttsYes = 0;
  for (let hg = 0; hg <= MAX_GOALS; hg += 1) {
    for (let ag = 0; ag <= MAX_GOALS; ag += 1) {
      const p = poisson(hg, lambdaHome) * poisson(ag, lambdaAway) * dixonColes(hg, ag, lambdaHome, lambdaAway, rho);
      mass += p;
      cells.push({ hg, ag, p });
      if (hg > ag) pHome += p;
      else if (hg === ag) pDraw += p;
      else pAway += p;
      if (hg + ag >= 3) pOver25 += p;
      if (hg > 0 && ag > 0) pBttsYes += p;
    }
  }
  const norm = mass > 0 ? mass : 1;
  const ready = cells.map((cell) => ({ ...cell, p: cell.p / norm }));
  const p1x2 = { home: pHome / norm, draw: pDraw / norm, away: pAway / norm };
  const total = p1x2.home + p1x2.draw + p1x2.away;
  if (Math.abs(total - 1) > 1e-9) {
    p1x2.home /= total;
    p1x2.draw /= total;
    p1x2.away /= total;
  }
  const topScores = [...ready].sort((a, b) => b.p - a.p).slice(0, 3);
  return {
    p1x2,
    pOver25: pOver25 / norm,
    pBttsYes: pBttsYes / norm,
    matrix: ready.filter((cell) => cell.hg <= 6 && cell.ag <= 6),
    topScores,
  };
}

export function devig(home: number, draw: number, away: number): ThreeWay | null {
  if (!(home > 1) || !(draw > 1) || !(away > 1)) return null;
  const raw = { home: 1 / home, draw: 1 / draw, away: 1 / away };
  const sum = raw.home + raw.draw + raw.away;
  const margin = sum - 1;
  if (sum <= 0 || margin < 0 || margin > 0.15) return null;
  return { home: raw.home / sum, draw: raw.draw / sum, away: raw.away / sum };
}

/** Shin. Si no converge, el llamador usa el proporcional. */
export function shin(home: number, draw: number, away: number): ThreeWay | null {
  if (!(home > 1) || !(draw > 1) || !(away > 1)) return null;
  const raw = [1 / home, 1 / draw, 1 / away];
  const sum = raw[0] + raw[1] + raw[2];
  const margin = sum - 1;
  if (margin < 0 || margin > 0.15) return null;
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 40; i += 1) {
    const z = (lo + hi) / 2;
    const total = raw.reduce((acc, q) => {
      const inner = z * z + (4 * (1 - z) * q * q) / sum;
      return acc + (Math.sqrt(inner) - z) / (2 * (1 - z));
    }, 0);
    if (total > 1) lo = z;
    else hi = z;
  }
  const z = (lo + hi) / 2;
  const probs = raw.map((q) => {
    const inner = z * z + (4 * (1 - z) * q * q) / sum;
    return (Math.sqrt(Math.max(0, inner)) - z) / (2 * (1 - z));
  });
  const mass = probs.reduce((acc, p) => acc + p, 0);
  if (mass <= 0 || probs.some((p) => !(p > 0))) return null;
  return { home: probs[0] / mass, draw: probs[1] / mass, away: probs[2] / mass };
}

export function valueCall(model: ThreeWay, market: ThreeWay | null, _label: ConfidenceLabel): ValueCall {
  if (!market) return { flag: "sin-cuota", side: null, gap: null };
  const sides = (["home", "draw", "away"] as const).map((side) => ({
    side,
    gap: model[side] - market[side],
  }));
  sides.sort((a, b) => b.gap - a.gap);
  const best = sides[0];
  if (best.gap > 0.1) return { flag: "revisar", side: best.side, gap: best.gap };
  return { flag: "sin-margen", side: best.side, gap: best.gap };
}

export function confidenceFrom(input: {
  useXg: boolean;
  sample: number;
  recentHome: number;
  recentAway: number;
  lineupHome: boolean;
  lineupAway: boolean;
  hasOdds: boolean;
  seasonUsable: boolean;
}): { label: ConfidenceLabel; score: number; reason: string } {
  const bits: string[] = [];
  let n = 0;
  if (input.useXg && input.seasonUsable) {
    n += 1;
    bits.push("hay xG de temporada de los dos");
  } else bits.push("sin xG de temporada de los dos");
  if ((input.recentHome >= 8 && input.recentAway >= 8) || input.sample >= 8) {
    n += 1;
    bits.push("hay al menos ocho partidos previos");
  } else bits.push("la muestra reciente no llega a ocho");
  if (input.lineupHome && input.lineupAway) {
    n += 1;
    bits.push("hay once titulares publicados");
  } else bits.push("no hay alineación confirmada de los dos");
  if (input.hasOdds) {
    n += 1;
    bits.push("hay cuota 1X2");
  } else bits.push("no hay cuota 1X2");
  const thin = input.sample < 6 && input.recentHome < 6;
  const label: ConfidenceLabel = thin || n < 2 ? "baja" : n >= 4 ? "alta" : "media";
  return { label, score: label === "alta" ? 74 : label === "media" ? 60 : 40, reason: bits.join(". ") };
}

export function bounded(base: number, factor: number): { next: number; applied: number } {
  const capped = Math.min(1.15, Math.max(0.85, factor));
  return { next: base * capped, applied: capped };
}
