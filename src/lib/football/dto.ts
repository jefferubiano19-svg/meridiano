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
  /** Mejor cuota de cada resultado entre las casas leídas (solo partidos por jugar). */
  /** Insignias del partido: «Valor del día» y «El rival marca 70 %+». */
  badges?: { key: "valor" | "rival"; label: string }[];
  /** Lectura 1X2 más reciente (cada hora) de un partido con selección de «Valor del día». */
  current?: {
    readAt: string;
    offers: { house: string; odds: number[] }[];
    double?: { dc: { house: string; odds: number[] }[]; dnb: { house: string; odds: number[] }[] } | null;
  } | null;
  /** Selecciones de «Valor del día» que encontró la búsqueda de cada hora (data/valor-hora.json). */
  hourPicks?: {
    market: "1x2" | "dc" | "dnb";
    outcomeIndex: 0 | 1 | 2;
    prob: number;
    pDraw: number;
    house: string;
    odds: number;
    ev: number;
    readAt: string;
  }[];
  /** Doble oportunidad y empate no válido del último corte (casas colombianas). */
  double?: { readAt: string | null; dc: { house: string; odds: number[] }[]; dnb: { house: string; odds: number[] }[] } | null;
  bestOdds?: {
    home: { house: string; odds: number };
    draw: { house: string; odds: number };
    away: { house: string; odds: number };
    houses: number;
    margin: number;
    readAt: string | null;
  } | null;
}

export interface ComboMatch extends MatchReading {
  pick: string;
  pickKey: "home" | "draw" | "away";
  pickProbability: number | null;
  /** Lista fija: cómo terminó el lado elegido (null si no ha terminado). */
  outcome?: "acierto" | "fallo" | null;
  /** Lista fija: cómo terminó «favorito o empate». */
  outcomeSafe?: "acierto" | "fallo" | null;
  /** Probabilidad de «favorito o empate» (doble oportunidad del lado elegido), de la 1X2 publicada. */
  favOrDraw?: number | null;
  /** «El rival marca»: el no favorito y la probabilidad de que haga al menos un gol (de la 1X2 publicada). */
  rival?: { team: string; side: "home" | "away"; p: number } | null;
}

export interface DayBoard {
  day: string;
  matches: MatchReading[];
  /** Ayer: cuántas veces ganó el favorito de cada partido contra lo esperado. */
  yesterday?: { day: string; n: number; hits: number; expected: number } | null;
}

export interface ComboBoard {
  day: string;
  pool: number;
  /** La lista usa solo partidos con cuota en casas. */
  withOdds?: boolean;
  joint: number | null;
  matches: ComboMatch[];
  /** Lista fija del día (la guardada por el primer corte del día), si existe. */
  frozen?: { savedAt: string; settled: number; hits: number; expected: number; hitsSafe: number; expectedSafe: number } | null;
  /** Cómo le fue a la lista de los días anteriores (la publicada en la madrugada de cada día). */
  history?: {
    day: string;
    savedAt: string;
    legs: number;
    settled: number;
    hits: number;
    expected: number;
    hitsSafe: number;
    expectedSafe: number | null;
    strong: { settled: number; hits: number; hitsSafe: number };
  }[];
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
