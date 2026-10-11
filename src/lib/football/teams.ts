import snapshot from "../../../data/snapshot.json";
import type { LeagueId, Team } from "./types";

export const DATA_FETCHED_AT = snapshot.fetchedAt;
export const DATA_SOURCES = snapshot.sources;

/** Selecciones: el nombre publicado por ESPN está en inglés. En pantalla va el nombre en español. */
const NOMBRE_ES: Record<string, string> = {
  Algeria: "Argelia",
  Azerbaijan: "Azerbaiyán",
  Belarus: "Bielorrusia",
  Belgium: "Bélgica",
  Benin: "Benín",
  "Bosnia-Herzegovina": "Bosnia y Herzegovina",
  Brazil: "Brasil",
  Cameroon: "Camerún",
  Canada: "Canadá",
  China: "China",
  Comoros: "Comoras",
  "Congo DR": "RD Congo",
  Croatia: "Croacia",
  Cyprus: "Chipre",
  Czechia: "Chequia",
  Denmark: "Dinamarca",
  Egypt: "Egipto",
  England: "Inglaterra",
  "Faroe Islands": "Islas Feroe",
  Finland: "Finlandia",
  France: "Francia",
  Germany: "Alemania",
  Greece: "Grecia",
  Hungary: "Hungría",
  Iceland: "Islandia",
  Italy: "Italia",
  "Ivory Coast": "Costa de Marfil",
  Jordan: "Jordania",
  Kazakhstan: "Kazajistán",
  Kenya: "Kenia",
  "Kyrgyz Republic": "Kirguistán",
  Latvia: "Letonia",
  Lebanon: "Líbano",
  Lithuania: "Lituania",
  Luxembourg: "Luxemburgo",
  Mauritius: "Mauricio",
  Mexico: "México",
  Moldova: "Moldavia",
  Morocco: "Marruecos",
  Netherlands: "Países Bajos",
  Niger: "Níger",
  "North Macedonia": "Macedonia del Norte",
  "Northern Ireland": "Irlanda del Norte",
  Norway: "Noruega",
  Peru: "Perú",
  Poland: "Polonia",
  "Republic of Ireland": "Irlanda",
  Romania: "Rumanía",
  Russia: "Rusia",
  Rwanda: "Ruanda",
  Scotland: "Escocia",
  Slovakia: "Eslovaquia",
  Slovenia: "Eslovenia",
  "South Africa": "Sudáfrica",
  "South Korea": "Corea del Sur",
  Spain: "España",
  "Sri Lanka": "Sri Lanka",
  Sweden: "Suecia",
  Switzerland: "Suiza",
  Tajikistan: "Tayikistán",
  Tunisia: "Túnez",
  Türkiye: "Turquía",
  Ukraine: "Ucrania",
  "United States": "Estados Unidos",
  Uzbekistan: "Uzbekistán",
  Wales: "Gales",
};

function enEspanol(team: Team): Team {
  const name = NOMBRE_ES[team.name];
  return name ? { ...team, name } : team;
}

export const TEAMS: Team[] = (snapshot.teams as Team[]).map(enEspanol);

export const TEAM_BY_ID: Record<string, Team> = Object.fromEntries(
  TEAMS.map((team) => [team.id, team]),
);

export function getTeam(id: string): Team {
  const team = TEAM_BY_ID[id];
  if (!team) throw new Error(`Equipo no encontrado: ${id}`);
  return team;
}

export function teamsInLeague(leagueId: LeagueId): Team[] {
  return TEAMS.filter((team) => team.leagueId === leagueId).sort((a, b) => {
    if (a.table !== b.table) return a.table.localeCompare(b.table);
    if (b.pts !== a.pts) return b.pts - a.pts;
    const gdA = a.gf - a.ga;
    const gdB = b.gf - b.ga;
    if (gdB !== gdA) return gdB - gdA;
    return b.gf - a.gf;
  });
}
