import file from "../../../data/dixon.json";
import homeFile from "../../../data/home-advantage.json";
import strengthFile from "../../../data/market-strength.json";
import { scoreboard } from "./engine";
import { canonicalCompetition } from "./places";
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

/* ---------------------------------------------------------------------------
 * Nivel A para partidos de la agenda de Flashscore.
 * Antes el Nivel A solo salía si el partido estaba en la lista fija de ESPN
 * (snapshot.json, hasta el 14 oct). Aquí se conecta cada liga de Flashscore
 * con su modelo Dixon-Coles y cada nombre de equipo con el de football-data.
 * No cambia ningún parámetro: usa los mismos ataques, defensas, rho, ventaja
 * local y la misma mezcla 0,5 con la fuerza de cierres que el Nivel A de siempre.
 * ------------------------------------------------------------------------- */


const strength = strengthFile as {
  weight?: number;
  leagues: Record<string, Record<string, { homeFor: number; homeAgainst: number; awayFor: number; awayAgainst: number }>>;
};

/** Liga de Flashscore (país: nombre) → liga del modelo. Solo coincidencia exacta, con o sin fase (" - Clausura"). */
const COMPETITION_TO_LEAGUE: [string, string][] = [
  ["ENGLAND: Premier League", "epl"],
  ["ENGLAND: Championship", "championship"],
  ["ENGLAND: National League", "conference"],
  ["GERMANY: 2. Bundesliga", "bundesliga2"],
  ["ITALY: Serie A", "seriea"],
  ["SPAIN: LaLiga2", "laliga2"],
  ["NETHERLANDS: Eredivisie", "eredivisie"],
  ["BELGIUM: Jupiler Pro League", "belgium"],
  ["PORTUGAL: Liga Portugal", "portugal"],
  ["TURKEY: Super Lig", "turkey"],
  ["ARGENTINA: Liga Profesional", "argentina"],
  ["BRAZIL: Serie A Betano", "brazil"],
  ["BRAZIL: Serie A", "brazil"],
  ["CHINA: Super League", "china"],
  ["ROMANIA: Superliga", "romania"],
  ["SWITZERLAND: Super League", "switzerland"],
  ["USA: MLS", "usa"],
];

/** Nombres de Flashscore que no coinciden solos con football-data. Verificados uno por uno. */
const TEAM_ALIASES: Record<string, Record<string, string>> = {
  epl: { Nottingham: "Nottingham Forest" },
  championship: { "Sheffield Utd": "Sheffield United", "Sheffield Wed": "Sheffield Weds" },
  conference: { "Solihull Moors": "Solihull" },
  bundesliga2: {
    "SG Dynamo Dresden": "Dresden",
    "Arminia Bielefeld": "Bielefeld",
    "Hertha Berlin": "Hertha",
    "Karlsruher SC": "Karlsruhe",
  },
  laliga2: { "Real Sociedad B": "Sociedad B", Gijon: "Sp Gijon", "Celta Vigo B": "Celta B" },
  eredivisie: { PSV: "PSV Eindhoven", "G.A. Eagles": "Go Ahead Eagles", Sittard: "For Sittard" },
  portugal: { Braga: "Sp Braga", "Sporting CP": "Sp Lisbon", "Vitoria Guimaraes": "Guimaraes" },
  belgium: {
    "Cercle Brugge KSV": "Cercle Brugge",
    "St. Liege": "Standard",
    "Royale Union SG": "St. Gilloise",
    Leuven: "Oud-Heverlee Leuven",
  },
  turkey: { Basaksehir: "Buyuksehyr", Goztepe: "Goztep" },
  // Nombres de Flashscore en español.
  seriea: { "Nápoles": "Napoli", Bolonia: "Bologna", Roma: "AS Roma" },
};

const STOP_WORDS = new Set([
  "fc", "cf", "ac", "sc", "afc", "cd", "ud", "sd", "ca", "club", "de", "the", "fk", "sk", "as", "ss", "us", "calcio",
  "cfc", "bk", "kv", "krc", "rsc", "sv", "vfl", "vfb", "tsv", "fsv", "ssv", "1", "ec", "se", "cr", "esporte", "clube",
  "futebol", "atletico", "sl", "sporting",
]);

function teamKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\butd\b/g, "united")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word))
    .join(" ");
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LEAGUE_PATTERNS = COMPETITION_TO_LEAGUE.map(
  ([competition, id]) => [new RegExp(`^${escapeRe(competition)}(?: - .*)?$`, "i"), id] as const,
);

export function leagueForCompetition(competition: string): string | null {
  const canonical = canonicalCompetition(competition).trim();
  for (const [pattern, id] of LEAGUE_PATTERNS) if (pattern.test(canonical)) return id;
  return null;
}

const TEAM_INDEX = new Map<string, Map<string, string>>();

function teamIndex(leagueId: string): Map<string, string> {
  const cached = TEAM_INDEX.get(leagueId);
  if (cached) return cached;
  const index = new Map<string, string>();
  const league = data.leagues[leagueId];
  if (league) {
    for (const [key, row] of Object.entries(league.teams)) {
      for (const name of [key, ...row.also]) {
        const k = teamKey(name);
        if (k && !index.has(k)) index.set(k, key);
      }
    }
  }
  TEAM_INDEX.set(leagueId, index);
  return index;
}

function resolveTeam(leagueId: string, name: string): { key: string; row: TeamRow } | null {
  const league = data.leagues[leagueId];
  if (!league) return null;
  const alias = TEAM_ALIASES[leagueId]?.[name];
  const key = alias && league.teams[alias] ? alias : teamIndex(leagueId).get(teamKey(name));
  if (!key) return null;
  const row = league.teams[key];
  return row ? { key, row } : null;
}

function strengthOf(leagueId: string, key: string, row: TeamRow) {
  const table = strength.leagues[leagueId];
  if (!table) return null;
  for (const name of [key, ...row.also]) if (table[name]) return table[name];
  return null;
}

const DIXON_ASOF_MS = Date.parse(`${(file as { asof?: string }).asof ?? "2026-10-04"}T00:00:00-05:00`);

/**
 * Nivel A para un partido de la agenda: liga conectada, los dos equipos con al menos
 * 6 partidos en el modelo y partido posterior a la fecha de ajuste (sin mirar el futuro).
 */
export function levelAForAgenda(
  homeName: string,
  awayName: string,
  competition: string,
  kickoffMs: number,
): (RecentAnalysis & { level: "A"; leagueId: string }) | null {
  if (!Number.isFinite(kickoffMs) || kickoffMs < DIXON_ASOF_MS) return null;
  const leagueId = leagueForCompetition(competition);
  if (!leagueId) return null;
  const league = data.leagues[leagueId];
  const home = resolveTeam(leagueId, homeName);
  const away = resolveTeam(leagueId, awayName);
  if (!league || !home || !away || home.key === away.key || home.row.n < 6 || away.row.n < 6) return null;
  const advantage = recentHome[leagueId] ?? league.home;
  let lambdaHome = Math.min(4, Math.max(0.2, Math.exp(home.row.att - away.row.def + advantage)));
  let lambdaAway = Math.min(4, Math.max(0.2, Math.exp(away.row.att - home.row.def)));
  const hs = strengthOf(leagueId, home.key, home.row);
  const as = strengthOf(leagueId, away.key, away.row);
  if (hs && as) {
    const w = strength.weight ?? 0.5;
    lambdaHome = lambdaHome * (1 - w) + ((hs.homeFor + as.awayAgainst) / 2) * w;
    lambdaAway = lambdaAway * (1 - w) + ((as.awayFor + hs.homeAgainst) / 2) * w;
  }
  const board = scoreboard(lambdaHome, lambdaAway, league.rho);
  const fair = (p: number) => Math.round((1 / Math.min(0.92, Math.max(0.035, p))) * 100) / 100;
  return {
    level: "A",
    leagueId,
    lambdaHome,
    lambdaAway,
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
