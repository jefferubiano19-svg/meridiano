import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBetStore, followedRules, profitOf, type MyBet } from "./mis-apuestas";

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

describe("guardado en el navegador", () => {
  type Store = Record<string, string>;
  const KEY = "meridiano-mis-apuestas";
  const storeOn = (store: Store, broken = false) =>
    createBetStore(() => ({
      getItem: (key: string) => {
        if (broken) throw new Error("bloqueado");
        return store[key] ?? null;
      },
      setItem: (key: string, value: string) => {
        if (broken) throw new Error("bloqueado");
        store[key] = value;
      },
    }));
  const saved = (store: Store) => JSON.parse(store[KEY] ?? "[]") as MyBet[];
  const { id: _id, ...fresh } = bet();

  it("agregar, cambiar el resultado y borrar quedan guardados", () => {
    const store: Store = {};
    const bets = storeOn(store);
    bets.add(fresh);
    const [first] = saved(store);
    assert.equal(first.match, "Junior — Pasto");
    assert.equal(typeof first.id, "string");
    bets.update(first.id, { result: "ganada" });
    assert.equal(saved(store)[0].result, "ganada");
    bets.add({ ...fresh, match: "Otro" });
    assert.deepEqual(saved(store).map((item) => item.match), ["Otro", "Junior — Pasto"]);
    bets.remove(first.id);
    assert.deepEqual(saved(store).map((item) => item.match), ["Otro"]);
    assert.deepEqual(bets.load().map((item) => item.match), ["Otro"]);
  });

  it("descarta filas dañadas al leer y sobrevive a un JSON roto o que no es lista", () => {
    const good = bet({ id: "bien" });
    const store: Store = { [KEY]: JSON.stringify([good, { ...good, id: 3 }, { ...good, odds: 1 }, { ...good, stake: 0 }, null]) };
    assert.deepEqual(storeOn(store).load().map((item) => item.id), ["bien"]);
    // Montos pequeños (incluso menos de 1) y cuotas apenas sobre 1 son válidos.
    const small: Store = { [KEY]: JSON.stringify([bet({ id: "uno", stake: 1 }), bet({ id: "medio", stake: 0.5, odds: 1.01 })]) };
    assert.deepEqual(storeOn(small).load().map((item) => item.id), ["uno", "medio"]);
    assert.deepEqual(storeOn({ [KEY]: "{no es json" }).load(), []);
    assert.deepEqual(storeOn({ [KEY]: JSON.stringify({ a: 1 }) }).load(), []);
    assert.deepEqual(storeOn({}).load(), []);
  });

  it("si el navegador no deja leer ni guardar, funciona en memoria", () => {
    const store: Store = {};
    const bets = storeOn(store, true);
    bets.add(fresh);
    assert.deepEqual(store, {});
    assert.equal(bets.load().length, 1);
  });

  it("avisa a quien escucha y relee cuando otra pestaña cambia lo guardado", () => {
    const store: Store = {};
    const bets = storeOn(store);
    let calls = 0;
    const stop = bets.listen(() => (calls += 1));
    bets.add(fresh);
    assert.equal(calls, 1);
    store[KEY] = JSON.stringify([bet({ id: "otra", match: "Desde otra pestaña" })]);
    assert.equal(bets.load()[0].match, "Junior — Pasto");
    bets.reload();
    assert.equal(calls, 2);
    assert.equal(bets.load()[0].match, "Desde otra pestaña");
    stop();
    bets.add(fresh);
    assert.equal(calls, 2);
  });

  it("el borrador de «Valor del día» se entrega una sola vez", () => {
    const bets = storeOn({});
    const { stake: _stake, result: _result, ...draft } = fresh;
    bets.setDraft(draft);
    assert.equal(bets.takeDraft()?.match, "Junior — Pasto");
    assert.equal(bets.takeDraft(), null);
  });
});
