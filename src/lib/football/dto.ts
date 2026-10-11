/** Lo que una página puede mostrar. Sin archivos de datos. */

export const MISSING = "NO DISPONIBLE";

export interface Way {
  home: number;
  draw: number;
  away: number;
}

export interface ValueMark {
  house: string;
  odds: number;
  side: "home" | "draw" | "away";
  readAt: string | null;
}

export interface MatchReading {
  id: string;
  href: string;
  home: string;
  away: string;
  competition: string;
  kickoff: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  published: Way | null;
  model: Way | null;
  consensus: Way | null;
  level: string;
  confidence: string;
  revisar: boolean;
  value: ValueMark | null;
}

export interface ComboMatch extends MatchReading {
  pick: string;
  pickKey: "home" | "draw" | "away";
  pickProbability: number | null;
}

export interface DayBoard {
  day: string;
  matches: MatchReading[];
}

export interface ComboBoard {
  day: string;
  pool: number;
  joint: number | null;
  matches: ComboMatch[];
}

export interface ConsultaBoard {
  day: string;
  days: { day: string; n: number }[];
  matches: MatchReading[];
}

export interface LeagueCard {
  id: string;
  teams: number;
  upcoming: number;
  leader: string;
  leaderPts: number | null;
}

export interface LeaguePage {
  id: string;
  name: string;
  country: string;
  note: string;
  table: { name: string; pts: number; gf: number; ga: number }[];
  matches: MatchReading[];
}

export interface SearchBoard {
  hits: MatchReading[];
  others: MatchReading[];
  named: MatchReading | null;
  note: string;
}

export interface ModeloBin {
  label: string;
  n: number;
  hit: number;
  rate: number | null;
}

export interface ModeloBundle {
  fetchedAt: string;
  sources: string[];
  dixonRule: string;
  dixonAt: string | null;
  dixon: { league: string; published: boolean; rpsModel: number | null; rpsBaseline: number | null; rpsMarket: number | null; n: number | null }[];
  report: {
    rule: string;
    playedInCut: number;
    scored: number;
    brier: number | null;
    rps: number | null;
    bins: ModeloBin[];
  };
  cut: {
    readAtBogota: string;
    today: number;
    tomorrow: number;
    yesterday: number;
    oddsWith1x2: number;
    oddsListed: number;
  };
  variant: { distanciaAnterior: number; distancia: number };
  coveragePoints: { id: string; label: string; read: number; expected?: number | null; note: string }[];
  evaluations: {
    evaluated: number;
    goal: number;
    predictionRows: number;
    comparable: number;
    rpsModel: number | null;
    rpsPublished: number | null;
    rpsConsensus: number | null;
    distance: number | null;
    distanceRule: string;
    valueMarks: number;
    clvMean: number | null;
  };
}
