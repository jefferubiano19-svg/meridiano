import cierresFile from "../../../data/cierres.json";
import comboFile from "../../../data/combo-odds.json";
import vigentesFile from "../../../data/vigentes.json";

/* ---------------------------------------------------------------------------
 * Cuota vigente: la lectura 1X2 más reciente de un partido con selección de «Valor del día», hecha cada hora
 * por cierre.yml (data/vigentes.json, de 130 min a 24 h antes; data/cierres.json, de 10 a 130 min antes).
 * Solo informa en la página /valor si la selección sigue con valor; no cambia ninguna probabilidad.
 * ------------------------------------------------------------------------- */

export interface CurrentOdds {
  readAt: string;
  offers: { house: string; odds: number[] }[];
  /** Doble oportunidad y empate no válido, si la lectura los trajo. */
  double?: { dc: { house: string; odds: number[] }[]; dnb: { house: string; odds: number[] }[] } | null;
}

type Book = { house: string; odds: number[] };
type Row = { kickoff?: string; readAt?: string; books?: Book[]; double?: { dc?: Book[]; dnb?: Book[] } };
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
  const clean = (books: Book[] | undefined, cells: number) =>
    (books ?? [])
      .filter((book) => HOUSES.test(String(book.house).trim()) && Array.isArray(book.odds) && book.odds.length === cells && book.odds.every((price) => price > 1))
      .map((book) => ({ house: String(book.house).replace(/\.(co|latam|com)$/i, ""), odds: book.odds }));
  const double = best.double ? { dc: clean(best.double.dc, 3), dnb: clean(best.double.dnb, 2) } : null;
  return offers.length ? { readAt: best.readAt, offers, double } : null;
}

type ComboItem = { id: string; readAtBogota?: string; doubleReadAt?: string; markets?: Record<string, { house: string; cells?: { text: string; withdrawn?: boolean }[] }[]> };
const comboById = new Map(((comboFile as { matches?: ComboItem[] }).matches ?? []).map((item) => [item.id, item]));

/** Doble oportunidad y empate no válido leídos en el último corte (data/combo-odds.json), casas colombianas. */
export function doubleOffers(matchId: string): { readAt: string | null; dc: Book[]; dnb: Book[] } | null {
  const item = comboById.get(matchId);
  if (!item?.markets) return null;
  const read = (key: string, cells: number) =>
    (item.markets?.[key] ?? [])
      .filter((book) => HOUSES.test(String(book.house).trim()) && Array.isArray(book.cells) && book.cells.length === cells && !book.cells.some((cell) => cell.withdrawn))
      .map((book) => ({ house: String(book.house).replace(/\.(co|latam|com)$/i, ""), odds: (book.cells ?? []).map((cell) => Number(cell.text)) }))
      .filter((book) => book.odds.every((price) => price > 1));
  const dc = read("dc", 3);
  const dnb = read("dnb", 2);
  if (!dc.length && !dnb.length) return null;
  return { readAt: item.doubleReadAt ?? item.readAtBogota ?? null, dc, dnb };
}
