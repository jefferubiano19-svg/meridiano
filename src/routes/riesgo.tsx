import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ExportBar } from "@/components/export-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { CURRENCIES, formatEv, money, type Currency } from "@/lib/football/format";
import { simulateDrawdown } from "@/lib/football/kelly";
import { loadNames } from "@/lib/football/pages";
import { periodLoss, useSession } from "@/lib/store/session";
import type { ConfidenceLabel } from "@/lib/football/types";

export const Route = createFileRoute("/riesgo")({ component: RiskPage });

function RiskPage() {
  const session = useSession();
  const daily = periodLoss(session.logs, 86400000);
  const weekly = periodLoss(session.logs, 7 * 86400000);
  const cooling = session.coolingOffUntil && session.coolingOffUntil > Date.now();
  const [simP, setSimP] = useState(0.52);
  const [simOdds, setSimOdds] = useState(2.0);
  const [journalQuery, setJournalQuery] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [simReady, setSimReady] = useState(false);
  const sim = useMemo(
    () =>
      simReady
        ? simulateDrawdown({
            probability: simP,
            odds: simOdds,
            fraction: session.kellyFraction,
            bets: 80,
            paths: 600,
          })
        : { p5: 0, median: 0, p95: 0, ruin: 0 },
    [simReady, simP, simOdds, session.kellyFraction],
  );
  useEffect(() => {
    setSimReady(true);
  }, []);
  const nameKey = session.logs.map((log) => log.fixtureId).join("|");
  useEffect(() => {
    const ids = nameKey ? nameKey.split("|") : [];
    if (ids.length === 0) return;
    let live = true;
    void loadNames({ data: { ids } })
      .then((next) => {
        if (live) setNames(next);
      })
      .catch(() => {
        if (live) setNames({});
      });
    return () => {
      live = false;
    };
  }, [nameKey]);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Mesa de riesgo</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Límites antes que cuotas</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          Kelly fraccional, tope de stake y cortes de pérdida. Si no puedes permitirte perder el
          bankroll, no lo uses. Meridiano no mueve dinero.
        </p>
        <div className="mt-4">
          <ExportBar
            filename="meridiano-riesgo"
            title="Riesgo"
            build={() => ({
              name: "Riesgo",
              headers: ["Campo", "Valor"],
              rows: [
                ["Capital", session.bankroll],
                ["Divisa", session.currency],
                ["Unidad %", session.unitPercent],
                ["Kelly", session.kellyFraction],
                ["Stake maximo %", session.maxStakePercent],
                ["VE minimo", session.minEv],
                ["Confianza minima", session.minConfidence],
                ["Perdida diaria", session.dailyLossLimit],
                ["Perdida semanal", session.weeklyLossLimit],
                ["Perdida del dia", daily],
                ["Perdida de la semana", weekly],
                ["Simulacion p", simP],
                ["Simulacion cuota", simOdds],
                ...session.logs
                  .filter((log) => {
                    const q = journalQuery.trim().toLowerCase();
                    if (!q) return true;
                    const namesOf = names[log.fixtureId] ?? log.fixtureId;
                    return `${namesOf} ${log.market}`.toLowerCase().includes(q);
                  })
                  .map((log) => [`Diario ${log.market}`, `${log.stake} @ ${log.odds} · ${log.result} · ${log.pnl}`]),
              ],
              note: "Meridiano no mueve dinero. La simulación no es un resultado futuro.",
            })}
          />
        </div>
      </header>

      {cooling ? (
        <div className="rounded-xl bg-warn/10 p-4 text-sm text-warn">
          Pausa activa hasta {new Date(session.coolingOffUntil!).toLocaleString("es")}. Las sugerencias
          de stake están bloqueadas.
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-display text-xl">Bankroll</h2>
          <div className="mt-4 space-y-4">
            <Field label="Capital de trabajo">
              <Input
                type="number"
                min={0}
                value={session.bankroll}
                onChange={(e) => session.setBankroll(Number(e.target.value))}
              />
            </Field>
            <Field label="Divisa">
              <div className="flex flex-wrap gap-2">
                {CURRENCIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`h-10 rounded-md px-3 text-xs ${session.currency === c ? "bg-accent text-accent-fg" : "bg-elevated text-muted"}`}
                    onClick={() => session.setCurrency(c as Currency)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={`Unidad ${session.unitPercent.toFixed(1)}%`}>
              <Slider
                min={0.25}
                max={5}
                step={0.25}
                value={[session.unitPercent]}
                onValueChange={(v) => session.setUnitPercent(v[0] ?? 1)}
              />
            </Field>
            <Field label={`Kelly fraccional ${Math.round(session.kellyFraction * 100)}%`}>
              <Slider
                min={0.1}
                max={0.5}
                step={0.05}
                value={[session.kellyFraction]}
                onValueChange={(v) => session.setKellyFraction(v[0] ?? 0.25)}
              />
            </Field>
            <Field label={`Stake máximo ${session.maxStakePercent.toFixed(1)}%`}>
              <Slider
                min={0.5}
                max={5}
                step={0.25}
                value={[session.maxStakePercent]}
                onValueChange={(v) => session.setMaxStakePercent(v[0] ?? 2)}
              />
            </Field>
          </div>
        </div>

        <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-display text-xl">Cortes</h2>
          <div className="mt-4 space-y-4">
            <Field label="Pérdida diaria máxima">
              <Input
                type="number"
                min={0}
                value={session.dailyLossLimit}
                onChange={(e) => session.setDailyLossLimit(Number(e.target.value))}
              />
            </Field>
            <Field label="Pérdida semanal máxima">
              <Input
                type="number"
                min={0}
                value={session.weeklyLossLimit}
                onChange={(e) => session.setWeeklyLossLimit(Number(e.target.value))}
              />
            </Field>
            <Field label={`VE mínimo ${(session.minEv * 100).toFixed(0)}%`}>
              <Slider
                min={0}
                max={0.1}
                step={0.01}
                value={[session.minEv]}
                onValueChange={(v) => session.setMinEv(v[0] ?? 0.03)}
              />
            </Field>
            <Field label="Confianza mínima">
              <div className="flex gap-2">
                {(["baja", "media", "alta"] as ConfidenceLabel[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`h-10 flex-1 rounded-md text-xs capitalize ${session.minConfidence === c ? "bg-accent text-accent-fg" : "bg-elevated text-muted"}`}
                    onClick={() => session.setMinConfidence(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-elevated p-3">
                <p className="text-[11px] uppercase tracking-wider text-subtle">PnL 24 h</p>
                <p className="mt-1 tabular-nums">{money(daily, session.currency)}</p>
              </div>
              <div className="rounded-lg bg-elevated p-3">
                <p className="text-[11px] uppercase tracking-wider text-subtle">PnL 7 d</p>
                <p className="mt-1 tabular-nums">{money(weekly, session.currency)}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Pausa voluntaria</h2>
        <p className="mt-1 text-sm text-muted">
          Bloquea las sugerencias de stake. El análisis de partidos sigue visible.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => session.startCoolingOff(24)}>
            24 horas
          </Button>
          <Button variant="secondary" onClick={() => session.startCoolingOff(72)}>
            3 días
          </Button>
          <Button variant="secondary" onClick={() => session.startCoolingOff(168)}>
            7 días
          </Button>
          <Button variant="ghost" onClick={() => session.clearCoolingOff()}>
            Levantar pausa
          </Button>
        </div>
        <p className="mt-3 text-xs text-subtle">
          Si necesitas una autoexclusión real de operadores, usa los canales oficiales de tu país.{" "}
          <Link to="/responsable" className="underline">
            Recursos
          </Link>
          .
        </p>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Simulador de drawdown</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          600 trayectorias de 80 apuestas. Incluso con ventaja teórica, una racha adversa reduce el
          capital. No es una predicción de tu resultado.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label={`P modelo ${(simP * 100).toFixed(0)}%`}>
            <Slider min={0.4} max={0.65} step={0.01} value={[simP]} onValueChange={(v) => setSimP(v[0] ?? 0.52)} />
          </Field>
          <Field label={`Cuota ${simOdds.toFixed(2)}`}>
            <Slider min={1.5} max={3.2} step={0.05} value={[simOdds]} onValueChange={(v) => setSimOdds(v[0] ?? 2)} />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <SimStat k="Percentil 5" v={`${(sim.p5 * 100).toFixed(0)}%`} />
          <SimStat k="Mediana" v={`${(sim.median * 100).toFixed(0)}%`} />
          <SimStat k="Percentil 95" v={`${(sim.p95 * 100).toFixed(0)}%`} />
          <SimStat k="Toque de suelo" v={`${(sim.ruin * 100).toFixed(0)}%`} />
        </div>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl">Diario</h2>
          <Button variant="ghost" size="sm" onClick={() => session.resetJournal()}>
            Vaciar
          </Button>
        </div>
        <input
          value={journalQuery}
          onChange={(event) => setJournalQuery(event.target.value)}
          placeholder="Filtrar registro"
          aria-label="Filtrar registro"
          className="mt-3 h-11 w-full max-w-xs rounded-lg bg-elevated px-3 text-sm outline-none"
        />
        {session.logs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Aún no hay registros. Ábrelos desde un partido, después de calcular el VE.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {session.logs
              .filter((log) => {
                const q = journalQuery.trim().toLowerCase();
                if (!q) return true;
                const title = `${names[log.fixtureId] ?? log.fixtureId} ${log.market}`;
                return title.toLowerCase().includes(q);
              })
              .map((log) => {
              const title = names[log.fixtureId] ?? log.fixtureId;
              return (
                <li key={log.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm">
                      {title} · {log.market}
                    </p>
                    <p className="text-xs text-subtle">
                      {money(log.stake, session.currency)} @ {log.odds.toFixed(2)} · VE {formatEv(log.ev)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["pendiente", "ganada", "perdida", "nula"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`h-9 rounded-md px-3 text-xs capitalize ${log.result === r ? "bg-accent text-accent-fg" : "bg-elevated text-muted"}`}
                        onClick={() => session.settleLog(log.id, r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      {children}
    </div>
  );
}

function SimStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-elevated p-3">
      <p className="text-[11px] uppercase tracking-wider text-subtle">{k}</p>
      <p className="mt-1 font-medium tabular-nums">{v}</p>
    </div>
  );
}
