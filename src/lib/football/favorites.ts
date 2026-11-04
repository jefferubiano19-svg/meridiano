/* ---------------------------------------------------------------------------
 * Corrección de favoritos fuertes (sombra desde el 5 nov 2026; NO se publica todavía).
 *
 * Hallazgo (4 nov 2026, 1.917 partidos ya jugados con favorito de 65 % o más): el favorito ganó 77,9 % cuando la
 * publicada decía 74,4 %; en fútbol femenino 87,4 % contra 78,0 % y en copas 84,2 % contra 75,8 %. La diferencia
 * aparece igual antes y después del 24 oct, y también con el consenso de las casas (sesgo favorito–no favorito que
 * Shin no corrige del todo).
 *
 * Corrección: para el favorito (local o visita con 50 % o más), logit(p') = a + b·logit(p) + c·femenino + d·copa; el
 * resto se reparte en proporción entre los otros dos resultados. Prueba fuera de muestra (ajuste antes del 24 oct,
 * prueba desde el 24 oct, 7.460 partidos): RPS 0,20028 → 0,20008, diferencia −0,0002 (IC 95 % −0,0006 a +0,0002):
 * mejora pequeña y todavía no distinguible de cero; en femenino −0,005 por partido. Por la regla del sistema se mide
 * como sombra hacia adelante (review.ts → shadows «favoritos») y se publica solo con 500+ partidos y el IC entero
 * bajo cero. Parámetros congelados: ajuste con todo lo jugado hasta el 3 nov 2026.
 * ------------------------------------------------------------------------- */

export const FAVORITE_ADJUST = { a: 0.0703, b: 1.0881, women: 0.3084, cup: 0.2108, since: "2026-11-05" } as const;

const WOMEN = /( F$| F \(|Fem|Women)/i;
const CUP = /Cup|Copa|Pokal|Beker|Coupe|Coppa|Taça|Cupa|Kupa/i;

type Way = { home: number; draw: number; away: number };

export function adjustFavorite(published: Way, info: { home?: string; away?: string; competition?: string }): Way {
  const top = Math.max(published.home, published.away);
  if (!(top >= 0.5) || top >= 0.995) return published;
  const side = published.home >= published.away ? "home" : "away";
  const women = WOMEN.test(`${info.home ?? ""} ${info.away ?? ""} ${info.competition ?? ""}`) ? 1 : 0;
  const cup = CUP.test(info.competition ?? "") ? 1 : 0;
  const z = FAVORITE_ADJUST.a + FAVORITE_ADJUST.b * Math.log(top / (1 - top)) + FAVORITE_ADJUST.women * women + FAVORITE_ADJUST.cup * cup;
  const q = 1 / (1 + Math.exp(-z));
  const rest = 1 - top;
  const scale = rest > 0 ? (1 - q) / rest : 0;
  return side === "home"
    ? { home: q, draw: published.draw * scale, away: published.away * scale }
    : { home: published.home * scale, draw: published.draw * scale, away: q };
}
