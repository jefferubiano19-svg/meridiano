import { useSyncExternalStore } from "react";

/* ---------------------------------------------------------------------------
 * «Mis apuestas»: las apuestas reales que el usuario anota (casa, cuota, monto, resultado) para comparar su
 * resultado con el de Meridiano. Vive solo en este navegador (localStorage); no se envía a ningún servidor.
 * Si el navegador no deja guardar, funciona mientras la página esté abierta.
 * ------------------------------------------------------------------------- */

export type BetResult = "pendiente" | "ganada" | "perdida" | "devuelta";

export interface MyBet {
  id: string;
  /** Día de la apuesta (AAAA-MM-DD). */
  date: string;
  match: string;
  market: string;
  selection: string;
  house: string;
  odds: number;
  stake: number;
  result: BetResult;
  /** Combinada (varias selecciones en un boleto). Cuota y monto son los del boleto completo. */
  combo: boolean;
  /** Número de selecciones de la combinada. */
  legs?: number;
  /** Si viene de «Valor del día»: casa indicada, cuota mínima y probabilidad de ganarse. */
  valor?: { house: string; minOdds: number; prob: number; matchId: string } | null;
  note?: string;
}

/** Datos para empezar una apuesta desde «Valor del día» (no se guardan hasta que el usuario confirma). */
export type BetDraft = Omit<MyBet, "id" | "stake" | "result">;

const KEY = "meridiano-mis-apuestas";
const EMPTY: MyBet[] = [];
let memory: MyBet[] | null = null;
let draft: BetDraft | null = null;
const listeners = new Set<() => void>();

function valid(bet: MyBet): boolean {
  return Boolean(bet) && typeof bet.id === "string" && Number(bet.odds) > 1 && Number(bet.stake) > 0;
}

function load(): MyBet[] {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as MyBet[]) : [];
    memory = Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    memory = [];
  }
  return memory;
}

function save(next: MyBet[]) {
  memory = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* sin almacenamiento: queda en memoria */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      memory = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useMyBets(): MyBet[] {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}

export const myBets = {
  add(bet: Omit<MyBet, "id">) {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    save([{ ...bet, id }, ...load()]);
  },
  update(id: string, change: Partial<Omit<MyBet, "id">>) {
    save(load().map((bet) => (bet.id === id ? { ...bet, ...change } : bet)));
  },
  remove(id: string) {
    save(load().filter((bet) => bet.id !== id));
  },
  /** Deja lista una apuesta de «Valor del día» para que la página la muestre en el formulario. */
  setDraft(next: BetDraft) {
    draft = next;
  },
  takeDraft(): BetDraft | null {
    const out = draft;
    draft = null;
    return out;
  },
};

/** Ganancia neta de una apuesta resuelta (null si está pendiente). */
export function profitOf(bet: MyBet): number | null {
  if (bet.result === "pendiente") return null;
  if (bet.result === "ganada") return bet.stake * (bet.odds - 1);
  if (bet.result === "devuelta") return 0;
  return -bet.stake;
}

/** ¿Siguió las reglas de «Valor del día»? Sola, en la casa indicada y a la cuota mínima o más. */
export function followedRules(bet: MyBet): boolean {
  if (bet.combo || !bet.valor) return false;
  const sameHouse = bet.house.trim().toLowerCase().replace(/\.(co|latam|com)$/i, "") === bet.valor.house.trim().toLowerCase().replace(/\.(co|latam|com)$/i, "");
  return sameHouse && bet.odds + 1e-9 >= bet.valor.minOdds;
}
