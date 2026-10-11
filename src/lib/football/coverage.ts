export interface RankedLeague {
  rank: number;
  name: string;
  country: string;
  confederation: "UEFA" | "CONMEBOL" | "CONCACAF" | "AFC" | "CAF" | "OFC";
  modeled?: boolean;
}

/** Referencia de fuerza de liga, no una clasificación oficial de la FIFA. */
export const OPTA_RANK_2026: RankedLeague[] = [
  { rank: 1, name: "Premier League", country: "Inglaterra", confederation: "UEFA", modeled: true },
  { rank: 2, name: "Bundesliga", country: "Alemania", confederation: "UEFA", modeled: true },
  { rank: 3, name: "LaLiga", country: "España", confederation: "UEFA", modeled: true },
  { rank: 4, name: "Serie A", country: "Italia", confederation: "UEFA", modeled: true },
  { rank: 5, name: "Ligue 1", country: "Francia", confederation: "UEFA", modeled: true },
  { rank: 6, name: "Brasileirão", country: "Brasil", confederation: "CONMEBOL", modeled: true },
  { rank: 7, name: "Liga Profesional", country: "Argentina", confederation: "CONMEBOL", modeled: true },
  { rank: 8, name: "Jupiler Pro League", country: "Bélgica", confederation: "UEFA" },
  { rank: 9, name: "Primeira Liga", country: "Portugal", confederation: "UEFA", modeled: true },
  { rank: 10, name: "Championship", country: "Inglaterra", confederation: "UEFA" },
  { rank: 11, name: "Ekstraklasa", country: "Polonia", confederation: "UEFA" },
  { rank: 12, name: "J1 League", country: "Japón", confederation: "AFC" },
  { rank: 13, name: "Superligaen", country: "Dinamarca", confederation: "UEFA" },
  { rank: 14, name: "Prva HNL", country: "Croacia", confederation: "UEFA" },
  { rank: 15, name: "Süper Lig", country: "Turquía", confederation: "UEFA" },
  { rank: 16, name: "Eredivisie", country: "Países Bajos", confederation: "UEFA", modeled: true },
  { rank: 17, name: "Liga BetPlay", country: "Colombia", confederation: "CONMEBOL", modeled: true },
  { rank: 18, name: "Eliteserien", country: "Noruega", confederation: "UEFA" },
  { rank: 19, name: "Super League", country: "Suiza", confederation: "UEFA" },
  { rank: 20, name: "Liga Pro", country: "Ecuador", confederation: "CONMEBOL" },
  { rank: 21, name: "MLS", country: "EE. UU.", confederation: "CONCACAF", modeled: true },
  { rank: 22, name: "Primera División", country: "Paraguay", confederation: "CONMEBOL" },
  { rank: 23, name: "Liga MX", country: "México", confederation: "CONCACAF", modeled: true },
  { rank: 24, name: "Segunda División", country: "España", confederation: "UEFA" },
  { rank: 25, name: "Chance Liga", country: "Chequia", confederation: "UEFA" },
  { rank: 26, name: "Allsvenskan", country: "Suecia", confederation: "UEFA" },
  { rank: 27, name: "Super League", country: "Grecia", confederation: "UEFA" },
  { rank: 28, name: "Premier League", country: "Rusia", confederation: "UEFA" },
  { rank: 29, name: "Primera División", country: "Chile", confederation: "CONMEBOL" },
  { rank: 30, name: "K League 1", country: "Corea del Sur", confederation: "AFC" },
];

export const CONFEDERATIONS = [
  {
    id: "UEFA",
    region: "Europa",
    clubs: "Champions League, Europa League, Conference League",
    nations: "Eurocopa, Nations League",
  },
  {
    id: "CONMEBOL",
    region: "Sudamérica",
    clubs: "Libertadores, Sudamericana",
    nations: "Copa América",
  },
  {
    id: "CONCACAF",
    region: "Norte, Centroamérica y Caribe",
    clubs: "Liga de Campeones",
    nations: "Copa Oro",
  },
  {
    id: "CAF",
    region: "África",
    clubs: "Liga de Campeones",
    nations: "Copa Africana de Naciones",
  },
  {
    id: "AFC",
    region: "Asia",
    clubs: "Champions League Elite",
    nations: "Copa Asiática",
  },
  {
    id: "OFC",
    region: "Oceanía",
    clubs: "Liga de Campeones",
    nations: "Copa de Naciones",
  },
] as const;
