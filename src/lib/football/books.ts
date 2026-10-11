import data from "../../../data/book-odds.json";

export interface BookQuote {
  home: string;
  away: string;
  homeOdd: number;
  drawOdd: number;
  awayOdd: number;
  over25?: number | null;
  under25?: number | null;
  bttsYes?: number | null;
  bttsNo?: number | null;
  dc1x?: number | null;
  dc12?: number | null;
  dcx2?: number | null;
  cornersLine?: number | null;
  cornersOver?: number | null;
  cornersUnder?: number | null;
  url?: string | null;
  provider: string;
  wplayTime?: string;
}

export const BOOK_FETCHED_AT = (data as { fetchedAt: string }).fetchedAt;
export const BOOK_NOTES = ((data as { notes?: string[] }).notes ?? []) as string[];

const QUOTES = (data as { quotes: BookQuote[] }).quotes;
const STOP = new Set([
  "fc",
  "cf",
  "cd",
  "sc",
  "de",
  "del",
  "las",
  "los",
  "club",
  "deportivo",
  "atletico",
  "cali",
]);

function tokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length >= 4 && !STOP.has(part));
}

function sameTeam(leftName: string, rightName: string): boolean {
  const left = tokens(leftName);
  const right = new Set(tokens(rightName));
  if (!left.length || !right.size) return false;
  const shared = left.filter((token) => right.has(token));
  if (!shared.length) return false;
  const long = shared.filter((token) => token.length >= 5);
  return long.length > 0 || shared.length === left.length || left.length === 1;
}

export function findBook(home: string, away: string): BookQuote | null {
  for (const quote of QUOTES) {
    if (sameTeam(home, quote.home) && sameTeam(away, quote.away)) return quote;
  }
  return null;
}
