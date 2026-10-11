import data from "../../../data/sheets.json";

export interface PastMatch {
  id: string;
  ts: number | null;
  competition: string;
  home: string;
  away: string;
  score: string | null;
  side: string | null;
}

export interface SquadPlayer {
  id: string;
  name: string;
  shirt: string | null;
  club: string | null;
  role: "titular" | "suplente";
}

export interface PastRole {
  competition: string;
  role: "titular" | "suplente";
  opponent: string | null;
  score: string | null;
  ts: number | null;
}

export interface TeamRecord {
  formation: string | null;
  players: SquadPlayer[];
  history: PastMatch[];
  roles: Record<string, PastRole[]>;
}

export interface MatchSheet {
  fixtureId: string;
  competition: string;
  home: TeamRecord;
  away: TeamRecord;
}

const BY_FIXTURE = data.byFixture as Record<string, MatchSheet>;

export function sheetFor(fixtureId: string): MatchSheet | undefined {
  return BY_FIXTURE[fixtureId];
}
