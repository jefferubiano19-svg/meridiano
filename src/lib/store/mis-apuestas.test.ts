import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { followedRules, profitOf, type MyBet } from "./mis-apuestas";

/* «Mis apuestas»: ganancia de cada apuesta y si siguió las reglas de «Valor del día». */

const bet = (change: Partial<MyBet> = {}): MyBet => ({
  id: "a",
  date: "2026-11-23",
  match: "Junior — Pasto",
  market: "Resultado (1X2)",
  selection: "Junior",
  house: "Betano",
  odds: 2.1,
  stake: 10000,
  result: "pendiente",
  combo: false,
  valor: { house: "Betano", minOdds: 2.06, prob: 0.5, matchId: "x" },
  ...change,
});

describe("ganancia", () => {
  it("pendiente no cuenta; ganada = monto × (cuota − 1); perdida = −monto; devuelta = 0", () => {
    assert.equal(profitOf(bet()), null);
    assert.ok(Math.abs((profitOf(bet({ result: "ganada" })) ?? 0) - 11000) < 1e-6);
    assert.equal(profitOf(bet({ result: "perdida" })), -10000);
    assert.equal(profitOf(bet({ result: "devuelta" })), 0);
  });
});

describe("¿siguió las reglas?", () => {
  it("sola, en la casa indicada y a la cuota mínima o más", () => {
    assert.equal(followedRules(bet()), true);
    assert.equal(followedRules(bet({ house: "betano.co" })), true);
  });
  it("no: combinada, otra casa, cuota debajo de la mínima o fuera de «Valor del día»", () => {
    assert.equal(followedRules(bet({ combo: true })), false);
    assert.equal(followedRules(bet({ house: "Wplay" })), false);
    assert.equal(followedRules(bet({ odds: 2.0 })), false);
    assert.equal(followedRules(bet({ valor: null })), false);
  });
  it("la mínima se compara como se muestra, a 2 decimales (igual que /valor)", () => {
    assert.equal(followedRules(bet({ odds: 1.14, valor: { house: "Betano", minOdds: 1.1401, prob: 0.9, matchId: "x" } })), true);
    assert.equal(followedRules(bet({ odds: 1.13, valor: { house: "Betano", minOdds: 1.1401, prob: 0.9, matchId: "x" } })), false);
  });
});
