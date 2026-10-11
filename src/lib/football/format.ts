import { getLeague } from "./leagues";
import type { ConfidenceLabel, LeagueId, MarketKey } from "./types";

export const CURRENCIES = ["COP", "USD", "EUR", "MXN", "ARS", "BRL"] as const;
export type Currency = (typeof CURRENCIES)[number];

const CURRENCY_CODE: Record<Currency, string> = {
  COP: "COP",
  USD: "USD",
  EUR: "EUR",
  MXN: "MXN",
  ARS: "ARS",
  BRL: "BRL",
};

export const MARKET_LABEL: Record<MarketKey, string> = {
  home: "Local",
  draw: "Empate",
  away: "Visita",
  over25: "Más de 2.5",
  under25: "Menos de 2.5",
  bttsYes: "Ambos marcan",
  bttsNo: "No ambos",
  dc1x: "Doble 1X",
  dc12: "Doble 12",
  dcx2: "Doble X2",
  dnbHome: "Sin empate local",
  dnbAway: "Sin empate visita",
  cornersOver: "Más córners",
  cornersUnder: "Menos córners",
};

export function formatPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatOdds(value: number): string {
  if (!Number.isFinite(value) || value <= 1) return "—";
  return value.toFixed(2);
}

export function formatEv(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function money(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: CURRENCY_CODE[currency],
    maximumFractionDigits: currency === "COP" ? 0 : 2,
  }).format(amount);
}

export function gd(gf: number, ga: number): string {
  const diff = gf - ga;
  return diff > 0 ? `+${diff}` : String(diff);
}

export function confidenceCopy(label: ConfidenceLabel): string {
  if (label === "alta") return "alta";
  if (label === "media") return "media";
  return "baja";
}

export function dayKey(iso: string, leagueId: LeagueId): string {
  getLeague(leagueId);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function dayHeading(iso: string, leagueId: LeagueId): string {
  const key = dayKey(iso, leagueId);
  const ref = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const label = new Intl.DateTimeFormat("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  }).format(new Date(iso));
  if (key === ref) return `Hoy · ${label}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatKickoff(iso: string, leagueId: LeagueId): string {
  getLeague(leagueId);
  return new Intl.DateTimeFormat("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Bogota",
  }).format(new Date(iso));
}

export function formatKickoffLong(iso: string, leagueId: LeagueId): string {
  getLeague(leagueId);
  return new Intl.DateTimeFormat("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Bogota",
  }).format(new Date(iso));
}

export function boardDayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("es", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}
