import data from "../../../data/agenda.json";

type AgendaRow = [
  string,
  string,
  string,
  string,
  string,
  string,
  number | null,
  number | null,
  string | null,
  string | null,
];

export interface AgendaMatch {
  id: string;
  kickoff: string;
  competition: string;
  home: string;
  away: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  fixtureId: string | null;
}

export const AGENDA_SOURCE = data.source;
export const AGENDA_FETCHED_AT = data.fetchedAt;

export const AGENDA: AgendaMatch[] = (data.matches as AgendaRow[]).map((row) => ({
  id: row[0],
  kickoff: row[1],
  competition: row[2],
  home: row[3],
  away: row[4],
  status: row[5],
  homeScore: row[6],
  awayScore: row[7],
  fixtureId: row[9],
}));

const BY_FIXTURE = new Map<string, AgendaMatch>();
for (const match of AGENDA) {
  if (match.fixtureId) BY_FIXTURE.set(match.fixtureId, match);
}

const BY_DAY = new Map<string, AgendaMatch[]>();
for (const match of AGENDA) {
  const day = agendaDay(match);
  const list = BY_DAY.get(day);
  if (list) list.push(match);
  else BY_DAY.set(day, [match]);
}

export function agendaOnDay(day: string): AgendaMatch[] {
  return BY_DAY.get(day) ?? [];
}

export function agendaByFixture(id: string): AgendaMatch | undefined {
  return BY_FIXTURE.get(id);
}

export function agendaDay(match: AgendaMatch): string {
  return match.kickoff.slice(0, 10);
}

export const AGENDA_DAYS = [...new Set(AGENDA.map(agendaDay))].sort();
