/* ---------------------------------------------------------------------------
 * "Mejores ligas": orden de competiciones para elegir los 20 partidos del día
 * de mayor nivel. No lo calcula Meridiano: los ratings del Nivel B comparan equipos
 * dentro de su grupo de partidos y no sirven para comparar ligas entre sí.
 *
 * Fuentes (revisadas el 14 oct 2026):
 *  - Competiciones continentales: jerarquía oficial de cada confederación
 *    (UEFA: Champions > Europa > Conference; CONMEBOL: Libertadores > Sudamericana).
 *    La UEFA va antes porque en el ranking de Opta las ligas europeas encabezan.
 *  - Ligas 1–25: ranking de ligas de Opta (Opta Power Rankings), publicado por The Analyst
 *    el 27 jul 2026, según la lista completa de Récord (29 jul 2026).
 *    Del puesto 1 al 10 los reportes coinciden (salvo LaLiga/Bundesliga, 2.º y 3.º).
 *    Del 11 en adelante difieren: Colombia 13.º o 17.º, MLS 19.º, 21.º o 40.º.
 *    Por eso, del 11 al 25 el orden es aproximado.
 * Solo torneos de mayores masculinos de primera división (sin femeninas, juveniles ni reservas).
 * ------------------------------------------------------------------------- */

export interface TopCompetition {
  /** Posición usada para ordenar: 1–5 continentales, 11–35 ligas (= puesto Opta + 10). */
  rank: number;
  label: string;
  pattern: RegExp;
}

const SUFFIX = "(?: - .*)?$";
const comp = (prefix: string, name: string) => new RegExp(`^${prefix}: ${name}${SUFFIX}`);

export const TOP_COMPETITIONS: TopCompetition[] = [
  { rank: 1, label: "Champions League", pattern: comp("EUROPE", "Champions League") },
  { rank: 2, label: "Europa League", pattern: comp("EUROPE", "Europa League") },
  { rank: 3, label: "Copa Libertadores", pattern: comp("SOUTH AMERICA", "Copa Libertadores") },
  { rank: 4, label: "Conference League", pattern: comp("EUROPE", "Conference League") },
  { rank: 5, label: "Copa Sudamericana", pattern: comp("SOUTH AMERICA", "Copa Sudamericana") },
  { rank: 11, label: "Premier League", pattern: comp("ENGLAND", "Premier League") },
  { rank: 12, label: "LaLiga", pattern: comp("SPAIN", "LaLiga") },
  { rank: 13, label: "Bundesliga", pattern: comp("GERMANY", "Bundesliga") },
  { rank: 14, label: "Serie A (Italia)", pattern: comp("ITALY", "Serie A") },
  { rank: 15, label: "Ligue 1", pattern: comp("FRANCE", "Ligue 1") },
  { rank: 16, label: "Brasileirão", pattern: comp("BRAZIL", "Serie A(?: Betano)?") },
  { rank: 17, label: "Liga Profesional (Argentina)", pattern: comp("ARGENTINA", "Liga Profesional") },
  { rank: 18, label: "Jupiler Pro League", pattern: comp("BELGIUM", "Jupiler Pro League") },
  { rank: 19, label: "Liga Portugal", pattern: comp("PORTUGAL", "Liga Portugal") },
  { rank: 20, label: "Championship", pattern: comp("ENGLAND", "Championship") },
  { rank: 21, label: "Ekstraklasa", pattern: comp("POLAND", "Ekstraklasa") },
  { rank: 22, label: "Superliga (Dinamarca)", pattern: comp("DENMARK", "Superliga") },
  { rank: 23, label: "Primera A (Colombia)", pattern: comp("COLOMBIA", "Primera A") },
  { rank: 24, label: "J1 League", pattern: comp("JAPAN", "J1 League") },
  { rank: 25, label: "Eliteserien", pattern: comp("NORWAY", "Eliteserien") },
  { rank: 26, label: "Liga Pro (Ecuador)", pattern: comp("ECUADOR", "Liga Pro") },
  { rank: 27, label: "Super League (Suiza)", pattern: comp("SWITZERLAND", "Super League") },
  { rank: 28, label: "HNL (Croacia)", pattern: comp("CROATIA", "HNL") },
  { rank: 29, label: "MLS", pattern: comp("USA", "MLS") },
  { rank: 30, label: "Primera División (Paraguay)", pattern: comp("PARAGUAY", "Copa de Primera") },
  { rank: 31, label: "Liga MX", pattern: comp("MEXICO", "Liga MX") },
  { rank: 32, label: "Eredivisie", pattern: comp("NETHERLANDS", "Eredivisie") },
  { rank: 33, label: "LaLiga 2", pattern: comp("SPAIN", "LaLiga2") },
  { rank: 34, label: "Chance Liga (Chequia)", pattern: comp("CZECH REPUBLIC", "Chance Liga") },
  { rank: 35, label: "Süper Lig", pattern: comp("TURKEY", "Super Lig") },
];

export const TOP_SOURCE =
  "Continentales: jerarquía oficial de UEFA y CONMEBOL. Ligas: ranking de Opta de julio de 2026 (The Analyst; lista de Récord, 29 jul). Del puesto 11 en adelante los reportes difieren y el orden es aproximado.";

export function topCompetition(competition: string): TopCompetition | null {
  if (/women|femen|u1\d|u2\d|sub-\d|reserv|youth|juvenil/i.test(competition)) return null;
  return TOP_COMPETITIONS.find((item) => item.pattern.test(competition)) ?? null;
}

/** Hasta `limit` partidos de las competiciones de mayor nivel: por puesto y, a igual puesto, por hora. */
export function topMatches<T extends { competition: string; kickoff: string }>(rows: T[], limit = 20): (T & { top: TopCompetition })[] {
  return rows
    .flatMap((row) => {
      const top = topCompetition(row.competition);
      return top ? [{ ...row, top }] : [];
    })
    .sort((a, b) => a.top.rank - b.top.rank || a.kickoff.localeCompare(b.kickoff))
    .slice(0, limit);
}
