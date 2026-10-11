import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExportBar } from "@/components/export-bar";
import { MatchReadingCard } from "@/components/match/reading-block";
import { readingsSheet } from "@/lib/export/reading-rows";
import { boardDayLabel } from "@/lib/football/format";
import type { ConsultaBoard } from "@/lib/football/dto";
import { loadConsulta } from "@/lib/football/pages";

export const Route = createFileRoute("/consulta")({ component: ConsultaPage });

function ConsultaPage() {
  const [day, setDay] = useState("");
  const [board, setBoard] = useState<ConsultaBoard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    void loadConsulta({ data: { day } })
      .then((next) => {
        if (live) setBoard(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [day]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Fechas anteriores</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Consulta</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          Partidos ya jugados, también los de hoy. Si el día tiene más de 80, se muestran los 80 de
          hora más reciente. Sin marca de valor, la ficha lo dice en una línea. Lo que no está, dice
          NO DISPONIBLE.
        </p>
        {board ? (
          <div className="mt-4">
            <ExportBar
              filename="meridiano-consulta"
              title="Consulta"
              build={() =>
                readingsSheet(
                  "Consulta",
                  board.matches,
                  "Hasta 80 fichas del día elegido. La estimación usa solo lo publicado antes del inicio.",
                )
              }
            />
          </div>
        ) : null}
      </header>
      {board ? (
        <div className="flex flex-wrap gap-2">
          {board.days.map((item) => (
            <button
              key={item.day}
              type="button"
              onClick={() => setDay(item.day)}
              className={`h-9 rounded-full px-3 text-xs ${
                item.day === board.day ? "bg-accent text-accent-fg" : "bg-elevated text-muted"
              }`}
            >
              {boardDayLabel(item.day)} · {item.n}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">{failed ? "No se pudo cargar la consulta." : "Cargando fechas…"}</p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {board?.matches.map((match) => (
          <MatchReadingCard key={match.id} match={match} />
        ))}
      </div>
    </div>
  );
}
