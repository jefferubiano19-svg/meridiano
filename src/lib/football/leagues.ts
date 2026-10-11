import type { League, LeagueId } from "./types";

const NOTE =
  "Tabla y partidos descargados de ESPN el 3 de octubre de 2026. El tablero de ese sábado se cruzó con BeSoccer; las fichas de equipo de BeSoccer no abrieron (HTTP 406).";

export const LEAGUES: League[] = [
  { id: "selecciones", name: "Selecciones", short: "SEL", country: "Fecha FIFA", tz: "America/Bogota", note: NOTE },
  { id: "colombia", name: "Liga BetPlay", short: "COL", country: "Colombia", tz: "America/Bogota", note: NOTE },
  { id: "argentina", name: "Liga Profesional", short: "ARG", country: "Argentina", tz: "America/Argentina/Buenos_Aires", note: NOTE },
  { id: "brasileirao", name: "Brasileirão", short: "BRA", country: "Brasil", tz: "America/Sao_Paulo", note: NOTE },
  { id: "epl", name: "Premier League", short: "EPL", country: "Inglaterra", tz: "Europe/London", note: NOTE },
  { id: "laliga", name: "LaLiga", short: "LAL", country: "España", tz: "Europe/Madrid", note: NOTE },
  { id: "bundesliga", name: "Bundesliga", short: "BUN", country: "Alemania", tz: "Europe/Berlin", note: NOTE },
  { id: "seriea", name: "Serie A", short: "ITA", country: "Italia", tz: "Europe/Rome", note: NOTE },
  { id: "ligue1", name: "Ligue 1", short: "FL1", country: "Francia", tz: "Europe/Paris", note: NOTE },
  { id: "ligamx", name: "Liga MX", short: "MX", country: "México", tz: "America/Mexico_City", note: NOTE },
  { id: "eredivisie", name: "Eredivisie", short: "NED", country: "Países Bajos", tz: "Europe/Amsterdam", note: NOTE },
  { id: "portugal", name: "Primeira Liga", short: "POR", country: "Portugal", tz: "Europe/Lisbon", note: NOTE },
  { id: "mls", name: "MLS", short: "MLS", country: "EE. UU. / Canadá", tz: "America/New_York", note: NOTE },
  { id: "ucl", name: "UEFA Champions League", short: "UCL", country: "Europa", tz: "Europe/Paris", note: NOTE },
];

export const LEAGUE_BY_ID: Record<LeagueId, League> = Object.fromEntries(
  LEAGUES.map((league) => [league.id, league]),
) as Record<LeagueId, League>;

export function getLeague(id: LeagueId): League {
  return LEAGUE_BY_ID[id];
}
