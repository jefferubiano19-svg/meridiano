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
  /** Una casa ofrece el partido: el corte leyó su cuota (Wplay o varias casas). */
  withOdds?: boolean;
  href: string;
  home: string;
  away: string;
  competition: string;
  kickoff: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  /** Nombres en español (tabla de Flashscore en español) cuando difieren de los de la agenda. */
  homeEs?: string | null;
  awayEs?: string | null;
  published: Way | null;
  model: Way | null;
  consensus: Way | null;
  /** Sin consenso de 3 casas: probabilidad sin margen de Wplay, si se usó en la publicada. */
  wplay?: Way | null;
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
  /** La lista usa solo partidos con cuota en casas. */
  withOdds?: boolean;
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

export interface ModeloBundle {
  /** Último corte registrado (data/cut-coverage.json). */
  lastCut: {
    corte: string | null;
    startedAtBogota: string | null;
    finishedAtBogota: string | null;
    fatal: boolean;
    predictionsSaved: number | null;
    predictionsWithConsensus: number | null;
    predictionsWithWplay: number | null;
    tablesRead: number | null;
    failures: number;
    agendaToday: number | null;
    agendaTomorrow: number | null;
  };
  /** Revisión automática que escribe el corte (data/review.json). Null si aún no hay. */
  review: import("./review").Review | null;
  dixonRule: string;
  dixonAt: string | null;
  dixon: { league: string; published: boolean; rpsModel: number | null; rpsBaseline: number | null; rpsMarket: number | null; n: number | null }[];
  tables: { competition: string; readAtBogota: string | null; teams: number }[];
  ratings: { asOf: string | null; teams: number; games: number };
  nationEloAt: string | null;
}
