import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { kickLabel } from "@/components/match/reading-block";
import type { ComboBoard, ComboMatch } from "@/lib/football/dto";
import { boardDayLabel } from "@/lib/football/format";
import { loadCombo, loadModelo } from "@/lib/football/pages";

export const Route = createFileRoute("/rival")({ component: RivalPage });

/* ---------------------------------------------------------------------------
 * «El rival marca»: de los partidos de «Partido hoy» y «Partido» (mañana), la probabilidad de que el no
 * favorito haga al menos un gol. Sale de la misma probabilidad 1X2 publicada (goles esperados que la
 * reproducen, Poisson con rho; engine.ts → rivalScores). La revisión automática la mide contra los resultados.
 * ------------------------------------------------------------------------- */

type Bucket = { label: string; n: number; expected: number | null; observed: number | null };
type Track = { n: number; rate: number | null; brier: number | null; brierConstant: number | null; buckets: Bucket[] };

const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
const fair = (value: number) => (1 / value).toFixed(2).replace(".", ",");

function RivalPage() {
  const [which, setWhich] = useState<"hoy" | "manana">("hoy");
  const [board, setBoard] = useState<ComboBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [track, setTrack] = useState<Track | null>(null);

  useEffect(() => {
    let live = true;
    setBoard(null);
    setFailed(false);
    void loadCombo({ data: { which } })
      .then((next) => {
        if (live) setBoard(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [which]);

  useEffect(() => {
    void loadModelo()
      .then((bundle) => {
        const review = bundle.review as unknown as { rivalGoal?: Track } | null;
        setTrack(review?.rivalGoal ?? null);
      })
      .catch(() => undefined);
  }, []);

  const rows = useMemo(
    () =>
      (board?.matches ?? [])
        .filter((match): match is ComboMatch & { rival: NonNullable<ComboMatch["rival"]> } => Boolean(match.rival))
        .sort((a, b) => b.rival.p - a.rival.p),
    [board],
  );

  const bucketOf = (p: number) => track?.buckets.find((bucket) => {
    const [low, high] = bucket.label === "menos de 60 %" ? [0, 0.6] : bucket.label === "60–70 %" ? [0.6, 0.7] : bucket.label === "70–80 %" ? [0.7, 0.8] : bucket.label === "80–90 %" ? [0.8, 0.9] : [0.9, 1.01];
    return p >= low && p < high;
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">
          {board?.day ? boardDayLabel(board.day) : "Día en Bogotá"} · de la lista de Partido
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">El rival marca</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Para cada partido de la lista, la probabilidad de que el equipo no favorito haga al menos un gol (en las casas:
          «total de goles del equipo, más de 0,5»). Sale de la misma probabilidad publicada del partido. Ordenado de mayor
          a menor.
        </p>
        <div className="mt-4 flex gap-2" role="tablist">
          {(["hoy", "manana"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={which === key}
              onClick={() => setWhich(key)}
              className={`h-9 rounded-full px-4 text-sm ring-1 ring-border ${which === key ? "bg-fg text-bg" : "bg-elevated text-fg"}`}
            >
              {key === "hoy" ? "Hoy" : "Mañana"}
            </button>
          ))}
        </div>
      </header>

      <section className="rounded-xl bg-surface p-4 text-sm leading-relaxed shadow-[var(--shadow-border)]">
        <h2 className="font-display text-lg">¿Se cumple?</h2>
        {track && track.n > 0 && track.brier != null && track.brierConstant != null ? (
          <div className="mt-2 space-y-2 text-muted">
            <p>
              Medido en {track.n.toLocaleString("es-CO")} partidos ya jugados: el no favorito marcó en el{" "}
              {pct(track.rate ?? 0)}. Error (Brier) {track.brier.toFixed(4).replace(".", ",")} contra{" "}
              {track.brierConstant.toFixed(4).replace(".", ",")} de decir siempre el promedio: mejor, pero por poco.
            </p>
            <table className="w-full max-w-md text-left text-xs">
              <thead className="text-subtle">
                <tr>
                  <th className="py-1 font-normal">Dice</th>
                  <th className="py-1 font-normal">Partidos</th>
                  <th className="py-1 font-normal">Esperado</th>
                  <th className="py-1 font-normal">Pasó</th>
                </tr>
              </thead>
              <tbody className="tabular-nums text-fg">
                {track.buckets.filter((bucket) => bucket.n > 0).map((bucket) => (
                  <tr key={bucket.label}>
                    <td className="py-1">{bucket.label}</td>
                    <td className="py-1">{bucket.n.toLocaleString("es-CO")}</td>
                    <td className="py-1">{bucket.expected == null ? "—" : pct(bucket.expected)}</td>
                    <td className="py-1">{bucket.observed == null ? "—" : pct(bucket.observed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Por encima de 80 % la probabilidad exagera: se cumple menos de lo que dice. Usa la columna «Pasó» como
              referencia real.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-muted">La medición aparece después del próximo corte.</p>
        )}
      </section>

      <section className="rounded-xl bg-surface p-4 text-sm leading-relaxed text-muted shadow-[var(--shadow-border)]">
        <h2 className="font-display text-lg text-fg">Antes de apostar</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong className="text-fg">Cuota justa</strong> = 1 ÷ probabilidad. Solo tiene valor si la casa paga{" "}
            <strong className="text-fg">más</strong> que la cuota justa (mejor aún, usando la columna «Pasó»).
          </li>
          <li>Este mercado no tiene cuotas leídas por Meridiano ni medición de valor: no es «Valor del día».</li>
          <li>Cada partido por separado, nunca en combinada.</li>
        </ul>
      </section>

      {!board ? (
        <p className="text-sm text-muted">{failed ? "No se pudo cargar la lista." : "Cargando los partidos…"}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No hay partidos con probabilidad publicada para este día.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((match) => {
            const bucket = bucketOf(match.rival.p);
            return (
              <article key={match.id} className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
                <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">{match.competition}</p>
                <h2 className="mt-1 font-display text-xl tracking-tight">
                  {match.home} — {match.away}
                </h2>
                <p className="mt-1 text-xs text-muted">{kickLabel(match.kickoff)}</p>
                <p className="mt-3 text-base text-fg">
                  <strong>{match.rival.team}</strong> marca al menos 1 gol{" "}
                  <span className="text-muted">({match.rival.side === "home" ? "local" : "visita"}, no favorito)</span>
                </p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">Probabilidad</dt>
                    <dd className="tabular-nums">{pct(match.rival.p)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">Cuota justa</dt>
                    <dd className="tabular-nums">{fair(match.rival.p)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">Pasó (histórico)</dt>
                    <dd className="tabular-nums">{bucket?.observed == null ? "—" : pct(bucket.observed)}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted">
                  Favorito: {match.pick}
                  {match.pickProbability != null ? ` (${pct(match.pickProbability)} de ganar)` : ""}.
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
