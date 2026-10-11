import { AGENDA } from "./agenda";
import { scoreboard } from "./engine";
import table from "../../../data/nation-elo.json";
import type { ThreeWay } from "./types";

const NATIONAL = /friendly international|nations league|asean cup|world cup/i;

type Fit = { mu: number; home: number; gamma: number; n: number };
const fits = table.fits as { nations: Fit; friendly: Fit; other: Fit };
const teams = table.teams as Record<string, { code: string; elo: number; asOf: string }>;

export function isNational(competition: string): boolean {
  return NATIONAL.test(competition);
}

function fitFor(competition: string): Fit {
  if (/nations league/i.test(competition)) return fits.nations;
  if (/friendly/i.test(competition)) return fits.friendly;
  return fits.other;
}

export function nationModel(home: string, away: string, competition: string): {
  lambdaHome: number;
  lambdaAway: number;
  p1x2: ThreeWay;
  pOver25: number;
  pBttsYes: number;
  eloHome: number;
  eloAway: number;
  fit: string;
  n: number;
} | null {
  if (!isNational(competition)) return null;
  const left = teams[home];
  const right = teams[away];
  if (!left || !right) return null;
  const fit = fitFor(competition);
  const neutral = /neutral|sede neutral/i.test(competition);
  const diff = (left.elo - right.elo) / 400;
  const homeAdv = neutral ? 0 : fit.home;
  const lambdaHome = Math.min(4, Math.max(0.2, Math.exp(fit.mu + homeAdv + fit.gamma * diff)));
  const lambdaAway = Math.min(4, Math.max(0.2, Math.exp(fit.mu - fit.gamma * diff)));
  const board = scoreboard(lambdaHome, lambdaAway, -0.08);
  const temperature = 0.95;
  const logits = [board.p1x2.home, board.p1x2.draw, board.p1x2.away].map((value) => Math.log(Math.max(value, 1e-6)) / temperature);
  const top = Math.max(...logits);
  const weights = logits.map((value) => Math.exp(value - top));
  const sum = weights[0] + weights[1] + weights[2];
  return {
    lambdaHome,
    lambdaAway,
    p1x2: { home: weights[0] / sum, draw: weights[1] / sum, away: weights[2] / sum },
    pOver25: board.pOver25,
    pBttsYes: board.pBttsYes,
    eloHome: left.elo,
    eloAway: right.elo,
    fit: /nations league/i.test(competition) ? "Nations League" : /friendly/i.test(competition) ? "amistosos" : "selecciones",
    n: fit.n,
  };
}

export function nationForMatch(matchId: string) {
  const match = AGENDA.find((item) => item.id === matchId);
  if (!match) return null;
  return nationModel(match.home, match.away, match.competition);
}
