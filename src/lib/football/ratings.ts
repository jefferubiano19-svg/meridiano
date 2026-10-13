/* ---------------------------------------------------------------------------
 * Nivel B: ratings globales de ataque y defensa.
 * Un solo modelo de Poisson para todos los equipos del feed, ajustado con todos los
 * resultados conocidos antes del corte (agenda y fichas leídas). A diferencia del
 * promedio de goles del Nivel C, corrige por la fuerza del rival: un 3-0 contra el
 * último no pesa igual que contra el primero. Los equipos se conectan entre ligas por
 * copas y torneos internacionales. Cada competición tiene su propio nivel de goles.
 *
 *   log λ_local  = μ + g_comp + H·sede + ataque_local  − defensa_visita
 *   log λ_visita = μ + g_comp + H·sede' + ataque_visita − defensa_local
 *
 * Partidos con sede conocida: sede = 1, sede' = 0. Partidos de fichas sin sede: ambas
 * 0,5. Peso por antigüedad con vida media de 120 días. Penalización L2 (ridge) a
 * ataques/defensas (10) y a niveles de competición (20), elegida por backtest.
 *
 * Backtest sin mirar el futuro (ajuste cada día solo con partidos anteriores), 4.428
 * partidos del 4 al 12 oct 2026 que el motor anterior también cubría: RPS 0,2148 contra
 * 0,2253 (−0,0105; error estándar ≈ 0,0014). Igual en la mitad de ajuste y en la de prueba.
 * Además cubre 279 partidos que antes quedaban sin probabilidad (RPS 0,233, mejor que una
 * probabilidad fija por resultado, 0,239).
 *
 * Probado y NO adoptado: nivel de fuerza por país (ridgeGroup). En 306 partidos entre equipos de
 * países distintos bajó el RPS 0,005, pero la muestra es chica y deja resultados poco creíbles en
 * partidos grandes de Europa. Queda apagado (0) hasta tener más partidos internacionales.
 * ------------------------------------------------------------------------- */

export interface RatingGame {
  /** Inicio en milisegundos. */
  ts: number;
  home: string;
  away: string;
  hg: number;
  ag: number;
  /** 1 si se sabe quién fue local; 0 si no. */
  venue: 0 | 1;
  comp: string;
}

export interface RatingsFile {
  asOf: string | null;
  rule?: string;
  params?: RatingParams;
  mu: number;
  home: number;
  /** [ataque, defensa, partidos con peso] por equipo (ya incluye la fuerza de su país). */
  teams: Record<string, [number, number, number]>;
  comps: Record<string, number>;
  groups?: Record<string, [number, number]>;
  games?: number;
}

export interface RatingParams {
  halfLifeDays: number;
  ridgeTeam: number;
  ridgeComp: number;
  unknownVenue: number;
  sweeps: number;
  /** Penalización de la fuerza de cada país (ataque y defensa comunes a sus equipos). 0 = sin nivel de país. */
  ridgeGroup: number;
}

export const RATING_PARAMS: RatingParams = {
  halfLifeDays: 120,
  ridgeTeam: 10,
  ridgeComp: 20,
  unknownVenue: 0.5,
  sweeps: 120,
  ridgeGroup: 0,
};

/** País y rama ("ITALY|m") de una clave de equipo "ITALY|m|inter". */
export function groupOf(teamKey: string): string {
  const parts = teamKey.split("|");
  return parts.length >= 3 ? `${parts[0]}|${parts[1]}` : teamKey;
}

const DAY_MS = 86_400_000;

/** Ajuste por Newton en bloques (ataques, defensas, competiciones, μ y localía). Convexo: converge solo. */
export function fitRatings(games: RatingGame[], nowMs: number, params: RatingParams = RATING_PARAMS): RatingsFile {
  const windowMs = 4 * params.halfLifeDays * DAY_MS;
  const train = games.filter((game) => game.ts < nowMs && nowMs - game.ts <= windowMs);
  const teamIndex = new Map<string, number>();
  const compIndex = new Map<string, number>();
  for (const game of train) {
    if (!teamIndex.has(game.home)) teamIndex.set(game.home, teamIndex.size);
    if (!teamIndex.has(game.away)) teamIndex.set(game.away, teamIndex.size);
    if (!compIndex.has(game.comp)) compIndex.set(game.comp, compIndex.size);
  }
  const n = train.length;
  const T = teamIndex.size;
  const C = compIndex.size;
  const hi = new Int32Array(n);
  const ai = new Int32Array(n);
  const ci = new Int32Array(n);
  const w = new Float64Array(n);
  const vh = new Float64Array(n);
  const va = new Float64Array(n);
  const yh = new Float64Array(n);
  const ya = new Float64Array(n);
  const xi = Math.log(2) / params.halfLifeDays;
  train.forEach((game, i) => {
    hi[i] = teamIndex.get(game.home) as number;
    ai[i] = teamIndex.get(game.away) as number;
    ci[i] = compIndex.get(game.comp) as number;
    w[i] = Math.exp((-xi * (nowMs - game.ts)) / DAY_MS);
    vh[i] = game.venue ? 1 : params.unknownVenue;
    va[i] = game.venue ? 0 : params.unknownVenue;
    yh[i] = game.hg;
    ya[i] = game.ag;
  });
  const groupIndex = new Map<string, number>();
  const teamGroup = new Int32Array(T);
  for (const [key, t] of teamIndex) {
    const gk = groupOf(key);
    if (!groupIndex.has(gk)) groupIndex.set(gk, groupIndex.size);
    teamGroup[t] = groupIndex.get(gk) as number;
  }
  const G = groupIndex.size;
  const gAtt = new Float64Array(G);
  const gDef = new Float64Array(G);
  const useGroups = params.ridgeGroup > 0;
  const att = new Float64Array(T);
  const def = new Float64Array(T);
  const comp = new Float64Array(C);
  const played = new Float64Array(T);
  for (let i = 0; i < n; i += 1) {
    played[hi[i]] += w[i];
    played[ai[i]] += w[i];
  }
  let mu = Math.log(1.3);
  let home = 0.2;
  const lh = new Float64Array(n);
  const la = new Float64Array(n);
  const refresh = () => {
    for (let i = 0; i < n; i += 1) {
      const base = mu + comp[ci[i]];
      const H = hi[i];
      const A = ai[i];
      const ah = att[H] + gAtt[teamGroup[H]];
      const aa = att[A] + gAtt[teamGroup[A]];
      const dh = def[H] + gDef[teamGroup[H]];
      const da = def[A] + gDef[teamGroup[A]];
      lh[i] = Math.exp(base + home * vh[i] + ah - da);
      la[i] = Math.exp(base + home * va[i] + aa - dh);
    }
  };
  const g = new Float64Array(Math.max(T, C, G));
  const h = new Float64Array(Math.max(T, C, G));
  for (let sweep = 0; sweep < params.sweeps; sweep += 1) {
    // Ataques
    refresh();
    g.fill(0, 0, T);
    h.fill(0, 0, T);
    for (let i = 0; i < n; i += 1) {
      g[hi[i]] += w[i] * (lh[i] - yh[i]);
      h[hi[i]] += w[i] * lh[i];
      g[ai[i]] += w[i] * (la[i] - ya[i]);
      h[ai[i]] += w[i] * la[i];
    }
    for (let t = 0; t < T; t += 1) att[t] -= (g[t] + params.ridgeTeam * att[t]) / (h[t] + params.ridgeTeam);
    // Defensas
    refresh();
    g.fill(0, 0, T);
    h.fill(0, 0, T);
    for (let i = 0; i < n; i += 1) {
      g[ai[i]] -= w[i] * (lh[i] - yh[i]);
      h[ai[i]] += w[i] * lh[i];
      g[hi[i]] -= w[i] * (la[i] - ya[i]);
      h[hi[i]] += w[i] * la[i];
    }
    for (let t = 0; t < T; t += 1) def[t] -= (g[t] + params.ridgeTeam * def[t]) / (h[t] + params.ridgeTeam);
    if (useGroups) {
      // Fuerza de cada país: la identifican los partidos entre equipos de países distintos.
      refresh();
      g.fill(0, 0, G);
      h.fill(0, 0, G);
      for (let i = 0; i < n; i += 1) {
        const gh = teamGroup[hi[i]];
        const ga = teamGroup[ai[i]];
        g[gh] += w[i] * (lh[i] - yh[i]);
        h[gh] += w[i] * lh[i];
        g[ga] += w[i] * (la[i] - ya[i]);
        h[ga] += w[i] * la[i];
      }
      for (let k = 0; k < G; k += 1) gAtt[k] -= (g[k] + params.ridgeGroup * gAtt[k]) / (h[k] + params.ridgeGroup);
      refresh();
      g.fill(0, 0, G);
      h.fill(0, 0, G);
      for (let i = 0; i < n; i += 1) {
        const gh = teamGroup[hi[i]];
        const ga = teamGroup[ai[i]];
        g[ga] -= w[i] * (lh[i] - yh[i]);
        h[ga] += w[i] * lh[i];
        g[gh] -= w[i] * (la[i] - ya[i]);
        h[gh] += w[i] * la[i];
      }
      for (let k = 0; k < G; k += 1) gDef[k] -= (g[k] + params.ridgeGroup * gDef[k]) / (h[k] + params.ridgeGroup);
    }
    // Nivel de goles de cada competición
    refresh();
    g.fill(0, 0, C);
    h.fill(0, 0, C);
    for (let i = 0; i < n; i += 1) {
      g[ci[i]] += w[i] * (lh[i] - yh[i] + la[i] - ya[i]);
      h[ci[i]] += w[i] * (lh[i] + la[i]);
    }
    for (let c = 0; c < C; c += 1) comp[c] -= (g[c] + params.ridgeComp * comp[c]) / (h[c] + params.ridgeComp);
    // μ y localía
    refresh();
    let gm = 0;
    let hm = 0;
    let gh = 0;
    let hh = 0;
    for (let i = 0; i < n; i += 1) {
      gm += w[i] * (lh[i] - yh[i] + la[i] - ya[i]);
      hm += w[i] * (lh[i] + la[i]);
      gh += w[i] * ((lh[i] - yh[i]) * vh[i] + (la[i] - ya[i]) * va[i]);
      hh += w[i] * (lh[i] * vh[i] * vh[i] + la[i] * va[i] * va[i]);
    }
    if (hm > 0) mu -= gm / hm;
    if (hh > 0) home -= gh / hh;
  }
  const r4 = (value: number) => Math.round(value * 10000) / 10000;
  const teams: RatingsFile["teams"] = {};
  for (const [key, t] of teamIndex) {
    const k = teamGroup[t];
    teams[key] = [r4(att[t] + gAtt[k]), r4(def[t] + gDef[k]), Math.round(played[t] * 10) / 10];
  }
  const groups: Record<string, [number, number]> = {};
  for (const [key, k] of groupIndex) groups[key] = [r4(gAtt[k]), r4(gDef[k])];
  const comps: RatingsFile["comps"] = {};
  for (const [key, c] of compIndex) comps[key] = r4(comp[c]);
  return { asOf: new Date(nowMs).toISOString(), params, mu: r4(mu), home: r4(home), teams, comps, groups, games: n };
}

/** Goles esperados de un partido, o null si falta alguno de los dos equipos. */
export function ratingLambdas(
  file: RatingsFile,
  homeKey: string | null,
  awayKey: string | null,
  competition: string,
  neutral = false,
): [number, number] | null {
  if (!homeKey || !awayKey) return null;
  const h = file.teams[homeKey];
  const a = file.teams[awayKey];
  if (!h || !a) return null;
  const base = file.mu + (file.comps[competition] ?? 0);
  const lh = Math.exp(base + (neutral ? 0 : file.home) + h[0] - a[1]);
  const la = Math.exp(base + a[0] - h[1]);
  return [lh, la];
}
