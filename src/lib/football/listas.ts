import listasFile from "../../../data/listas.json";
import { AGENDA } from "./agenda";

/* ---------------------------------------------------------------------------
 * Cómo le fue a la lista «Partido hoy» de cada día: la guardada por el corte (data/listas.json, scripts/listas.mjs)
 * contra los marcadores de la agenda. Se usa la primera lista publicada ese mismo día (la del corte de la noche).
 * ------------------------------------------------------------------------- */

type Leg = { id: string; key: "home" | "draw" | "away"; probability: number };
type Slot = { savedAt: string; legs: Leg[] };

export interface ListResult {
  day: string;
  savedAt: string;
  legs: number;
  settled: number;
  hits: number;
  expected: number;
}

const byDay = ((listasFile as { byDay?: Record<string, Record<string, Slot>> }).byDay ?? {}) as Record<string, Record<string, Slot>>;
const results = new Map(AGENDA.map((match) => [match.id, match]));

export function listHistory(beforeDay: string, days = 7): ListResult[] {
  const out: ListResult[] = [];
  for (const day of Object.keys(byDay).filter((item) => item < beforeDay).sort().reverse().slice(0, days)) {
    const slots = Object.entries(byDay[day]);
    // La primera publicada ese mismo día; si no hay, la de la víspera.
    const chosen =
      slots.filter(([key]) => key.startsWith("hoy-")).sort((a, b) => a[1].savedAt.localeCompare(b[1].savedAt))[0] ??
      slots.sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))[0];
    if (!chosen) continue;
    const slot = chosen[1];
    let settled = 0;
    let hits = 0;
    let expected = 0;
    for (const leg of slot.legs) {
      const match = results.get(leg.id);
      if (!match || match.status !== "finalizado" || match.homeScore == null || match.awayScore == null) continue;
      settled += 1;
      expected += leg.probability;
      const actual = match.homeScore > match.awayScore ? "home" : match.homeScore === match.awayScore ? "draw" : "away";
      if (actual === leg.key) hits += 1;
    }
    out.push({ day, savedAt: slot.savedAt, legs: slot.legs.length, settled, hits, expected });
  }
  return out;
}
