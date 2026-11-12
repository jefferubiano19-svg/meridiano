import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ExportBar } from "@/components/export-bar";
import { Input } from "@/components/ui/input";
import { loadModelo } from "@/lib/football/pages";
import { useAgendaToday } from "@/lib/football/use-today";
import {
  followedRules,
  myBets,
  profitOf,
  useMyBets,
  type BetDraft,
  type BetResult,
  type MyBet,
} from "@/lib/store/mis-apuestas";

export const Route = createFileRoute("/mis-apuestas")({ component: MisApuestasPage });

/* ---------------------------------------------------------------------------
 * «Mis apuestas»: el usuario anota sus apuestas reales y ve su resultado real contra el de Meridiano.
 * Separa las que siguieron las reglas de «Valor del día» (sola, casa indicada, cuota mínima o más) de las demás,
 * y avisa de combinadas y cuotas debajo de la mínima. Los datos quedan solo en este navegador (localStorage).
 * ------------------------------------------------------------------------- */

const HOUSES = ["Betano", "Wplay", "BetPlay", "Stake", "Bwin", "Otra"];
const MARKETS = ["Resultado (1X2)", "Doble oportunidad", "Empate no válido", "Otro"];
const RESULTS: { key: BetResult; label: string }[] = [
  { key: "pendiente", label: "Pendiente" },
  { key: "ganada", label: "Ganada" },
  { key: "perdida", label: "Perdida" },
  { key: "devuelta", label: "Devuelta" },
];

type Stat = { n: number; mean: number | null; low: number | null; high: number | null };

const cop = (value: number) =>
  `${value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("es-CO")}`;
const pct = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1).replace(".", ",")} %`;
const num = (value: number) => value.toFixed(2).replace(".", ",");

interface Tally {
  n: number;
  settled: number;
  won: number;
  staked: number;
  profit: number;
  /** En las resueltas de «Valor del día» sueltas: ganadas y esperadas (suma de la probabilidad de Meridiano). */
  wonValor: number;
  expected: number | null;
}

function tally(bets: MyBet[]): Tally {
  const settled = bets.filter((bet) => bet.result !== "pendiente");
  const withProb = settled.filter((bet) => bet.valor && !bet.combo && bet.result !== "devuelta");
  return {
    n: bets.length,
    settled: settled.length,
    won: settled.filter((bet) => bet.result === "ganada").length,
    staked: settled.reduce((sum, bet) => sum + bet.stake, 0),
    profit: settled.reduce((sum, bet) => sum + (profitOf(bet) ?? 0), 0),
    wonValor: withProb.filter((bet) => bet.result === "ganada").length,
    expected: withProb.length ? withProb.reduce((sum, bet) => sum + (bet.valor?.prob ?? 0), 0) : null,
  };
}

function emptyForm(today: string): BetDraft & { stake: string; oddsText: string; legsText: string } {
  return {
    date: today,
    match: "",
    market: MARKETS[0],
    selection: "",
    house: HOUSES[0],
    odds: 0,
    oddsText: "",
    stake: "",
    combo: false,
    legs: undefined,
    legsText: "",
    valor: null,
  };
}

function MisApuestasPage() {
  const today = useAgendaToday();
  const bets = useMyBets();
  const [form, setForm] = useState(() => emptyForm(today));
  const [meridiano, setMeridiano] = useState<{ v2: Stat | null; settled: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const draft = myBets.takeDraft();
    if (draft) setForm({ ...emptyForm(today), ...draft, oddsText: draft.odds ? String(draft.odds) : "", legsText: "" });
  }, [today]);

  useEffect(() => {
    let live = true;
    void loadModelo()
      .then((bundle) => {
        const review = bundle.review as unknown as { pickRuleV2?: { all?: { settled: number; roi: Stat } } } | null;
        const all = review?.pickRuleV2?.all;
        if (live) setMeridiano(all ? { v2: all.roi, settled: all.settled } : null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const groups = useMemo(() => {
    const rules = bets.filter(followedRules);
    const other = bets.filter((bet) => !followedRules(bet));
    return {
      all: tally(bets),
      rules: tally(rules),
      other: tally(other),
      combos: tally(bets.filter((bet) => bet.combo)),
      below: tally(bets.filter((bet) => bet.valor && bet.odds + 1e-9 < bet.valor.minOdds)),
    };
  }, [bets]);

  const odds = Number(form.oddsText.replace(",", "."));
  const stake = Number(form.stake.replace(/\./g, "").replace(",", "."));
  const warnings: string[] = [];
  if (form.combo)
    warnings.push(
      "Combinada: la probabilidad de acertar es el producto de cada selección (tres de 60 % = 21,6 %). Meridiano no mide ni recomienda combinadas.",
    );
  if (form.valor && odds > 1 && odds + 1e-9 < form.valor.minOdds)
    warnings.push(`Cuota debajo de la mínima (${num(form.valor.minOdds)}): esta apuesta ya no tiene valor.`);
  if (form.valor && form.house.toLowerCase() !== form.valor.house.toLowerCase())
    warnings.push(`La casa indicada era ${form.valor.house}: en otra casa la cuota y el valor cambian.`);
  if (!form.valor && !form.combo)
    warnings.push("No viene de «Valor del día»: cuenta en «sin seguir las reglas».");

  function submit() {
    setError(null);
    if (!form.match.trim()) return setError("Escribe el partido.");
    if (!(odds > 1)) return setError("La cuota debe ser mayor que 1.");
    if (!(stake > 0)) return setError("Escribe el monto apostado.");
    const legs = Number(form.legsText);
    myBets.add({
      date: form.date || today,
      match: form.match.trim(),
      market: form.market,
      selection: form.selection.trim(),
      house: form.house,
      odds,
      stake,
      result: "pendiente",
      combo: form.combo,
      legs: form.combo && legs >= 2 ? legs : undefined,
      valor: form.valor ?? null,
    });
    setForm(emptyForm(today));
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Tu registro</p>
          <h1 className="mt-2 font-display text-4xl tracking-tight">Mis apuestas</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Anota cada apuesta real: casa, cuota, monto y resultado. Aquí se ve tu resultado de verdad y se separa
            lo que siguió las reglas de «Valor del día» (sola, en la casa indicada, a la cuota mínima o más) de lo
            que no. Los datos quedan <strong className="text-fg">solo en este navegador</strong>: si borras los datos
            del navegador se pierden; descarga el Excel para guardarlos.
          </p>
        </div>
        <ExportBar
          filename="meridiano-mis-apuestas"
          title="Mis apuestas"
          build={() => ({
            name: "Mis apuestas",
            headers: [
              "Fecha",
              "Partido",
              "Mercado",
              "Selección",
              "Casa",
              "Cuota",
              "Monto",
              "Resultado",
              "Ganancia",
              "Combinada",
              "Casa indicada",
              "Cuota mínima",
              "Probabilidad Meridiano",
              "¿Siguió las reglas?",
            ],
            rows: bets.map((bet) => [
              bet.date,
              bet.match,
              bet.market,
              bet.selection,
              bet.house,
              Number(bet.odds.toFixed(2)),
              bet.stake,
              bet.result,
              profitOf(bet),
              bet.combo ? `sí${bet.legs ? ` (${bet.legs})` : ""}` : "no",
              bet.valor?.house ?? null,
              bet.valor ? Number(bet.valor.minOdds.toFixed(2)) : null,
              bet.valor ? `${(bet.valor.prob * 100).toFixed(1)} %` : null,
              followedRules(bet) ? "sí" : "no",
            ]),
            note: `Resueltas: ${groups.all.settled}. Apostado: ${cop(groups.all.staked)}. Ganancia: ${cop(groups.all.profit)}.`,
          })}
        />
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <Summary title="Todas" tally={groups.all} />
        <Summary title="Siguiendo las reglas" tally={groups.rules} tone="good" />
        <Summary title="Sin seguir las reglas" tally={groups.other} tone="warn" />
      </section>

      <section className="rounded-xl bg-surface p-4 text-sm leading-relaxed text-muted shadow-[var(--shadow-border)]">
        <h2 className="font-display text-lg text-fg">Tú contra Meridiano</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Meridiano, regla actual de «Valor del día» (misma cantidad a cada selección):{" "}
            {meridiano?.v2 && meridiano.v2.mean != null
              ? `${pct(meridiano.v2.mean)} por apuesta en ${meridiano.settled} resueltas${meridiano.settled < 100 ? " (muy pocas para concluir)" : ""}.`
              : "sin datos todavía."}
          </li>
          <li>
            Tú, siguiendo las reglas:{" "}
            {groups.rules.settled && groups.rules.staked
              ? `${pct(groups.rules.profit / groups.rules.staked)} sobre lo apostado en ${groups.rules.settled} resueltas.`
              : "ninguna resuelta todavía."}
          </li>
          <li>
            Tú, sin seguir las reglas:{" "}
            {groups.other.settled && groups.other.staked
              ? `${pct(groups.other.profit / groups.other.staked)} sobre lo apostado en ${groups.other.settled} resueltas.`
              : "ninguna resuelta todavía."}
          </li>
          {groups.combos.n ? (
            <li className="text-danger">
              Combinadas: {groups.combos.n} ({groups.combos.won} ganadas de {groups.combos.settled} resueltas, ganancia{" "}
              {cop(groups.combos.profit)}). Meridiano no las mide ni las recomienda.
            </li>
          ) : null}
          {groups.below.n ? (
            <li className="text-danger">
              Debajo de la cuota mínima: {groups.below.n} (ganancia {cop(groups.below.profit)}). A esa cuota ya no había
              valor.
            </li>
          ) : null}
        </ul>
        <p className="mt-2 text-xs">
          Con menos de 100 apuestas resueltas el resultado depende sobre todo de la suerte. Con selecciones de 50 %, en
          100 apuestas hay una racha de 6 o más pérdidas seguidas el 55 % de las veces, y de 5 o más el 81 %: perder
          varias seguidas no prueba que el método falle.
        </p>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-lg">Anotar una apuesta</h2>
        {form.valor ? (
          <p className="mt-1 text-xs text-muted">
            De «Valor del día»: casa indicada <strong className="text-fg">{form.valor.house}</strong>, cuota mínima{" "}
            <strong className="text-fg">{num(form.valor.minOdds)}</strong>, se gana{" "}
            {(form.valor.prob * 100).toFixed(1).replace(".", ",")} %. Escribe la cuota que te dio la casa.
          </p>
        ) : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Fecha">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Partido">
            <Input value={form.match} placeholder="Local — Visita" onChange={(e) => setForm({ ...form, match: e.target.value })} />
          </Field>
          <Field label="Mercado">
            <Select value={form.market} options={MARKETS} onChange={(value) => setForm({ ...form, market: value })} />
          </Field>
          <Field label="Selección">
            <Input value={form.selection} placeholder="Ej.: Local, 1X" onChange={(e) => setForm({ ...form, selection: e.target.value })} />
          </Field>
          <Field label="Casa">
            <Select
              value={HOUSES.find((house) => house.toLowerCase() === form.house.toLowerCase()) ?? "Otra"}
              options={HOUSES}
              onChange={(value) => setForm({ ...form, house: value })}
            />
          </Field>
          <Field label="Cuota">
            <Input inputMode="decimal" value={form.oddsText} placeholder="1,85" onChange={(e) => setForm({ ...form, oddsText: e.target.value })} />
          </Field>
          <Field label="Monto (COP)">
            <Input inputMode="numeric" value={form.stake} placeholder="10000" onChange={(e) => setForm({ ...form, stake: e.target.value })} />
          </Field>
          <div className="block text-xs text-subtle">
            <span className="mb-1 block uppercase tracking-wide">Combinada</span>
            <div className="flex h-11 items-center gap-2">
              <input
                id="combo"
                type="checkbox"
                checked={form.combo}
                onChange={(e) => setForm({ ...form, combo: e.target.checked })}
                className="h-5 w-5"
              />
              <label htmlFor="combo" className="text-sm">
                Sí
              </label>
              {form.combo ? (
                <Input
                  inputMode="numeric"
                  value={form.legsText}
                  placeholder="N.º selecciones"
                  onChange={(e) => setForm({ ...form, legsText: e.target.value })}
                  className="h-9"
                />
              ) : null}
            </div>
          </div>
        </div>
        {warnings.length ? (
          <ul className="mt-3 space-y-1 text-xs text-danger">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={submit} className="h-10 rounded-full bg-accent px-5 text-sm text-accent-fg">
            Guardar apuesta
          </button>
          <button
            type="button"
            onClick={() => setForm(emptyForm(today))}
            className="h-10 rounded-full bg-elevated px-4 text-sm text-fg ring-1 ring-border"
          >
            Limpiar
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg">Apuestas anotadas ({bets.length})</h2>
        {bets.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay apuestas anotadas en este navegador.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {bets.map((bet) => {
              const profit = profitOf(bet);
              const flags = [
                bet.combo ? "Combinada" : null,
                bet.valor && bet.odds + 1e-9 < bet.valor.minOdds ? "Debajo de la mínima" : null,
                bet.valor && !followedRules(bet) && !bet.combo && bet.odds + 1e-9 >= bet.valor.minOdds ? "Otra casa" : null,
                !bet.valor && !bet.combo ? "Fuera de «Valor del día»" : null,
              ].filter(Boolean);
              return (
                <article key={bet.id} className="rounded-xl bg-surface p-4 text-sm shadow-[var(--shadow-border)]">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">
                    {bet.date.split("-").reverse().join("/")} · {bet.market}
                  </p>
                  <h3 className="mt-1 font-display text-lg tracking-tight">{bet.match}</h3>
                  <p className="text-muted">
                    {bet.selection ? <strong className="text-fg">{bet.selection}</strong> : null}
                    {bet.selection ? " · " : ""}
                    {bet.house} · cuota {num(bet.odds)} · {cop(bet.stake)}
                    {bet.combo && bet.legs ? ` · ${bet.legs} selecciones` : ""}
                  </p>
                  {flags.length ? (
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {flags.map((flag) => (
                        <span key={flag} className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-danger ring-1 ring-border">
                          {flag}
                        </span>
                      ))}
                    </p>
                  ) : followedRules(bet) ? (
                    <p className="mt-1">
                      <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-fg ring-1 ring-border">
                        Siguió las reglas
                      </span>
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Resultado">
                    {RESULTS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => myBets.update(bet.id, { result: option.key })}
                        className={`h-8 rounded-full px-3 text-xs ring-1 ring-border ${bet.result === option.key ? "bg-fg text-bg" : "bg-elevated text-fg"}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className={profit == null ? "text-muted" : profit >= 0 ? "text-value" : "text-danger"}>
                      {profit == null ? "Sin resolver" : `Ganancia ${cop(profit)}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => myBets.remove(bet.id)}
                      className="text-xs text-muted underline underline-offset-2"
                    >
                      Borrar
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Summary({ title, tally: t, tone }: { title: string; tally: Tally; tone?: "good" | "warn" }) {
  const roi = t.staked ? t.profit / t.staked : null;
  return (
    <div className="rounded-xl bg-surface p-4 text-sm shadow-[var(--shadow-border)]">
      <p className={`text-[11px] uppercase tracking-[0.16em] ${tone === "warn" ? "text-danger" : "text-subtle"}`}>{title}</p>
      <p className="mt-1 font-display text-2xl tabular-nums">{t.settled ? cop(t.profit) : "—"}</p>
      <p className="text-muted">
        {t.n} anotadas · {t.settled} resueltas
        {t.settled ? ` · ${t.won} ganadas` : ""}
      </p>
      <p className="text-muted">
        Apostado (resueltas): {cop(t.staked)}
        {roi != null ? ` · retorno ${pct(roi)}` : ""}
      </p>
      {t.expected != null ? (
        <p className="text-xs text-muted">
          En las de «Valor del día» sueltas: {t.wonValor} ganadas; Meridiano esperaba {t.expected.toFixed(1).replace(".", ",")}.
        </p>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs text-subtle">
      <span className="mb-1 block uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-md bg-elevated px-3 text-sm text-fg shadow-[var(--shadow-border)]"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
