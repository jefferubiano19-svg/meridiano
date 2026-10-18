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

export const VALUE_MIN_EV = 0.03;
export const VALUE_MAX_EV = 0.15;
export const VALUE_MIN_HOUSES = 3;

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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function validOffers(offers: Offer[]): Offer[] {
  return offers.filter((offer) => offer.odds.length >= 3 && offer.odds.slice(0, 3).every((price) => price > 1));
}

/** Consenso de las casas: probabilidad sin margen (Shin) de cada casa y la mediana por resultado. */
export function consensusFromOffers(offers: Offer[]): [number, number, number] | null {
  const fairs = validOffers(offers)
    .map((offer) => shin(offer.odds[0], offer.odds[1], offer.odds[2]))
    .filter((fair): fair is NonNullable<typeof fair> => Boolean(fair));
  if (fairs.length < VALUE_MIN_HOUSES) return null;
  const raw = [median(fairs.map((f) => f.home)), median(fairs.map((f) => f.draw)), median(fairs.map((f) => f.away))];
  const sum = raw[0] + raw[1] + raw[2];
  return [raw[0] / sum, raw[1] / sum, raw[2] / sum];
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
export function valuePicks(probs: number[], best: { house: string; odds: number }[], houses: number): ValuePick[] {
  if (houses < VALUE_MIN_HOUSES || probs.length < 3 || best.length < 3) return [];
  const out: ValuePick[] = [];
  for (const index of [0, 1, 2] as const) {
    const prob = probs[index];
    const { house, odds } = best[index];
    if (!(prob > 0) || !(odds > 1)) continue;
    const ev = prob * odds - 1;
    if (ev < VALUE_MIN_EV || ev > VALUE_MAX_EV) continue;
    out.push({ outcomeIndex: index, prob, house, odds, ev, fair: 1 / prob, minOdds: (1 + VALUE_MIN_EV) / prob });
  }
  return out;
}
