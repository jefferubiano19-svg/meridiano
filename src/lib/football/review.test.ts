import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rivalScores, shin } from "./engine";
import { medianConsensus } from "./mercados";
import {
  agendaIndex,
  anomaliesOf,
  buildReview,
  calibrationOf,
  cutsSummary,
  evaluationOf,
  pickRuleV2Of,
  pickTiersOf,
  resultsOf,
  rivalGoalOf,
  verdictOf,
  type ByMatch,
  type CutRow,
  type MarkRow,
  type PredictionRow,
  type ReviewInput,
  type Stat,
} from "./review";

/* Medición de «Valor del día» contra el cierre: la misma regla de consenso con que se registró la selección. */

const books = [
  // Cada mediana sale de una casa distinta, así que las tres medianas no suman 1.
  { house: "Betano.co", odds: [1.9, 3.6, 4.2] },
  { house: "Wplay.co", odds: [2.2, 3.1, 3.4] },
  { house: "Bwin.co", odds: [2.0, 3.8, 3.5] },
  { house: "bet365.us", odds: [5, 5, 5] },
];

function review(pick: Record<string, unknown>, score: [number, number]) {
  return buildReview({
    now: Date.parse("2026-11-23T12:00:00Z"),
    cuts: [],
    predictions: [],
    evaluations: {},
    marks: [],
    closings: { m1: { books: books.map((book) => ({ ...book })) } },
    picks: [{ matchId: "m1", house: "Betano", kickoff: "2026-11-22T15:00:00-05:00", ...pick }],
    favorites: [],
    agenda: [["m1", "2026-11-22T15:00:00-05:00", "COLOMBIA: Liga", "A", "B", "finalizado", score[0], score[1]]],
    standings: [],
  } as unknown as Parameters<typeof buildReview>[0]);
}

const closing = medianConsensus(books.slice(0, 3).map((book) => shin(book.odds[0], book.odds[1], book.odds[2])!))!;
const near = (actual: number | null | undefined, expected: number) => assert.ok(Math.abs((actual ?? NaN) - expected) < 1e-12, `${actual} ≠ ${expected}`);

describe("medición contra el cierre", () => {
  it("1X2: valor contra el consenso de cierre normalizado, como el de registro", () => {
    const result = review({ outcomeIndex: 0, odds: 2.2, prob: 0.5 }, [2, 0]).pickResults;
    assert.equal(result.closed, 1);
    assert.ok(Math.abs((result.evClose.mean ?? 0) - (2.2 * closing[0] - 1)) < 1e-12);
    assert.equal(result.settled, 1);
    assert.ok(Math.abs((result.roi.mean ?? 0) - 1.2) < 1e-12);
  });

  it("doble oportunidad y empate no válido usan el mismo consenso", () => {
    const dc = review({ market: "dc", outcomeIndex: 2, odds: 2.0, prob: 0.5 }, [1, 1]).pickResults;
    assert.ok(Math.abs((dc.evClose.mean ?? 0) - (2.0 * (closing[1] + closing[2]) - 1)) < 1e-12);
    const dnb = review({ market: "dnb", outcomeIndex: 0, odds: 1.5, prob: 0.5, pDraw: 0.3 }, [1, 1]).pickResults;
    assert.ok(Math.abs((dnb.evClose.mean ?? 0) - (1.5 * closing[0] + closing[1] - 1)) < 1e-12);
    assert.equal(dnb.roi.mean, 0);
  });
});

/* ---- resultsOf: la medición del dinero (pickResults decide la regla de 300) --------------------------- */

type Agenda = ReviewInput["agenda"];
const played = (id: string, home: number, away: number): Agenda[number] => [id, "2026-11-22T15:00:00-05:00", "COLOMBIA: Liga", "A", "B", "finalizado", home, away, null, null];
const agenda: Agenda = [
  played("home", 2, 0),
  played("draw", 1, 1),
  played("away", 0, 3),
  ["pending", "2026-11-24T15:00:00-05:00", "COLOMBIA: Liga", "A", "B", "por-jugar", null, null, null, null],
  ["noScore", "2026-11-22T15:00:00-05:00", "COLOMBIA: Liga", "A", "B", "finalizado", 1, null, null, null],
];
const index = agendaIndex(agenda);
const pick = (matchId: string, outcomeIndex: number, odds: number, extra: Partial<MarkRow> = {}): MarkRow => ({ matchId, house: "Betano", outcomeIndex, odds, ...extra });
const measure = (list: MarkRow[], closings: NonNullable<ReviewInput["closings"]> = {}) => resultsOf(list, index, closings);

describe("resultsOf: liquidación", () => {
  it("1X2: gana cuota − 1, pierde −1, y solo cuenta lo ya jugado con marcador", () => {
    const result = measure([pick("home", 0, 2.5), pick("home", 2, 4), pick("pending", 0, 2), pick("noScore", 0, 2), pick("unknown", 0, 2)]);
    assert.equal(result.settled, 2);
    near(result.roi.mean, (1.5 - 1) / 2);
  });

  it("empate y visita se reconocen por el marcador", () => {
    assert.equal(measure([pick("draw", 1, 3.2)]).roi.mean, 2.2);
    near(measure([pick("away", 2, 4.5)]).roi.mean, 3.5);
    assert.equal(measure([pick("away", 0, 1.5)]).roi.mean, -1);
    assert.equal(measure([pick("draw", 0, 1.5)]).roi.mean, -1);
  });

  it("doble oportunidad gana con cualquiera de sus dos resultados; empate no válido devuelve en empate", () => {
    near(measure([pick("draw", 0, 1.3, { market: "dc" })]).roi.mean, 0.3); // 1X con empate
    assert.equal(measure([pick("draw", 1, 1.3, { market: "dc" })]).roi.mean, -1); // 12 con empate
    assert.equal(measure([pick("draw", 0, 1.6, { market: "dnb" })]).roi.mean, 0);
    near(measure([pick("away", 2, 1.6, { market: "dnb" })]).roi.mean, 0.6);
    assert.equal(measure([pick("home", 2, 1.6, { market: "dnb" })]).roi.mean, -1);
  });

  it("deja fuera las filas que no se pueden medir", () => {
    const result = measure([
      pick("home", 0, 1), // cuota 1 no paga nada
      pick("home", 0, Number.NaN),
      { house: "Betano", outcomeIndex: 0, odds: 2 }, // sin partido
      pick("home", 0.5, 2), // resultado no entero
      { matchId: "home", house: "Betano", odds: 2 }, // sin resultado
      pick("home", 0, 2, { market: "ou" }), // otro mercado
    ]);
    assert.equal(result.settled, 0);
    assert.deepEqual(result.roi, { n: 0, mean: null, low: null, high: null });
  });

  it("una fila repetida (mismo partido, mercado, casa y resultado) cuenta una vez; la casa sin dominio ni mayúsculas", () => {
    const result = measure([pick("home", 0, 2.5, { house: "Betano.co" }), pick("home", 0, 3, { house: "betano" }), pick("home", 0, 2.5, { market: "1x2", house: "BETANO.CO" })]);
    assert.equal(result.settled, 1);
    assert.equal(result.roi.mean, 1.5); // la primera que aparece
  });

  it("cambia el resultado, el mercado o la casa: son filas distintas", () => {
    const result = measure([pick("home", 0, 2.5), pick("home", 2, 4), pick("home", 0, 1.3, { market: "dc" }), pick("home", 0, 2.6, { house: "Wplay" })]);
    assert.equal(result.settled, 4);
  });
});

describe("resultsOf: valor al cierre", () => {
  const closings = () => ({ home: { books: books.map((book) => ({ ...book, odds: [...book.odds] })) } });

  it("clvHouse: cuota contra la misma casa al cierre (sin dominio ni mayúsculas) − 1", () => {
    const result = measure([pick("home", 0, 2.28, { house: "WPLAY" })], closings());
    assert.equal(result.clvHouse.n, 1);
    near(result.clvHouse.mean, 2.28 / 2.2 - 1);
    assert.equal(result.closed, 1);
    near(result.evClose.mean, 2.28 * closing[0] - 1);
  });

  it("sin la casa en el cierre no hay clvHouse, pero sí valor contra el consenso", () => {
    const result = measure([pick("home", 0, 2.1, { house: "Stake" })], closings());
    assert.equal(result.clvHouse.n, 0);
    assert.equal(result.closed, 1);
  });

  it("dc y dnb no tienen clvHouse: el cierre guardado es de la 1X2", () => {
    const result = measure([pick("home", 0, 1.3, { market: "dc" }), pick("home", 0, 1.5, { market: "dnb" })], closings());
    assert.equal(result.clvHouse.n, 0);
    assert.equal(result.closed, 2);
  });

  it("una cuota de cierre de 1 o menos no se usa para clvHouse", () => {
    const close = closings();
    close.home.books[0].odds[0] = 1;
    assert.equal(measure([pick("home", 0, 2)], close).clvHouse.n, 0);
  });

  it("solo cuentan las 5 casas colombianas: con 2 y bet365 no hay consenso de cierre", () => {
    const result = measure([pick("home", 0, 2, { house: "bet365.us" })], { home: { books: [books[0], books[1], books[3]] } });
    assert.equal(result.closed, 0);
    assert.equal(result.clvHouse.n, 0); // bet365 no es la misma casa: no está entre las leídas
  });

  it("sin cierre, o con libros vacíos, no se compara", () => {
    assert.equal(measure([pick("home", 0, 2)], { home: { books: [] } }).closed, 0);
    assert.equal(measure([pick("home", 0, 2)], { home: {} }).closed, 0);
    assert.equal(measure([pick("home", 0, 2)]).closed, 0);
  });

  it("no cambia los cierres que recibe", () => {
    const close = closings();
    measure([pick("home", 0, 2)], close);
    assert.equal(close.home.books.length, 4);
  });

  it("el veredicto sale del valor al cierre", () => {
    assert.match(measure([pick("home", 0, 2)], closings()).verdict, /^sin conclusión: 1 con cierre/);
  });
});

describe("verdictOf: lectura del valor al cierre", () => {
  const s = (n: number, low: number | null, high: number | null): Stat => ({ n, mean: 0, low, high });

  it("menos de 30 cierres: sin conclusión, diga lo que diga el intervalo", () => {
    assert.equal(verdictOf(s(29, 0.1, 0.2)), "sin conclusión: 29 con cierre de 3+ casas (hacen falta 30 para una primera lectura y 100 para decidir)");
  });

  it("de 30 a 99: primera lectura", () => {
    assert.equal(verdictOf(s(30, 0.01, 0.2)), "primera lectura favorable: le ganan al cierre en 30 (preliminar; se confirma con 100)");
    assert.equal(verdictOf(s(99, -0.2, -0.01)), "primera lectura desfavorable: pierden contra el cierre en 99 (preliminar; se confirma con 100)");
    assert.equal(verdictOf(s(50, -0.1, 0.1)), "primera lectura: todavía no se distingue de cero en 50 (se decide con 100)");
    assert.equal(verdictOf(s(50, 0, 0.1)), "primera lectura: todavía no se distingue de cero en 50 (se decide con 100)");
    assert.equal(verdictOf(s(50, -0.1, 0)), "primera lectura: todavía no se distingue de cero en 50 (se decide con 100)");
  });

  it("100 o más: decide", () => {
    assert.equal(verdictOf(s(100, 0.01, 0.2)), "le ganan al cierre: hay ventaja medida");
    assert.equal(verdictOf(s(205, -0.2, -0.01)), "pierden contra el cierre: no hay ventaja");
    assert.equal(verdictOf(s(100, -0.1, 0.1)), "todavía no se distingue de cero");
    assert.equal(verdictOf(s(100, 0, 0.1)), "todavía no se distingue de cero");
    assert.equal(verdictOf(s(100, -0.1, 0)), "todavía no se distingue de cero");
    assert.equal(verdictOf(s(100, null, null)), "todavía no se distingue de cero");
  });
});

describe("regla v2 y tramos de «Valor del día»", () => {
  const picks = [
    { ...pick("home", 0, 2.5), rule: "v2", prob: 0.45, savedAt: "2026-11-06T10:00:00-05:00" },
    { ...pick("draw", 0, 1.3, { market: "dc" }), rule: "v2", source: "hora", prob: 0.8, savedAt: "2026-11-12T10:00:00-05:00" },
    { ...pick("away", 2, 1.6, { market: "dnb" }), rule: "v2", source: "corte", prob: 0.5, savedAt: "2026-11-07T10:00:00-05:00" },
    { ...pick("away", 0, 3.5), prob: 0.3, savedAt: "2026-11-05T00:00:00-05:00" },
    { ...pick("home", 2, 6), prob: 0.15, savedAt: "2026-11-04T23:59:00-05:00" },
  ];
  const count: Parameters<typeof pickRuleV2Of>[1] = (list) => ({ ...resultsOf(list, index, {}), verdict: list.map((row) => row.matchId).join(",") });

  it("v2: total, por mercado y por origen (sin origen = corte)", () => {
    const v2 = pickRuleV2Of(picks, count);
    assert.equal(v2.all.verdict, "home,draw,away");
    assert.deepEqual(
      v2.byMarket.map((row) => [row.market, row.results.verdict]),
      [
        ["1x2", "home"],
        ["dc", "draw"],
        ["dnb", "away"],
      ],
    );
    assert.deepEqual(
      v2.bySource.map((row) => [row.source, row.results.verdict]),
      [
        ["corte", "home,away"],
        ["hora", "draw"],
      ],
    );
  });

  it("tramos acumulados y prueba limpia desde el 5 nov", () => {
    const tiers = pickTiersOf(picks, count);
    assert.deepEqual(
      tiers.map((tier) => [tier.key, tier.label, tier.since, tier.all.verdict, tier.forward.verdict]),
      [
        ["alta", "40 % o más", "2026-11-05", "home,draw,away", "home,draw,away"],
        ["media", "25 % o más", "2026-11-05", "home,draw,away,away", "home,draw,away,away"],
        ["todas", "todas", "2026-11-05", "home,draw,away,away,home", "home,draw,away,away"],
      ],
    );
    assert.equal(pickTiersOf([{ ...pick("home", 0, 2), prob: 0.4 }], count)[0].all.verdict, "home");
    assert.equal(pickTiersOf([{ ...pick("home", 0, 2) }], count)[2].all.verdict, "");
  });
});

/* ---- Semáforo de cortes ------------------------------------------------------------------------------- */

describe("cutsSummary: semáforo de cortes", () => {
  // 23 nov 2026 07:00 en Bogotá: la ventana empieza el 16 nov a las 07:00.
  const now = Date.parse("2026-11-23T12:00:00Z");
  const from = now - 7 * 24 * 3600 * 1000;
  const days = ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];
  const cut = (date: string, corte: string, clock: string, extra: Partial<CutRow> = {}): CutRow => ({ cut: date, corte, startedAtBogota: `${date}T${clock}:00-05:00`, ...extra });
  const week = (): CutRow[] => [
    cut("2026-11-16", "mediodia", "12:03"),
    ...days.flatMap((date) => [cut(date, "noche", "00:20"), cut(date, "mediodia", "12:05")]),
    cut("2026-11-23", "noche", "00:16"),
  ];

  it("14 turnos a tiempo: verde", () => {
    const summary = cutsSummary(week(), from, now);
    assert.deepEqual([summary.light, summary.expected, summary.done, summary.late, summary.fatal], ["verde", 14, 14, 0, 0]);
    assert.equal(summary.list.length, 14);
    assert.deepEqual(summary.list[0], { when: "2026-11-16T12:03:00-05:00", corte: "mediodia", delayMin: 3, predictions: null, withConsensus: null, failures: 0 });
    assert.equal(summary.list[1].delayMin, 5); // noche: 00:15
  });

  it("falta uno o dos: amarillo; faltan tres: rojo", () => {
    // Se quitan turnos del medio: quitar el primero también corre «el primer corte registrado».
    assert.deepEqual(
      [[5], [5, 8], [3, 5, 8]].map((gone) => {
        const summary = cutsSummary(week().filter((_, i) => !gone.includes(i)), from, now);
        return [summary.light, summary.expected, summary.done];
      }),
      [
        ["amarillo", 14, 13],
        ["amarillo", 14, 12],
        ["rojo", 14, 11],
      ],
    );
  });

  it("un corte fatal: rojo", () => {
    const cuts = week();
    cuts[5] = { ...cuts[5], fatal: true };
    const summary = cutsSummary(cuts, from, now);
    assert.deepEqual([summary.light, summary.fatal], ["rojo", 1]);
  });

  it("más de 15 min tarde: amarillo; 15 justos, a tiempo", () => {
    const cuts = week();
    cuts[2] = cut("2026-11-17", "mediodia", "12:16");
    const late = cutsSummary(cuts, from, now);
    assert.deepEqual([late.light, late.late], ["amarillo", 1]);
    cuts[2] = cut("2026-11-17", "mediodia", "12:15");
    assert.equal(cutsSummary(cuts, from, now).light, "verde");
  });

  it("la tarde se programa a las 17:00 y un corte sin fecha no tiene retraso", () => {
    const list = cutsSummary([cut("2026-11-20", "tarde", "17:30"), { ...cut("2026-11-20", "noche", "01:00"), cut: null }], from, now).list;
    assert.deepEqual(
      list.map((row) => row.delayMin),
      [30, null],
    );
  });

  it("copia los conteos del corte", () => {
    const [row] = cutsSummary([cut("2026-11-20", "noche", "00:15", { predictionsSaved: 400, predictionsWithConsensus: 120, failures: 2 })], from, now).list;
    assert.deepEqual([row.predictions, row.withConsensus, row.failures], [400, 120, 2]);
  });

  it("no espera turnos antes del primer corte registrado ni de la última hora", () => {
    const first = cutsSummary([cut("2026-11-22", "mediodia", "12:00")], from, now);
    assert.deepEqual([first.expected, first.done, first.light], [2, 1, "amarillo"]); // 22 mediodía y 23 noche
    const hourAgo = Date.parse("2026-11-23T00:15:00-05:00") + 3600 * 1000;
    assert.equal(cutsSummary(week(), from, hourAgo).expected, 14);
    assert.equal(cutsSummary(week(), from, hourAgo - 1).expected, 13);
    assert.equal(cutsSummary([cut("2026-11-22", "mediodia", "13:00")], from, now).expected, 2); // 12:00 = 13:00 − 1 h: entra
    assert.equal(cutsSummary([cut("2026-11-22", "mediodia", "13:01")], from, now).expected, 1); // 12:00 < 13:01 − 1 h: no
  });

  it("sin cortes no se espera nada; los de fuera de la ventana no cuentan", () => {
    assert.deepEqual(cutsSummary([], from, now), { light: "verde", expected: 0, done: 0, late: 0, fatal: 0, list: [] });
    const old = cutsSummary([cut("2026-11-10", "noche", "00:15", { fatal: true }), cut("2026-11-23", "mediodia", "12:00"), { cut: null, corte: null, startedAtBogota: null }], from, now);
    assert.deepEqual([old.list.length, old.fatal], [0, 0]);
  });
});

/* ---- Evaluación y etapas ------------------------------------------------------------------------------ */

const evaluated = (n: number, diff: (i: number) => number, extra: Partial<ByMatch> = {}): ByMatch[] =>
  Array.from({ length: n }, (_, i) => ({ matchId: `m${i}`, rowId: `r${i}`, actual: "home", comparable: true, rpsModel: 0.3, rpsPublished: 0.2 + diff(i), rpsConsensus: 0.2, ...extra }));
const spread = (center: number) => (i: number) => center + (i % 2 ? 0.001 : -0.001);

describe("evaluationOf: etapa y semáforo", () => {
  it("etapas: < 150 muestra insuficiente (gris), 150–499 preliminar, ≥ 500 formal", () => {
    assert.deepEqual(
      [149, 150, 499, 500].map((n) => {
        const evaluation = evaluationOf(evaluated(n, spread(-0.01)), new Map(), 500);
        return [evaluation.stage, evaluation.light];
      }),
      [
        ["muestra insuficiente", "gris"],
        ["lectura preliminar", "verde"],
        ["lectura preliminar", "verde"],
        ["medición formal", "verde"],
      ],
    );
  });

  it("verde si la publicada le gana al consenso, rojo si pierde, amarillo si no se distingue", () => {
    const light = (rows: ByMatch[]) => evaluationOf(rows, new Map(), 500).light;
    assert.equal(light(evaluated(200, spread(0.01))), "rojo");
    assert.equal(light(evaluated(200, (i) => (i % 2 ? 0.01 : -0.01))), "amarillo");
    assert.equal(light(evaluated(200, (i) => (i % 2 ? 0.01 : -0.011))), "amarillo"); // media negativa, IC cruza el cero
  });

  it("solo cuentan los comparables con las dos RPS; los demás entran en evaluados", () => {
    const rows = [...evaluated(3, () => 0.03), ...evaluated(1, () => 0, { comparable: false }), ...evaluated(1, () => 0, { rpsConsensus: null }), ...evaluated(1, () => 0, { rpsPublished: null })];
    const evaluation = evaluationOf(rows, new Map(), 400);
    assert.deepEqual([evaluation.evaluated, evaluation.comparable, evaluation.goal, evaluation.light], [6, 3, 400, "gris"]);
    near(evaluation.distance.mean, 0.03);
    near(evaluation.rpsPublished, 0.23);
    near(evaluation.rpsConsensus, 0.2);
    near(evaluation.rpsModel, 0.3);
  });

  it("por nivel de la predicción, en orden alfabético; sin fila o sin nivel va a «?»", () => {
    const rows = [
      ...evaluated(2, () => 0.01).map((row, i) => ({ ...row, rowId: `b${i}`, publishedRps: 0.5 })),
      ...evaluated(1, () => 0.02).map((row) => ({ ...row, rowId: "a0" })),
      ...evaluated(1, () => 0).map((row) => ({ ...row, rowId: null, comparable: false })),
      ...evaluated(1, () => 0).map((row) => ({ ...row, rowId: "z0", rpsPublished: null })),
    ];
    const level = (id: string, value?: string) => [id, { id, level: value } as PredictionRow] as const;
    const evaluation = evaluationOf(rows, new Map([level("b0", "B"), level("b1", "B"), level("a0", "A"), level("z0")]), 500);
    assert.deepEqual(
      evaluation.byLevel.map((row) => [row.level, row.n, row.comparable]),
      [
        ["?", 2, 0],
        ["A", 1, 1],
        ["B", 2, 2],
      ],
    );
    assert.equal(evaluation.byLevel[2].rpsPublished, 0.5); // la RPS publicada guardada aparte manda
    near(evaluation.byLevel[1].rpsPublished, 0.22);
    near(evaluation.byLevel[2].distance.mean, 0.01);
    assert.equal(evaluation.byLevel[0].rpsPublished, 0.2); // la que tiene, sin la nula
  });
});

/* ---- Calibración por tramos --------------------------------------------------------------------------- */

describe("calibrationOf: favorito publicado contra lo que pasó", () => {
  const rows = (cases: [Partial<Record<"home" | "draw" | "away", number>>, ByMatch["actual"]][]) => {
    const byMatch: ByMatch[] = cases.map(([, actual], i) => ({ matchId: `m${i}`, rowId: `r${i}`, actual, comparable: true, rpsModel: null, rpsPublished: null, rpsConsensus: null }));
    const predictions = new Map(cases.map(([way], i) => [`r${i}`, { id: `r${i}`, published: { home: 0, draw: 0, away: 0, ...way } } as PredictionRow]));
    return calibrationOf(byMatch, predictions);
  };

  it("siete tramos de 30 % a 100 %", () => {
    assert.deepEqual(
      rows([]).map((bin) => [bin.label, bin.n, bin.expected, bin.observed]),
      ["30–40 %", "40–50 %", "50–60 %", "60–70 %", "70–80 %", "80–90 %", "90–100 %"].map((label) => [label, 0, null, null]),
    );
  });

  it("el favorito puede ser local, empate o visita, y acierta si pasó eso", () => {
    const bins = rows([
      [{ home: 0.45, draw: 0.3, away: 0.25 }, "home"],
      [{ home: 0.25, draw: 0.42, away: 0.33 }, "home"],
      [{ home: 0.2, draw: 0.32, away: 0.48 }, "away"],
      [{ home: 0.2, draw: 0.31, away: 0.49 }, "draw"],
    ]);
    assert.equal(bins[1].n, 4);
    near(bins[1].expected, (0.45 + 0.42 + 0.48 + 0.49) / 4);
    assert.equal(bins[1].observed, 0.5);
  });

  it("en un empate de probabilidades el favorito es el local", () => {
    assert.equal(rows([[{ home: 0.4, draw: 0.4, away: 0.2 }, "home"]])[1].observed, 1);
    assert.equal(rows([[{ home: 0.2, draw: 0.4, away: 0.4 }, "draw"]])[1].observed, 1);
  });

  it("bordes: 30 % entra, menos no; 90 % y 100 % van al último tramo", () => {
    const bins = rows([
      [{ home: 0.3 }, "home"],
      [{ home: 0.2999 }, "home"],
      [{ home: 0.6 }, "draw"],
      [{ home: 0.9 }, "home"],
      [{ home: 1 }, "home"],
    ]);
    assert.deepEqual(
      bins.map((bin) => bin.n),
      [1, 0, 0, 1, 0, 0, 2],
    );
    assert.deepEqual([bins[0].observed, bins[3].observed, bins[6].observed], [1, 0, 1]);
  });

  it("sin predicción publicada no cuenta", () => {
    const byMatch: ByMatch[] = [
      { matchId: "a", rowId: null, actual: "home", comparable: true, rpsModel: null, rpsPublished: null, rpsConsensus: null },
      { matchId: "b", rowId: "r", actual: "home", comparable: true, rpsModel: null, rpsPublished: null, rpsConsensus: null },
    ];
    const bins = calibrationOf(byMatch, new Map([["r", { id: "r", published: null } as PredictionRow]]));
    assert.equal(
      bins.reduce((sum, bin) => sum + bin.n, 0),
      0,
    );
  });
});

/* ---- El rival marca ------------------------------------------------------------------------------------ */

describe("rivalGoalOf", () => {
  const strong = { home: 0.7, draw: 0.2, away: 0.1 };
  const weakHome = { home: 0.15, draw: 0.25, away: 0.6 };
  const ev = (rowId: string | null, score: unknown): ByMatch => ({ matchId: String(rowId), rowId, actual: "home", comparable: true, rpsModel: null, rpsPublished: null, rpsConsensus: null, score });
  const preds = new Map<string, PredictionRow>([
    ["s", { id: "s", published: strong } as PredictionRow],
    ["w", { id: "w", published: weakHome } as PredictionRow],
    ["n", { id: "n", published: null } as PredictionRow],
  ]);

  it("mira los goles del no favorito, sea visita o local", () => {
    const pStrong = rivalScores(strong)!;
    const pWeak = rivalScores(weakHome)!;
    assert.equal(pStrong.side, "away");
    assert.equal(pWeak.side, "home");
    const goal = rivalGoalOf([ev("s", [3, 1]), ev("s", [1, 0]), ev("w", [1, 2]), ev("w", [0, 2])], preds);
    assert.equal(goal.n, 4);
    assert.equal(goal.rate, 0.5);
    near(goal.brier, ((pStrong.p - 1) ** 2 + pStrong.p ** 2 + (pWeak.p - 1) ** 2 + pWeak.p ** 2) / 4);
    assert.equal(goal.brierConstant, 0.25);
    const counted = goal.buckets.filter((bucket) => bucket.n > 0);
    assert.equal(
      counted.reduce((sum, bucket) => sum + bucket.n, 0),
      4,
    );
  });

  it("sin marcador, sin fila o sin 1X2 publicada no cuenta", () => {
    const goal = rivalGoalOf([ev("s", null), ev("s", [1]), ev(null, [1, 1]), ev("n", [1, 1]), ev("x", [1, 1])], preds);
    assert.deepEqual([goal.n, goal.rate, goal.brier, goal.brierConstant], [0, null, null, null]);
    assert.deepEqual(
      goal.buckets.map((bucket) => [bucket.label, bucket.n, bucket.expected, bucket.observed]),
      ["menos de 60 %", "60–70 %", "70–80 %", "80–90 %", "90 % o más"].map((label) => [label, 0, null, null]),
    );
  });

  it("cada partido cae en el tramo de su probabilidad", () => {
    const goal = rivalGoalOf([ev("s", [0, 1])], preds);
    const p = rivalScores(strong)!.p;
    const bucket = goal.buckets.find((row) => row.n === 1)!;
    const bounds: Record<string, [number, number]> = { "menos de 60 %": [0, 0.6], "60–70 %": [0.6, 0.7], "70–80 %": [0.7, 0.8], "80–90 %": [0.8, 0.9], "90 % o más": [0.9, 1.01] };
    assert.ok(p >= bounds[bucket.label][0] && p < bounds[bucket.label][1]);
    assert.deepEqual([bucket.expected, bucket.observed], [p, 1]);
  });
});

/* ---- Anomalías ---------------------------------------------------------------------------------------- */

describe("anomaliesOf", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const base = { agenda: [] as Agenda, predictions: [] as PredictionRow[], standings: [] as ReviewInput["standings"], recent: [] as CutRow[], from: now - 7 * 24 * 3600 * 1000, now };
  const count = (data: Partial<typeof base>, key: string) => anomaliesOf({ ...base, ...data }).items.find((item) => item.key === key)!;
  const row = (id: string, kickoff: string, status: string, competition = "COLOMBIA: Liga"): Agenda[number] => [id, kickoff, competition, "A", "B", status, null, null, null, null];
  const prediction = (id: string, extra: Partial<PredictionRow>): PredictionRow => ({ id, matchId: id, kickoff: "2026-11-22T20:00:00Z", calculatedAt: "2026-11-22T10:00:00Z", ...extra });

  it("sin datos: nueve verificaciones en cero y verde", () => {
    const result = anomaliesOf(base);
    assert.equal(result.light, "verde");
    assert.deepEqual(
      result.items.map((item) => [item.key, item.count]),
      ["prefijo", "por-jugar-viejo", "sin-resultado", "id-repetido", "despues-inicio", "suma", "goles", "tablas", "conflictos"].map((key) => [key, 0]),
    );
  });

  it("prefijo en español: amarillo, con hasta 5 ejemplos", () => {
    const agendaRows = Array.from({ length: 6 }, (_, i) => row(`e${i}`, "2026-11-22T20:00:00Z", "finalizado", "ESPAÑA: LaLiga"));
    const result = anomaliesOf({ ...base, agenda: [...agendaRows, row("ok", "2026-11-22T20:00:00Z", "finalizado", "SPAIN: LaLiga")] });
    const item = result.items[0];
    assert.deepEqual([item.count, item.examples.length, item.examples[0], result.light], [6, 5, "e0 ESPAÑA: LaLiga", "amarillo"]);
  });

  it("por jugar de hace más de 48 h (y menos de 9 días)", () => {
    const item = count(
      {
        agenda: [
          row("viejo", "2026-11-20T10:00:00Z", "por-jugar"),
          row("reciente", "2026-11-22T10:00:00Z", "por-jugar"),
          row("antiguo", "2026-11-13T10:00:00Z", "por-jugar"),
          row("jugado", "2026-11-20T10:00:00Z", "finalizado"),
        ],
      },
      "por-jugar-viejo",
    );
    assert.deepEqual(item.examples, ["viejo 2026-11-20T10:00 A - B"]);
  });

  it("sin resultado es informativo: no cambia el verde", () => {
    const result = anomaliesOf({ ...base, agenda: [row("aplazado", "2026-11-20T10:00:00Z", "sin-resultado"), row("viejo", "2026-11-10T10:00:00Z", "sin-resultado")], recent: [{ cut: "2026-11-20", corte: "noche", startedAtBogota: "2026-11-20T00:15:00-05:00", scoreConflicts: 2 }, { cut: "2026-11-21", corte: "noche", startedAtBogota: "x" }] });
    assert.equal(result.light, "verde");
    assert.deepEqual(result.items.find((item) => item.key === "sin-resultado")!.examples, ["aplazado 2026-11-20T10:00 A - B"]);
    assert.deepEqual(result.items.find((item) => item.key === "conflictos")!.examples, ["2026-11-20T00:15:00-05:00: 2"]);
  });

  it("ids repetidos, guardadas después del inicio o que no suman 1: rojo", () => {
    const repeated = anomaliesOf({ ...base, agenda: [row("a", "2026-11-22T20:00:00Z", "finalizado"), row("a", "2026-11-22T20:00:00Z", "finalizado"), row("b", "2026-11-22T20:00:00Z", "finalizado")] });
    assert.deepEqual([repeated.light, repeated.items[3].examples], ["rojo", ["a"]]);
    const late = anomaliesOf({ ...base, predictions: [prediction("tarde", { calculatedAt: "2026-11-22T20:00:00Z" }), prediction("bien", {}), prediction("vieja", { calculatedAt: "2026-11-10T20:00:00Z", kickoff: "2026-11-10T10:00:00Z" })] });
    assert.deepEqual([late.light, late.items[4].examples], ["rojo", ["tarde"]]);
    const sum = anomaliesOf({ ...base, predictions: [prediction("mala", { published: { home: 0.5, draw: 0.3, away: 0.3 } }), prediction("bien", { published: { home: 0.5, draw: 0.3, away: 0.2005 } }), prediction("sin", { published: null })] });
    assert.deepEqual([sum.light, sum.items[5].examples], ["rojo", ["mala"]]);
  });

  it("goles esperados fuera de 0,20 a 4,00 y tablas que no cuadran: amarillo", () => {
    const goals = anomaliesOf({ ...base, predictions: [prediction("bajo", { lambdaHome: 0.19 }), prediction("alto", { lambdaAway: 4.01 }), prediction("borde", { lambdaHome: 0.2, lambdaAway: 4 })] });
    assert.deepEqual([goals.light, goals.items[6].examples], ["amarillo", ["bajo", "alto"]]);
    const tables = anomaliesOf({
      ...base,
      standings: [
        {
          competition: "Liga",
          rows: [
            { team: "Mal", gp: 10, w: 5, d: 3, l: 1, gf: 0, ga: 0 },
            { team: "Bien", gp: 9, w: 5, d: 3, l: 1, gf: 0, ga: 0 },
            { team: "Sin", gp: 9, gf: 0, ga: 0 },
          ],
        },
      ],
    });
    assert.deepEqual([tables.light, tables.items[7].examples], ["amarillo", ["Liga: Mal"]]);
  });
});

/* ---- buildReview: el ensamblado y las secciones sin función exportada ---------------------------------- */

describe("buildReview", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const input = (extra: Partial<ReviewInput>): ReviewInput => ({ now, cuts: [], predictions: [], evaluations: {}, marks: [], agenda: [], standings: [], ...extra });

  it("ventana de 7 días en hora de Bogotá y meta de 500 por defecto", () => {
    const result = buildReview(input({}));
    assert.equal(result.generatedAt, "2026-11-23T12:00:00.000Z");
    assert.deepEqual(result.window, { from: "2026-11-16", to: "2026-11-23" });
    assert.equal(result.evaluation.goal, 500);
    assert.equal(buildReview(input({ evaluations: { goal: 300 } })).evaluation.goal, 300);
  });

  it("cobertura: esta semana (hasta ahora incluido) y la anterior, por nivel y con consenso", () => {
    const p = (id: string, calculatedAt: string, level?: string, consensus?: boolean): PredictionRow => ({ id, matchId: id, kickoff: calculatedAt, calculatedAt, level, consensus: consensus ? { home: 0.5, draw: 0.3, away: 0.2 } : null });
    const result = buildReview(
      input({
        predictions: [
          p("a", "2026-11-23T12:00:00Z", "A", true),
          p("b", "2026-11-16T12:00:00Z", "B"),
          p("c", "2026-11-20T12:00:00Z"),
          p("d", "2026-11-16T11:59:59Z", "A", true),
          p("e", "2026-11-09T12:00:00Z", "C"),
          p("f", "2026-11-09T11:59:59Z", "C"),
          p("g", "2026-11-23T12:00:01Z", "A"),
        ],
      }),
    );
    assert.deepEqual(result.coverage.week, { total: 3, byLevel: { A: 1, B: 1, "?": 1 }, withConsensus: 1 });
    assert.deepEqual(result.coverage.previous, { total: 2, byLevel: { A: 1, C: 1 }, withConsensus: 1 });
  });

  it("valor y CLV de las marcas: solo las que tienen CLV y cuota de cierre > 1", () => {
    const marks = [{ clv: 0.05, closingOdds: 2 }, { clv: 0.03, closingOdds: 1 }, { clv: null, closingOdds: 2 }, { clv: -0.01 }];
    const value = buildReview(input({ marks })).value;
    assert.deepEqual([value.marks, value.withClose, value.clv.mean, value.stage], [4, 1, 0.05, "sin conclusión (menos de 100 marcas con cierre)"]);
    const many = Array.from({ length: 100 }, () => ({ clv: 0.01, closingOdds: 2 }));
    assert.equal(buildReview(input({ marks: many })).value.stage, "con muestra");
  });

  it("mide marcas, selecciones, las de cuota < 4 y favoritos por separado", () => {
    const close = { home: { books: books.map((book) => ({ ...book })) } };
    const result = buildReview(
      input({
        agenda,
        closings: close,
        marks: [pick("home", 0, 2.5)],
        picks: [pick("home", 0, 3.9), pick("home", 2, 4), { ...pick("draw", 1, 3), rule: "v2" } as MarkRow],
        favorites: [pick("away", 2, 1.5), pick("away", 0, 5)],
      }),
    );
    assert.deepEqual([result.valueResults.settled, result.valueResults.roi.mean, result.valueResults.closed], [1, 1.5, 1]);
    assert.deepEqual([result.pickResults.settled, result.pickResultsLow.settled, result.favoriteResults.settled], [3, 2, 2]);
    near(result.pickResultsLow.roi.mean, (2.9 + 2) / 2);
    assert.deepEqual([result.pickRuleV2.all.settled, result.pickRuleV2.all.roi.mean], [1, 2]);
    assert.equal(result.pickTiers.length, 3);
    assert.equal(close.home.books.length, 4);
  });

  it("sombras contra la publicada; la de Wplay sin los partidos publicados con Wplay", () => {
    const ev = (shadowRps: Record<string, number | null>, extra: Partial<ByMatch> = {}): ByMatch => ({ matchId: "m", rowId: null, actual: "home", comparable: false, rpsModel: null, rpsPublished: 0.2, rpsConsensus: null, shadowRps, ...extra });
    const shadows = buildReview(
      input({
        evaluations: {
          byMatch: [
            ev({ wplay: 0.25, xg: 0.18 }),
            ev({ wplay: 0.3 }, { marketSource: "wplay" }),
            ev({ xg: 0.22 }, { publishedRps: 0.21 }),
            ev({ season: 0.1 }, { rpsPublished: null }),
            ev({ clubElo: null }),
            ev({}, { shadowRps: undefined }),
          ],
        },
      }),
    ).shadows;
    assert.deepEqual(
      shadows.map((row) => [row.key, row.label, row.n]),
      [
        ["wplay", "Wplay (hasta 12 oct)", 1],
        ["xg", "xG", 2],
        ["clubElo", "Elo clubes", 0],
        ["season", "Temporada BetPlay", 0],
      ],
    );
    near(shadows[0].diff.mean, 0.05);
    near(shadows[1].diff.mean, (-0.02 + 0.01) / 2);
  });

  it("Wplay como mercado: publicada contra modelo, sin los partidos de cuotas copiadas", () => {
    const ev = (matchId: string, publishedRps: number | null, modelRps: number | null, marketSource = "wplay"): ByMatch => ({ matchId, rowId: null, actual: "home", comparable: false, rpsModel: null, rpsPublished: null, rpsConsensus: null, publishedRps, modelRps, marketSource });
    const p = (matchId: string, readAtBogota: string, wplay1x2: unknown): PredictionRow => ({ id: matchId, matchId, kickoff: "", calculatedAt: "", verifiedOdds: { readAtBogota, wplay1x2 } });
    const result = buildReview(
      input({
        predictions: [p("c1", "t1", [2, 3, 4]), p("c2", "t1", [2, 3, 4]), p("ok", "t1", [2, 3, 5]), p("t2", "t2", [2, 3, 4]), p("bad", "t1", ["2", 3, 5]), p("bad2", "t1", "2/3/5"), { id: "none", matchId: "none", kickoff: "", calculatedAt: "" }],
        evaluations: { byMatch: [ev("c1", 0.2, 0.3), ev("ok", 0.2, 0.25), ev("t2", 0.18, 0.2), ev("cons", 0.2, 0.2, "consensus"), ev("nul", null, 0.2), ev("nul2", 0.2, null)] },
      }),
    ).wplayMarket;
    assert.deepEqual([result.excludedCopied, result.n], [1, 2]);
    near(result.rpsPublished, 0.19);
    near(result.rpsModel, 0.225);
    near(result.diff.mean, (-0.05 - 0.02) / 2);
  });

  it("sombra del modelo: mezcla 80 % consenso + 20 % modelo contra el consenso solo", () => {
    const consensus = { home: 0.5, draw: 0.3, away: 0.2 };
    const pred = (id: string, model: PredictionRow["model"]): PredictionRow => ({ id, matchId: id, kickoff: "", calculatedAt: "", model, consensus });
    const ev = (rowId: string | null, actual: ByMatch["actual"]): ByMatch => ({ matchId: String(rowId), rowId, actual, comparable: false, rpsModel: null, rpsPublished: null, rpsConsensus: null });
    const same = buildReview(input({ predictions: [pred("s", consensus)], evaluations: { byMatch: [ev("s", "home")] } })).modelBlend;
    assert.equal(same.n, 1);
    near(same.diff.mean, 0); // modelo = consenso: la mezcla no cambia nada
    const better = buildReview(input({ predictions: [pred("b", { home: 0.995, draw: 0.004, away: 0.001 })], evaluations: { byMatch: [ev("b", "home"), ev(null, "home"), ev("x", "home")] } })).modelBlend;
    assert.equal(better.n, 1);
    // Modelo recortado a 0,99 / 0,01 / 0,01 en log-odds y mezclado; RPS contra ganó el local.
    const logit = (x: number) => Math.log(x / (1 - x));
    const ex = (x: number) => 1 / (1 + Math.exp(-x));
    const raw = [ex(0.8 * logit(0.5) + 0.2 * logit(0.99)), ex(0.8 * logit(0.3) + 0.2 * logit(0.01)), ex(0.8 * logit(0.2) + 0.2 * logit(0.01))];
    const sum = raw[0] + raw[1] + raw[2];
    const rps = (home: number, draw: number, o: [number, number]) => ((home - o[0]) ** 2 + (home + draw - o[0] - o[1]) ** 2) / 2;
    near(better.diff.mean, rps(raw[0] / sum, raw[1] / sum, [1, 0]) - rps(0.5, 0.3, [1, 0]));
    const draw = buildReview(input({ predictions: [pred("b", { home: 0.995, draw: 0.004, away: 0.001 })], evaluations: { byMatch: [ev("b", "draw")] } })).modelBlend;
    near(draw.diff.mean, rps(raw[0] / sum, raw[1] / sum, [0, 1]) - rps(0.5, 0.3, [0, 1]));
    const away = buildReview(input({ predictions: [pred("b", { home: 0.995, draw: 0.004, away: 0.001 })], evaluations: { byMatch: [ev("b", "away")] } })).modelBlend;
    near(away.diff.mean, rps(raw[0] / sum, raw[1] / sum, [0, 0]) - rps(0.5, 0.3, [0, 0]));
    const noModel = buildReview(input({ predictions: [{ ...pred("n", null) }, { ...pred("c", consensus), consensus: null }], evaluations: { byMatch: [ev("n", "home"), ev("c", "home")] } })).modelBlend;
    assert.equal(noModel.n, 0);
  });

  it("anomalías con los cortes de la semana", () => {
    const result = buildReview(input({ cuts: [{ cut: "2026-11-20", corte: "noche", startedAtBogota: "2026-11-20T00:15:00-05:00", scoreConflicts: 3 }] }));
    assert.equal(result.anomalies.items.find((item) => item.key === "conflictos")!.count, 1);
    assert.equal(result.cuts.list.length, 1);
  });
});
