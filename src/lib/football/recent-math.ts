import type { ScoreCell, ThreeWay } from "./types";

export interface RecentAnalysis {
  /** "A": Dixon-Coles de la liga. "B": tabla de la temporada más resultados nuevos. "C": goles recientes. */
  level?: "A" | "B" | "C";
  lambdaHome: number;
  lambdaAway: number;
  p1x2: ThreeWay;
  pOver25: number;
  pUnder25: number;
  pBttsYes: number;
  pBttsNo: number;
  mostLikely: ScoreCell;
  matrix: ScoreCell[];
  fairHome: number;
  fairDraw: number;
  fairAway: number;
}

/** Ancla fija. No se estima con estos partidos: estimarla ahí sería el sobreajuste. */
const PRIOR_GOALS = 1.25;
const PRIOR_MATCHES = 8;
const RHO = -0.08;
const XI = Math.log(2) / 120;
const DAY_MS = 86_400_000;

export function shrinkRate(observed: number, games: number, prior = PRIOR_GOALS, strength = PRIOR_MATCHES): number {
  if (games <= 0) return prior;
  return (games * observed + strength * prior) / (games + strength);
}

/** Corrección fija de marcadores bajos. Rho no se ajusta a la muestra. */
export function dixonColes(hg: number, ag: number, lambdaHome: number, lambdaAway: number, rho = RHO): number {
  if (hg === 0 && ag === 0) return Math.max(0, 1 - lambdaHome * lambdaAway * rho);
  if (hg === 1 && ag === 0) return Math.max(0, 1 + lambdaAway * rho);
  if (hg === 0 && ag === 1) return Math.max(0, 1 + lambdaHome * rho);
  if (hg === 1 && ag === 1) return Math.max(0, 1 - rho);
  return 1;
}

function poisson(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let term = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) term *= lambda / i;
  return term;
}

function fair(p: number): number {
  const clamped = Math.min(0.92, Math.max(0.035, p));
  return Math.round((1 / clamped) * 100) / 100;
}

function finish(lambdaHome: number, lambdaAway: number): RecentAnalysis | null {
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pOver25 = 0;
  let pBttsYes = 0;
  let mass = 0;
  let most: ScoreCell = { hg: 0, ag: 0, p: 0 };
  const matrix: ScoreCell[] = [];
  for (let hg = 0; hg <= 10; hg += 1) {
    for (let ag = 0; ag <= 10; ag += 1) {
      const p = poisson(hg, lambdaHome) * poisson(ag, lambdaAway) * dixonColes(hg, ag, lambdaHome, lambdaAway);
      mass += p;
      if (hg > ag) pHome += p;
      else if (hg === ag) pDraw += p;
      else pAway += p;
      if (hg + ag >= 3) pOver25 += p;
      if (hg > 0 && ag > 0) pBttsYes += p;
      if (p > most.p) most = { hg, ag, p };
      if (hg <= 6 && ag <= 6) matrix.push({ hg, ag, p });
    }
  }
  if (mass <= 0) return null;
  pHome /= mass;
  pDraw /= mass;
  pAway /= mass;
  pOver25 /= mass;
  pBttsYes /= mass;
  most = { ...most, p: most.p / mass };
  matrix.forEach((cell) => {
    cell.p /= mass;
  });
  return {
    lambdaHome,
    lambdaAway,
    p1x2: { home: pHome, draw: pDraw, away: pAway },
    pOver25,
    pUnder25: 1 - pOver25,
    pBttsYes,
    pBttsNo: 1 - pBttsYes,
    mostLikely: most,
    matrix,
    fairHome: fair(pHome),
    fairDraw: fair(pDraw),
    fairAway: fair(pAway),
  };
}

function ratesOf(
  games: { ts: number | null; goalsFor: number; goalsAgainst: number }[],
  kickoffMs: number,
  prior: number,
): { attack: number; defense: number; n: number } | null {
  let mass = 0;
  let gf = 0;
  let ga = 0;
  let n = 0;
  for (const game of games) {
    if (game.ts == null) continue;
    const ms = game.ts > 1e12 ? game.ts : game.ts * 1000;
    const days = (kickoffMs - ms) / DAY_MS;
    if (!(days >= 0)) continue;
    const weight = Math.exp(-XI * days);
    mass += weight;
    gf += weight * game.goalsFor;
    ga += weight * game.goalsAgainst;
    n += 1;
  }
  if (n < 1 || mass <= 0) return null;
  return {
    attack: shrinkRate(gf / mass, mass, prior, 8),
    defense: shrinkRate(ga / mass, mass, prior, 8),
    n,
  };
}

export interface LevelCOptions {
  neutral?: boolean;
  prior?: number | null;
  homeFactor?: number | null;
  awayFactor?: number | null;
}

/** Nivel C. La media es la de la liga si el feed tiene partidos previos. 1,25 y 1,10/0,91 solo sin esa media. */
export function analyzeLevelC(
  homeGames: { ts: number | null; goalsFor: number; goalsAgainst: number }[],
  awayGames: { ts: number | null; goalsFor: number; goalsAgainst: number }[],
  kickoffMs: number,
  options: LevelCOptions = {},
): RecentAnalysis | null {
  const prior = options.prior != null && options.prior > 0 ? options.prior : 1.25;
  const home = ratesOf(homeGames, kickoffMs, prior);
  const away = ratesOf(awayGames, kickoffMs, prior);
  if (!home || !away) return null;
  let lambdaHome = (home.attack + away.defense) / 2;
  let lambdaAway = (away.attack + home.defense) / 2;
  if (!options.neutral) {
    if (options.homeFactor != null && options.awayFactor != null) {
      lambdaHome *= options.homeFactor;
      lambdaAway *= options.awayFactor;
    } else {
      lambdaHome *= 1.1;
      lambdaAway *= 0.91;
    }
  }
  return finish(Math.min(4, Math.max(0.2, lambdaHome)), Math.min(4, Math.max(0.2, lambdaAway)));
}

export function analyzeCounts(
  homeN: number,
  homeGf: number,
  homeGa: number,
  awayN: number,
  awayGf: number,
  awayGa: number,
): RecentAnalysis | null {
  if (homeN < 1 || awayN < 1) return null;
  const homeFor = shrinkRate(homeGf / homeN, homeN);
  const homeAgainst = shrinkRate(homeGa / homeN, homeN);
  const awayFor = shrinkRate(awayGf / awayN, awayN);
  const awayAgainst = shrinkRate(awayGa / awayN, awayN);
  let lambdaHome = ((homeFor + awayAgainst) / 2) * 1.1;
  let lambdaAway = ((awayFor + homeAgainst) / 2) * 0.91;
  lambdaHome = Math.min(4, Math.max(0.2, lambdaHome));
  lambdaAway = Math.min(4, Math.max(0.2, lambdaAway));
  return finish(lambdaHome, lambdaAway);
}
