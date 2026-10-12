import file from "../../../data/colombia-2026.json";
import { AGENDA } from "./agenda";
import { scoreboard } from "./engine";
import { canonicalCompetition } from "./places";
import { tableRow } from "./standings";
import type { ThreeWay } from "./types";

/* ---------------------------------------------------------------------------
 * Sombra "modelo de temporada" de la Liga BetPlay (Colombia Primera A).
 * Ataque y defensa por equipo con todos los partidos de 2026 (archivo del usuario
 * más los resultados nuevos de la agenda), con más peso a lo reciente (vida media
 * de 120 días). NO se publica: se guarda en cada predicción y se compara con la
 * publicada cuando haya suficientes partidos evaluados.
 * Prueba previa (65 partidos del Clausura desde el 1 sep): RPS 0,2075 contra 0,2113
 * de la tabla del Clausura; diferencia dentro del error (±0,012).
 * ------------------------------------------------------------------------- */

const COMPETITION = /^COLOMBIA: Primera A(?: - .*)?$/i;
const AGENDA_COMPETITION = "COLOMBIA: Primera A";
const XI = Math.log(2) / 120;
const DAY_MS = 24 * 3600 * 1000;

type Game = [number, string, string, number, number];

const FILE_GAMES: Game[] = (file as unknown as { matches: [string, string, string, number, number][] }).matches.map(
  ([iso, home, away, hg, ag]) => [Date.parse(iso), home, away, hg, ag],
);
const FILE_END = FILE_GAMES.reduce((max, game) => Math.max(max, game[0]), 0);

function canon(name: string): string {
  return tableRow(AGENDA_COMPETITION, name)?.team ?? name;
}

let ALL: Game[] | null = null;

function games(): Game[] {
  if (ALL) return ALL;
  const extra: Game[] = [];
  for (const match of AGENDA) {
    if (!COMPETITION.test(canonicalCompetition(match.competition))) continue;
    if (match.status !== "finalizado" || match.homeScore == null || match.awayScore == null) continue;
    const ms = Date.parse(match.kickoff);
    if (!(ms > FILE_END + 3600 * 1000)) continue;
    extra.push([ms, canon(match.home), canon(match.away), match.homeScore, match.awayScore]);
  }
  ALL = [...FILE_GAMES, ...extra].sort((a, b) => a[0] - b[0]);
  return ALL;
}

interface Fit {
  att: Map<string, number>;
  def: Map<string, number>;
  home: number;
  mu: number;
}

function fit(train: Game[], nowMs: number): Fit | null {
  if (train.length < 60) return null;
  const teams = new Set<string>();
  for (const game of train) {
    teams.add(game[1]);
    teams.add(game[2]);
  }
  const att = new Map([...teams].map((team) => [team, 0]));
  const def = new Map([...teams].map((team) => [team, 0]));
  let home = 0.25;
  let mu = 0.1;
  const weights = train.map((game) => Math.exp((-XI * (nowMs - game[0])) / DAY_MS));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const lr = 0.05;
  const reg = 0.05;
  for (let step = 0; step < 200; step += 1) {
    const gAtt = new Map([...teams].map((team) => [team, 0]));
    const gDef = new Map([...teams].map((team) => [team, 0]));
    let gHome = 0;
    let gMu = 0;
    train.forEach(([, h, v, hg, vg], index) => {
      const w = weights[index];
      const lh = Math.exp(mu + home + (att.get(h) as number) - (def.get(v) as number));
      const lv = Math.exp(mu + (att.get(v) as number) - (def.get(h) as number));
      gAtt.set(h, (gAtt.get(h) as number) + w * (hg - lh));
      gDef.set(v, (gDef.get(v) as number) - w * (hg - lh));
      gAtt.set(v, (gAtt.get(v) as number) + w * (vg - lv));
      gDef.set(h, (gDef.get(h) as number) - w * (vg - lv));
      gHome += w * (hg - lh);
      gMu += w * (hg - lh + vg - lv);
    });
    for (const team of teams) {
      att.set(team, (att.get(team) as number) + lr * (((gAtt.get(team) as number) / total) * 20 - reg * (att.get(team) as number)));
      def.set(team, (def.get(team) as number) + lr * (((gDef.get(team) as number) / total) * 20 - reg * (def.get(team) as number)));
    }
    home += (lr * gHome) / total;
    mu += (lr * gMu) / total / 2;
  }
  return { att, def, home, mu };
}

const CACHE = new Map<number, Fit | null>();

/** Probabilidad 1X2 del modelo de temporada, o null si no es Liga BetPlay o falta un equipo. */
export function seasonShadow(home: string, away: string, competition: string, kickoffMs: number): ThreeWay | null {
  if (!COMPETITION.test(canonicalCompetition(competition)) || !Number.isFinite(kickoffMs)) return null;
  // Un ajuste por día, solo con partidos jugados antes de ese día (hora de Bogotá).
  const dayStart = Math.floor((kickoffMs - 5 * 3600 * 1000) / DAY_MS) * DAY_MS + 5 * 3600 * 1000;
  if (!CACHE.has(dayStart)) CACHE.set(dayStart, fit(games().filter((game) => game[0] < dayStart), dayStart));
  const model = CACHE.get(dayStart);
  if (!model) return null;
  const h = canon(home);
  const a = canon(away);
  if (!model.att.has(h) || !model.att.has(a)) return null;
  const lh = Math.exp(model.mu + model.home + (model.att.get(h) as number) - (model.def.get(a) as number));
  const la = Math.exp(model.mu + (model.att.get(a) as number) - (model.def.get(h) as number));
  return scoreboard(Math.min(4, Math.max(0.2, lh)), Math.min(4, Math.max(0.2, la)), -0.05).p1x2;
}
