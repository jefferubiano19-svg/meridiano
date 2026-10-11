export type LeagueId =
  | "epl"
  | "laliga"
  | "bundesliga"
  | "seriea"
  | "ligue1"
  | "ligamx"
  | "brasileirao"
  | "eredivisie"
  | "portugal"
  | "mls"
  | "ucl"
  | "colombia"
  | "argentina"
  | "selecciones";

export type MarketKey =
  | "home"
  | "draw"
  | "away"
  | "over25"
  | "under25"
  | "bttsYes"
  | "bttsNo"
  | "dc1x"
  | "dc12"
  | "dcx2"
  | "dnbHome"
  | "dnbAway"
  | "cornersOver"
  | "cornersUnder";

export type ConfidenceLabel = "alta" | "media" | "baja";

export interface League {
  id: LeagueId;
  name: string;
  short: string;
  country: string;
  tz: string;
  note?: string;
}

export interface Split {
  gp: number;
  gf: number;
  ga: number;
}

export interface Team {
  id: string;
  name: string;
  short: string;
  leagueId: LeagueId;
  gp: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  form: string;
  table: string;
  source: string;
  home: Split;
  away: Split;
  /** Totales de temporada publicados por FotMob. Null si esa liga no los trae. */
  xg: number | null;
  xga: number | null;
  xgPlayed: number | null;
  corners: number | null;
  cornersPlayed: number | null;
  statsSource: string | null;
  /** Elo de resultados. Selecciones: eloratings.net. Clubes: null si la fuente no respondió. */
  elo: number | null;
  eloSource: string | null;
}

export interface MarketQuote {
  provider: string;
  home: number | null;
  draw: number | null;
  away: number | null;
  over: number | null;
  under: number | null;
  line: number | null;
  bttsYes?: number | null;
  bttsNo?: number | null;
  dc1x?: number | null;
  dc12?: number | null;
  dcx2?: number | null;
  dnbHome?: number | null;
  dnbAway?: number | null;
  cornersOver?: number | null;
  cornersUnder?: number | null;
  /** Línea de córners que publicó la casa. Null si ese mercado no estaba. */
  cornersLine?: number | null;
  eventUrl?: string | null;
  fetchedAt?: string | null;
}

export interface Fixture {
  id: string;
  leagueId: LeagueId;
  competition: string;
  kickoff: string;
  homeId: string;
  awayId: string;
  venue: string;
  round: string;
  note?: string | null;
  status: string;
  market: MarketQuote | null;
  source: string;
}

export interface ThreeWay {
  home: number;
  draw: number;
  away: number;
}

export interface MarketOdds {
  home: number;
  draw: number;
  away: number;
  over25: number;
  under25: number;
  bttsYes: number;
  bttsNo: number;
  dc1x: number;
  dc12: number;
  dcx2: number;
  dnbHome: number;
  dnbAway: number;
  cornersOver?: number;
  cornersUnder?: number;
}

export interface ScoreCell {
  hg: number;
  ag: number;
  p: number;
}

export interface MatchAnalysis {
  fixtureId: string;
  lambdaHome: number;
  lambdaAway: number;
  p1x2: ThreeWay;
  /** Modelo antes de mezclarlo con el consenso. La barra puede mostrar la publicada. */
  modelPure?: ThreeWay;
  pOver25: number;
  pUnder25: number;
  pBttsYes: number;
  pBttsNo: number;
  pDc1x: number;
  pDc12: number;
  pDcX2: number;
  fair: MarketOdds;
  /** Cuotas publicadas. Null si ESPN no traía precio para ese lado. */
  quoted: Partial<Record<MarketKey, number>>;
  quoteProvider: string | null;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  matrix: ScoreCell[];
  mostLikelyScore: ScoreCell;
  reasons: string[];
  inputs: string;
  cornerHome: number | null;
  cornerAway: number | null;
  pCornersOver: number | null;
  pCornersUnder: number | null;
  /** Línea a la que corresponde pCornersOver. 9.5 si la casa no publicó otra. */
  cornersLine: number;
  eloHome: number | null;
  eloAway: number | null;
  /** Probabilidad de que el local gane si se ignora el empate, solo con Elo publicado. */
  eloHomeWin: number | null;
  topScores?: ScoreCell[];
  adjustments?: { key: string; value: number; note: string }[];
  marketFair?: ThreeWay | null;
  valueFlag?: "valor" | "revisar" | "sin-margen" | "sin-cuota";
  valueSide?: "home" | "draw" | "away" | null;
  valueGap?: number | null;
  /** Texto de la marca vigente. Valor por modelo está apagado. */
  valueNote?: string | null;
  confidenceReason?: string;
  /** Solo si hay un global publicado. Si no, null. */
  pQualify?: number | null;
  level?: "A" | "B" | "C";
}

export interface CalibrationBin {
  predicted: number;
  actual: number;
  n: number;
}
