import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ExportBar } from "@/components/export-bar";
import { MatchReadingCard } from "@/components/match/reading-block";
import { readingsSheet } from "@/lib/export/reading-rows";
import type { SearchBoard } from "@/lib/football/dto";
import { loadSearch } from "@/lib/football/pages";

export const Route = createFileRoute("/buscar")({ component: BuscarPage });

function BuscarPage() {
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [date, setDate] = useState("");
  const [competition, setCompetition] = useState("");
  const [board, setBoard] = useState<SearchBoard | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    void loadSearch({ data: { home, away, date, competition } })
      .then((next) => setBoard(next))
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  }

  const rows = [...(board?.hits ?? []), ...(board?.named ? [board.named] : [])];

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Un partido</p>
        <h1 className="font-display text-4xl tracking-tight">Consulta de partido</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Escribe un equipo contra el otro, la fecha y la liga o copa. Si el cruce está publicado, se
          abre esa ficha. Si no está, se calcula con el mismo modelo, usando solo el historial publicado
          de esos nombres.
        </p>
        <ExportBar
          filename="meridiano-consulta-partido"
          title="Consulta de partido"
          build={() =>
            readingsSheet(
              "Fichas",
              rows,
              board?.note || "Cada fila repite la ficha del cruce publicado. No es una promesa de resultado.",
            )
          }
        />
      </header>

      <form onSubmit={search} className="grid gap-3 rounded-xl bg-surface p-5 shadow-[var(--shadow-border)] sm:grid-cols-2">
        <Field label="Equipo local" value={home} onChange={setHome} placeholder="Nombre del local" />
        <Field label="Equipo visita" value={away} onChange={setAway} placeholder="Nombre de la visita" />
        <label className="block text-xs text-subtle">
          Fecha de juego
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="mt-1 h-11 w-full rounded-lg bg-elevated px-3 text-sm text-fg outline-none"
          />
        </label>
        <Field label="Copa, liga o competición" value={competition} onChange={setCompetition} placeholder="Opcional" />
        <button type="submit" className="h-11 rounded-full bg-accent px-4 text-sm text-accent-fg sm:col-span-2">
          {busy ? "Buscando…" : "Buscar y analizar"}
        </button>
      </form>

      {failed ? <p className="text-sm text-muted">No se pudo buscar.</p> : null}

      {board && board.hits.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Ese cruce no está en la agenda
            {date ? ` el ${date}` : ""}
            {competition ? ` en ${competition}` : ""}. {board.note}
          </p>
          {board.others.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">También hay estos cruces publicados, en otra fecha:</p>
              {board.others.map((hit) => (
                <MatchReadingCard key={hit.id} match={hit} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {board && board.hits.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            {board.hits.length === 30
              ? "30 cruces. Afina la fecha o la competición."
              : `${board.hits.length} cruce${board.hits.length === 1 ? "" : "s"} publicado${board.hits.length === 1 ? "" : "s"}.`}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {board.hits.map((hit) => (
              <MatchReadingCard key={hit.id} match={hit} />
            ))}
          </div>
        </div>
      ) : null}

      {board?.named ? <MatchReadingCard match={board.named} extra={board.note} /> : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block text-xs text-subtle">
      {label}
      <input
        required={label.startsWith("Equipo")}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-11 w-full rounded-lg bg-elevated px-3 text-sm text-fg outline-none"
      />
    </label>
  );
}
