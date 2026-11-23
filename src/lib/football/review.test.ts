import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shin } from "./engine";
import { medianConsensus } from "./mercados";
import { buildReview } from "./review";

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

describe("medición contra el cierre", () => {
  const closing = medianConsensus(books.slice(0, 3).map((book) => shin(book.odds[0], book.odds[1], book.odds[2])!))!;

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
