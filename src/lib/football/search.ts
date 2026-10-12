/* Buscador tolerante: sin tildes, sin mayúsculas, sin prefijos como FC, CD o Real,
 * y con nombres en español de países y de clubes conocidos. "Real Betis" encuentra "Betis". */

const STOP = new Set([
  "fc", "cf", "cd", "club", "de", "del", "la", "el", "sc", "ac", "as", "ud", "sd", "ca", "real", "the", "deportivo", "dep",
]);

/** País de la agenda (inglés) → español, para buscar "España", "Inglaterra", etc. */
const COUNTRY_ES: Record<string, string> = {
  SPAIN: "España",
  ENGLAND: "Inglaterra",
  ITALY: "Italia",
  GERMANY: "Alemania",
  FRANCE: "Francia",
  NETHERLANDS: "Países Bajos Holanda",
  PORTUGAL: "Portugal",
  BELGIUM: "Bélgica",
  TURKEY: "Turquía",
  SCOTLAND: "Escocia",
  BRAZIL: "Brasil",
  ARGENTINA: "Argentina",
  COLOMBIA: "Colombia",
  MEXICO: "México",
  USA: "Estados Unidos",
  CHILE: "Chile",
  PERU: "Perú",
  ECUADOR: "Ecuador",
  URUGUAY: "Uruguay",
  PARAGUAY: "Paraguay",
  VENEZUELA: "Venezuela",
  BOLIVIA: "Bolivia",
  SWITZERLAND: "Suiza",
  AUSTRIA: "Austria",
  GREECE: "Grecia",
  CHINA: "China",
  JAPAN: "Japón",
  "SAUDI ARABIA": "Arabia Saudita",
  WORLD: "Mundo",
  EUROPE: "Europa",
  "SOUTH AMERICA": "Sudamérica",
};

/** Nombres en español de clubes que Flashscore Lite escribe en inglés o abreviados. */
const CLUB_ES: Record<string, string> = {
  "Bayern Munich": "Bayern Múnich",
  "B. Monchengladbach": "Borussia Mönchengladbach",
  "Dortmund": "Borussia Dortmund",
  "FC Koln": "Colonia",
  Inter: "Inter de Milán",
  "AC Milan": "Milán",
  "AS Roma": "Roma",
  Napoli: "Nápoles",
  Bologna: "Bolonia",
  Fiorentina: "Florencia",
  Genoa: "Génova",
  Torino: "Turín",
  Venezia: "Venecia",
  Juventus: "Juve",
  "Sporting CP": "Sporting de Lisboa",
  "FC Porto": "Oporto",
  "St. Liege": "Standard de Lieja",
  "Crvena zvezda": "Estrella Roja",
  "Ath Bilbao": "Athletic Club Bilbao",
  "Atl. Madrid": "Atlético de Madrid",
  "Manchester Utd": "Manchester United",
  "Nottingham": "Nottingham Forest",
};

function tokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

export function searchText(parts: (string | null | undefined)[]): string {
  const extra: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    const country = part.includes(":") ? part.slice(0, part.indexOf(":")).trim().toUpperCase() : "";
    if (country && COUNTRY_ES[country]) extra.push(COUNTRY_ES[country]);
    if (CLUB_ES[part]) extra.push(CLUB_ES[part]);
  }
  return [...parts.filter(Boolean), ...extra].join(" ");
}

/** Cada palabra útil de la búsqueda debe aparecer al inicio de alguna palabra del partido. */
export function matchesSearch(query: string, haystack: string): boolean {
  const all = tokens(query);
  if (all.length === 0) return true;
  const wanted = all.filter((token) => !STOP.has(token));
  const have = tokens(haystack);
  if (wanted.length === 0) return all.every((token) => have.includes(token));
  if (wanted.every((token) => have.some((word) => word.startsWith(token)))) return true;
  // Palabras juntas o separadas: "la liga" encuentra "LaLiga" y "laliga" encuentra "La Liga".
  const compact = all.join("");
  for (let i = 0; i < have.length; i += 1) {
    let joined = "";
    for (let j = i; j < have.length && joined.length < compact.length; j += 1) joined += have[j];
    if (joined.startsWith(compact)) return true;
  }
  return false;
}
