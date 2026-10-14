/* ---------------------------------------------------------------------------
 * Limpieza de las cuotas 1X2 de Wplay leídas en la versión Lite.
 *
 * Error corregido el 13 oct 2026: el lector buscaba la caja de cuotas en los 2.500
 * caracteres siguientes a cada partido. Si un partido no traía cuotas, se quedaba con
 * las del partido siguiente de la misma liga. Ejemplo: UNAN-Managua – Diriangén
 * recibió 1.15 / 6 / 15, que eran de Managua – San Marcos (la casa pagaba 4.70 / 3.65 / 1.65).
 * En el archivo del 13 oct, 66 de 396 filas estaban en grupos copiados así.
 *
 * Desde el arreglo, cada fila nueva lleva v: 2 (lector acotado al propio partido).
 * Las filas viejas (sin v: 2) que comparten hora de lectura y las tres cuotas exactas
 * con otra fila se descartan todas: no se puede saber cuál era la real, y descartar
 * no inventa nada (el partido queda con consenso, con modelo o sin dato).
 * ------------------------------------------------------------------------- */

export interface WplayRow {
  odds: number[];
  readAt: string;
  /** 2 = leída con el lector acotado al propio partido. */
  v?: number;
}

export const WPLAY_READER_VERSION = 2;

export function cleanWplay(byId: Record<string, WplayRow>): { kept: Record<string, WplayRow>; dropped: string[] } {
  const groups = new Map<string, string[]>();
  for (const [id, row] of Object.entries(byId)) {
    if (!row || !Array.isArray(row.odds) || row.odds.length < 3) continue;
    if (row.v === WPLAY_READER_VERSION) continue;
    const key = `${row.readAt}|${row.odds.slice(0, 3).join("/")}`;
    const list = groups.get(key) ?? [];
    list.push(id);
    groups.set(key, list);
  }
  const dropped = new Set<string>();
  for (const list of groups.values()) if (list.length > 1) for (const id of list) dropped.add(id);
  const kept: Record<string, WplayRow> = {};
  for (const [id, row] of Object.entries(byId)) {
    if (!row || !Array.isArray(row.odds) || row.odds.length < 3) continue;
    if (dropped.has(id)) continue;
    kept[id] = row;
  }
  return { kept, dropped: [...dropped] };
}
