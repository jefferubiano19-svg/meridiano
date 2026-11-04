import cierresFile from "../../../data/cierres.json";
import vigentesFile from "../../../data/vigentes.json";

/* ---------------------------------------------------------------------------
 * Cuota vigente: la lectura 1X2 más reciente de un partido con selección de «Valor del día», hecha cada hora
 * por cierre.yml (data/vigentes.json, de 130 min a 24 h antes; data/cierres.json, de 10 a 130 min antes).
 * Solo informa en la página /valor si la selección sigue con valor; no cambia ninguna probabilidad.
 * ------------------------------------------------------------------------- */

export interface CurrentOdds {
  readAt: string;
  offers: { house: string; odds: number[] }[];
}

type Row = { kickoff?: string; readAt?: string; books?: { house: string; odds: number[] }[] };
const HOUSES = /^(wplay\.co|betano\.co|stake\.latam|bwin\.co|betplay)$/i;

const sources = [
  (vigentesFile as { byMatch?: Record<string, Row> }).byMatch ?? {},
  (cierresFile as { byMatch?: Record<string, Row> }).byMatch ?? {},
];

export function currentOdds(matchId: string): CurrentOdds | null {
  let best: Row | null = null;
  for (const source of sources) {
    const row = source[matchId];
    if (row?.readAt && Array.isArray(row.books) && (!best || String(row.readAt) > String(best.readAt))) best = row;
  }
  if (!best?.readAt || !best.books) return null;
  const offers = best.books
    .filter((book) => HOUSES.test(String(book.house).trim()) && Array.isArray(book.odds) && book.odds.length === 3 && book.odds.every((price) => price > 1))
    .map((book) => ({ house: String(book.house).replace(/\.(co|latam|com)$/i, ""), odds: book.odds.slice(0, 3) }));
  return offers.length ? { readAt: best.readAt, offers } : null;
}
