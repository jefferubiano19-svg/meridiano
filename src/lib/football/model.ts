import { AGENDA } from "./agenda";
import { FIXTURES } from "./fixtures";
import { nationModel } from "./nations";
import strengthFile from "../../../data/market-strength.json";
import { getTeam, teamsInLeague, DATA_FETCHED_AT } from "./teams";
import { shrinkRate } from "./recent-math";
import contextFile from "../../../data/match-context.json";
import { findBook, BOOK_FETCHED_AT } from "./books";
import { dixonLambda } from "./dixon";
import { bounded, clampLambda, confidenceFrom, devig, scoreboard, shin, valueCall, type Adjustment } from "./engine";
import type { Fixture, MarketKey, MarketOdds, MatchAnalysis, Team, ThreeWay } from "./types";

interface StrengthRates {
  homeFor: number;
  homeAgainst: number;
  awayFor: number;
  awayAgainst: number;
}

const marketStrength = strengthFile as { leagues: Record<string, Record<string, StrengthRates>> };

function marketGoals(leagueId: string, homeName: string, awayName: string) {
  const league = marketStrength.leagues[leagueId];
  const home = league?.[homeName];
  const away = league?.[awayName];
  if (!home || !away) return null;
  return {
    home: (home.homeFor + away.awayAgainst) / 2,
    away: (away.awayFor + home.homeAgainst) / 2,
  };
}

interface Prematch {
  homeRest: number | null;
  awayRest: number | null;
  homeFor: number | null;
  homeAgainst: number | null;
  homeN: number;
  awayFor: number | null;
  awayAgainst: number | null;
  awayN: number;
  lineupHome: boolean;
  lineupAway: boolean;
  h2hN: number;
  h2hHomeGf: number;
  h2hAwayGf: number;
}

const CONTEXT = (contextFile as { byFixture: Record<string, Prematch> }).byFixture;

function leagueHomeFactor(pool: Team[]): number {
  let gp = 0;
  let gf = 0;
  let homeGp = 0;
  let homeGf = 0;
  for (const team of pool) {
    gp += team.gp;
    gf += team.gf;
    homeGp += team.home.gp;
    homeGf += team.home.gf;
  }
  if (homeGp < 20 || gp < 40 || gf <= 0) return 1;
  return Math.min(1.15, Math.max(0.9, homeGf / homeGp / (gf / gp)));
}

function perGame(gf: number, gp: number, fallback: number): number {
  if (gp <= 0) return fallback;
  return shrinkRate(gf / gp, gp, fallback, 6);
}

function toOdds(p: number): number {
  const clamped = Math.min(0.92, Math.max(0.035, p));
  return Math.round((1 / clamped) * 100) / 100;
}

function fairFrom(p1x2: ThreeWay, pOver25: number, pBttsYes: number): MarketOdds {
  const settled = Math.max(0.08, p1x2.home + p1x2.away);
  return {
    home: toOdds(p1x2.home),
    draw: toOdds(p1x2.draw),
    away: toOdds(p1x2.away),
    over25: toOdds(pOver25),
    under25: toOdds(1 - pOver25),
    bttsYes: toOdds(pBttsYes),
    bttsNo: toOdds(1 - pBttsYes),
    dc1x: toOdds(p1x2.home + p1x2.draw),
    dc12: toOdds(p1x2.home + p1x2.away),
    dcx2: toOdds(p1x2.draw + p1x2.away),
    dnbHome: toOdds(p1x2.home / settled),
    dnbAway: toOdds(p1x2.away / settled),
  };
}

function quotedFrom(
  fixture: Fixture,
  homeName: string,
  awayName: string,
): { provider: string | null; quoted: Partial<Record<MarketKey, number>> } {
  const book = findBook(homeName, awayName);
  const market = fixture.market;
  const quoted: Partial<Record<MarketKey, number>> = {};
  const provider = book?.provider ?? market?.provider ?? null;
  const home = book?.homeOdd ?? market?.home;
  const draw = book?.drawOdd ?? market?.draw;
  const away = book?.awayOdd ?? market?.away;
  if (home) quoted.home = home;
  if (draw) quoted.draw = draw;
  if (away) quoted.away = away;
  const over = book?.over25 ?? (market?.line === 2.5 ? market.over : null);
  const under = book?.under25 ?? (market?.line === 2.5 ? market.under : null);
  if (over) quoted.over25 = over;
  if (under) quoted.under25 = under;
  if (book?.bttsYes) quoted.bttsYes = book.bttsYes;
  else if (market?.bttsYes) quoted.bttsYes = market.bttsYes;
  if (book?.bttsNo) quoted.bttsNo = book.bttsNo;
  else if (market?.bttsNo) quoted.bttsNo = market.bttsNo;
  if (market?.dc1x) quoted.dc1x = market.dc1x;
  if (market?.dc12) quoted.dc12 = market.dc12;
  if (market?.dcx2) quoted.dcx2 = market.dcx2;
  if (market?.dnbHome) quoted.dnbHome = market.dnbHome;
  if (market?.dnbAway) quoted.dnbAway = market.dnbAway;
  if (book?.cornersOver) quoted.cornersOver = book.cornersOver;
  else if (market?.cornersOver) quoted.cornersOver = market.cornersOver;
  if (book?.cornersUnder) quoted.cornersUnder = book.cornersUnder;
  else if (market?.cornersUnder) quoted.cornersUnder = market.cornersUnder;
  return { provider, quoted };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function rate(total: number | null, played: number | null): number | null {
  if (total == null || !played) return null;
  return total / played;
}

function poissonAtLeast(kMin: number, lambda: number): number {
  let term = Math.exp(-lambda);
  let acc = 0;
  for (let k = 0; k <= 28; k += 1) {
    if (k >= kMin) acc += term;
    term *= lambda / (k + 1);
  }
  return Math.min(0.97, Math.max(0.03, acc));
}

export function analyzeFixture(fixture: Fixture): MatchAnalysis {
  const home = getTeam(fixture.homeId);
  const away = getTeam(fixture.awayId);
  const pool = teamsInLeague(home.leagueId).filter((team) => team.gp > 0);
  const gp = pool.reduce((sum, team) => sum + team.gp, 0);
  const gf = pool.reduce((sum, team) => sum + team.gf, 0);
  const avg = gp > 0 ? gf / gp : 1.25;

  const homeXg = rate(home.xg, home.xgPlayed);
  const homeXga = rate(home.xga, home.xgPlayed);
  const awayXg = rate(away.xg, away.xgPlayed);
  const awayXga = rate(away.xga, away.xgPlayed);
  const useXg = homeXg != null && homeXga != null && awayXg != null && awayXga != null;

  const seasonUsable = Number.isFinite(Date.parse(fixture.kickoff)) && Date.parse(fixture.kickoff) >= Date.parse(DATA_FETCHED_AT);
  const neutral = /neutral/i.test(`${fixture.venue} ${fixture.note ?? ""}`);
  const ctx = CONTEXT[fixture.id];
  const adjustments: Adjustment[] = [
    { key: "bajas", value: 0, note: "Sin bajas confirmadas en este corte. Ajuste 0." },
    { key: "tecnico", value: 0, note: "Sin cambio de técnico publicado. Ajuste 0." },
    { key: "rotacion", value: 0, note: "Sin rotación confirmada. Ajuste 0." },
  ];

  let lambdaHome: number;
  let lambdaAway: number;
  const thin = Math.min(home.gp, away.gp) < 6 && !useXg;
  if (!seasonUsable) {
    lambdaHome = avg;
    lambdaAway = avg;
    adjustments.push({
      key: "fuga",
      value: 0,
      note: "La tabla de temporada puede incluir este partido o uno posterior. No entra en el cálculo.",
    });
  } else if (thin) {
    lambdaHome = avg;
    lambdaAway = avg;
    adjustments.push({
      key: "muestra",
      value: 0,
      note: "Menos de seis partidos y sin xG. Se parte del promedio de la liga.",
    });
  } else if (useXg) {
    lambdaHome = (shrinkRate(homeXg, home.xgPlayed ?? 0, avg, 6) + shrinkRate(awayXga, away.xgPlayed ?? 0, avg, 6)) / 2;
    lambdaAway = (shrinkRate(awayXg, away.xgPlayed ?? 0, avg, 6) + shrinkRate(homeXga, home.xgPlayed ?? 0, avg, 6)) / 2;
    if (!neutral) {
      const factor = leagueHomeFactor(pool);
      lambdaHome = bounded(lambdaHome, factor).next;
      lambdaAway = bounded(lambdaAway, factor === 0 ? 1 : 1 / factor).next;
      adjustments.push({
        key: "local",
        value: Number((factor - 1).toFixed(3)),
        note: `Ventaja de local de la liga ${factor.toFixed(2)}, porque el xG publicado es global. Tope ±15%.`,
      });
    }
  } else {
    const homeFor = home.home.gp >= 6 ? shrinkRate(home.home.gf / home.home.gp, home.home.gp, avg, 6) : perGame(home.gf, home.gp, avg);
    const homeAgainst = home.home.gp >= 6 ? shrinkRate(home.home.ga / home.home.gp, home.home.gp, avg, 6) : perGame(home.ga, home.gp, avg);
    const awayFor = away.away.gp >= 6 ? shrinkRate(away.away.gf / away.away.gp, away.away.gp, avg, 6) : perGame(away.gf, away.gp, avg);
    const awayAgainst = away.away.gp >= 6 ? shrinkRate(away.away.ga / away.away.gp, away.away.gp, avg, 6) : perGame(away.ga, away.gp, avg);
    lambdaHome = avg > 0 ? (homeFor * awayAgainst) / avg : homeFor;
    lambdaAway = avg > 0 ? (awayFor * homeAgainst) / avg : awayFor;
    adjustments.push({
      key: "local",
      value: 0,
      note: "El corte local/visita ya trae la sede. No se multiplica otra ventaja.",
    });
  }
  if (neutral) {
    adjustments.push({ key: "sede", value: 0, note: "Sede neutral: ventaja de local en cero." });
  }
  if (
    ctx &&
    ctx.homeFor != null &&
    ctx.homeAgainst != null &&
    ctx.awayFor != null &&
    ctx.awayAgainst != null &&
    ctx.homeN >= 4 &&
    ctx.awayN >= 4
  ) {
    const decayHome = clampLambda((shrinkRate(ctx.homeFor, ctx.homeN, avg, 8) + shrinkRate(ctx.awayAgainst, ctx.awayN, avg, 8)) / 2);
    const decayAway = clampLambda((shrinkRate(ctx.awayFor, ctx.awayN, avg, 8) + shrinkRate(ctx.homeAgainst, ctx.homeN, avg, 8)) / 2);
    if (seasonUsable && !thin) {
      lambdaHome = (lambdaHome + decayHome) / 2;
      lambdaAway = (lambdaAway + decayAway) / 2;
      adjustments.push({
        key: "decaimiento",
        value: 0.5,
        note: "Mitad temporada publicada y mitad goles anteriores al partido, vida media 120 días. No hay xG por fecha.",
      });
    } else {
      lambdaHome = decayHome;
      lambdaAway = decayAway;
      adjustments.push({
        key: "decaimiento",
        value: 1,
        note: "Solo goles de partidos anteriores al inicio, con vida media de 120 días.",
      });
    }
  }
  if (ctx && ctx.homeRest != null && ctx.homeRest < 4) {
    lambdaHome = bounded(lambdaHome, 0.97).next;
    adjustments.push({
      key: "descanso-local",
      value: -0.03,
      note: `Descanso local de ${ctx.homeRest.toFixed(1)} días. Ajuste acotado de −3%.`,
    });
  }
  if (ctx && ctx.awayRest != null && ctx.awayRest < 4) {
    lambdaAway = bounded(lambdaAway, 0.97).next;
    adjustments.push({
      key: "descanso-visita",
      value: -0.03,
      note: `Descanso visitante de ${ctx.awayRest.toFixed(1)} días. Ajuste acotado de −3%.`,
    });
  }
  if ((fixture.leagueId === "selecciones" || fixture.leagueId === "ucl") && home.elo != null && away.elo != null) {
    const raw = 1 + (0.08 * (home.elo - away.elo)) / 400;
    lambdaHome = bounded(lambdaHome, raw).next;
    lambdaAway = bounded(lambdaAway, 1 / Math.min(1.15, Math.max(0.85, raw))).next;
    adjustments.push({
      key: "fuerza-relativa",
      value: Number((Math.min(1.15, Math.max(0.85, raw)) - 1).toFixed(3)),
      note: "Ajuste acotado por Elo publicado de selecciones o copa. No sustituye los goles.",
    });
  }
  if (ctx && ctx.h2hN >= 3 && !dixonLambda(home.name, away.name, home.leagueId)) {
    const h2hHome = shrinkRate(ctx.h2hHomeGf / ctx.h2hN, ctx.h2hN, avg, 8);
    const h2hAway = shrinkRate(ctx.h2hAwayGf / ctx.h2hN, ctx.h2hN, avg, 8);
    lambdaHome = lambdaHome * 0.85 + h2hHome * 0.15;
    lambdaAway = lambdaAway * 0.85 + h2hAway * 0.15;
    adjustments.push({
      key: "h2h",
      value: 0.15,
      note: `${ctx.h2hN} enfrentamientos de los tres años previos. Peso 15%, no más.`,
    });
  }
  lambdaHome = clampLambda(lambdaHome);
  lambdaAway = clampLambda(lambdaAway);
  const levelA = dixonLambda(home.name, away.name, home.leagueId);
  let rho = -0.08;
  let level: "A" | "B" | "C" = seasonUsable && !thin ? "B" : "C";
  if (levelA) {
    lambdaHome = levelA.lambdaHome;
    lambdaAway = levelA.lambdaAway;
    rho = levelA.rho;
    level = "A";
    adjustments.push({
      key: "nivel-a",
      value: levelA.rho,
      note: `Nivel A: Dixon-Coles de football-data.co.uk, ajustado solo con partidos anteriores al 4 oct 2026. Rho ${levelA.rho.toFixed(3)}.`,
    });
    if (ctx?.homeRest != null && ctx.homeRest < 4) {
      lambdaHome = bounded(lambdaHome, 0.97).next;
      adjustments.push({
        key: "descanso-local",
        value: -0.03,
        note: `Descanso local de ${ctx.homeRest.toFixed(1)} días, aplicado sobre el Nivel A. Ajuste −3%.`,
      });
    }
    if (ctx?.awayRest != null && ctx.awayRest < 4) {
      lambdaAway = bounded(lambdaAway, 0.97).next;
      adjustments.push({
        key: "descanso-visita",
        value: -0.03,
        note: `Descanso visitante de ${ctx.awayRest.toFixed(1)} días, aplicado sobre el Nivel A. Ajuste −3%.`,
      });
    }
    const implied = marketGoals(levelA.leagueId, home.name, away.name);
    if (implied) {
      lambdaHome = lambdaHome * 0.5 + implied.home * 0.5;
      lambdaAway = lambdaAway * 0.5 + implied.away * 0.5;
      adjustments.push({
        key: "fuerza-cierre",
        value: 0.5,
        note: "Mitad Dixon-Coles y mitad fuerza de los cierres. El peso 0,5 se eligió en 2025/26.",
      });
    }
  }

  const linked = AGENDA.find((match) => match.fixtureId === fixture.id);
  const nation = linked ? nationModel(linked.home, linked.away, linked.competition) : null;
  if (nation) {
    lambdaHome = nation.lambdaHome;
    lambdaAway = nation.lambdaAway;
    rho = -0.08;
    level = "B";
    adjustments.push({
      key: "elo-5.4",
      value: nation.eloHome - nation.eloAway,
      note: `Sección 5.4: Elo de eloratings.net ${nation.eloHome} contra ${nation.eloAway}. Sustituye la tabla de liga. Regresión de ${nation.fit}, ${nation.n} partidos anteriores al 5 oct 2026.`,
    });
  }

  const board = scoreboard(lambdaHome, lambdaAway, rho);
  const p1x2 = board.p1x2;
  const pOver25 = board.pOver25;
  const pBttsYes = board.pBttsYes;
  const mostLikely = board.topScores[0] ?? { hg: 0, ag: 0, p: 0 };
  const cornerHome = rate(home.corners, home.cornersPlayed);
  const cornerAway = rate(away.corners, away.cornersPlayed);
  const publishedCornerLine = findBook(home.name, away.name)?.cornersLine ?? fixture.market?.cornersLine;
  const hasCornerLine = typeof publishedCornerLine === "number" && publishedCornerLine > 0;
  const cornersLine = hasCornerLine ? publishedCornerLine : 0;
  const pCornersOver =
    hasCornerLine && cornerHome != null && cornerAway != null
      ? poissonAtLeast(Math.floor(cornersLine) + 1, cornerHome + cornerAway)
      : null;
  const eloHomeWin =
    home.elo != null && away.elo != null ? 1 / (1 + 10 ** (-(home.elo - away.elo) / 400)) : null;
  const reasons = [
    useXg
      ? `Goles esperados con el xG de FotMob, contraídos hacia la media de la liga (${fmt(avg)}) con 6 partidos de peso: ${home.short} ${fmt(homeXg!)} a favor y ${fmt(homeXga!)} en contra (${home.xgPlayed} PJ); ${away.short} ${fmt(awayXg!)} y ${fmt(awayXga!)} (${away.xgPlayed} PJ). La forma no se vuelve a multiplicar: esos partidos ya están en la tasa.`
      : `Sin xG de FotMob para los dos. Goles de ESPN contraídos hacia la media de la liga (${fmt(avg)}): ${home.short} ${home.gf} GF en ${home.gp} PJ, ${away.short} ${away.gf} GF en ${away.gp} PJ. Una racha corta no manda sola.`,
    cornerHome != null && cornerAway != null
      ? `Córners a favor en FotMob: ${home.short} ${fmt(cornerHome)} por partido, ${away.short} ${fmt(cornerAway)}.`
      : "FotMob no publicó córners para los dos equipos. Ese mercado queda en blanco.",
    home.elo != null && away.elo != null
      ? `Elo de eloratings.net: ${home.short} ${home.elo}, ${away.short} ${away.elo}. La expectativa de victoria del local, sin modelar el empate, es ${fmt(eloHomeWin! * 100)}%.${fixture.leagueId === "selecciones" || fixture.leagueId === "ucl" ? " En copa o selección entra un ajuste acotado." : " No entra en el 1X2 de liga."}`
      : "No hay Elo de clubes: ClubElo respondió 502 el 3 oct 2026 y BeSoccer bloqueó las fichas. No se inventa un Elo.",
  ];
  reasons.push(...adjustments.map((item) => item.note));
  if (/vuelta|eliminatoria/i.test(`${fixture.round} ${fixture.note ?? ""}`)) {
    reasons.push("No hay marcador global publicado. No se calcula la probabilidad de clasificar.");
  }

  const { provider, quoted } = quotedFrom(fixture, home.name, away.name);
  const sample = Math.min(home.xgPlayed || home.gp, away.xgPlayed || away.gp);
  const hasOdds = quoted.home != null && quoted.draw != null && quoted.away != null;
  const confidenceBits = confidenceFrom({
    useXg,
    sample,
    recentHome: ctx?.homeN ?? 0,
    recentAway: ctx?.awayN ?? 0,
    lineupHome: ctx?.lineupHome ?? false,
    lineupAway: ctx?.lineupAway ?? false,
    hasOdds,
    seasonUsable,
  });
  const marketFair =
    quoted.home != null && quoted.draw != null && quoted.away != null
      ? shin(quoted.home, quoted.draw, quoted.away) ?? devig(quoted.home, quoted.draw, quoted.away)
      : null;
  const call = valueCall(p1x2, marketFair, confidenceBits.label);
  reasons.push(confidenceBits.reason);
  if (call.flag === "revisar") {
    reasons.push("Revisar: el modelo y la cuota sin margen difieren más de 10 puntos. No es valor.");
  }
  if (provider === "Wplay") {
    reasons.push(
      `Cuotas de Wplay.co leídas del cupón público (${BOOK_FETCHED_AT}). Betano no entregó el cupón. BetPlay y Rushbet abrieron, pero el precio no viene en el HTML. No es una recomendación.`,
    );
  } else if (provider) {
    reasons.push(
      `Cuotas 1X2 de ${provider}, vía ESPN. Wplay no listaba este partido en el tablero leído. No son una recomendación.`,
    );
  } else {
    reasons.push(
      "Ni Wplay ni ESPN publicaron cuota para este partido. La cuota justa es solo el inverso de la probabilidad.",
    );
  }

  return {
    fixtureId: fixture.id,
    lambdaHome: Number(lambdaHome.toFixed(2)),
    lambdaAway: Number(lambdaAway.toFixed(2)),
    p1x2,
    pOver25,
    pUnder25: 1 - pOver25,
    pBttsYes,
    pBttsNo: 1 - pBttsYes,
    pDc1x: p1x2.home + p1x2.draw,
    pDc12: p1x2.home + p1x2.away,
    pDcX2: p1x2.draw + p1x2.away,
    fair: fairFrom(p1x2, pOver25, pBttsYes),
    quoted,
    quoteProvider: provider,
    confidence: confidenceBits.score,
    confidenceLabel: confidenceBits.label,
    matrix: board.matrix,
    mostLikelyScore: mostLikely,
    reasons,
    inputs: useXg
      ? `xG y córners: FotMob. Marcador y tabla: ESPN. Goles previos: ficha del corte, solo anteriores al inicio. ${home.eloSource ?? away.eloSource ?? "Elo de clubes no publicado en este corte."}`
      : `Marcador y tabla: ESPN. Goles previos: ficha del corte, solo anteriores al inicio. ${home.statsSource ?? "Sin xG de FotMob."}`,
    cornerHome,
    cornerAway,
    pCornersOver,
    pCornersUnder: pCornersOver == null ? null : 1 - pCornersOver,
    cornersLine,
    eloHome: home.elo,
    eloAway: away.elo,
    eloHomeWin,
    topScores: board.topScores,
    adjustments,
    marketFair,
    valueFlag: call.flag,
    valueSide: call.side,
    valueGap: call.gap,
    confidenceReason: confidenceBits.reason,
    pQualify: null,
    level,
  };
}

const ANALYSIS_CACHE = new Map<string, MatchAnalysis>();

export function getAnalysis(fixture: Fixture): MatchAnalysis {
  const cached = ANALYSIS_CACHE.get(fixture.id);
  if (cached) return cached;
  const analysis = analyzeFixture(fixture);
  ANALYSIS_CACHE.set(fixture.id, analysis);
  return analysis;
}

const IMPORTANCE: Record<string, number> = {
  selecciones: 0,
  ucl: 1,
  epl: 2,
  laliga: 2,
  seriea: 2,
  bundesliga: 2,
  ligue1: 2,
  colombia: 3,
  argentina: 3,
  brasileirao: 3,
  ligamx: 4,
  eredivisie: 4,
  portugal: 4,
  mls: 4,
};

export const ANALYSIS_FAILURES: { fixtureId: string; message: string }[] = [];

export function allAnalyses(): { fixture: Fixture; analysis: MatchAnalysis }[] {
  const ranked = [...FIXTURES].sort(
    (a, b) => (IMPORTANCE[a.leagueId] ?? 5) - (IMPORTANCE[b.leagueId] ?? 5) || a.kickoff.localeCompare(b.kickoff),
  );
  const ready: { fixture: Fixture; analysis: MatchAnalysis }[] = [];
  for (let index = 0; index < ranked.length; index += 10) {
    for (const fixture of ranked.slice(index, index + 10)) {
      try {
        ready.push({ fixture, analysis: getAnalysis(fixture) });
      } catch (error) {
        ANALYSIS_FAILURES.push({
          fixtureId: fixture.id,
          message: error instanceof Error ? error.message : "fallo sin mensaje",
        });
      }
    }
  }
  return ready;
}

export function expectedValue(probability: number, decimalOdds: number): number {
  if (decimalOdds <= 1) return -1;
  return probability * decimalOdds - 1;
}

export function bestOneXTwoValue(analysis: MatchAnalysis): {
  key: "home" | "draw" | "away";
  ev: number;
  odds: number;
  p: number;
} | null {
  const sides = [
    { key: "home" as const, p: analysis.p1x2.home, odds: analysis.quoted.home },
    { key: "draw" as const, p: analysis.p1x2.draw, odds: analysis.quoted.draw },
    { key: "away" as const, p: analysis.p1x2.away, odds: analysis.quoted.away },
  ].filter((side): side is { key: "home" | "draw" | "away"; p: number; odds: number } =>
    typeof side.odds === "number",
  );
  if (sides.length === 0) return null;
  return sides
    .map((side) => ({ ...side, ev: expectedValue(side.p, side.odds) }))
    .sort((a, b) => b.ev - a.ev)[0];
}

export function rateLine(team: Team, side: "home" | "away"): string {
  const split = side === "home" ? team.home : team.away;
  if (split.gp <= 0) return "sin partidos";
  return `${(split.gf / split.gp).toFixed(2)} GF / ${(split.ga / split.gp).toFixed(2)} GC · ${split.gp} PJ`;
}
