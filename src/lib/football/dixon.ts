import file from "../../../data/dixon.json";
import homeFile from "../../../data/home-advantage.json";
import { scoreboard } from "./engine";
import type { RecentAnalysis } from "./recent-math";

interface TeamRow {
  att: number;
  def: number;
  n: number;
  also: string[];
}

interface LeagueRow {
  home: number;
  rho: number;
  teams: Record<string, TeamRow>;
}

const recentHome = homeFile as Record<string, number>;
const data = file as {
  fetchedAt?: string | null;
  rule?: string;
  leagues: Record<string, LeagueRow>;
  report?: Record<string, { published?: boolean; holdout?: { n: number; rpsModel: number | null; rpsBaseline: number | null; rpsMarket: number | null } | null }>;
};

export const DIXON_RULE = data.rule ?? "";
export const DIXON_FETCHED_AT = data.fetchedAt ?? null;
export const DIXON_REPORT = data.report ?? {};

function findTeam(league: LeagueRow, name: string): TeamRow | null {
  for (const row of Object.values(league.teams)) {
    if (row.also.includes(name)) return row;
  }
  return null;
}

export function dixonLambda(
  homeName: string,
  awayName: string,
  leagueId?: string,
): { lambdaHome: number; lambdaAway: number; rho: number; leagueId: string } | null {
  const entries = leagueId && data.leagues[leagueId] ? [[leagueId, data.leagues[leagueId]] as const] : Object.entries(data.leagues);
  for (const [id, league] of entries) {
    const home = findTeam(league, homeName);
    const away = findTeam(league, awayName);
    if (!home || !away || home.n < 6 || away.n < 6) continue;
    const advantage = recentHome[id] ?? league.home;
    const lambdaHome = Math.min(4, Math.max(0.2, Math.exp(home.att - away.def + advantage)));
    const lambdaAway = Math.min(4, Math.max(0.2, Math.exp(away.att - home.def)));
    return { lambdaHome, lambdaAway, rho: league.rho, leagueId: id };
  }
  return null;
}

export function dixonRecent(homeName: string, awayName: string): RecentAnalysis | null {
  const hit = dixonLambda(homeName, awayName);
  if (!hit) return null;
  const board = scoreboard(hit.lambdaHome, hit.lambdaAway, hit.rho);
  const fair = (p: number) => Math.round((1 / Math.min(0.92, Math.max(0.035, p))) * 100) / 100;
  return {
    lambdaHome: hit.lambdaHome,
    lambdaAway: hit.lambdaAway,
    p1x2: board.p1x2,
    pOver25: board.pOver25,
    pUnder25: 1 - board.pOver25,
    pBttsYes: board.pBttsYes,
    pBttsNo: 1 - board.pBttsYes,
    mostLikely: board.topScores[0] ?? { hg: 0, ag: 0, p: 0 },
    matrix: board.matrix,
    fairHome: fair(board.p1x2.home),
    fairDraw: fair(board.p1x2.draw),
    fairAway: fair(board.p1x2.away),
  };
}
