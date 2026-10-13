import agendaFile from "../../../data/agenda.json";
import data from "../../../data/agenda-read.json";
import { levelAForAgenda } from "./dixon";
import { canonicalCompetition } from "./places";
import { tableRow } from "./standings";
import { leagueRate } from "./league-rate";
import { analyzeCounts, analyzeLevelC, fromLambdas, type RecentAnalysis } from "./recent-math";
import ratingsData from "../../../data/ratings.json";
import { ratingLambdas, type RatingGame, type RatingsFile } from "./ratings";

export type { RecentAnalysis };

export interface RecentGame {
  ts: number | null;
  competition: string;
  opponent: string | null;
  goalsFor: number;
  goalsAgainst: number;
}

export interface SideRead {
  /** true si la base del historial es la tabla de la temporada (Nivel B). */
  fromTable?: boolean;
  n: number;
  gf: number;
  ga: number;
  games: RecentGame[];
}

interface RawSide {
  n: number;
  gf: number;
  ga: number;
  games: [number | null, string, string | null, number, number][];
}

const BY_ID = data.byId as unknown as Record<string, { h: RawSide | null; a: RawSide | null }>;

function side(raw: RawSide | null): SideRead | null {
  if (!raw || raw.n < 1) return null;
  return {
    n: raw.n,
    gf: raw.gf,
    ga: raw.ga,
    games: raw.games.map(([ts, competition, opponent, goalsFor, goalsAgainst]) => ({
      ts,
      competition,
      opponent,
      goalsFor,
      goalsAgainst,
    })),
  };
}

export function hasRecentPair(id: string): boolean {
  const row = BY_ID[id];
  return Boolean(row?.h && row.h.n >= 1 && row.a && row.a.n >= 1);
}

/* ---------------------------------------------------------------------------
 * Historial de cada equipo para el Nivel C.
 * agenda-read.json es la última lectura completa de fichas (fija). El corte diario
 * actualiza agenda.json con los resultados nuevos. El historial de un partido es:
 * la lectura de fichas más reciente de ese equipo, más los resultados de agenda.json
 * posteriores a esa lectura y anteriores al inicio del partido. Nunca entra un
 * partido jugado después del inicio.
 * ------------------------------------------------------------------------- */

type AgendaRow = [string, string, string, string, string, string, number | null, number | null, unknown, unknown];
type RawGame = RawSide["games"][number];

const AGENDA_ROWS = (agendaFile as unknown as { matches: AgendaRow[] }).matches;
const REGION_PREFIX =
  /^(WORLD|EUROPE|ASIA|AFRICA|ÁFRICA|SOUTH AMERICA|NORTH & CENTRAL AMERICA|MUNDIAL|INTERNATIONAL|OCEANIA)$/i;
const WOMEN = /women|femenin|féminine|feminine|frauen|\bliga f\b|\bwsl\b|\bnwsl\b|damallsvenskan|\bw\b/i;
const YOUTH = /sub[-\s]?\d+|\bu1[5-9]\b|\bu2[0-3]\b|juvenil|youth|primavera|reserves?|reservas?|\bii\b|\bb team\b/i;
const HOUR_MS = 60 * 60 * 1000;

function placeOf(raw: string): string {
  const competition = canonicalCompetition(raw);
  const cut = competition.indexOf(":");
  const prefix = cut > 0 ? competition.slice(0, cut).trim().toUpperCase() : "";
  return REGION_PREFIX.test(prefix) ? "" : prefix;
}

function tierOf(competition: string, name: string): string {
  const text = `${competition} ${name}`;
  return `${WOMEN.test(text) ? "w" : "m"}${YOUTH.test(text) ? "y" : ""}`;
}

interface TeamHistory {
  /** Resultados de agenda.json: [ms, juego]. */
  results: [number, RawGame][];
  /** Lecturas de fichas: [inicio del partido leído, lado leído]. */
  reads: [number, RawSide][];
}

let TEAMS: Map<string, TeamHistory> | null = null;
let ROW_BY_ID: Map<string, AgendaRow> | null = null;
const PLACES_BY_NAME = new Map<string, Set<string>>();

/** Nombres que Flashscore en español traduce y en inglés no (ya sin tildes ni mayúsculas). */
const EXONYMS: Record<string, string> = {
  "atletico de madrid": "atl. madrid",
  "club brujas": "club brugge",
  napoles: "napoli",
  bolonia: "bologna",
  genova: "genoa",
  "slavia praga": "slavia prague",
  "sparta praga": "sparta prague",
  "estrella roja": "crvena zvezda",
  "bayern munich": "bayern munich",
  "1860 munich": "1860 munich",
  duisburgo: "duisburg",
  augsburgo: "augsburg",
  "augsburgo ii": "augsburg ii",
  colonia: "fc koln",
  oporto: "fc porto",
  monaco: "monaco",
  marsella: "marseille",
  niza: "nice",
  estrasburgo: "strasbourg",
  "stade rennais": "rennes",
  "sporting de lisboa": "sporting cp",
  "copenhague": "fc copenhagen",
  "basilea": "basel",
  "ginebra": "servette",
  "salzburgo": "salzburg",
  "bucarest": "bucharest",
  "estambul basaksehir": "basaksehir",
};

/** Nombre sin tildes ni mayúsculas ni país entre paréntesis: "Cúcuta" y "Cucuta" son el mismo equipo. */
function plainName(name: string): string {
  const plain = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*\([a-z]{2,4}\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return EXONYMS[plain] ?? plain;
}

/** Siglas de forma jurídica que Flashscore pone o quita según el idioma: "Club Brugge KV" y "Club Brujas" son el mismo. */
const LEGAL_TOKENS = new Set(["fc", "cf", "sc", "ac", "afc", "kv", "ksv", "krc", "sk", "fk", "bk", "cd", "ud", "sd", "sv", "ssc", "jk", "nk", "if", "ik"]);

/** Nombre canónico del equipo: sin tildes, sin país entre paréntesis, con exónimo y sin siglas jurídicas. */
function canonName(name: string): string {
  const plain = plainName(name);
  const words = plain.split(" ").filter((word) => !LEGAL_TOKENS.has(word));
  const stripped = words.length ? words.join(" ") : plain;
  return EXONYMS[stripped] ?? stripped;
}

function teamKeyFor(rawName: string, competition: string, fallbackPlace: string | null = null): string | null {
  const name = canonName(rawName);
  const tier = tierOf(competition, rawName);
  let place = placeOf(competition);
  if (!place) {
    const places = PLACES_BY_NAME.get(`${tier}|${name}`);
    if (places && places.size === 1) place = [...places][0];
    else if (fallbackPlace) place = fallbackPlace;
    else return null;
  }
  return `${place}|${tier}|${name}`;
}

/**
 * Todos los resultados conocidos para los ratings globales (Nivel B): los de la agenda (con sede)
 * y los de las fichas leídas de cada equipo (sin sede). Un mismo partido no entra dos veces.
 */
export function ratingGames(): RatingGame[] {
  buildTeams();
  const seen = new Map<string, RatingGame>();
  const add = (game: RatingGame) => {
    const id = `${Math.floor(game.ts / 3600000)}|${[game.home, game.away].sort().join("|")}`;
    const prev = seen.get(id);
    if (prev && prev.venue) return;
    seen.set(id, game);
  };
  for (const row of AGENDA_ROWS) {
    if (row[5] !== "finalizado" || typeof row[6] !== "number" || typeof row[7] !== "number") continue;
    const ts = Date.parse(row[1]);
    const home = teamKeyFor(row[3], row[2]);
    const away = teamKeyFor(row[4], row[2]);
    if (!Number.isFinite(ts) || !home || !away) continue;
    add({ ts, home, away, hg: row[6], ag: row[7], venue: 1, comp: canonicalCompetition(row[2]) });
  }
  for (const row of AGENDA_ROWS) {
    const read = BY_ID[row[0]];
    if (!read) continue;
    for (const [sideRead, name] of [[read.h, row[3]], [read.a, row[4]]] as const) {
      if (!sideRead) continue;
      const team = teamKeyFor(name, row[2]);
      if (!team) continue;
      const place = team.split("|")[0];
      for (const [ts, competition, opponent, gf, ga] of sideRead.games) {
        if (ts == null || !opponent) continue;
        const other = teamKeyFor(opponent, competition || row[2], place);
        if (!other || other === team) continue;
        add({ ts: ts > 1e12 ? ts : ts * 1000, home: team, away: other, hg: gf, ag: ga, venue: 0, comp: canonicalCompetition(competition || "") });
      }
    }
  }
  return [...seen.values()];
}

let RATINGS = ratingsData as unknown as RatingsFile;

/** El corte calcula los ratings y los pasa aquí antes de guardar predicciones (el JSON importado sería el anterior). */
export function useRatings(file: RatingsFile): void {
  RATINGS = file;
  SIDE_CACHE.clear();
}

/** Nivel B: ratings globales, si el corte ya los calculó y los dos equipos tienen partidos. */
function levelBFor(match: AgendaRow, kickoffMs: number, competition: string): RecentAnalysis | null {
  if (!RATINGS?.teams || !RATINGS.asOf) return null;
  // Solo ratings calculados antes del partido.
  if (!(Date.parse(RATINGS.asOf) < kickoffMs)) return null;
  const lambdas = ratingLambdas(
    RATINGS,
    teamKeyFor(match[3], match[2]),
    teamKeyFor(match[4], match[2]),
    canonicalCompetition(competition || match[2]),
    /neutral/i.test(competition || match[2]),
  );
  if (!lambdas) return null;
  const analysis = fromLambdas(lambdas[0], lambdas[1]);
  return analysis ? { ...analysis, level: "B" } : null;
}

function buildTeams(): Map<string, TeamHistory> {
  if (TEAMS) return TEAMS;
  ROW_BY_ID = new Map(AGENDA_ROWS.map((row) => [row[0], row]));
  for (const row of AGENDA_ROWS) {
    const place = placeOf(row[2]);
    if (!place) continue;
    for (const name of [row[3], row[4]]) {
      const k = `${tierOf(row[2], name)}|${canonName(name)}`;
      const set = PLACES_BY_NAME.get(k) ?? new Set<string>();
      set.add(place);
      PLACES_BY_NAME.set(k, set);
    }
  }
  const teams = new Map<string, TeamHistory>();
  const entry = (key: string) => {
    let value = teams.get(key);
    if (!value) {
      value = { results: [], reads: [] };
      teams.set(key, value);
    }
    return value;
  };
  for (const row of AGENDA_ROWS) {
    const ms = Date.parse(row[1]);
    if (!Number.isFinite(ms)) continue;
    const homeKey = teamKeyFor(row[3], row[2]);
    const awayKey = teamKeyFor(row[4], row[2]);
    if (row[5] === "finalizado" && typeof row[6] === "number" && typeof row[7] === "number") {
      const ts = Math.round(ms / 1000);
      if (homeKey) entry(homeKey).results.push([ms, [ts, row[2], row[4], row[6], row[7]]]);
      if (awayKey) entry(awayKey).results.push([ms, [ts, row[2], row[3], row[7], row[6]]]);
    }
    const read = BY_ID[row[0]];
    if (read?.h && homeKey) entry(homeKey).reads.push([ms, read.h]);
    if (read?.a && awayKey) entry(awayKey).reads.push([ms, read.a]);
  }
  TEAMS = teams;
  return teams;
}

function lastTs(raw: RawSide): number {
  let best = -Infinity;
  for (const game of raw.games) if (game[0] != null && game[0] > best) best = game[0];
  return best;
}

function historyOf(name: string, competition: string, kickoffMs: number, own: RawSide | null): SideRead | null {
  const teams = buildTeams();
  const key = teamKeyFor(name, competition);
  const team = key ? teams.get(key) : undefined;
  // Lectura base: la que llega más cerca del inicio, sin pasarlo.
  let base: RawSide | null = own && own.n >= 1 ? own : null;
  for (const [ms, read] of team?.reads ?? []) {
    if (ms >= kickoffMs || read.n < 1) continue;
    if (!base || lastTs(read) > lastTs(base)) base = read;
  }
  let games: RawGame[] = (base?.games ?? []).filter((game) => game[0] == null || game[0] * 1000 < kickoffMs);
  let cutoffMs = base ? lastTs(base) * 1000 + HOUR_MS : -Infinity;
  // Sin lectura de fichas útil: la tabla de la temporada hace de base (Nivel B), si se leyó antes del partido.
  let fromTable = false;
  const row = games.length < 3 ? tableRow(competition, name) : null;
  if (row && row.readMs < kickoffMs) {
    if (row.gp >= 3) {
      const readSec = Math.round(row.readMs / 1000);
      games = Array.from({ length: row.gp }, (_, i): RawGame => [
        readSec - i * 7 * 24 * 3600,
        competition,
        null,
        row.gf / row.gp,
        row.ga / row.gp,
      ]);
      cutoffMs = row.readMs;
      fromTable = true;
    }
  }
  const added = (team?.results ?? [])
    .filter(([ms]) => ms > cutoffMs && ms < kickoffMs - HOUR_MS)
    .sort((a, b) => b[0] - a[0])
    .map(([, game]) => game);
  const all = [...added, ...games].sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0));
  if (!all.length) return null;
  let gf = 0;
  let ga = 0;
  for (const game of all) {
    gf += game[3];
    ga += game[4];
  }
  const value = side({ n: all.length, gf, ga, games: all });
  return value ? { ...value, fromTable } : null;
}

const SIDE_CACHE = new Map<string, { home: SideRead | null; away: SideRead | null }>();

export function recentFor(id: string): { home: SideRead | null; away: SideRead | null } | undefined {
  const cached = SIDE_CACHE.get(id);
  if (cached) return cached;
  buildTeams();
  const match = ROW_BY_ID?.get(id);
  const read = BY_ID[id];
  if (!match) {
    if (!read) return undefined;
    const value = { home: side(read.h), away: side(read.a) };
    SIDE_CACHE.set(id, value);
    return value;
  }
  const kickoffMs = Date.parse(match[1]);
  if (!Number.isFinite(kickoffMs)) return undefined;
  const value = {
    home: historyOf(match[3], match[2], kickoffMs, read?.h ?? null),
    away: historyOf(match[4], match[2], kickoffMs, read?.a ?? null),
  };
  if (!value.home && !value.away && !read) return undefined;
  SIDE_CACHE.set(id, value);
  return value;
}

export const INCOMPATIBLE = /kings league|futsal|fútbol sala|futbol sala|beach soccer|fútbol playa|futbol playa|fútbol 7|futbol 7/i;

function levelC(
  home: SideRead,
  away: SideRead,
  kickoffMs: number,
  competition: string,
): RecentAnalysis | null {
  const league = leagueRate(competition, kickoffMs);
  return analyzeLevelC(home.games, away.games, kickoffMs, {
    neutral: /neutral/i.test(competition),
    prior: league.prior,
    homeFactor: league.homeFactor,
    awayFactor: league.awayFactor,
  });
}

export function analyzeRecent(home: SideRead, away: SideRead, kickoff?: string, competition = ""): RecentAnalysis | null {
  const kickoffMs = kickoff ? Date.parse(kickoff) : Number.NaN;
  if (Number.isFinite(kickoffMs)) return levelC(home, away, kickoffMs, competition);
  return analyzeCounts(home.n, home.gf, home.ga, away.n, away.gf, away.ga);
}

/**
 * Modelo de la tarjeta de un partido de la agenda.
 * Nivel A si la liga y los dos equipos están en el Dixon-Coles; si no, Nivel C.
 */
export function levelCFor(id: string, kickoff: string, competition = ""): RecentAnalysis | null {
  if (INCOMPATIBLE.test(competition)) return null;
  const kickoffMs = Date.parse(kickoff);
  if (!Number.isFinite(kickoffMs)) return null;
  buildTeams();
  const match = ROW_BY_ID?.get(id);
  if (match) {
    const levelA = levelAForAgenda(match[3], match[4], competition || match[2], kickoffMs);
    if (levelA) return levelA;
    const levelB = levelBFor(match, kickoffMs, competition);
    if (levelB) return levelB;
  }
  const recent = recentFor(id);
  if (!recent?.home || !recent?.away) return null;
  const analysis = levelC(recent.home, recent.away, kickoffMs, competition);
  if (!analysis) return null;
  return { ...analysis, level: "C" };
}
