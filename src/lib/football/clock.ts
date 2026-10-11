/** Fecha de calendario en Bogotá. Sin archivos de datos. */

export function bogotaStamp(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

export function agendaToday(now = new Date()): string {
  return bogotaStamp(now);
}

export function agendaTomorrow(now = new Date()): string {
  return shiftDay(agendaToday(now), 1);
}

export function bogotaDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
