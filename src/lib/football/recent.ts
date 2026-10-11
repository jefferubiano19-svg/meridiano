import data from "../../../data/agenda-read.json";
import { leagueRate } from "./league-rate";
import { analyzeCounts, analyzeLevelC, type RecentAnalysis } from "./recent-math";

export type { RecentAnalysis };

export interface RecentGame {
  ts: number | null;
  competition: string;
  opponent: string | null;
  goalsFor: number;
  goalsAgainst: number;
}

export interface SideRead {
  n: number;
  gf: number;
  ga: number;
  games: RecentGame[];
}

interface RawSide {
  n: number;
  gf: number;
  ga: number;
  games: [number | null, string, string | null, number, number][];
}

const BY_ID = data.byId as unknown as Record<string, { h: RawSide | null; a: RawSide | null }>;

function side(raw: RawSide | null): SideRead | null {
  if (!raw || raw.n < 1) return null;
  return {
    n: raw.n,
    gf: raw.gf,
    ga: raw.ga,
    games: raw.games.map(([ts, competition, opponent, goalsFor, goalsAgainst]) => ({
      ts,
      competition,
      opponent,
      goalsFor,
      goalsAgainst,
    })),
  };
}

export function hasRecentPair(id: string): boolean {
  const row = BY_ID[id];
  return Boolean(row?.h && row.h.n >= 1 && row.a && row.a.n >= 1);
}

const SIDE_CACHE = new Map<string, { home: SideRead | null; away: SideRead | null }>();

export function recentFor(id: string): { home: SideRead | null; away: SideRead | null } | undefined {
  const cached = SIDE_CACHE.get(id);
  if (cached) return cached;
  const row = BY_ID[id];
  if (!row) return undefined;
  const value = { home: side(row.h), away: side(row.a) };
  SIDE_CACHE.set(id, value);
  return value;
}

export const INCOMPATIBLE = /kings league|futsal|fútbol sala|futbol sala|beach soccer|fútbol playa|futbol playa|fútbol 7|futbol 7/i;

function levelC(
  home: SideRead,
  away: SideRead,
  kickoffMs: number,
  competition: string,
): RecentAnalysis | null {
  const league = leagueRate(competition, kickoffMs);
  return analyzeLevelC(home.games, away.games, kickoffMs, {
    neutral: /neutral/i.test(competition),
    prior: league.prior,
    homeFactor: league.homeFactor,
    awayFactor: league.awayFactor,
  });
}

export function analyzeRecent(home: SideRead, away: SideRead, kickoff?: string, competition = ""): RecentAnalysis | null {
  const kickoffMs = kickoff ? Date.parse(kickoff) : Number.NaN;
  if (Number.isFinite(kickoffMs)) return levelC(home, away, kickoffMs, competition);
  return analyzeCounts(home.n, home.gf, home.ga, away.n, away.gf, away.ga);
}

export function levelCFor(id: string, kickoff: string, competition = ""): RecentAnalysis | null {
  if (INCOMPATIBLE.test(competition)) return null;
  const recent = recentFor(id);
  if (!recent?.home || !recent?.away) return null;
  const kickoffMs = Date.parse(kickoff);
  if (!Number.isFinite(kickoffMs)) return null;
  return levelC(recent.home, recent.away, kickoffMs, competition);
}
