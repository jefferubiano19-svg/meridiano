import { AGENDA, type AgendaMatch } from "./agenda";
import { dixonLambda } from "./dixon";
import { lambdasFor, scoreboard, shin } from "./engine";
import { getFixture } from "./fixtures";
import { leagueRate } from "./league-rate";
import { getAnalysis } from "./model";
import { isNational, nationForMatch, nationModel } from "./nations";
import { blendMarket, marketOnly, MARKET_WEIGHT, publication } from "./publish";
import { INCOMPATIBLE, levelCFor } from "./recent";
import { analyzeLevelC } from "./recent-math";
import { seasonShadow } from "./season";
import type { ThreeWay } from "./types";

/** Parámetros vigentes el 5 oct 2026. No cambian hasta 500 predicciones evaluadas. */
export const ENGINE_VERSION = "2026-10-13";

const REGION = new Set([
  "WORLD",
  "EUROPE",
  "ASIA",
  "AFRICA",
  "ÁFRICA",
  "SOUTH AMERICA",
  "NORTH & CENTRAL AMERICA",
  "MUNDIAL",
  "INTERNATIONAL",
]);

const INTERNATIONAL_CLUB =
  /champions league|copa libertadores|libertadores|sudamericana|europa league|conference league|club world cup|afc champions|caf champions|asean club championship|club friendly|amistosos de clubs/i;

export interface Way {
  home: number;
  draw: number;
  away: number;
}

export interface BuiltCard {
  /** A Dixon-Coles de liga, B ratings globales, C goles recientes, 5.4 selecciones, M solo mercado. */
  level: "A" | "B" | "C" | "5.4" | "M";
  engine: string;
  lambdaHome: number;
  lambdaAway: number;
  /** Null en Nivel M: no hay modelo, la publicada es el mercado. */
  model: Way | null;
  consensus: Way | null;
  published: Way;
  marketWeight: number;
  /** "consenso" (3+ casas), "wplay" (solo Wplay de la versión Lite) o null (solo modelo). */
  marketSource: "consenso" | "wplay" | null;
  probabilities: Way & { over25: number; under25: number; bttsYes: number; bttsNo: number };
  shadow: {
    wplay: Way | null;
    xg: Way | null;
    clubElo: Way | null;
    /** Liga BetPlay: modelo con toda la temporada 2026. */
    season: Way | null;
    note: string;
  };
}

export interface SheetHit {
  xg?: unknown;
  home?: string;
  away?: string;
}

function way(p: ThreeWay): Way {
  return { home: p.home, draw: p.draw, away: p.away };
}

function placeOf(competition: string): string {
  const head = String(competition ?? "").split(":")[0]?.trim().toUpperCase() ?? "";
  return head;
}

function countryIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const match of AGENDA) {
    const place = placeOf(match.competition);
    if (!place || REGION.has(place)) continue;
    for (const name of [match.home, match.away]) {
      const set = index.get(name) ?? new Set<string>();
      set.add(place);
      index.set(name, set);
    }
  }
  return index;
}

const COUNTRIES = countryIndex();

function teamKey(name: string, competition: string): string | null {
  const place = placeOf(competition);
  if (place && !REGION.has(place)) return `${name}|${place}`;
  const set = COUNTRIES.get(name);
  if (!set || set.size !== 1) return null;
  return `${name}|${[...set][0]}`;
}

function xgPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const home = Number(value[0]);
  const away = Number(value[1]);
  if (!(home >= 0) || !(away >= 0)) return null;
  return [home, away];
}

function xgGames(team: string, competition: string, kickoffMs: number, sheets: Record<string, SheetHit>) {
  const place = placeOf(competition);
  const games: { ts: number; goalsFor: number; goalsAgainst: number }[] = [];
  for (const match of AGENDA) {
    if (match.homeScore == null || match.awayScore == null) continue;
    const ts = Date.parse(match.kickoff);
    if (!Number.isFinite(ts) || !(ts < kickoffMs)) continue;
    if (placeOf(match.competition) !== place) continue;
    const pair = xgPair(sheets[match.id]?.xg);
    if (!pair) continue;
    if (match.home === team) games.push({ ts, goalsFor: pair[0], goalsAgainst: pair[1] });
    else if (match.away === team) games.push({ ts, goalsFor: pair[1], goalsAgainst: pair[0] });
  }
  return games;
}

function levelFromGames(
  homeGames: { ts: number | null; goalsFor: number; goalsAgainst: number }[],
  awayGames: { ts: number | null; goalsFor: number; goalsAgainst: number }[],
  kickoffMs: number,
  competition: string,
): Way | null {
  const league = leagueRate(competition, kickoffMs);
  const card = analyzeLevelC(homeGames, awayGames, kickoffMs, {
    neutral: /neutral|sede neutral/i.test(competition),
    prior: league.prior,
    homeFactor: league.homeFactor,
    awayFactor: league.awayFactor,
  });
  return card ? way(card.p1x2) : null;
}

function isInternationalClub(competition: string): boolean {
  return !isNational(competition) && INTERNATIONAL_CLUB.test(competition);
}

function solve3(matrix: number[][], target: number[]): number[] | null {
  const a = matrix.map((row, i) => [...row, target[i]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    for (let j = col; j < 4; j += 1) a[col][j] /= div;
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j < 4; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return [a[0][3], a[1][3], a[2][3]];
}

function clubElo(home: string, away: string, competition: string, kickoffMs: number): Way | null {
  if (!isInternationalClub(competition)) return null;
  const homeKey = teamKey(home, competition);
  const awayKey = teamKey(away, competition);
  if (!homeKey || !awayKey) return null;
  const played = AGENDA.filter((match) => match.homeScore != null && match.awayScore != null && Date.parse(match.kickoff) < kickoffMs)
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const ratings = new Map<string, number>();
  const samples: { d: number; gf: number; ga: number; neutral: boolean }[] = [];
  for (const match of played) {
    const left = teamKey(match.home, match.competition);
    const right = teamKey(match.away, match.competition);
    if (!left || !right || match.homeScore == null || match.awayScore == null) continue;
    const homeGoals = match.homeScore;
    const awayGoals = match.awayScore;
    const rh = ratings.get(left) ?? 1500;
    const ra = ratings.get(right) ?? 1500;
    const neutral = /neutral|sede neutral|club friendly|amistosos de clubs/i.test(match.competition);
    if (isInternationalClub(match.competition)) {
      samples.push({ d: (rh - ra) / 400, gf: homeGoals, ga: awayGoals, neutral });
    }
    const expected = 1 / (1 + 10 ** (-(rh + (neutral ? 0 : 65) - ra) / 400));
    const score = homeGoals > awayGoals ? 1 : homeGoals === awayGoals ? 0.5 : 0;
    ratings.set(left, rh + 20 * (score - expected));
    ratings.set(right, ra + 20 * (1 - score - (1 - expected)));
  }
  if (samples.length < 30) return null;
  const xtx = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const xty = [0, 0, 0];
  for (const sample of samples) {
    const rows = [
      [1, sample.neutral ? 0 : 1, sample.d, Math.log(sample.gf + 0.2)],
      [1, 0, -sample.d, Math.log(sample.ga + 0.2)],
    ];
    for (const row of rows) {
      for (let i = 0; i < 3; i += 1) {
        xty[i] += row[i] * row[3];
        for (let j = 0; j < 3; j += 1) xtx[i][j] += row[i] * row[j];
      }
    }
  }
  const beta = solve3(xtx, xty);
  if (!beta) return null;
  const neutral = /neutral|sede neutral|club friendly|amistosos de clubs/i.test(competition);
  const rh = ratings.get(homeKey) ?? 1500;
  const ra = ratings.get(awayKey) ?? 1500;
  const diff = (rh - ra) / 400;
  let lambdaHome = Math.exp(beta[0] + (neutral ? 0 : beta[1]) + beta[2] * diff);
  let lambdaAway = Math.exp(beta[0] - beta[2] * diff);
  const domestic = dixonLambda(home, away);
  if (domestic) {
    lambdaHome = lambdaHome * 0.5 + domestic.lambdaHome * 0.5;
    lambdaAway = lambdaAway * 0.5 + domestic.lambdaAway * 0.5;
  }
  lambdaHome = Math.min(4, Math.max(0.2, lambdaHome));
  lambdaAway = Math.min(4, Math.max(0.2, lambdaAway));
  return way(scoreboard(lambdaHome, lambdaAway, -0.08).p1x2);
}

function fromFixture(match: AgendaMatch): {
  level: "A" | "B" | "C" | "5.4";
  lambdaHome: number;
  lambdaAway: number;
  model: Way;
  over25: number;
  bttsYes: number;
} | null {
  if (!match.fixtureId) return null;
  const fixture = getFixture(match.fixtureId);
  if (!fixture) return null;
  try {
    const analysis = getAnalysis(fixture);
    const nation = nationForMatch(match.id) ?? nationModel(match.home, match.away, match.competition);
    const model = nation?.p1x2 ?? analysis.p1x2;
    return {
      level: nation ? "5.4" : analysis.level === "A" || analysis.level === "C" ? analysis.level : "B",
      lambdaHome: nation?.lambdaHome ?? analysis.lambdaHome,
      lambdaAway: nation?.lambdaAway ?? analysis.lambdaAway,
      model: way(model),
      over25: nation?.pOver25 ?? analysis.pOver25,
      bttsYes: nation?.pBttsYes ?? analysis.pBttsYes,
    };
  } catch {
    return null;
  }
}

function fromLevelC(match: AgendaMatch) {
  // Selecciones primero: no dependen del historial de clubes.
  const nation = nationForMatch(match.id) ?? nationModel(match.home, match.away, match.competition);
  if (nation) {
    return {
      level: "5.4" as const,
      lambdaHome: nation.lambdaHome,
      lambdaAway: nation.lambdaAway,
      model: way(nation.p1x2),
      over25: nation.pOver25,
      bttsYes: nation.pBttsYes,
    };
  }
  const raw = levelCFor(match.id, match.kickoff, match.competition);
  if (!raw) return null;
  return {
    level: (raw.level ?? "C") as "A" | "B" | "C",
    lambdaHome: raw.lambdaHome,
    lambdaAway: raw.lambdaAway,
    model: way(raw.p1x2),
    over25: raw.pOver25,
    bttsYes: raw.pBttsYes,
  };
}

/** La misma tarjeta que publica la app. Las sombras no salen en la probabilidad publicada. */
/** Nivel M: sin historial de los equipos pero con cuotas leídas antes del inicio. */
function marketCard(matchId: string): BuiltCard | null {
  const pub = marketOnly(matchId);
  if (!pub) return null;
  const published = way(pub.published);
  const [lambdaHome, lambdaAway] = lambdasFor(pub.published);
  const board = scoreboard(lambdaHome, lambdaAway);
  return {
    level: "M",
    engine: ENGINE_VERSION,
    lambdaHome,
    lambdaAway,
    model: null,
    consensus: pub.consensus ? way(pub.consensus) : null,
    published,
    marketWeight: 1,
    marketSource: pub.marketSource,
    probabilities: {
      ...published,
      over25: board.pOver25,
      under25: 1 - board.pOver25,
      bttsYes: board.pBttsYes,
      bttsNo: 1 - board.pBttsYes,
    },
    shadow: { wplay: null, xg: null, clubElo: null, season: null, note: "Nivel M: solo mercado, sin modelo." },
  };
}

export function buildCard(
  match: { id: string; kickoff: string; competition: string; home: string; away: string; fixtureId?: string | null },
  extra: { wplay?: number[] | null; sheets?: Record<string, SheetHit> } = {},
): BuiltCard | null {
  if (INCOMPATIBLE.test(match.competition)) return null;
  const kickoffMs = Date.parse(match.kickoff);
  if (!Number.isFinite(kickoffMs)) return null;
  const agendaMatch: AgendaMatch = {
    id: match.id,
    kickoff: match.kickoff,
    competition: match.competition,
    home: match.home,
    away: match.away,
    status: "por-jugar",
    homeScore: null,
    awayScore: null,
    fixtureId: match.fixtureId ?? null,
  };
  const base = fromFixture(agendaMatch) ?? fromLevelC(agendaMatch);
  if (!base) return marketCard(match.id);
  const pub = publication(match.id, base.model, base.lambdaHome + base.lambdaAway);
  const published = way(pub.published);
  const wplay = extra.wplay;
  let wplayShadow: Way | null = null;
  if (!pub.consensus && wplay && wplay.length >= 3) {
    const fair = shin(wplay[0], wplay[1], wplay[2]);
    if (fair) wplayShadow = way(blendMarket(base.model, fair));
  }
  const sheets = extra.sheets ?? {};
  const homeXg = xgGames(match.home, match.competition, kickoffMs, sheets);
  const awayXg = xgGames(match.away, match.competition, kickoffMs, sheets);
  const xg = homeXg.length >= 4 && awayXg.length >= 4 ? levelFromGames(homeXg, awayXg, kickoffMs, match.competition) : null;
  return {
    level: base.level,
    engine: ENGINE_VERSION,
    lambdaHome: base.lambdaHome,
    lambdaAway: base.lambdaAway,
    model: base.model,
    consensus: pub.consensus ? way(pub.consensus) : null,
    published,
    marketWeight: pub.market ? MARKET_WEIGHT : 0,
    marketSource: pub.marketSource,
    probabilities: {
      ...published,
      over25: base.over25,
      under25: 1 - base.over25,
      bttsYes: base.bttsYes,
      bttsNo: 1 - base.bttsYes,
    },
    shadow: {
      wplay: wplayShadow,
      xg,
      clubElo: clubElo(match.home, match.away, match.competition, kickoffMs),
      season: (() => {
        const value = seasonShadow(match.home, match.away, match.competition, kickoffMs);
        return value ? way(value) : null;
      })(),
      note: "No se publica. Al llegar a 500 partidos evaluados se compara con la publicada por la regla de la sección 9.2.",
    },
  };
}
