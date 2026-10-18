import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { shiftDay } from "@/lib/football/clock";
import type { MatchReading } from "@/lib/football/dto";
import { kickLabel } from "@/components/match/reading-block";
import { loadDay, loadModelo } from "@/lib/football/pages";
import { useAgendaToday } from "@/lib/football/use-today";
import { VALUE_MAX_EV, VALUE_MIN_EV, valuePicks, type ValuePick } from "@/lib/football/valor";
import { betSlip } from "@/lib/store/bet-slip";

export const Route = createFileRoute("/valor")({ component: ValorPage });

/* ---------------------------------------------------------------------------
 * «Valor del día»: selecciones de hoy y mañana donde la mejor cuota de las casas paga más de lo que
 * vale el resultado según el consenso de esas mismas casas (reglas en src/lib/football/valor.ts).
 * Cada selección queda guardada por el corte (data/valor-registro.json) y la página Modelo mide si ganan.
 * ------------------------------------------------------------------------- */

interface Row {
  match: MatchReading;
  pick: ValuePick;
}

type Stat = { n: number; mean: number | null; low: number | null; high: number | null };

const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
const num = (value: number) => value.toFixed(2).replace(".", ",");
const SIDE = ["local", "empate", "visita"] as const;
const MARKET = ["home", "draw", "away"] as const;

function team(match: MatchReading, index: number): string {
  if (index === 0) return match.homeEs || match.home;
  if (index === 2) return match.awayEs || match.away;
  return "Empate";
}

function money(stat: Stat | undefined): string {
  if (!stat || stat.mean == null) return "sin datos todavía";
  const base = `${stat.mean >= 0 ? "+" : "−"}${Math.abs(stat.mean * 100).toFixed(1).replace(".", ",")} % por apuesta`;
  if (stat.n < 20 || stat.low == null || stat.high == null) return `${base} en ${stat.n} (muy pocas para concluir)`;
  return `${base} (IC 95 % ${(stat.low * 100).toFixed(1).replace(".", ",")} % a ${(stat.high * 100).toFixed(1).replace(".", ",")} %, ${stat.n} selecciones)`;
}

function ValorPage() {
  const today = useAgendaToday();
  const [matches, setMatches] = useState<MatchReading[] | null>(null);
  const [record, setRecord] = useState<{ settled: number; roi: Stat; closed: number; evClose: Stat; verdict: string } | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([loadDay({ data: { day: today } }), loadDay({ data: { day: shiftDay(today, 1) } })])
      .then(([a, b]) => {
        if (live) setMatches([...a.matches, ...b.matches]);
      })
      .catch(() => {
        if (live) setMatches([]);
      });
    void loadModelo()
      .then((bundle) => {
        const review = bundle.review as unknown as { pickResults?: typeof record } | null;
        if (live) setRecord(review?.pickResults ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [today]);

  const rows = useMemo(() => {
    const now = Date.now();
    const out: Row[] = [];
    for (const match of matches ?? []) {
      if (match.status !== "por-jugar" || !(Date.parse(match.kickoff) - now > 10 * 60 * 1000)) continue;
      if (!match.consensus || !match.bestOdds) continue;
      const probs = [match.consensus.home, match.consensus.draw, match.consensus.away];
      const best = [match.bestOdds.home, match.bestOdds.draw, match.bestOdds.away];
      for (const pick of valuePicks(probs, best, match.bestOdds.houses)) out.push({ match, pick });
    }
    return out.sort((a, b) => a.match.kickoff.localeCompare(b.match.kickoff));
  }, [matches]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Cada día · hoy y mañana</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Valor del día</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Selecciones donde la casa que mejor paga da más de lo que vale el resultado según el consenso de las casas
          (entre +{pct(VALUE_MIN_EV)} y +{pct(VALUE_MAX_EV)} por apuesta). Casi siempre son equipos no favoritos: se
          cumplen pocas veces. No es una recomendación y la ventaja todavía no está demostrada.
        </p>
      </header>

      <section className="rounded-xl bg-surface p-4 text-sm shadow-[var(--shadow-border)]">
        <h2 className="font-display text-lg">¿Han ganado hasta ahora?</h2>
        {record ? (
          <div className="mt-2 space-y-1 text-muted">
            <p>
              <strong className="text-fg">Veredicto:</strong> {record.verdict}.
            </p>
            <p>Contra el consenso de cierre: {money(record.evClose)}.</p>
            <p>Resultado real: {money(record.roi)}.</p>
          </div>
        ) : (
          <p className="mt-2 text-muted">Se empieza a medir desde el próximo corte.</p>
        )}
      </section>

      <section className="rounded-xl bg-surface p-4 text-sm leading-relaxed text-muted shadow-[var(--shadow-border)]">
        <h2 className="font-display text-lg text-fg">Cómo usarlo</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Busca el partido en la casa indicada y confirma la hora y el equipo local.</li>
          <li>Apuesta solo si la casa paga la cuota mínima o más. Si paga menos, ya no tiene valor.</li>
          <li>Por separado, nunca en combinada, y siempre la misma cantidad pequeña.</li>
          <li>Cuenta con perder la mayoría: el valor solo aparece después de muchas apuestas.</li>
        </ol>
      </section>

      {matches == null ? (
        <p className="text-sm text-muted">Cargando partidos de hoy y mañana…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">
          Hoy y mañana ninguna casa paga por encima de lo que vale ningún resultado (con 3 o más casas leídas). Es lo
          normal: en ese caso no hay apuesta con valor.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ match, pick }) => (
            <article key={`${match.id}-${pick.outcomeIndex}`} className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">{match.competition}</p>
              <h2 className="mt-1 font-display text-xl tracking-tight">
                {match.home} — {match.away}
              </h2>
              <p className="mt-1 text-xs text-muted">{kickLabel(match.kickoff)}</p>
              <p className="mt-3 text-base text-fg">
                <strong>{team(match, pick.outcomeIndex)}</strong>{" "}
                <span className="text-muted">({SIDE[pick.outcomeIndex]})</span>
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-subtle">Se cumple</dt>
                  <dd>{pct(pick.prob)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-subtle">Cuota justa</dt>
                  <dd>{num(pick.fair)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-subtle">Mejor cuota</dt>
                  <dd>
                    {num(pick.odds)} · {pick.house}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-subtle">Cuota mínima</dt>
                  <dd className="text-value">{num(pick.minOdds)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-subtle">Por cada $100</dt>
                  <dd className="text-value">+${(pick.ev * 100).toFixed(1).replace(".", ",")}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-subtle">Casas leídas</dt>
                  <dd>{match.bestOdds?.houses ?? "—"}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-muted">
                Cuota leída en el último corte{match.bestOdds?.readAt ? ` (${match.bestOdds.readAt.slice(11, 16)})` : ""}: verifica
                que siga igual en la casa.
              </p>
              <button
                type="button"
                className="mt-3 h-9 rounded-full bg-elevated px-3 text-xs text-fg ring-1 ring-border"
                onClick={() => betSlip.put(match.id, MARKET[pick.outcomeIndex], `${match.home} — ${match.away}`)}
              >
                Revisar en Apuesta
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
