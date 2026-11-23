/* ---------------------------------------------------------------------------
 * La matemática del dinero de Meridiano, en un solo lugar (regla ub-mode: «una decisión vive en un lugar»).
 * Antes estaba repetida en valor.ts, review.ts, scripts/corte.mjs, /valor y «Mis apuestas».
 *
 * Una selección es un mercado y un resultado. Los mercados:
 *  - 1x2: 0 = local, 1 = empate, 2 = visita.
 *  - dc (doble oportunidad): 0 = 1X, 1 = 12, 2 = X2. Gana si sale cualquiera de los dos resultados.
 *  - dnb (empate no válido): 0 = local, 2 = visita. Si empata se devuelve lo apostado.
 * Las probabilidades son las del consenso 1X2 [local, empate, visita].
 * ------------------------------------------------------------------------- */

/** Valor mínimo por apuesta para que una selección cuente: +3 %. */
export const MIN_EV = 0.03;

/** Las 5 casas colombianas que se leen (nombre como lo escribe Flashscore). */
export const COLOMBIAN_HOUSE = /^(wplay\.co|betano\.co|stake\.latam|bwin\.co|betplay)$/i;

export type Outcome = 0 | 1 | 2;
export type Selection =
  | { market: "1x2"; outcomeIndex: Outcome }
  | { market: "dc"; outcomeIndex: Outcome }
  | { market: "dnb"; outcomeIndex: 0 | 2 };
export type Probs = readonly number[];

/** Resultados que cubre cada doble oportunidad. */
const DC_COVERS: readonly (readonly Outcome[])[] = [
  [0, 1],
  [0, 2],
  [1, 2],
];

/** Probabilidad de ganar la apuesta (sin contar la devolución del empate no válido). */
export function winProb(selection: Selection, probs: Probs): number {
  if (selection.market === "dc") return DC_COVERS[selection.outcomeIndex].reduce((sum: number, outcome) => sum + probs[outcome], 0);
  return probs[selection.outcomeIndex];
}

/** Probabilidad de que se devuelva lo apostado: el empate en empate no válido; 0 en lo demás. */
export function refundProb(selection: Selection, probs: Probs): number {
  return selection.market === "dnb" ? probs[1] : 0;
}

/** Valor por unidad apostada: probabilidad de ganar × cuota + probabilidad de devolución − 1. */
export function expectedValue(selection: Selection, probs: Probs, odds: number): number {
  return winProb(selection, probs) * odds + refundProb(selection, probs) - 1;
}

/** Cuota sin ventaja para nadie (valor 0). */
export function fairOdds(selection: Selection, probs: Probs): number {
  return (1 - refundProb(selection, probs)) / winProb(selection, probs);
}

/** Cuota desde la que la selección da +3 %. */
export function minOdds(selection: Selection, probs: Probs): number {
  return (1 + MIN_EV - refundProb(selection, probs)) / winProb(selection, probs);
}

/** Selección ya registrada: probabilidad de ganar y, en empate no válido, de empate. */
export interface StoredPick {
  market?: string | null;
  prob: number;
  pDraw?: number | null;
}

const storedRefund = (pick: StoredPick) => (pick.market === "dnb" ? (pick.pDraw ?? 0) : 0);

/** Cuota mínima de una selección registrada (correo del corte, /valor). Igual a minOdds con el consenso de entonces. */
export function pickMinOdds(pick: StoredPick): number {
  return (1 + MIN_EV - storedRefund(pick)) / pick.prob;
}

/** Cuota justa de una selección registrada. */
export function pickFairOdds(pick: StoredPick): number {
  return (1 - storedRefund(pick)) / pick.prob;
}

/**
 * ¿La cuota llega a la mínima? Con la mínima redondeada a 2 decimales, como se muestra (1,14 contra 1,1401 sigue con
 * valor). Lo usan el aviso «ya no tiene valor» del cierre y /valor.
 */
export function stillValuable(odds: number, minimum: number): boolean {
  return odds + 0.005 >= minimum;
}

/** Ganancia por unidad apostada con el resultado final (0 = ganó el local, 1 = empate, 2 = ganó la visita). */
export function settle(selection: Selection, odds: number, winner: Outcome): number {
  if (selection.market === "dnb" && winner === 1) return 0;
  const won = selection.market === "dc" ? DC_COVERS[selection.outcomeIndex].includes(winner) : winner === selection.outcomeIndex;
  return won ? odds - 1 : -1;
}

/** Reparte a suma 1. */
export function normalize(values: readonly number[]): [number, number, number] {
  const sum = values[0] + values[1] + values[2];
  return [values[0] / sum, values[1] / sum, values[2] / sum];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface FairThreeWay {
  home: number;
  draw: number;
  away: number;
}

/** Mediana de cada resultado entre casas ya sin margen, sin normalizar. */
export function medians(fairs: readonly FairThreeWay[]): [number, number, number] {
  return [median(fairs.map((fair) => fair.home)), median(fairs.map((fair) => fair.draw)), median(fairs.map((fair) => fair.away))];
}

/** Consenso: mediana de cada resultado entre 3+ casas sin margen, normalizada. Sin 3 casas, null. */
export function medianConsensus(fairs: readonly FairThreeWay[]): [number, number, number] | null {
  if (fairs.length < 3) return null;
  return normalize(medians(fairs));
}
