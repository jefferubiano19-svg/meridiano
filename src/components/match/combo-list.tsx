import { useEffect, useMemo, useState } from "react";
import { ExportBar } from "@/components/export-bar";
import { MatchReadingCard } from "@/components/match/reading-block";
import { readingsSheet } from "@/lib/export/reading-rows";
import { boardDayLabel, formatPct } from "@/lib/football/format";
import { MISSING, type ComboBoard } from "@/lib/football/dto";
import { loadCombo } from "@/lib/football/pages";

const JOINT_NOTE =
  "Acertar los 20 a la vez es casi imposible y el margen de la casa se multiplica en cada partido";

function formatJoint(p: number): string {
  if (!(p > 0) || !Number.isFinite(p)) return MISSING;
  let count = Math.round(1 / p);
  if (count < 1) count = 1;
  const scales: { size: number; one: string; many: string }[] = [
    { size: 1e3, one: "mil", many: "mil" },
    { size: 1e6, one: "millón", many: "millones" },
    { size: 1e9, one: "mil millones", many: "mil millones" },
    { size: 1e12, one: "billón", many: "billones" },
  ];
  let word = "";
  let shown = count;
  for (const scale of scales) {
    if (count < scale.size) break;
    shown = Math.round(count / scale.size);
    word = shown === 1 ? scale.one : scale.many;
  }
  if (shown >= 1000 && word) {
    const next =
      word === "mil"
        ? { one: "millón", many: "millones" }
        : word === "millones" || word === "millón"
          ? { one: "mil millones", many: "mil millones" }
          : word === "mil millones"
            ? { one: "billón", many: "billones" }
            : null;
    if (next) {
      shown = Math.round(shown / 1000);
      word = shown === 1 ? next.one : next.many;
    }
  }
  if (!word) return `aprox. 1 en ${shown}`;
  return `aprox. 1 en ${shown} ${word}`;
}

export function ComboList({ which }: { which: "hoy" | "manana" }) {
  const [board, setBoard] = useState<ComboBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<"rank" | "time">("rank");

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

  // Puesto de 1 a 20: 1 es el lado más probable de la lista (probabilidad publicada). Sin probabilidad, al final.
  const ranks = useMemo(() => {
    const sorted = [...(board?.matches ?? [])].sort(
      (a, b) => (b.pickProbability ?? -1) - (a.pickProbability ?? -1) || a.kickoff.localeCompare(b.kickoff),
    );
    return new Map(sorted.map((match, index) => [match.id, index + 1]));
  }, [board]);

  const matches = useMemo(() => {
    if (!board) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? board.matches.filter((match) => `${match.home} ${match.away} ${match.competition} ${match.pick}`.toLowerCase().includes(q))
      : board.matches;
    return [...list].sort((a, b) =>
      order === "rank" ? (ranks.get(a.id) ?? 99) - (ranks.get(b.id) ?? 99) : a.kickoff.localeCompare(b.kickoff),
    );
  }, [board, query, order, ranks]);

  const day = board?.day ?? "";

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">
          {day ? boardDayLabel(day) : "Día en Bogotá"} · partidos sueltos
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">
          {which === "hoy" ? "Partido hoy" : day ? `Partido ${boardDayLabel(day)}` : "Partido"}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Lista de hasta 20 partidos individuales de {which === "hoy" ? "hoy" : "ese día"}, cada uno con su
          probabilidad. No es una apuesta combinada. Entran solo partidos que una casa ofrece y se
          eligen los de favorito más probable. El lado de cada fila es el más probable según la probabilidad
          publicada (mercado y modelo juntos). Si falta, dice {MISSING}.
        </p>
        {board ? (
          <div className="mt-4">
            <ExportBar
              filename={which === "hoy" ? "meridiano-combo" : "meridiano-manana"}
              title={which === "hoy" ? "Partido hoy" : "Partido"}
              build={() => {
                const sheet = readingsSheet(
                  "Partidos",
                  matches,
                  board.joint == null
                    ? `Probabilidad conjunta ${MISSING}. ${JOINT_NOTE}`
                    : `Probabilidad conjunta ${formatJoint(board.joint)}. ${JOINT_NOTE}`,
                );
                // Puesto (1 = más probable) y lado elegido al principio de cada fila.
                return {
                  ...sheet,
                  headers: ["Puesto", "Lado", "Probabilidad del lado", ...sheet.headers],
                  rows: sheet.rows.map((row, index) => {
                    const match = matches[index];
                    return [
                      ranks.get(match.id) ?? null,
                      match.pick,
                      match.pickProbability == null ? null : formatPct(match.pickProbability, 1),
                      ...row,
                    ];
                  }),
                };
              }}
            />
          </div>
        ) : null}
      </header>

      {!board ? (
        <p className="text-sm text-muted">{failed ? "No se pudo cargar la lista." : "Cargando los partidos…"}</p>
      ) : (
        <>
          {board.frozen ? (
            <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
              <h2 className="font-display text-xl">Lista fija de hoy</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Publicada a las {board.frozen.savedAt.slice(11, 16)} y no cambia en el día: los partidos que ya empezaron
                siguen en la lista y se marcan ✔ o ✘ al terminar.
              </p>
              <p className="mt-2 text-base">
                {board.frozen.settled === 0
                  ? "Todavía no termina ningún partido."
                  : `Van ${board.frozen.hits} aciertos de ${board.frozen.settled} terminados (esperado ${board.frozen.expected.toFixed(1).replace(".", ",")}).`}
              </p>
            </section>
          ) : null}
          <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
            <h2 className="font-display text-xl">{board.matches.length} partidos, cada uno por separado</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {board.withOdds
                ? `En el día hay ${board.pool} partidos por jugar con cuota en casas de apuestas.`
                : `Para este día todavía no hay cuotas leídas: se toman los ${board.pool} partidos por jugar con probabilidad.`}{" "}
              Aquí se listan los {board.matches.length} con el favorito más probable, numerados de 1 a {board.matches.length} por
              probabilidad. Cada
              probabilidad es de ese partido solo.
            </p>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-elevated px-3 py-3">
                <dt className="text-[10px] uppercase tracking-wide text-subtle">Partidos</dt>
                <dd className="mt-1 font-medium tabular-nums">{board.matches.length}</dd>
              </div>
              <div className="rounded-lg bg-elevated px-3 py-3">
                <dt className="text-[10px] uppercase tracking-wide text-subtle">Probabilidad conjunta</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {board.joint == null ? MISSING : formatJoint(board.joint)}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-muted">{JOINT_NOTE}</p>
          </section>

          {which === "hoy" ? (
            <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
              <h2 className="font-display text-xl">¿Cómo le fue a esta lista los días anteriores?</h2>
              {board.history && board.history.length ? (
                <>
                  <table className="mt-3 w-full max-w-lg text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-subtle">
                      <tr>
                        <th className="py-1 font-normal">Día</th>
                        <th className="py-1 font-normal">Acertó</th>
                        <th className="py-1 font-normal">Esperado</th>
                        <th className="py-1 font-normal">Sin resultado</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {board.history.map((row) => (
                        <tr key={row.day}>
                          <td className="py-1">{boardDayLabel(row.day)}</td>
                          <td className="py-1">
                            {row.hits} de {row.settled}
                            {row.settled ? ` (${formatPct(row.hits / row.settled, 0)})` : ""}
                          </td>
                          <td className="py-1">{row.expected.toFixed(1).replace(".", ",")}</td>
                          <td className="py-1">{row.legs - row.settled}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted">
                    Lista guardada en la madrugada de cada día (corte de la noche). «Esperado» es la suma de las probabilidades
                    de la lista: si se acerca a lo acertado, los porcentajes dicen la verdad. Ninguna lista acierta las 20.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  Las listas se guardan desde el 4 de noviembre de 2026; el primer resultado aparece al día siguiente.
                </p>
              )}
            </section>
          ) : null}

          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Orden de la lista">
            {[
              { key: "rank" as const, label: "Por probabilidad (1 a 20)" },
              { key: "time" as const, label: "Por hora" },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={order === option.key}
                onClick={() => setOrder(option.key)}
                className={`h-9 rounded-full px-4 text-sm ring-1 ring-border ${order === option.key ? "bg-fg text-bg" : "bg-elevated text-fg"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="-mt-2 text-xs text-muted">
            «Favorito o empate» (doble oportunidad) es lo que más se acierta: cuando Meridiano dijo 85–90 %, pasó el 89 %; cuando
            dijo 90–95 %, el 94 % (1.917 partidos ya jugados). La casa lo paga poco: compara con la cuota justa.{" "}
            #1 es el partido cuyo resultado más probable tiene la probabilidad más alta de la lista; #{board.matches.length} el
            más bajo. Más alto no significa que pague más: la cuota de esos favoritos suele ser baja.
          </p>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrar equipo o liga"
            aria-label="Filtrar equipo o liga"
            className="h-11 w-full max-w-xs rounded-lg bg-elevated px-3 text-sm outline-none"
          />
          <div className="grid gap-3 md:grid-cols-2">
            {matches.map((match) => (
              <MatchReadingCard
                key={match.id}
                match={match}
                rank={ranks.has(match.id) ? { position: ranks.get(match.id) as number, total: board.matches.length } : null}
                extra={[
                  match.outcome === "acierto" ? "✔ Acertó" : match.outcome === "fallo" ? "✘ Falló" : "",
                  match.pickProbability == null
                    ? `Lado ${match.pick}: ${MISSING}`
                    : `Lado ${match.pick}: ${formatPct(match.pickProbability, 1)} · cuota justa ${(1 / match.pickProbability).toFixed(2).replace(".", ",")}`,
                  match.favOrDraw != null
                    ? `${match.pick} o empate: ${formatPct(match.favOrDraw, 1)} · cuota justa ${(1 / match.favOrDraw).toFixed(2).replace(".", ",")}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </div>
          {matches.length === 0 ? <p className="text-sm text-muted">Ningún partido coincide con el filtro.</p> : null}
        </>
      )}
    </div>
  );
}
