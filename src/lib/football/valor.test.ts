import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shin } from "./engine";
import {
  bestFromOffers,
  consensusFromOffers,
  doublePicks,
  favoritePick,
  MARKET_NAME,
  pickLabel,
  valuePicks,
  VALUE_MIN_PROB,
} from "./valor";

/* Pruebas de «Valor del día»: qué selecciones salen, con qué cuota mínima, y cuáles no. Se escriben como las vería el
 * usuario (ofertas de casas → selecciones), con números que se pueden comprobar a mano. */

const near = (actual: number, expected: number, digits = 9) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} no es ${expected}`);

const best3 = (home: number, draw: number, away: number) => [
  { house: "Betano", odds: home },
  { house: "Wplay", odds: draw },
  { house: "Bwin", odds: away },
];

describe("shin: probabilidad sin el margen de la casa", () => {
  it("con cuotas sin margen devuelve las probabilidades de la cuota", () => {
    const fair = shin(2, 4, 4);
    assert.ok(fair);
    near(fair.home, 0.5, 6);
    near(fair.draw, 0.25, 6);
    near(fair.away, 0.25, 6);
  });

  it("quita el margen y le da al favorito más que el reparto proporcional", () => {
    const fair = shin(2.0, 3.4, 3.8);
    assert.ok(fair);
    near(fair.home + fair.draw + fair.away, 1);
    const proportional = 1 / 2.0 / (1 / 2.0 + 1 / 3.4 + 1 / 3.8);
    assert.ok(fair.home > proportional);
    assert.ok(fair.away < 1 / 3.8 / (1 / 2.0 + 1 / 3.4 + 1 / 3.8));
  });

  it("rechaza cuotas imposibles o con margen mayor a 15 %", () => {
    assert.equal(shin(1, 3, 3), null);
    assert.equal(shin(1.5, 2.5, 3), null);
    assert.equal(shin(3, 3, 4), null);
  });
});

describe("consenso y mejor cuota", () => {
  const offers = [
    { house: "Betano", odds: [2.0, 3.4, 3.8] },
    { house: "Wplay", odds: [2.1, 3.3, 3.6] },
    { house: "Bwin", odds: [1.95, 3.5, 3.9] },
  ];

  it("necesita 3 casas con cuotas válidas", () => {
    assert.equal(consensusFromOffers(offers.slice(0, 2)), null);
    assert.equal(consensusFromOffers([...offers.slice(0, 2), { house: "Stake", odds: [1, 3, 3] }]), null);
    assert.equal(bestFromOffers(offers.slice(0, 2)), null);
  });

  it("el consenso es la mediana de cada casa sin margen y suma 1", () => {
    const consensus = consensusFromOffers(offers);
    assert.ok(consensus);
    near(consensus[0] + consensus[1] + consensus[2], 1);
    const homes = offers.map((offer) => shin(offer.odds[0], offer.odds[1], offer.odds[2])!.home).sort();
    assert.ok(consensus[0] > homes[0] * 0.99 && consensus[0] < homes[2] * 1.01);
  });

  it("con las tres casas iguales el consenso es Shin de esa casa", () => {
    const same = [0, 1, 2].map((index) => ({ house: `C${index}`, odds: [2.0, 3.4, 3.8] }));
    const consensus = consensusFromOffers(same)!;
    const fair = shin(2.0, 3.4, 3.8)!;
    near(consensus[0], fair.home);
    near(consensus[2], fair.away);
  });

  it("la mejor cuota de cada resultado dice en qué casa está", () => {
    assert.deepEqual(bestFromOffers(offers), [
      { house: "Wplay", odds: 2.1 },
      { house: "Bwin", odds: 3.5 },
      { house: "Bwin", odds: 3.9 },
    ]);
  });
});

describe("valuePicks (1X2)", () => {
  it("selección con +5 %: cuota justa 2,00 y mínima 2,06", () => {
    const [pick] = valuePicks([0.5, 0.3, 0.2], best3(2.1, 3.0, 4.0), 3);
    assert.equal(pick.outcomeIndex, 0);
    assert.equal(pick.house, "Betano");
    near(pick.ev, 0.05);
    near(pick.fair, 2);
    near(pick.minOdds, 2.06);
  });

  it("incluye los extremos +3 % y +15 %", () => {
    assert.equal(valuePicks([0.5, 0.3, 0.2], best3(2.06, 3, 4), 3).length, 1);
    assert.equal(valuePicks([0.5, 0.3, 0.2], best3(2.3, 3, 4), 3).length, 1);
  });

  it("descarta menos de +3 % (error) y más de +15 % (cuota vieja o mal leída)", () => {
    assert.deepEqual(valuePicks([0.5, 0.3, 0.2], best3(2.05, 3, 4), 3), []);
    assert.deepEqual(valuePicks([0.5, 0.3, 0.2], best3(2.31, 3, 4), 3), []);
  });

  it("regla v2: menos de 40 % no sale, salvo con mínimo 0", () => {
    assert.equal(VALUE_MIN_PROB, 0.4);
    const probs = [0.5, 0.3, 0.2];
    const best = best3(1.5, 3.5, 3);
    assert.deepEqual(valuePicks(probs, best, 3), []);
    const all = valuePicks(probs, best, 3, 0);
    assert.deepEqual(all.map((pick) => pick.outcomeIndex), [1]);
    near(all[0].ev, 0.05);
    assert.equal(valuePicks([0.4, 0.3, 0.3], best3(2.6, 2, 2), 3).length, 1);
  });

  it("sin 3 casas, o con datos incompletos, no hay selecciones", () => {
    assert.deepEqual(valuePicks([0.5, 0.3, 0.2], best3(2.1, 3, 4), 2), []);
    assert.deepEqual(valuePicks([0.5, 0.3], best3(2.1, 3, 4), 3), []);
    assert.deepEqual(valuePicks([0.5, 0.3, 0.2], best3(2.1, 3, 4).slice(0, 2), 3), []);
    assert.deepEqual(valuePicks([0, 0.3, 0.2], best3(2.1, 3, 4), 3, 0), []);
    assert.deepEqual(valuePicks([0.5, 0.3, 0.2], best3(1, 3, 4), 3, 0), []);
  });
});

describe("doublePicks (doble oportunidad y empate no válido)", () => {
  const probs = [0.5, 0.3, 0.2];
  const dc = (oneX: number, twelve: number, xTwo: number) =>
    ["Betano", "Wplay", "Bwin"].map((house, index) => ({ house, odds: index === 0 ? [oneX, twelve, xTwo] : [1.01, 1.01, 1.01] }));
  const dnb = (home: number, away: number) =>
    ["Betano", "Wplay", "Bwin"].map((house, index) => ({ house, odds: index === 0 ? [home, away] : [1.01, 1.01] }));

  it("1X con 80 %: a 1,30 da +4 %, mínima 1,2875", () => {
    const [pick] = doublePicks(probs, dc(1.3, 1.01, 1.01), []);
    assert.equal(pick.market, "dc");
    assert.equal(pick.outcomeIndex, 0);
    near(pick.prob, 0.8);
    near(pick.ev, 0.04);
    near(pick.minOdds, 1.2875);
    near(pick.fair, 1.25);
    assert.equal(pick.pDraw, 0);
  });

  it("12 y X2 suman sus dos resultados", () => {
    const picks = doublePicks(probs, dc(1.01, 1.5, 2.1), [], 0);
    assert.deepEqual(picks.map((pick) => [pick.outcomeIndex, Number(pick.prob.toFixed(2))]), [[1, 0.7], [2, 0.5]]);
  });

  it("empate no válido: si empata se devuelve; valor = 50 % × 1,50 + 30 % − 1 = +5 %", () => {
    const [pick] = doublePicks(probs, [], dnb(1.5, 1.01));
    assert.equal(pick.market, "dnb");
    assert.equal(pick.outcomeIndex, 0);
    near(pick.ev, 0.05);
    near(pick.pDraw, 0.3);
    near(pick.minOdds, (1.03 - 0.3) / 0.5);
    near(pick.fair, 1.4);
    assert.deepEqual(doublePicks(probs, [], dnb(1.45, 1.01)), []);
  });

  it("visita en empate no válido usa el índice 2", () => {
    const [pick] = doublePicks([0.2, 0.3, 0.5], [], dnb(1.01, 1.5));
    assert.equal(pick.outcomeIndex, 2);
  });

  it("sin 3 casas en el mercado, filas incompletas o menos de 40 %, nada", () => {
    assert.deepEqual(doublePicks(probs, dc(1.3, 1.01, 1.01).slice(0, 2), []), []);
    assert.deepEqual(doublePicks(probs, [{ house: "A", odds: [1.3, 1.1] }, ...dc(1.3, 1.01, 1.01).slice(1)], []), []);
    assert.deepEqual(doublePicks([0.3, 0.3, 0.4], [], dnb(3.6, 1.01)), []);
    assert.deepEqual(doublePicks([0.5, 0.3], dc(1.3, 1.01, 1.01), []), []);
  });

  it("descarta más de +15 %", () => {
    assert.deepEqual(doublePicks(probs, dc(1.5, 1.01, 1.01), []), []);
  });
});

describe("textos", () => {
  it("nombra cada selección", () => {
    assert.equal(pickLabel("1x2", 0, "Junior", "Pasto"), "Junior");
    assert.equal(pickLabel("1x2", 1, "Junior", "Pasto"), "Empate");
    assert.equal(pickLabel("1x2", 2, "Junior", "Pasto"), "Pasto");
    assert.equal(pickLabel("dc", 0, "Junior", "Pasto"), "Junior o empate");
    assert.equal(pickLabel("dc", 1, "Junior", "Pasto"), "Junior o Pasto (no empate)");
    assert.equal(pickLabel("dc", 2, "Junior", "Pasto"), "Empate o Pasto");
    assert.equal(pickLabel("dnb", 0, "Junior", "Pasto"), "Junior (empate no válido)");
    assert.equal(pickLabel("dnb", 2, "Junior", "Pasto"), "Pasto (empate no válido)");
    assert.equal(MARKET_NAME.dc, "Doble oportunidad");
  });
});

describe("favoritePick (medición interna)", () => {
  it("sin 3 casas o sin favorito de 65 %+ no hay selección", () => {
    assert.equal(favoritePick([0.7, 0.2, 0.1], best3(1.5, 4, 8), 2, {}), null);
    assert.equal(favoritePick([0.5, 0.3, 0.2], best3(2.1, 4, 8), 3, {}), null);
  });
});
