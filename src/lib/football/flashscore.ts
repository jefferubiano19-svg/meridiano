import data from "../../../data/flashscore.json";
import type { TeamRecord } from "./sheets";

export type FlashscoreStatus =
  | "por-jugar"
  | "en-juego"
  | "finalizado"
  | "aplazado"
  | "cancelado"
  | "otro";

export interface FlashscoreMatch {
  fixtureId: string;
  flashscoreId: string;
  competition: string;
  home: string;
  away: string;
  kickoff: string;
  status: FlashscoreStatus;
  homeScore: number | null;
  awayScore: number | null;
  xgHome: number | null;
  xgAway: number | null;
  possessionHome: string | null;
  possessionAway: string | null;
  shotsHome: string | null;
  shotsAway: string | null;
  shotsOnHome: string | null;
  shotsOnAway: string | null;
  cornersHome: string | null;
  cornersAway: string | null;
  url: string;
}

const BY_FIXTURE = data.byFixture as Record<string, FlashscoreMatch>;

export interface TodayExtra {
  id: string;
  competition: string;
  kickoff: string;
  homeName: string;
  awayName: string;
  status: string;
  url: string;
  note: string;
  home: TeamRecord;
  away: TeamRecord;
}

export const TODAY_EXTRAS = ((data as { extras?: TodayExtra[] }).extras ?? []) as TodayExtra[];

export const FLASHSCORE_FETCHED_AT = data.fetchedAt;
export const FLASHSCORE_WINDOW = data.window;
export const FLASHSCORE_SOURCE = data.source;

export function flashscoreFor(fixtureId: string): FlashscoreMatch | undefined {
  return BY_FIXTURE[fixtureId];
}

export function flashscoreStatusLabel(status: string): string {
  if (status === "por-jugar") return "Por jugar";
  if (status === "en-juego") return "En juego";
  if (status === "finalizado") return "Finalizado";
  if (status === "aplazado") return "Aplazado";
  if (status === "cancelado") return "Cancelado";
  return "Sin estado";
}
