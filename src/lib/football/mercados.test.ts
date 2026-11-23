import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLOMBIAN_HOUSE,
  expectedValue,
  fairOdds,
  medianConsensus,
  minOdds,
  normalize,
  refundProb,
  settle,
  stillValuable,
  winProb,
  type Selection,
} from "./mercados";

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} no es ${expected}`);
const probs: [number, number, number] = [0.5, 0.3, 0.2];
const home: Selection = { market: "1x2", outcomeIndex: 0 };
const draw: Selection = { market: "1x2", outcomeIndex: 1 };
const oneX: Selection = { market: "dc", outcomeIndex: 0 };
const twelve: Selection = { market: "dc", outcomeIndex: 1 };
const xTwo: Selection = { market: "dc", outcomeIndex: 2 };
const dnbHome: Selection = { market: "dnb", outcomeIndex: 0 };
const dnbAway: Selection = { market: "dnb", outcomeIndex: 2 };

describe("probabilidad de ganar cada selección", () => {
  it("1X2 es la del resultado", () => {
    near(winProb(home, probs), 0.5);
    near(winProb(draw, probs), 0.3);
    near(winProb({ market: "1x2", outcomeIndex: 2 }, probs), 0.2);
  });
  it("doble oportunidad suma los dos resultados cubiertos", () => {
    near(winProb(oneX, probs), 0.8);
    near(winProb(twelve, probs), 0.7);
    near(winProb(xTwo, probs), 0.5);
  });
  it("empate no válido: gana ese equipo; el empate se devuelve", () => {
    near(winProb(dnbHome, probs), 0.5);
    near(winProb(dnbAway, probs), 0.2);
    near(refundProb(dnbHome, probs), 0.3);
    near(refundProb(oneX, probs), 0);
    near(refundProb(home, probs), 0);
  });
});

describe("valor, cuota justa y cuota mínima", () => {
  it("1X2 a 2,10 con 50 %: +5 %, justa 2,00, mínima 2,06", () => {
    near(expectedValue(home, probs, 2.1), 0.05);
    near(fairOdds(home, probs), 2);
    near(minOdds(home, probs), 2.06);
  });
  it("empate no válido a 1,50: 50 % × 1,50 + 30 % − 1 = +5 %; mínima (1,03 − 0,30) ÷ 0,50", () => {
    near(expectedValue(dnbHome, probs, 1.5), 0.05);
    near(fairOdds(dnbHome, probs), 1.4);
    near(minOdds(dnbHome, probs), 1.46);
  });
  it("a la cuota mínima el valor es justo +3 %", () => {
    for (const selection of [home, oneX, xTwo, dnbHome, dnbAway]) near(expectedValue(selection, probs, minOdds(selection, probs)), 0.03);
  });
  it("sigue con valor si la cuota llega a la mínima redondeada a 2 decimales", () => {
    assert.equal(stillValuable(1.14, 1.1401), true);
    assert.equal(stillValuable(1.14, 1.1449), true);
    assert.equal(stillValuable(1.14, 1.1451), false);
    assert.equal(stillValuable(2.0, 2.06), false);
    assert.equal(stillValuable(2.1, 2.06), true);
  });
});

describe("liquidación por unidad apostada", () => {
  it("1X2: gana cuota − 1, pierde −1", () => {
    near(settle(home, 2.1, 0), 1.1);
    assert.equal(settle(home, 2.1, 1), -1);
    near(settle(draw, 3.4, 1), 2.4);
  });
  it("doble oportunidad gana con cualquiera de sus dos resultados", () => {
    near(settle(oneX, 1.3, 0), 0.3);
    near(settle(oneX, 1.3, 1), 0.3);
    assert.equal(settle(oneX, 1.3, 2), -1);
    near(settle(twelve, 1.25, 2), 0.25);
    assert.equal(settle(twelve, 1.25, 1), -1);
    assert.equal(settle(xTwo, 1.9, 0), -1);
  });
  it("empate no válido: empate devuelve (0), gana cuota − 1, pierde −1", () => {
    assert.equal(settle(dnbHome, 1.5, 1), 0);
    near(settle(dnbHome, 1.5, 0), 0.5);
    assert.equal(settle(dnbHome, 1.5, 2), -1);
    near(settle(dnbAway, 2.2, 2), 1.2);
  });
});

describe("consenso", () => {
  it("normaliza a suma 1", () => {
    const [a, b, c] = normalize([0.6, 0.3, 0.3]);
    near(a, 0.5);
    near(b + c, 0.5);
  });
  it("mediana por resultado entre casas, normalizada", () => {
    const consensus = medianConsensus([
      { home: 0.5, draw: 0.3, away: 0.2 },
      { home: 0.6, draw: 0.2, away: 0.2 },
      { home: 0.4, draw: 0.3, away: 0.3 },
    ]);
    assert.ok(consensus);
    near(consensus[0], 0.5 / 1.0);
    near(consensus[1], 0.3);
    near(consensus[2], 0.2);
  });
  it("con un número par de casas usa el promedio de las dos del medio", () => {
    const consensus = medianConsensus([
      { home: 0.5, draw: 0.3, away: 0.2 },
      { home: 0.6, draw: 0.2, away: 0.2 },
      { home: 0.4, draw: 0.3, away: 0.3 },
      { home: 0.7, draw: 0.2, away: 0.1 },
    ])!;
    near(consensus[0], 0.55 / (0.55 + 0.25 + 0.2));
  });
  it("menos de 3 casas: sin consenso", () => {
    assert.equal(medianConsensus([{ home: 0.5, draw: 0.3, away: 0.2 }]), null);
  });
});

describe("casas colombianas", () => {
  it("solo las 5 casas, sin importar mayúsculas ni espacios alrededor", () => {
    for (const house of ["Wplay.co", "Betano.co", "Stake.latam", "Bwin.co", "BetPlay", " betplay "]) assert.ok(COLOMBIAN_HOUSE.test(house.trim()), house);
    for (const house of ["bet365.us", "Luckia.co", "Betano.com", "wplay"]) assert.equal(COLOMBIAN_HOUSE.test(house), false, house);
  });
});
