import { AGENDA } from "./agenda";

interface Played {
  ts: number;
  hg: number;
  ag: number;
}

const BY_COMPETITION = new Map<string, Played[]>();

for (const match of AGENDA) {
  if (match.homeScore == null || match.awayScore == null) continue;
  const ts = Date.parse(match.kickoff);
  if (!Number.isFinite(ts)) continue;
  const rows = BY_COMPETITION.get(match.competition) ?? [];
  rows.push({ ts, hg: match.homeScore, ag: match.awayScore });
  BY_COMPETITION.set(match.competition, rows);
}
for (const rows of BY_COMPETITION.values()) rows.sort((a, b) => a.ts - b.ts);

export interface LeagueRate {
  n: number;
  prior: number | null;
  homeFactor: number | null;
  awayFactor: number | null;
}

function cap(value: number): number {
  return Math.min(1.15, Math.max(0.85, value));
}

/** Media de goles por equipo y ventaja de local, solo con partidos del feed anteriores al inicio. */
export function leagueRate(competition: string, kickoffMs: number): LeagueRate {
  const rows = BY_COMPETITION.get(competition) ?? [];
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].ts < kickoffMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo < 1) return { n: 0, prior: null, homeFactor: null, awayFactor: null };
  let homeGoals = 0;
  let awayGoals = 0;
  for (let i = 0; i < lo; i += 1) {
    homeGoals += rows[i].hg;
    awayGoals += rows[i].ag;
  }
  const prior = (homeGoals + awayGoals) / (2 * lo);
  if (!(prior > 0)) return { n: lo, prior: null, homeFactor: null, awayFactor: null };
  return {
    n: lo,
    prior,
    homeFactor: cap(homeGoals / lo / prior),
    awayFactor: cap(awayGoals / lo / prior),
  };
}
