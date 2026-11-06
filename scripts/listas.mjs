/**
 * Listas «Partido hoy» y «Partido» (mañana) tal como quedan publicadas tras un corte → data/listas.json.
 * Corre como proceso aparte al final del corte (los módulos de la app leen data/ al importarse, así que ven los
 * datos nuevos). Guarda una lista por día y por corte; la app cuenta los aciertos cuando hay marcador. 30 días.
 *
 *   node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/listas.mjs <corte>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "data", "listas.json");
const corte = process.argv[2] || "manual";

const { buildCombinada, buildCombinadaManana } = await import("../src/lib/football/combinada.ts");
const { agendaToday, agendaTomorrow } = await import("../src/lib/football/today.ts");

let data = { rule: "", byDay: {} };
try {
  data = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {}
data.rule =
  "Listas «Partido hoy» y «Partido» (mañana) como quedaron publicadas después de cada corte: los 20 partidos con el favorito más probable según la probabilidad publicada. Una lista por día y por corte; no se editan. 30 días.";
data.byDay = data.byDay && typeof data.byDay === "object" ? data.byDay : {};
const stamp = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 19) + "-05:00";

for (const [day, ticket] of [
  [agendaToday(), buildCombinada(agendaToday())],
  [agendaTomorrow(), buildCombinadaManana(agendaTomorrow())],
]) {
  const slot = (data.byDay[day] ??= {});
  const key = `${stamp.slice(0, 10) === day ? "hoy" : "vispera"}-${corte}`;
  if (slot[key]) continue; // ya guardada: no se edita
  slot[key] = {
    savedAt: stamp,
    legs: ticket.legs.map((leg) => ({
      id: leg.id,
      home: leg.home,
      away: leg.away,
      competition: leg.competition,
      kickoff: leg.kickoff,
      key: leg.key,
      pick: leg.pick,
      probability: Number(leg.probability.toFixed(4)),
      draw: Number((leg.drawProbability ?? 0).toFixed(4)),
    })),
  };
}
const keep = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
data.byDay = Object.fromEntries(Object.entries(data.byDay).filter(([day]) => day >= keep));
fs.writeFileSync(file, `${JSON.stringify(data)}\n`);
console.log(`listas: ${Object.keys(data.byDay).length} días guardados.`);
