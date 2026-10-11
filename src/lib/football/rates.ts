import data from "../../../data/agenda-rates.json";
import { analyzeCounts, type RecentAnalysis } from "./recent-math";

const BY_ID = data.byId as unknown as Record<string, [number, number, number, number, number, number] | null>;

export function rateSample(id: string): [number, number, number, number, number, number] | null {
  const row = BY_ID[id];
  return row ?? null;
}

export function rateAnalysis(id: string): RecentAnalysis | null {
  const row = BY_ID[id];
  if (!row) return null;
  return analyzeCounts(row[0], row[1], row[2], row[3], row[4], row[5]);
}
