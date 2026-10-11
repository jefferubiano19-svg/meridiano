import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Currency } from "@/lib/football/format";
import type { ConfidenceLabel, MarketOdds } from "@/lib/football/types";

export interface StakeLog {
  id: string;
  fixtureId: string;
  market: string;
  odds: number;
  stake: number;
  ev: number;
  result: "pendiente" | "ganada" | "perdida" | "nula";
  pnl: number;
  at: number;
}

interface SessionState {
  ageConfirmed: boolean;
  confirmAge: () => void;
  bankroll: number;
  currency: Currency;
  unitPercent: number;
  kellyFraction: number;
  maxStakePercent: number;
  minEv: number;
  minConfidence: ConfidenceLabel;
  dailyLossLimit: number;
  weeklyLossLimit: number;
  coolingOffUntil: number | null;
  watchlist: string[];
  customOdds: Record<string, Partial<MarketOdds>>;
  logs: StakeLog[];
  setBankroll: (n: number) => void;
  setCurrency: (c: Currency) => void;
  setUnitPercent: (n: number) => void;
  setKellyFraction: (n: number) => void;
  setMaxStakePercent: (n: number) => void;
  setMinEv: (n: number) => void;
  setMinConfidence: (c: ConfidenceLabel) => void;
  setDailyLossLimit: (n: number) => void;
  setWeeklyLossLimit: (n: number) => void;
  startCoolingOff: (hours: number) => void;
  clearCoolingOff: () => void;
  toggleWatch: (id: string) => void;
  setCustomOdds: (fixtureId: string, odds: Partial<MarketOdds>) => void;
  addLog: (log: Omit<StakeLog, "id" | "at" | "result" | "pnl">) => void;
  settleLog: (id: string, result: StakeLog["result"]) => void;
  resetJournal: () => void;
}

function pnlFor(result: StakeLog["result"], stake: number, odds: number): number {
  if (result === "ganada") return Math.round(stake * (odds - 1) * 100) / 100;
  if (result === "perdida") return -stake;
  return 0;
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      ageConfirmed: false,
      confirmAge: () => set({ ageConfirmed: true }),
      bankroll: 1000,
      currency: "EUR",
      unitPercent: 1,
      kellyFraction: 0.25,
      maxStakePercent: 2,
      minEv: 0.03,
      minConfidence: "media",
      dailyLossLimit: 50,
      weeklyLossLimit: 150,
      coolingOffUntil: null,
      watchlist: [],
      customOdds: {},
      logs: [],
      setBankroll: (bankroll) => set({ bankroll: Math.max(0, bankroll) }),
      setCurrency: (currency) => set({ currency }),
      setUnitPercent: (unitPercent) => set({ unitPercent }),
      setKellyFraction: (kellyFraction) => set({ kellyFraction }),
      setMaxStakePercent: (maxStakePercent) => set({ maxStakePercent }),
      setMinEv: (minEv) => set({ minEv }),
      setMinConfidence: (minConfidence) => set({ minConfidence }),
      setDailyLossLimit: (dailyLossLimit) => set({ dailyLossLimit }),
      setWeeklyLossLimit: (weeklyLossLimit) => set({ weeklyLossLimit }),
      startCoolingOff: (hours) =>
        set({ coolingOffUntil: Date.now() + hours * 60 * 60 * 1000 }),
      clearCoolingOff: () => set({ coolingOffUntil: null }),
      toggleWatch: (id) => {
        const watchlist = get().watchlist;
        set({
          watchlist: watchlist.includes(id)
            ? watchlist.filter((item) => item !== id)
            : [...watchlist, id],
        });
      },
      setCustomOdds: (fixtureId, odds) =>
        set({
          customOdds: {
            ...get().customOdds,
            [fixtureId]: { ...get().customOdds[fixtureId], ...odds },
          },
        }),
      addLog: (log) =>
        set({
          logs: [
            {
              ...log,
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              at: Date.now(),
              result: "pendiente" as const,
              pnl: 0,
            },
            ...get().logs,
          ].slice(0, 80),
        }),
      settleLog: (id, result) =>
        set({
          logs: get().logs.map((log) => {
            if (log.id !== id) return log;
            const pnl = pnlFor(result, log.stake, log.odds);
            return { ...log, result, pnl };
          }),
        }),
      resetJournal: () => set({ logs: [] }),
    }),
    {
      name: "meridiano-session",
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SessionState>;
        const adult =
          saved.ageConfirmed === true ||
          current.ageConfirmed === true ||
          (typeof localStorage !== "undefined" && localStorage.getItem("meridiano-age") === "1");
        return { ...current, ...saved, ageConfirmed: adult };
      },
    },
  ),
);

export function periodLoss(logs: StakeLog[], ms: number): number {
  const from = Date.now() - ms;
  return logs
    .filter((log) => log.at >= from && log.result !== "pendiente")
    .reduce((acc, log) => acc + log.pnl, 0);
}
