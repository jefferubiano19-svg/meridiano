import { lambdasFor } from "./engine";
import { nationForMatch } from "./nations";
import { marketOnly, presentRecent } from "./publish";
import { levelCFor, type RecentAnalysis } from "./recent";
import { fromLambdas } from "./recent-math";

/* ---------------------------------------------------------------------------
 * Única fuente de la probabilidad que ve el usuario en cualquier pantalla.
 * Todo lo que muestre un lado favorito, un "lado", un porcentaje o una cuota
 * justa sale de aquí: la PUBLICADA (mercado + modelo), nunca el modelo solo.
 * El modelo puro solo se muestra en la fila "Modelo puro" de la ficha.
 *
 *  - Selecciones: Elo (5.4) mezclado con el mercado si hay cuotas.
 *  - Clubes con modelo (A, B o C): mezclado con el mercado si hay cuotas.
 *  - Sin modelo pero con cuotas (incluye torneos internacionales de clubes): Nivel M, solo mercado.
 *  - Sin nada: null (la pantalla dice NO DISPONIBLE).
 * ------------------------------------------------------------------------- */

export type PublishedAnalysis = Omit<RecentAnalysis, "level"> & {
  level: "A" | "B" | "C" | "5.4" | "M";
  /** Modelo puro, solo para la fila "Modelo puro". Null en Nivel M. */
  modelPure: RecentAnalysis["p1x2"] | null;
};

const CACHE = new Map<string, PublishedAnalysis | null>();

export function publishedFor(matchId: string, kickoff: string, competition: string): PublishedAnalysis | null {
  const key = `${matchId}|${kickoff}|${competition}`;
  if (CACHE.has(key)) return CACHE.get(key) ?? null;
  const value = compute(matchId, kickoff, competition);
  CACHE.set(key, value);
  return value;
}

function compute(matchId: string, kickoff: string, competition: string): PublishedAnalysis | null {
  const nation = nationForMatch(matchId);
  const raw = levelCFor(matchId, kickoff, competition);
  if (nation) {
    const base = fromLambdas(nation.lambdaHome, nation.lambdaAway);
    if (base) {
      const shown = presentRecent(matchId, { ...base, p1x2: nation.p1x2 });
      return { ...shown, level: "5.4", modelPure: nation.p1x2 };
    }
  }
  if (raw) {
    const shown = presentRecent(matchId, raw);
    return { ...shown, level: raw.level ?? "C", modelPure: raw.p1x2 };
  }
  const market = marketOnly(matchId);
  if (!market) return null;
  const [lambdaHome, lambdaAway] = lambdasFor(market.published);
  const base = fromLambdas(lambdaHome, lambdaAway);
  if (!base) return null;
  const shown = presentRecent(matchId, { ...base, p1x2: market.published });
  return { ...shown, p1x2: market.published, level: "M", modelPure: null };
}

/** Lado más probable según la publicada. */
export function favoriteOf(p: { home: number; draw: number; away: number }, home: string, away: string) {
  return [
    { key: "home" as const, name: home, probability: p.home },
    { key: "draw" as const, name: "Empate", probability: p.draw },
    { key: "away" as const, name: away, probability: p.away },
  ].sort((a, b) => b.probability - a.probability)[0];
}
