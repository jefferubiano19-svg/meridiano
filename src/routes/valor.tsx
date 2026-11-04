import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { shiftDay } from "@/lib/football/clock";
import type { MatchReading } from "@/lib/football/dto";
import { ExportBar } from "@/components/export-bar";
import { kickLabel } from "@/components/match/reading-block";
import { loadDay, loadModelo } from "@/lib/football/pages";
import { useAgendaToday } from "@/lib/football/use-today";
import { bestFromOffers, consensusFromOffers, VALUE_MAX_EV, VALUE_MIN_EV, valuePicks, type ValuePick } from "@/lib/football/valor";
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
  /** Lectura de cada hora (cierre.yml), si es más reciente que la del corte. */
  now: { readAt: string; still: boolean; house: string; odds: number; minOdds: number } | null;
}

const LOW_ODDS = 4;

/** Revisa la selección con la lectura más reciente: ¿la mejor casa todavía paga por encima de lo que vale? */
function recheck(match: MatchReading, pick: ValuePick): Row["now"] {
  const current = match.current;
  if (!current || !(current.readAt > (match.bestOdds?.readAt ?? ""))) return null;
  const probs = consensusFromOffers(current.offers);
  const best = bestFromOffers(current.offers);
  if (!probs || !best) return null;
  const top = best[pick.outcomeIndex];
  const again = valuePicks(probs, best, current.offers.length).find((item) => item.outcomeIndex === pick.outcomeIndex);
  return {
    readAt: current.readAt,
    still: Boolean(again),
    house: top.house,
    odds: top.odds,
    minOdds: (1 + VALUE_MIN_EV) / probs[pick.outcomeIndex],
  };
}

type Stat = { n: number; mean: number | null; low: number | null; high: number | null };

const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
const num = (value: number) => value.toFixed(2).replace(".", ",");
const SIDE = ["local", "empate", "visita"] as const;
const MARKET = ["home", "draw", "away"] as const;
const houseName = (house: string) => house.replace(/\.(co|latam)$/i, "");

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
  type PickRecord = { settled: number; roi: Stat; closed: number; evClose: Stat; verdict: string };
  const [records, setRecords] = useState<{ all: PickRecord | null; low: PickRecord | null }>({ all: null, low: null });
  const [low, setLow] = useState(false);
  const record = low ? records.low : records.all;

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
        const review = bundle.review as unknown as { pickResults?: PickRecord; pickResultsLow?: PickRecord } | null;
        if (live) setRecords({ all: review?.pickResults ?? null, low: review?.pickResultsLow ?? null });
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
      for (const pick of valuePicks(probs, best, match.bestOdds.houses)) {
        if (low && !(pick.odds < LOW_ODDS)) continue;
        out.push({ match, pick, now: recheck(match, pick) });
      }
    }
    // Primero las que siguen con valor; las que ya lo perdieron, al final.
    return out.sort((a, b) => Number(a.now?.still === false) - Number(b.now?.still === false) || a.match.kickoff.localeCompare(b.match.kickoff));
  }, [matches, low]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Cada día · hoy y mañana</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Valor del día</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Selecciones donde la casa que mejor paga da más de lo que vale el resultado según el consenso de las casas
          (entre +{pct(VALUE_MIN_EV)} y +{pct(VALUE_MAX_EV)} por apuesta). Casi siempre son equipos no favoritos: se
          cumplen pocas veces. No es una recomendación: la decisión sobre apostar se toma al llegar a 300 selecciones
          resueltas. Cada selección nueva llega por correo apenas el corte la encuentra, y la cuota se revisa cada hora.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Filtro de cuota">
          {[
            { key: false, label: "Todas" },
            { key: true, label: `Solo cuota menor a ${LOW_ODDS}` },
          ].map((option) => (
            <button
              key={String(option.key)}
              type="button"
              role="tab"
              aria-selected={low === option.key}
              onClick={() => setLow(option.key)}
              className={`h-9 rounded-full px-4 text-sm ring-1 ring-border ${low === option.key ? "bg-fg text-bg" : "bg-elevated text-fg"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {low ? (
          <p className="mt-2 max-w-2xl text-xs text-muted">
            Cuota menor a {LOW_ODDS}: se ganan cerca de 4 o 5 de cada 10, con menos ventaja por apuesta y rachas más cortas.
            La medición de abajo es solo de estas selecciones.
          </p>
        ) : null}
        <div className="mt-4">
          <ExportBar
            filename="meridiano-valor-del-dia"
            title="Valor del día"
            build={() => ({
              name: "Valor del día",
              headers: ["Inicio", "Competición", "Partido", "Selección", "Lado", "Casa", "Cuota", "Cuota mínima", "Se cumple", "Cuota justa", "Valor por $100", "Casas leídas", "Cuota leída", "Cuota vigente", "¿Sigue con valor?"],
              rows: rows.map(({ match, pick, now }) => [
                match.kickoff.slice(0, 16).replace("T", " "),
                match.competition,
                `${match.home} — ${match.away}`,
                team(match, pick.outcomeIndex),
                SIDE[pick.outcomeIndex],
                houseName(pick.house),
                Number(pick.odds.toFixed(2)),
                Number(pick.minOdds.toFixed(2)),
                pct(pick.prob),
                Number(pick.fair.toFixed(2)),
                Number((pick.ev * 100).toFixed(1)),
                match.bestOdds?.houses ?? null,
                match.bestOdds?.readAt?.slice(0, 16).replace("T", " ") ?? null,
                now ? `${num(now.odds)} en ${houseName(now.house)} (${now.readAt.slice(11, 16)})` : null,
                now ? (now.still ? "sí" : "no") : null,
              ]),
              note: `Reglas: solo en la casa indicada, a la cuota mínima o más; sola, nunca en combinada; una por partido. ${record ? `Medición: ${record.verdict}. Contra el cierre: ${money(record.evClose)}. Resultado real: ${money(record.roi)}.` : ""}`,
            })}
          />
        </div>
      </header>

      <section className="rounded-xl bg-surface p-4 text-sm shadow-[var(--shadow-border)]">
        <h2 className="font-display text-lg">¿Han ganado hasta ahora?{low ? ` (cuota menor a ${LOW_ODDS})` : ""}</h2>
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
          <li>Busca el partido en la casa indicada (no en otra) y confirma la hora y el equipo local.</li>
          <li>Apuesta solo si esa casa paga la cuota mínima o más. Si paga menos, ya no tiene valor: no se apuesta.</li>
          <li>
            <strong className="text-fg">Cada selección sola, nunca en combinada</strong>, una por partido y siempre la misma
            cantidad pequeña. Una combinada de 4 selecciones de 13–20 % se cumple menos de 1 vez en 400.
          </li>
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
          {rows.map(({ match, pick, now }) => (
            <article
              key={`${match.id}-${pick.outcomeIndex}`}
              className={`rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] ${now && !now.still ? "opacity-60" : ""}`}
            >
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
                    {num(pick.odds)} · {houseName(pick.house)}
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
              <div className="mt-3 rounded-lg bg-elevated p-3 text-xs leading-relaxed text-fg ring-1 ring-border">
                <p>
                  <strong>Solo en {houseName(pick.house)}, a {num(pick.minOdds)} o más.</strong> En otra casa o con menos cuota
                  ya no tiene valor: no se apuesta.
                </p>
                <p className="mt-1">
                  <strong>Sola, nunca en combinada.</strong> El valor medido es de apuestas sueltas; en combinada se pierde.
                </p>
                {rows.filter((row) => row.match.id === match.id).length > 1 ? (
                  <p className="mt-1">
                    <strong>Este partido tiene {rows.filter((row) => row.match.id === match.id).length} selecciones: juega solo una.</strong>
                  </p>
                ) : null}
              </div>
              {now ? (
                <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${now.still ? "bg-elevated text-fg" : "bg-elevated text-danger"}`}>
                  <strong>Cuota vigente ({now.readAt.slice(11, 16)}):</strong> {num(now.odds)} en {houseName(now.house)} ·
                  mínima {num(now.minOdds)}.{" "}
                  {now.still ? "Sigue con valor." : "Ya no tiene valor: no se apuesta."}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted">
                Cuota leída en el último corte{match.bestOdds?.readAt ? ` (${match.bestOdds.readAt.slice(11, 16)})` : ""}
                {now ? "; arriba, la lectura más reciente" : "; se relee cada hora"}. Verifica que siga igual en la casa.
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
