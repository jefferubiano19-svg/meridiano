import { useSyncExternalStore } from "react";

/* ---------------------------------------------------------------------------
 * "Mi apuesta": las selecciones que el usuario va agregando desde las fichas.
 * Vive solo en este navegador (localStorage). Si el navegador no deja guardar,
 * funciona igual mientras la página esté abierta.
 * ------------------------------------------------------------------------- */

export type Market = "home" | "draw" | "away" | "1X" | "X2" | "12";

export const MARKETS: { key: Market; label: string; short: string }[] = [
  { key: "home", label: "Local", short: "1" },
  { key: "draw", label: "Empate", short: "X" },
  { key: "away", label: "Visita", short: "2" },
  { key: "1X", label: "Local o empate", short: "1X" },
  { key: "X2", label: "Empate o visita", short: "X2" },
  { key: "12", label: "Local o visita", short: "12" },
];

export interface SlipLeg {
  id: string;
  market: Market;
  odds: string;
  /** "Local — Visita", para mostrarlo aunque el partido ya no esté en la agenda cargada. */
  label: string;
}

const KEY = "meridiano-apuesta";
const EMPTY: SlipLeg[] = [];
let memory: SlipLeg[] | null = null;
const listeners = new Set<() => void>();

function load(): SlipLeg[] {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as SlipLeg[]) : [];
    memory = Array.isArray(parsed) ? parsed.filter((leg) => leg && typeof leg.id === "string") : [];
  } catch {
    memory = [];
  }
  return memory;
}

function save(next: SlipLeg[]) {
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

export function useBetSlip(): SlipLeg[] {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}

export const betSlip = {
  /** Agrega o cambia la selección de un partido (un partido, una selección). */
  put(id: string, market: Market, label: string) {
    const current = load();
    const found = current.find((leg) => leg.id === id);
    save(found ? current.map((leg) => (leg.id === id ? { ...leg, market } : leg)) : [...current, { id, market, odds: "", label }]);
  },
  update(id: string, change: Partial<Pick<SlipLeg, "market" | "odds">>) {
    save(load().map((leg) => (leg.id === id ? { ...leg, ...change } : leg)));
  },
  remove(id: string) {
    save(load().filter((leg) => leg.id !== id));
  },
  clear() {
    save([]);
  },
};
