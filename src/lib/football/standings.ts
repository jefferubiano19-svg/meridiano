import file from "../../../data/standings-2026-10-10.json";

/* ---------------------------------------------------------------------------
 * Tabla de posiciones de la temporada (Nivel B) y nombres en español.
 * Fuente: www.flashscore.co, página de cada liga, leída el 10 oct 2026.
 * La tabla de Flashscore en español usa los nombres que se ven en las casas
 * colombianas (Real Betis, Atlético de Madrid, Niza…). La agenda usa los de
 * Flashscore Lite (Betis, Atl. Madrid, Nice…). Aquí se emparejan.
 * ------------------------------------------------------------------------- */

interface Row {
  team: string;
  gp: number;
  gf: number;
  ga: number;
}

interface League {
  league: string;
  tables?: { general?: { rows?: Row[] } };
}

const data = file as unknown as { readAtBogota: string; leagues: League[] };

/** Momento de la lectura de la tabla. Lo jugado después se suma desde la agenda. */
export const TABLE_READ_MS = Date.parse(data.readAtBogota);

/** Liga de la tabla → competición de la agenda (con o sin fase, p. ej. " - Clausura"). */
const TABLE_TO_AGENDA: Record<string, string> = {
  "ESPAÑA: LaLiga EA Sports": "SPAIN: LaLiga",
  "FRANCIA: Ligue 1": "FRANCE: Ligue 1",
  "PAÍSES BAJOS: Eredivisie": "NETHERLANDS: Eredivisie",
  "PORTUGAL: Liga Portugal": "PORTUGAL: Liga Portugal",
  "BRASIL: Serie A Betano": "BRAZIL: Serie A Betano",
  "MÉXICO: Liga MX": "MEXICO: Liga MX",
  "COLOMBIA: Liga Betplay": "COLOMBIA: Primera A",
  "ESTADOS UNIDOS: MLS": "USA: MLS",
};

/** Nombre en la agenda → nombre en la tabla, cuando no coinciden solos. Verificados uno por uno. */
const ALIASES: Record<string, Record<string, string>> = {
  "FRANCE: Ligue 1": { Nice: "Niza", Strasbourg: "Estrasburgo", Rennes: "Stade Rennais", Marseille: "Marsella" },
  "SPAIN: LaLiga": {
    "Ath Bilbao": "Athletic Club",
    "Atl. Madrid": "Atlético de Madrid",
    "Dep. A Coruna": "Deportivo de A Coruña",
    "Racing Santander": "R. Racing Club",
  },
  "PORTUGAL: Liga Portugal": { "FC Porto": "Oporto" },
  "BRAZIL: Serie A Betano": { "Botafogo RJ": "Botafogo", "Flamengo RJ": "Flamengo" },
  "MEXICO: Liga MX": {
    "Guadalajara Chivas": "Guadalajara",
    "Atl. San Luis": "Atlético de San Luis",
    "UNAM Pumas": "Pumas UNAM",
  },
  "COLOMBIA: Primera A": {
    "Dep. Cali": "Deportivo Cali",
    Aguilas: "Águilas Doradas",
    "Deportes Tolima": "Tolima",
    Chico: "Boyacá Chicó",
    Bucaramanga: "Atl. Bucaramanga",
    "Santa Fe": "Ind. Santa Fe",
  },
};

const STOP = new Set(["fc", "cf", "cd", "club", "de", "sc", "ac", "as", "ud", "sd", "ca", "real", "the"]);

function key(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOP.has(word))
    .join(" ");
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const TABLES = data.leagues.flatMap((league) => {
  const competition = TABLE_TO_AGENDA[league.league];
  const rows = league.tables?.general?.rows ?? [];
  if (!competition || rows.length === 0) return [];
  return [
    {
      competition,
      pattern: new RegExp(`^${escapeRe(competition)}(?: - .*)?$`, "i"),
      byKey: new Map(rows.map((row) => [key(row.team), row])),
      byName: new Map(rows.map((row) => [row.team, row])),
    },
  ];
});

function tableFor(competition: string) {
  return TABLES.find((table) => table.pattern.test(competition.trim())) ?? null;
}

/** Fila de la tabla de ese equipo en esa liga, o null si la liga o el nombre no tienen pareja segura. */
export function tableRow(competition: string, team: string): Row | null {
  const table = tableFor(competition);
  if (!table) return null;
  const alias = ALIASES[table.competition]?.[team];
  return (alias ? table.byName.get(alias) : undefined) ?? table.byKey.get(key(team)) ?? null;
}

/** Nombre en español de la tabla, solo si se escribe distinto al de la agenda. */
export function spanishName(competition: string, team: string): string | null {
  const row = tableRow(competition, team);
  if (!row) return null;
  const plain = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  return plain(row.team) === plain(team) ? null : row.team;
}
