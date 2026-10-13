import { AGENDA, agendaOnDay, type AgendaMatch } from "./agenda";
import { spanishName } from "./standings";
import { buildCombinada, buildCombinadaManana, type CombinadaLeg } from "./combinada";
import { agendaToday, agendaTomorrow, bogotaDay, shiftDay } from "./clock";
import { MISSING, type ComboBoard, type ComboMatch, type ConsultaBoard, type DayBoard, type LeagueCard, type LeaguePage, type MatchReading, type ModeloBundle, type SearchBoard, type Way } from "./dto";
import { DIXON_FETCHED_AT, DIXON_REPORT, DIXON_RULE } from "./dixon";
import { getFixture, FIXTURES } from "./fixtures";
import { findPartidos, type PartidoHit } from "./lookup";
import { LEAGUES, LEAGUE_BY_ID } from "./leagues";
import { getAnalysis } from "./model";
import { estimateNamed } from "./named";
import { nationModel } from "./nations";
import { hasMarketOdds, marketOnly, publication } from "./publish";
import { levelCFor, recentFor } from "./recent";
import { sheetFor } from "./sheets";
import historyFile from "../../../data/sheets-history.json";
import { getTeam, teamsInLeague } from "./teams";
import type { Fixture, LeagueId, ThreeWay } from "./types";
import coverageFile from "../../../data/cut-coverage.json";
import reviewFile from "../../../data/review.json";
import standingsAutoFile from "../../../data/standings-auto.json";
import nationEloFile from "../../../data/nation-elo.json";
import ratingsFile from "../../../data/ratings.json";
import type { Review } from "./review";

const BY_ID = new Map<string, AgendaMatch>();
const BY_FIXTURE = new Map<string, AgendaMatch>();
for (const match of AGENDA) {
  BY_ID.set(match.id, match);
  if (match.fixtureId) BY_FIXTURE.set(match.fixtureId, match);
}

const CACHE = new Map<string, MatchReading>();

const HISTORY = (
  historyFile as { byId?: Record<string, { xg?: unknown; lineup?: unknown }> }
).byId ?? {};

function xgBoth(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2) return false;
  const home = Number(value[0]);
  const away = Number(value[1]);
  return home >= 0 && away >= 0 && Number.isFinite(home) && Number.isFinite(away);
}

function bothElevens(lineup: unknown): boolean {
  if (typeof lineup !== "string" || !lineup.trim() || /no disponible/i.test(lineup)) return false;
  const names = lineup.split(/\r?\n/).filter((line) => {
    const text = line.trim();
    if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(text)) return false;
    if (/^\(.*\)$/.test(text)) return false;
    if (/alineacion/i.test(text)) return false;
    return true;
  });
  return names.length >= 22;
}

/** Sección 7: alta con los cuatro, media con dos o tres, baja con uno o ninguno o con menos de seis partidos. */
function section7(id: string, books: number): "alta" | "media" | "baja" {
  const match = BY_ID.get(id) ?? BY_FIXTURE.get(id);
  const agendaId = match?.id ?? id;
  const fixtureId = match?.fixtureId ?? (getFixture(id) ? id : null);
  const recent = recentFor(agendaId);
  let homeN = recent?.home?.n ?? 0;
  let awayN = recent?.away?.n ?? 0;
  let seasonXg = false;
  if (fixtureId) {
    const fixture = getFixture(fixtureId);
    if (fixture) {
      try {
        const home = getTeam(fixture.homeId);
        const away = getTeam(fixture.awayId);
        homeN = Math.max(homeN, home.gp);
        awayN = Math.max(awayN, away.gp);
        seasonXg = home.xg != null && home.xga != null && away.xg != null && away.xga != null;
      } catch {
        /* sin ficha de equipo */
      }
    }
  }
  const sheet = fixtureId ? sheetFor(fixtureId) : undefined;
  const lineupSheet = Boolean(
    sheet &&
      sheet.home.players.filter((player) => player.role === "titular").length >= 11 &&
      sheet.away.players.filter((player) => player.role === "titular").length >= 11,
  );
  const history = HISTORY[agendaId];
  const xg = seasonXg || xgBoth(history?.xg);
  const lineup = lineupSheet || bothElevens(history?.lineup);
  const games = Math.min(homeN, awayN);
  if (games < 6) return "baja";
  const met = [xg, homeN >= 8 && awayN >= 8, lineup, books > 0].filter(Boolean).length;
  if (met >= 4) return "alta";
  if (met >= 2) return "media";
  return "baja";
}


function way(value: ThreeWay | null | undefined): Way | null {
  if (!value) return null;
  if (![value.home, value.draw, value.away].every((n) => Number.isFinite(n))) return null;
  return { home: value.home, draw: value.draw, away: value.away };
}

function teamName(id: string): string {
  try {
    return getTeam(id).name;
  } catch {
    return id;
  }
}

interface Seed {
  id: string;
  href: string;
  home: string;
  away: string;
  competition: string;
  kickoff: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  model: ThreeWay | null;
  level: string;
  confidence: string;
  total: number | null;
}

function seal(seed: Seed): MatchReading {
  const model = way(seed.model);
  // Sin modelo pero con cuotas: Nivel M, la publicada es el mercado solo.
  const pub = model ? publication(seed.id, model, seed.total) : marketOnly(seed.id);
  const gap = pub?.gap ?? 0;
  const revisar = Boolean(pub && (gap > 0.1 || pub.review));
  const kick = Date.parse(seed.kickoff);
  const open = !seed.kickoff || (Number.isFinite(kick) && kick - Date.now() > 10 * 60 * 1000);
  const best = pub && open && gap <= 0.1 && !pub.review ? pub.values[0] : undefined;
  const reading: MatchReading = {
    id: seed.id,
    withOdds: Boolean(pub?.market) || hasMarketOdds(seed.id),
    href: seed.href,
    home: seed.home,
    away: seed.away,
    competition: seed.competition,
    kickoff: seed.kickoff,
    status: seed.status,
    homeScore: seed.homeScore,
    awayScore: seed.awayScore,
    homeEs: spanishName(seed.competition, seed.home),
    awayEs: spanishName(seed.competition, seed.away),
    published: pub ? way(pub.published) : null,
    model,
    consensus: pub ? way(pub.consensus) : null,
    wplay: pub?.marketSource === "wplay" ? way(pub.market) : null,
    level: !model && pub ? "M" : seed.level || MISSING,
    confidence: section7(seed.id, pub?.books ?? 0),
    revisar,
    value: best
      ? { house: best.house, odds: best.odds, side: best.side, readAt: pub?.readAt ?? null }
      : null,
  };
  CACHE.set(seed.id, reading);
  return reading;
}

function blank(seed: Omit<Seed, "model" | "level" | "confidence" | "total">): MatchReading {
  return seal({ ...seed, model: null, level: MISSING, confidence: MISSING, total: null });
}

function readingOf(match: AgendaMatch): MatchReading {
  const cached = CACHE.get(match.id);
  if (cached) return cached;
  let model: ThreeWay | null = null;
  let level = MISSING;
  let confidence = MISSING;
  let total: number | null = null;
  if (match.fixtureId) {
    const fixture = getFixture(match.fixtureId);
    if (fixture) {
      try {
        const analysis = getAnalysis(fixture);
        model = analysis.p1x2;
        level = analysis.level ?? "C";
        confidence = analysis.confidenceLabel || MISSING;
        total = analysis.lambdaHome + analysis.lambdaAway;
      } catch {
        /* el modelo de ficha no salió; sigue el nivel C */
      }
    }
  }
  const nation = nationModel(match.home, match.away, match.competition);
  if (nation) {
    model = nation.p1x2;
    level = "5.4";
    total = nation.lambdaHome + nation.lambdaAway;
  }
  if (!model) {
    const recent = levelCFor(match.id, match.kickoff, match.competition);
    if (recent) {
      model = recent.p1x2;
      level = recent.level ?? "C";
      total = recent.lambdaHome + recent.lambdaAway;
    }
  }
  return seal({
    id: match.id,
    href: `/agenda/${match.id}`,
    home: match.home,
    away: match.away,
    competition: match.competition,
    kickoff: match.kickoff,
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    model,
    level,
    confidence,
    total,
  });
}

function readingFromFixture(fixture: Fixture): MatchReading {
  const linked = BY_FIXTURE.get(fixture.id);
  if (linked) return readingOf(linked);
  const cached = CACHE.get(fixture.id);
  if (cached) return cached;
  let model: ThreeWay | null = null;
  let level = MISSING;
  let confidence = MISSING;
  let total: number | null = null;
  try {
    const analysis = getAnalysis(fixture);
    model = analysis.p1x2;
    level = analysis.level ?? "C";
    confidence = analysis.confidenceLabel || MISSING;
    total = analysis.lambdaHome + analysis.lambdaAway;
  } catch {
    /* sin ficha */
  }
  return seal({
    id: fixture.id,
    href: `/partido/${fixture.id}`,
    home: teamName(fixture.homeId),
    away: teamName(fixture.awayId),
    competition: fixture.competition,
    kickoff: fixture.kickoff,
    status: fixture.status,
    homeScore: null,
    awayScore: null,
    model,
    level,
    confidence,
    total,
  });
}

export function readingById(id: string): MatchReading | null {
  const match = BY_ID.get(id);
  if (match) return readingOf(match);
  const linked = BY_FIXTURE.get(id);
  if (linked) return readingOf(linked);
  const fixture = getFixture(id);
  if (fixture) return readingFromFixture(fixture);
  return null;
}

export function dayBoard(day: string): DayBoard {
  const today = agendaToday();
  const chosen = day || today;
  const rows = agendaOnDay(chosen).filter((match) => chosen !== today || match.status !== "finalizado");
  // Entre un corte y otro el estado guardado envejece. Un partido "por-jugar" cuya hora ya pasó
  // empezó, aunque el corte todavía no tenga su resultado: va después de los que faltan por jugar.
  const now = Date.now();
  const waiting = (match: AgendaMatch) => match.status === "por-jugar" && Date.parse(match.kickoff) <= now;
  const rank = (match: AgendaMatch) =>
    match.status === "por-jugar" && !waiting(match) ? 0 : match.status === "en-juego" ? 1 : waiting(match) ? 2 : 3;
  rows.sort((a, b) => rank(a) - rank(b) || a.kickoff.localeCompare(b.kickoff));
  return {
    day: chosen,
    matches: rows.map((match) => {
      const reading = readingOf(match);
      return waiting(match) ? { ...reading, status: "empezó, sin resultado aún" } : reading;
    }),
  };
}

function withPick(leg: CombinadaLeg): ComboMatch {
  const base = readingById(leg.id) ?? blank({
    id: leg.id,
    href: leg.fixtureId ? `/partido/${leg.fixtureId}` : `/agenda/${leg.id}`,
    home: leg.home,
    away: leg.away,
    competition: leg.competition,
    kickoff: leg.kickoff,
    status: "por-jugar",
    homeScore: null,
    awayScore: null,
  });
  const pickProbability = base.published ? base.published[leg.key] : null;
  return { ...base, pick: leg.pick, pickKey: leg.key, pickProbability };
}

export function comboBoard(which: "hoy" | "manana"): ComboBoard {
  const day = which === "manana" ? agendaTomorrow() : agendaToday();
  const ticket = which === "manana" ? buildCombinadaManana(day) : buildCombinada(day);
  const matches = ticket.legs.map(withPick);
  const joint =
    matches.length > 0 && matches.every((match) => match.pickProbability != null)
      ? matches.reduce((product, match) => product * (match.pickProbability as number), 1)
      : null;
  return { day, pool: ticket.today, joint, matches };
}

export function ficha(id: string): MatchReading | null {
  return readingById(id);
}

export function consultaBoard(day: string): ConsultaBoard {
  const today = agendaToday();
  const past = [...new Set(AGENDA.map((match) => match.kickoff.slice(0, 10)))]
    .filter((item) => item < today)
    .sort()
    .slice(-21)
    .reverse();
  const todayFinished = AGENDA.filter(
    (match) => match.kickoff.slice(0, 10) === today && match.status === "finalizado",
  ).length;
  const days = [
    ...(todayFinished > 0 ? [{ day: today, n: todayFinished }] : []),
    ...past.map((item) => ({ day: item, n: agendaOnDay(item).length })),
  ];
  const chosen = day && days.some((item) => item.day === day) ? day : (days[0]?.day ?? shiftDay(today, -1));
  const matches = agendaOnDay(chosen)
    .filter((match) => (chosen === today ? match.status === "finalizado" : true))
    .sort((a, b) =>
      chosen === today ? b.kickoff.localeCompare(a.kickoff) : a.kickoff.localeCompare(b.kickoff),
    )
    .slice(0, 80)
    .map(readingOf);
  return { day: chosen, days, matches };
}

export function leagueIndex(): LeagueCard[] {
  const today = agendaToday();
  return LEAGUES.map((league) => {
    const teams = teamsInLeague(league.id);
    const upcoming = upcomingCount(league.id, today);
    const leader = teams[0];
    return {
      id: league.id,
      teams: teams.length,
      upcoming,
      leader: leader?.name ?? "",
      leaderPts: leader ? leader.pts : null,
    };
  });
}

function upcomingCount(leagueId: LeagueId, today: string): number {
  let n = 0;
  for (const fixture of FIXTURES) {
    if (fixture.leagueId !== leagueId) continue;
    if (bogotaDay(fixture.kickoff) < today || fixture.status === "finalizado") continue;
    n += 1;
  }
  return n;
}

export function leaguePage(id: string): LeaguePage | null {
  const league = LEAGUE_BY_ID[id as LeagueId];
  if (!league) return null;
  const today = agendaToday();
  const teams = teamsInLeague(league.id);
  const matches = FIXTURES.filter(
    (fixture) =>
      fixture.leagueId === league.id &&
      bogotaDay(fixture.kickoff) >= today &&
      fixture.status !== "finalizado",
  ).map(readingFromFixture);
  return {
    id: league.id,
    name: league.name,
    country: league.country,
    note: league.note ?? "",
    table: teams.slice(0, 24).map((team) => ({ name: team.name, pts: team.pts, gf: team.gf, ga: team.ga })),
    matches,
  };
}

function hitReading(hit: PartidoHit): MatchReading {
  if (hit.kind === "agenda") {
    const match = BY_ID.get(hit.id);
    if (match) return readingOf(match);
  }
  const fixture = getFixture(hit.id);
  if (fixture) return readingFromFixture(fixture);
  return blank({
    id: hit.id,
    href: hit.kind === "agenda" ? `/agenda/${hit.id}` : `/partido/${hit.id}`,
    home: hit.home,
    away: hit.away,
    competition: hit.competition,
    kickoff: hit.kickoff,
    status: "",
    homeScore: null,
    awayScore: null,
  });
}

export function searchBoard(input: { home: string; away: string; date: string; competition: string }): SearchBoard {
  const found = findPartidos(input);
  const hits = found.hits.slice(0, 30).map(hitReading);
  const others = hits.length === 0 ? found.withoutDate.slice(0, 12).map(hitReading) : [];
  if (hits.length > 0) return { hits, others, named: null, note: "" };
  const named = estimateNamed(input);
  if (named.kind === "vacio") return { hits, others, named: null, note: named.note };
  if (named.kind === "modelo") {
    let model: ThreeWay | null = named.analysis.p1x2;
    const level = named.analysis.level ?? "B";
    const confidence = named.analysis.confidenceLabel || MISSING;
    const total = named.analysis.lambdaHome + named.analysis.lambdaAway;
    return {
      hits,
      others,
      note: named.note,
      named: seal({
        id: named.fixture.id,
        href: "",
        home: teamName(named.fixture.homeId),
        away: teamName(named.fixture.awayId),
        competition: named.fixture.competition,
        kickoff: named.fixture.kickoff,
        status: "por-jugar",
        homeScore: null,
        awayScore: null,
        model,
        level,
        confidence,
        total,
      }),
    };
  }
  return {
    hits,
    others,
    note: named.note,
    named: seal({
      id: `nombre:${named.home}:${named.away}`,
      href: "",
      home: named.home,
      away: named.away,
      competition: named.competition,
      kickoff: named.when,
      status: "por-jugar",
      homeScore: null,
      awayScore: null,
      model: named.analysis.p1x2,
      level: "C",
      confidence: MISSING,
      total: named.analysis.lambdaHome + named.analysis.lambdaAway,
    }),
  };
}

export function fixtureNames(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids.slice(0, 200)) {
    const fixture = getFixture(id);
    if (!fixture) continue;
    out[id] = `${teamName(fixture.homeId)} – ${teamName(fixture.awayId)}`;
  }
  return out;
}

export function modeloBundle(): ModeloBundle {
  const cut = coverageFile as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const review = reviewFile as unknown as Review | Record<string, never>;
  const leagues = (standingsAutoFile as { leagues?: { competition: string; readAtBogota?: string; rows?: unknown[] }[] }).leagues ?? [];
  return {
    lastCut: {
      corte: text(cut.corte),
      startedAtBogota: text(cut.startedAtBogota),
      finishedAtBogota: text(cut.finishedAtBogota),
      fatal: cut.fatal === true,
      predictionsSaved: num(cut.predictionsSaved),
      predictionsWithConsensus: num(cut.predictionsWithConsensus),
      predictionsWithWplay: num(cut.predictionsWithWplay),
      tablesRead: num(cut.tablesRead),
      failures: Array.isArray(cut.failures) ? cut.failures.length : 0,
      agendaToday: num(cut.agendaToday),
      agendaTomorrow: num(cut.agendaTomorrow),
    },
    review: "generatedAt" in review ? (review as Review) : null,
    dixonRule: DIXON_RULE,
    dixonAt: DIXON_FETCHED_AT,
    dixon: Object.entries(DIXON_REPORT).map(([league, row]) => ({
      league,
      published: Boolean(row.published),
      rpsModel: row.holdout?.rpsModel ?? null,
      rpsBaseline: row.holdout?.rpsBaseline ?? null,
      rpsMarket: row.holdout?.rpsMarket ?? null,
      n: row.holdout?.n ?? null,
    })),
    tables: leagues.map((table) => ({
      competition: table.competition,
      readAtBogota: table.readAtBogota ?? null,
      teams: Array.isArray(table.rows) ? table.rows.length : 0,
    })),
    nationEloAt: (nationEloFile as { readAtBogota?: string }).readAtBogota ?? null,
    ratings: (() => {
      const file = ratingsFile as { asOf?: string | null; teams?: Record<string, unknown>; games?: number };
      return { asOf: file.asOf ?? null, teams: Object.keys(file.teams ?? {}).length, games: file.games ?? 0 };
    })(),
  };
}
