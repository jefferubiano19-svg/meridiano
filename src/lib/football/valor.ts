/* ---------------------------------------------------------------------------
 * «Valor del día»: resultados donde la mejor cuota entre las casas paga más de lo que vale
 * según el consenso de las casas (Shin, mediana). Lo usan la página /valor y el corte (que guarda
 * cada selección la primera vez que aparece en data/valor-registro.json para medirla después).
 *
 * Reglas:
 *  - 3 o más casas con cuota 1X2 vigente (sin eso no hay consenso confiable).
 *  - Valor por cada $100 = probabilidad × mejor cuota − 1, entre +3 % y +15 %.
 *    Menos de 3 %: dentro del error. Más de 15 %: casi siempre una cuota vieja o mal leída.
 *  - Cuota mínima = (1 + 3 %) ÷ probabilidad: por debajo de eso, la selección ya no tiene valor.
 * No es una recomendación; la ventaja no está demostrada (la mide la página Modelo).
 * ------------------------------------------------------------------------- */

import { shin } from "./engine";
import { adjustFavorite } from "./favorites";
import { expectedValue, fairOdds, medianConsensus, MIN_EV, minOdds, winProb, type Selection } from "./mercados";

export const VALUE_MIN_EV = MIN_EV;
export const VALUE_MAX_EV = 0.15;
export const VALUE_MIN_HOUSES = 3;
/**
 * Regla del 5 nov 2026: solo resultados que se cumplen 40 % o más de las veces. Con 195 selecciones resueltas al 4 nov,
 * las de 40 %+ ganaron 22 de 39 (+17 % en plata) y las de menos de 20 %, 5 de 73 (−42 %); todas con valor al cierre.
 * El valor no cambia con el nivel; cambia cuántas se ganan. Se mide aparte desde esa fecha (review.ts → pickTiers).
 */
export const VALUE_MIN_PROB = 0.4;
export const VALUE_RULE_SINCE = "2026-11-05";

export interface Offer {
  house: string;
  /** Cuotas 1, X, 2. */
  odds: number[];
}

export interface ValuePick {
  outcomeIndex: 0 | 1 | 2;
  prob: number;
  house: string;
  odds: number;
  ev: number;
  fair: number;
  minOdds: number;
}

function validOffers(offers: Offer[]): Offer[] {
  return offers.filter((offer) => offer.odds.length >= 3 && offer.odds.slice(0, 3).every((price) => price > 1));
}

/** Consenso de las casas: probabilidad sin margen (Shin) de cada casa y la mediana por resultado. */
export function consensusFromOffers(offers: Offer[]): [number, number, number] | null {
  const fairs = validOffers(offers)
    .map((offer) => shin(offer.odds[0], offer.odds[1], offer.odds[2]))
    .filter((fair): fair is NonNullable<typeof fair> => Boolean(fair));
  return fairs.length < VALUE_MIN_HOUSES ? null : medianConsensus(fairs);
}

/**
 * ¿Entra en «Valor del día»? Probabilidad de ganar al mínimo o más y valor entre +3 % y +15 %. Una probabilidad de 0
 * da valor −100 % y una vacía (NaN) no pasa ninguna comparación: no hacen falta revisiones aparte.
 */
function qualifies(prob: number, ev: number, minProb: number): boolean {
  return prob >= minProb && ev >= VALUE_MIN_EV && ev <= VALUE_MAX_EV;
}

/** Mejor cuota de cada resultado entre las ofertas. */
export function bestFromOffers(offers: Offer[]): { house: string; odds: number }[] | null {
  const valid = validOffers(offers);
  if (valid.length < VALUE_MIN_HOUSES) return null;
  return [0, 1, 2].map((index) => {
    const top = valid.reduce((a, b) => (b.odds[index] > a.odds[index] ? b : a));
    return { house: top.house, odds: top.odds[index] };
  });
}

/** Selecciones con valor dados la probabilidad (consenso) y la mejor cuota de cada resultado. */
export function valuePicks(
  probs: number[],
  best: { house: string; odds: number }[],
  houses: number,
  minProb = VALUE_MIN_PROB,
): ValuePick[] {
  if (houses < VALUE_MIN_HOUSES || probs.length < 3 || best.length < 3) return [];
  const out: ValuePick[] = [];
  for (const index of [0, 1, 2] as const) {
    const selection: Selection = { market: "1x2", outcomeIndex: index };
    const { house, odds } = best[index];
    const prob = winProb(selection, probs);
    const ev = expectedValue(selection, probs, odds);
    // Una cuota de 1 o menos (o vacía) da valor negativo o NaN y no pasa qualifies: no hace falta revisarla aparte.
    if (!qualifies(prob, ev, minProb)) continue;
    out.push({ outcomeIndex: index, prob, house, odds, ev, fair: fairOdds(selection, probs), minOdds: minOdds(selection, probs) });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Doble oportunidad (1X · 12 · X2) y empate no válido (local · visita) desde el 5 nov 2026: resultados que se cumplen
 * más seguido. La probabilidad sale del mismo consenso 1X2 (no de las cuotas de estos mercados), y el valor se mide
 * igual: mejor cuota entre 3+ casas, entre +3 % y +15 %, y 40 % o más de probabilidad.
 *  - Doble oportunidad: prob = suma de los dos resultados cubiertos.
 *  - Empate no válido: si empata se devuelve lo apostado. Valor = prob. de ganar × cuota + prob. de empate − 1.
 * ------------------------------------------------------------------------- */

export type DoubleMarket = "dc" | "dnb";

export interface DoublePick {
  market: DoubleMarket;
  /** dc: 0 = 1X, 1 = 12, 2 = X2. dnb: 0 = local, 2 = visita. */
  outcomeIndex: 0 | 1 | 2;
  /** Probabilidad de ganar la apuesta (dc: cualquiera de los dos resultados; dnb: que gane ese equipo). */
  prob: number;
  /** Solo dnb: probabilidad de empate (se devuelve lo apostado). */
  pDraw: number;
  house: string;
  odds: number;
  ev: number;
  fair: number;
  minOdds: number;
}

function bestOf(offers: { house: string; odds: number[] }[], cells: number): { house: string; odds: number }[] | null {
  const valid = offers.filter((offer) => offer.odds.length === cells && offer.odds.every((price) => price > 1));
  if (valid.length < VALUE_MIN_HOUSES) return null;
  return Array.from({ length: cells }, (_, index) => {
    const top = valid.reduce((a, b) => (b.odds[index] > a.odds[index] ? b : a));
    return { house: top.house, odds: top.odds[index] };
  });
}

export function doublePicks(
  probs: number[],
  dc: { house: string; odds: number[] }[],
  dnb: { house: string; odds: number[] }[],
  minProb = VALUE_MIN_PROB,
): DoublePick[] {
  if (probs.length < 3) return [];
  const candidates: { selection: Exclude<Selection, { market: "1x2" }>; offer: { house: string; odds: number } }[] = [];
  const bestDc = bestOf(dc, 3);
  if (bestDc) for (const index of [0, 1, 2] as const) candidates.push({ selection: { market: "dc", outcomeIndex: index }, offer: bestDc[index] });
  const bestDnb = bestOf(dnb, 2);
  if (bestDnb) {
    candidates.push({ selection: { market: "dnb", outcomeIndex: 0 }, offer: bestDnb[0] });
    candidates.push({ selection: { market: "dnb", outcomeIndex: 2 }, offer: bestDnb[1] });
  }
  const out: DoublePick[] = [];
  for (const { selection, offer } of candidates) {
    const prob = winProb(selection, probs);
    const ev = expectedValue(selection, probs, offer.odds);
    if (!qualifies(prob, ev, minProb)) continue;
    out.push({
      market: selection.market,
      outcomeIndex: selection.outcomeIndex,
      prob,
      pDraw: selection.market === "dnb" ? probs[1] : 0,
      house: offer.house,
      odds: offer.odds,
      ev,
      fair: fairOdds(selection, probs),
      minOdds: minOdds(selection, probs),
    });
  }
  return out;
}

/** Nombre de la selección para mostrar. */
export function pickLabel(market: "1x2" | DoubleMarket, outcomeIndex: number, home: string, away: string): string {
  if (market === "dc") return outcomeIndex === 0 ? `${home} o empate` : outcomeIndex === 1 ? `${home} o ${away} (no empate)` : `Empate o ${away}`;
  if (market === "dnb") return `${outcomeIndex === 0 ? home : away} (empate no válido)`;
  return outcomeIndex === 0 ? home : outcomeIndex === 2 ? away : "Empate";
}

export const MARKET_NAME: Record<"1x2" | DoubleMarket, string> = {
  "1x2": "Resultado (1X2)",
  dc: "Doble oportunidad",
  dnb: "Empate no válido",
};

/* ---------------------------------------------------------------------------
 * «Favorito con valor» (EN PRUEBA desde el 5 nov 2026; no entra en «Valor del día» ni en el aviso).
 * Con la corrección de favoritos fuertes (favorites.ts), el favorito vale más de lo que dice el consenso. Si la mejor
 * cuota del favorito paga entre +3 % y +15 % sobre la probabilidad corregida, y esa probabilidad es de 65 % o más, se
 * registra aparte (data/favoritos-registro.json) y se mide con el resultado real (review.ts → favoriteResults).
 * ------------------------------------------------------------------------- */


export const FAVORITE_MIN_PROB = 0.65;

export interface FavoritePick {
  outcomeIndex: 0 | 2;
  /** Probabilidad corregida. */
  prob: number;
  /** Probabilidad del consenso (sin corregir). */
  probConsensus: number;
  house: string;
  odds: number;
  ev: number;
  minOdds: number;
}

export function favoritePick(
  probs: number[],
  best: { house: string; odds: number }[],
  houses: number,
  info: { home?: string; away?: string; competition?: string },
): FavoritePick | null {
  if (houses < VALUE_MIN_HOUSES || probs.length < 3 || best.length < 3) return null;
  const adjusted = adjustFavorite({ home: probs[0], draw: probs[1], away: probs[2] }, info);
  const index: 0 | 2 = adjusted.home >= adjusted.away ? 0 : 2;
  const prob = index === 0 ? adjusted.home : adjusted.away;
  if (prob < FAVORITE_MIN_PROB) return null;
  const { house, odds } = best[index];
  const selection: Selection = { market: "1x2", outcomeIndex: index };
  const corrected = [adjusted.home, adjusted.draw, adjusted.away];
  const ev = expectedValue(selection, corrected, odds);
  if (!qualifies(prob, ev, 0)) return null;
  return { outcomeIndex: index, prob, probConsensus: probs[index], house, odds, ev, minOdds: minOdds(selection, corrected) };
}
