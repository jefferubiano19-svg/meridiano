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

  const matches = useMemo(() => {
    if (!board) return [];
    const q = query.trim().toLowerCase();
    if (!q) return board.matches;
    return board.matches.filter((match) =>
      `${match.home} ${match.away} ${match.competition} ${match.pick}`.toLowerCase().includes(q),
    );
  }, [board, query]);

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
              build={() =>
                readingsSheet(
                  "Partidos",
                  matches,
                  board.joint == null
                    ? `Probabilidad conjunta ${MISSING}. ${JOINT_NOTE}`
                    : `Probabilidad conjunta ${formatJoint(board.joint)}. ${JOINT_NOTE}`,
                )
              }
            />
          </div>
        ) : null}
      </header>

      {!board ? (
        <p className="text-sm text-muted">{failed ? "No se pudo cargar la lista." : "Cargando los partidos…"}</p>
      ) : (
        <>
          <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
            <h2 className="font-display text-xl">{board.matches.length} partidos, cada uno por separado</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {board.withOdds
                ? `En el día hay ${board.pool} partidos por jugar con cuota en casas de apuestas.`
                : `Para este día todavía no hay cuotas leídas: se toman los ${board.pool} partidos por jugar con probabilidad.`}{" "}
              Aquí se listan los {board.matches.length} con el favorito más probable, ordenados por hora. Cada
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
                extra={
                  match.pickProbability == null
                    ? `Lado ${match.pick}: ${MISSING}`
                    : `Lado ${match.pick}: ${formatPct(match.pickProbability, 1)} · cuota justa ${(1 / match.pickProbability).toFixed(2).replace(".", ",")}`
                }
              />
            ))}
          </div>
          {matches.length === 0 ? <p className="text-sm text-muted">Ningún partido coincide con el filtro.</p> : null}
        </>
      )}
    </div>
  );
}
