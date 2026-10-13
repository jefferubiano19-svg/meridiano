import { agendaOnDay, type AgendaMatch } from "./agenda";
import { getFixture } from "./fixtures";
import { getAnalysis } from "./model";
import { hasMarketOdds, presentAnalysis } from "./publish";
import { publishedFor } from "./published";
import { INCOMPATIBLE } from "./recent";
import type { RecentAnalysis } from "./recent-math";
import { agendaToday, agendaTomorrow } from "./today";

const YOUTH = /sub[-\s]?\d+|\bu1[7-9]\b|\bu2[0-3]\b|juvenil|reservas?/i;

export interface CombinadaLeg {
  id: string;
  fixtureId: string | null;
  home: string;
  away: string;
  competition: string;
  kickoff: string;
  key: "home" | "draw" | "away";
  pick: string;
  probability: number;
  /** Cuota de casa solo si está publicada. Null no se sustituye. */
  odds: number | null;
  fairOdds: number;
  games: number;
}

export interface CombinadaTicket {
  legs: CombinadaLeg[];
  probability: number;
  bookOdds: number | null;
  fairOdds: number;
  /** Partidos de hoy que siguen sin empezar y tienen historial de los dos. */
  today: number;
  shortfall: number;
}

function pick(matchId: string, home: string, away: string, analysis: RecentAnalysis) {
  const sides = [
    { key: "home" as const, name: home, probability: analysis.p1x2.home, fair: analysis.fairHome },
    { key: "draw" as const, name: "Empate", probability: analysis.p1x2.draw, fair: analysis.fairDraw },
    { key: "away" as const, name: away, probability: analysis.p1x2.away, fair: analysis.fairAway },
  ].sort((a, b) => b.probability - a.probability);
  return sides[0];
}

function toLeg(match: AgendaMatch): CombinadaLeg | null {
  const fixture = match.fixtureId ? getFixture(match.fixtureId) : undefined;
  if (fixture) {
    // Probabilidad publicada (mercado + modelo), no el modelo solo.
    const analysis = presentAnalysis(match.id, getAnalysis(fixture), match.kickoff);
    const sides = [
      { key: "home" as const, name: match.home, probability: analysis.p1x2.home, fair: analysis.fair.home, odds: analysis.quoted.home },
      { key: "draw" as const, name: "Empate", probability: analysis.p1x2.draw, fair: analysis.fair.draw, odds: analysis.quoted.draw },
      { key: "away" as const, name: match.away, probability: analysis.p1x2.away, fair: analysis.fair.away, odds: analysis.quoted.away },
    ].sort((a, b) => b.probability - a.probability);
    const side = sides[0];
    return {
      id: match.id,
      fixtureId: match.fixtureId,
      home: match.home,
      away: match.away,
      competition: match.competition,
      kickoff: match.kickoff,
      key: side.key,
      pick: side.name,
      probability: side.probability,
      odds: typeof side.odds === "number" && side.odds > 1 ? side.odds : null,
      fairOdds: side.fair,
      games: 0,
    };
  }
  const analysis = publishedFor(match.id, match.kickoff, match.competition);
  if (!analysis) return null;
  const side = pick(match.id, match.home, match.away, analysis as unknown as RecentAnalysis);
  return {
    id: match.id,
    fixtureId: match.fixtureId,
    home: match.home,
    away: match.away,
    competition: match.competition,
    kickoff: match.kickoff,
    key: side.key,
    pick: side.name,
    probability: side.probability,
    odds: null,
    fairOdds: side.fair,
    games: 0,
  };
}

/** Cupón de un solo día. No se rellena con otra fecha ni con un partido ya empezado. */
function buildTicket(day: string, limit: number): CombinadaTicket {
  const now = Date.now();
  const pool = agendaOnDay(day).filter((match) => {
    if (match.status !== "por-jugar") return false;
    if (Date.parse(match.kickoff) <= now) return false;
    if (INCOMPATIBLE.test(match.competition) || YOUTH.test(`${match.competition} ${match.home} ${match.away}`)) return false;
    if (match.fixtureId && getFixture(match.fixtureId)) return true;
    return publishedFor(match.id, match.kickoff, match.competition) != null;
  });
  // Primero los partidos que una casa ofrece (el corte leyó su cuota); los demás solo si faltan.
  const offered = (match: AgendaMatch) => (hasMarketOdds(match.id) ? 0 : 1);
  const byKick = (a: AgendaMatch, b: AgendaMatch) => offered(a) - offered(b) || a.kickoff.localeCompare(b.kickoff);
  const withSheet = pool.filter((match) => match.fixtureId && getFixture(match.fixtureId)).sort(byKick);
  const rest = pool
    .filter((match) => !(match.fixtureId && getFixture(match.fixtureId)))
    .sort((a, b) => byKick(a, b) || a.competition.localeCompare(b.competition, "es"));

  const picked: AgendaMatch[] = [];
  const seen = new Set<string>();
  for (const match of withSheet) {
    if (picked.length >= limit) break;
    picked.push(match);
    seen.add(match.competition);
  }
  for (const match of rest) {
    if (picked.length >= limit) break;
    if (seen.has(match.competition)) continue;
    if (!publishedFor(match.id, match.kickoff, match.competition)) continue;
    seen.add(match.competition);
    picked.push(match);
  }
  picked.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const legs = picked.flatMap((match) => {
    const leg = toLeg(match);
    return leg ? [leg] : [];
  });
  const probability = legs.reduce((product, leg) => product * leg.probability, legs.length ? 1 : 0);
  const everyPrice = legs.length === limit && legs.every((leg) => leg.odds != null);
  const bookOdds = everyPrice ? legs.reduce((product, leg) => product * (leg.odds as number), 1) : null;

  return {
    legs,
    probability,
    bookOdds,
    fairOdds: probability > 0 ? 1 / probability : Number.POSITIVE_INFINITY,
    today: pool.length,
    shortfall: Math.max(0, limit - legs.length),
  };
}

/** Veinte patas del día en curso, hora de Bogotá. */
export function buildCombinada(day = agendaToday()): CombinadaTicket {
  return buildTicket(day, 20);
}

/** Veinte patas del día siguiente. */
export function buildCombinadaManana(day = agendaTomorrow()): CombinadaTicket {
  return buildTicket(day, 20);
}
