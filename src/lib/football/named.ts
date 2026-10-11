import { AGENDA, agendaDay } from "./agenda";
import { bogotaStamp } from "./fixtures";
import { leagueRate } from "./league-rate";
import { getLeague } from "./leagues";
import { sameSide } from "./lookup";
import { analyzeFixture } from "./model";
import { dixonRecent } from "./dixon";
import { analyzeRecent, type SideRead } from "./recent";
import type { RecentAnalysis } from "./recent-math";
import { TEAMS } from "./teams";
import type { Fixture, LeagueId, MatchAnalysis, Team } from "./types";

function leagueNote(competition: string, when: string): string {
  const kickoff = Date.parse(when);
  const league = Number.isFinite(kickoff) ? leagueRate(competition, kickoff) : null;
  if (league?.prior != null && league.homeFactor != null && league.awayFactor != null) {
    return `Contracción hacia ${league.prior.toFixed(2)} goles por equipo de esa liga (${league.n} partidos previos). Ventaja de local ${league.homeFactor.toFixed(2)} / ${league.awayFactor.toFixed(2)}, tope ±15 %.`;
  }
  return "Esa liga no tiene partidos previos en el feed. Contracción hacia 1,25 y ventaja 1,10 / 0,91.";
}

export type NamedFicha =
  | {
      kind: "modelo";
      fixture: Fixture;
      analysis: MatchAnalysis;
      note: string;
    }
  | {
      kind: "reciente";
      home: string;
      away: string;
      competition: string;
      when: string;
      analysis: RecentAnalysis;
      homeSide: SideRead | null;
      awaySide: SideRead | null;
      note: string;
    }
  | { kind: "vacio"; note: string };

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function pickTeam(query: string, competition: string): Team | null {
  const wanted = fold(query);
  const exact = TEAMS.filter((team) => fold(team.name) === wanted || fold(team.short) === wanted);
  const pool = exact.length
    ? exact
    : TEAMS.filter((team) => sameSide(query, team.name) || sameSide(query, team.short));
  if (!pool.length) return null;
  const comp = fold(competition);
  if (comp) {
    const inLeague = pool.find((team) => {
      const league = getLeague(team.leagueId);
      const blob = fold(`${league.name} ${league.country} ${league.short}`);
      return blob.includes(comp) || comp.includes(fold(league.short));
    });
    if (inLeague) return inLeague;
  }
  return pool.slice().sort((a, b) => b.gp - a.gp)[0] ?? null;
}

function publishedName(query: string, competition: string, cutoff: string): string {
  const comp = fold(competition);
  const names = new Map<string, { name: string; n: number; inComp: number }>();
  for (const match of AGENDA) {
    if (agendaDay(match) >= cutoff) continue;
    if (match.homeScore == null || match.awayScore == null) continue;
    for (const name of [match.home, match.away]) {
      if (!sameSide(query, name)) continue;
      const key = fold(name);
      const row = names.get(key) ?? { name, n: 0, inComp: 0 };
      row.n += 1;
      if (comp && fold(match.competition).includes(comp)) row.inComp += 1;
      names.set(key, row);
    }
  }
  const ranked = [...names.values()].sort((a, b) => b.inComp - a.inComp || b.n - a.n);
  return ranked[0]?.name ?? query.trim();
}

function sideFromAgenda(name: string, cutoff: string): SideRead | null {
  const key = fold(name);
  const games = [];
  for (const match of AGENDA) {
    if (agendaDay(match) >= cutoff) continue;
    if (match.homeScore == null || match.awayScore == null) continue;
    const home = fold(match.home) === key;
    const away = fold(match.away) === key;
    if (home === away) continue;
    games.push({
      ts: Date.parse(match.kickoff) / 1000,
      competition: match.competition,
      opponent: home ? match.away : match.home,
      goalsFor: home ? match.homeScore : match.awayScore,
      goalsAgainst: home ? match.awayScore : match.homeScore,
    });
  }
  games.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const last = games.slice(0, 6);
  if (!last.length) return null;
  return {
    n: last.length,
    gf: last.reduce((sum, game) => sum + game.goalsFor, 0),
    ga: last.reduce((sum, game) => sum + game.goalsAgainst, 0),
    games: last,
  };
}

export function estimateNamed(input: {
  home: string;
  away: string;
  date: string;
  competition: string;
}): NamedFicha {
  const homeQuery = input.home.trim();
  const awayQuery = input.away.trim();
  const competition = input.competition.trim();
  const cutoff = input.date.trim() || bogotaStamp();
  const when = input.date.trim()
    ? `${input.date.trim()}T12:00:00-05:00`
    : new Date(Date.now() + 36 * 3600 * 1000).toISOString();

  const homeTeam = pickTeam(homeQuery, competition);
  const awayTeam = pickTeam(awayQuery, competition);
  if (homeTeam && awayTeam && homeTeam.id !== awayTeam.id) {
    const fixture: Fixture = {
      id: `consulta:${homeTeam.id}:${awayTeam.id}:${cutoff}`,
      leagueId: homeTeam.leagueId as LeagueId,
      competition: competition || getLeague(homeTeam.leagueId).name,
      kickoff: when,
      homeId: homeTeam.id,
      awayId: awayTeam.id,
      venue: "",
      round: "Consulta",
      status: "por-jugar",
      market: null,
      source: "Consulta del usuario. Equipos del corte publicado.",
    };
    return {
      kind: "modelo",
      fixture,
      analysis: analyzeFixture(fixture),
      note: "Este cruce no estaba en la agenda. La ficha usa el mismo cálculo de las ligas del corte, con la tabla publicada de estos dos equipos.",
    };
  }

  const homeName = publishedName(homeQuery, competition, cutoff);
  const awayName = publishedName(awayQuery, competition, cutoff);
  const homeSide = sideFromAgenda(homeName, cutoff);
  const awaySide = sideFromAgenda(awayName, cutoff);
  const analysis =
    dixonRecent(homeName, awayName) ??
    dixonRecent(homeQuery, awayQuery) ??
    (homeSide && awaySide ? analyzeRecent(homeSide, awaySide, when, competition) : null);
  if (!analysis) {
    return {
      kind: "vacio",
      note: "No hay partidos recientes publicados de los dos equipos. No se inventa una probabilidad.",
    };
  }
  return {
    kind: "reciente",
    home: homeName,
    away: awayName,
    competition: competition || "Competición indicada por el usuario",
    when,
    analysis,
    homeSide,
    awaySide,
    note: homeSide && awaySide
      ? `Sale de los últimos ${homeSide.n} partidos publicados de ${homeName} y los últimos ${awaySide.n} de ${awayName}, anteriores al ${cutoff}. ${leagueNote(competition, when)}`
      : "Nivel A de Dixon-Coles, porque esos dos nombres están en el corte de football-data.co.uk. No hay lista de partidos recientes para el otro lado.",
  };
}
