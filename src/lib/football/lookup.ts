import { AGENDA, agendaDay, type AgendaMatch } from "./agenda";
import { FIXTURES } from "./fixtures";
import { getLeague } from "./leagues";
import { getTeam } from "./teams";
import { bogotaDay } from "./today";
import type { Fixture } from "./types";

export interface PartidoHit {
  kind: "agenda" | "fixture";
  id: string;
  home: string;
  away: string;
  competition: string;
  day: string;
  kickoff: string;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function tokens(value: string): string[] {
  return fold(value)
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length >= 3);
}

export function sameSide(query: string, name: string): boolean {
  const left = fold(query);
  const right = fold(name);
  if (left.length < 2 || right.length < 2) return false;
  if (left === right) return true;
  const wanted = tokens(query);
  const known = new Set(tokens(name));
  if (!wanted.length || !known.size) return false;
  return wanted.every((token) => known.has(token));
}

function pair(homeQuery: string, awayQuery: string, home: string, away: string): boolean {
  return (
    (sameSide(homeQuery, home) && sameSide(awayQuery, away)) ||
    (sameSide(homeQuery, away) && sameSide(awayQuery, home))
  );
}

export function findPartidos(input: {
  home: string;
  away: string;
  date: string;
  competition: string;
}): { hits: PartidoHit[]; withoutDate: PartidoHit[] } {
  const home = input.home.trim();
  const away = input.away.trim();
  const date = input.date.trim();
  const competition = fold(input.competition);
  if (!home || !away) return { hits: [], withoutDate: [] };

  const found: PartidoHit[] = [];
  const seen = new Set<string>();

  function push(hit: PartidoHit) {
    const key = `${fold(hit.home)}|${fold(hit.away)}|${hit.day}|${fold(hit.competition)}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(hit);
  }

  for (const match of AGENDA) {
    if (!pair(home, away, match.home, match.away)) continue;
    push(fromAgenda(match));
  }
  for (const fixture of FIXTURES) {
    let homeName = fixture.homeId;
    let awayName = fixture.awayId;
    try {
      homeName = getTeam(fixture.homeId).name;
      awayName = getTeam(fixture.awayId).name;
    } catch {
      continue;
    }
    if (!pair(home, away, homeName, awayName)) continue;
    push(fromFixture(fixture, homeName, awayName));
  }

  const byCompetition = competition
    ? found.filter((hit) => fold(hit.competition).includes(competition) || competition.includes(fold(hit.competition)))
    : found;
  const hits = date ? byCompetition.filter((hit) => hit.day === date) : byCompetition;
  hits.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  return { hits, withoutDate: byCompetition };
}

function fromAgenda(match: AgendaMatch): PartidoHit {
  return {
    kind: "agenda",
    id: match.id,
    home: match.home,
    away: match.away,
    competition: match.competition,
    day: agendaDay(match),
    kickoff: match.kickoff,
  };
}

function fromFixture(fixture: Fixture, home: string, away: string): PartidoHit {
  return {
    kind: "fixture",
    id: fixture.id,
    home,
    away,
    competition: fixture.competition || getLeague(fixture.leagueId).name,
    day: bogotaDay(fixture.kickoff),
    kickoff: fixture.kickoff,
  };
}
