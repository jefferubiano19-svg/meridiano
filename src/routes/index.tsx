import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ExportBar } from "@/components/export-bar";
import { MatchReadingCard } from "@/components/match/reading-block";
import { Input } from "@/components/ui/input";
import { readingsSheet } from "@/lib/export/reading-rows";
import { boardDayLabel } from "@/lib/football/format";
import type { DayBoard } from "@/lib/football/dto";
import { loadDay } from "@/lib/football/pages";
import { useAgendaToday } from "@/lib/football/use-today";
import { matchesSearch, searchText } from "@/lib/football/search";
import { TOP_SOURCE, topMatches } from "@/lib/football/top-leagues";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const today = useAgendaToday();
  const [board, setBoard] = useState<DayBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [onlyOdds, setOnlyOdds] = useState(true);
  const [count, setCount] = useState(24);
  const [view, setView] = useState<"todos" | "top">("todos");
  const [level, setLevel] = useState<string>("todos");

  useEffect(() => {
    let live = true;
    setBoard(null);
    setFailed(false);
    void loadDay({ data: { day: today } })
      .then((next) => {
        if (live) setBoard(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [today]);

  const withOddsCount = useMemo(() => (board?.matches ?? []).filter((match) => match.withOdds).length, [board]);
  // Los 20 partidos del día de las competiciones de mayor nivel (top-leagues.ts), en el orden del tablero.
  const topIds = useMemo(() => new Set(topMatches(board?.matches ?? [], 20).map((match) => match.id)), [board]);
  const base = useMemo(
    () => (view === "top" ? (board?.matches ?? []).filter((match) => topIds.has(match.id)) : (board?.matches ?? [])),
    [board, view, topIds],
  );
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const match of base) counts[match.level] = (counts[match.level] ?? 0) + 1;
    return counts;
  }, [base]);
  // Si el corte todavía no leyó cuotas de ningún partido, se muestran todos. En «Mejores ligas» no aplica.
  const oddsFilter = view === "todos" && onlyOdds && withOddsCount > 0;
  const filtered = useMemo(() => {
    const q = query.trim();
    return base.filter((match) => {
      if (oddsFilter && !match.withOdds) return false;
      if (level !== "todos" && match.level !== level) return false;
      if (onlyReview && !match.revisar && !match.value) return false;
      if (!q) return true;
      return matchesSearch(
        q,
        searchText([match.home, match.away, match.competition, match.homeEs, match.awayEs]),
      );
    });
  }, [base, query, onlyReview, oddsFilter, level]);

  const shown = filtered.slice(0, count);

  return (
    <div className="space-y-4">
      <section className="sheet flex flex-wrap items-end justify-between gap-3 px-4 py-4 pl-5 md:px-5">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.2em] text-subtle">
            Tablero · {boardDayLabel(today)}
          </p>
          <h1 className="mt-1 font-display text-3xl leading-none tracking-tight">La ficha de cada partido</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Primero los que faltan por jugar, por hora. «Con cuota en casas» deja solo los partidos que una casa de
            apuestas ofrece; «Mejores ligas», los 20 de mayor nivel del día; «Nivel», cómo se calculó cada ficha. Los
            ya jugados están en Consulta.
          </p>
          <span className="mt-3 block h-0.5 w-28 rounded-full bg-[#b7c7b0]" />
        </div>
        <ExportBar
          filename="meridiano-agenda"
          title="Agenda"
          build={() =>
            readingsSheet(
              "Agenda",
              shown,
              "Partidos del día que se están mostrando. No es una promesa de resultado.",
            )
          }
        />
      </section>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Qué partidos ver">
        <FilterChip
          active={view === "todos"}
          onClick={() => {
            setView("todos");
            setCount(24);
          }}
        >
          Todos los partidos
        </FilterChip>
        <FilterChip
          active={view === "top"}
          onClick={() => {
            setView("top");
            setCount(24);
          }}
        >
          {`Mejores ligas (${topIds.size})`}
        </FilterChip>
      </div>
      {view === "top" ? (
        <p className="max-w-3xl text-xs text-muted">
          Los {topIds.size === 20 ? "20" : topIds.size} partidos de hoy de las competiciones de mayor nivel
          {topIds.size < 20 ? " (hoy no hay más de esas competiciones)" : ""}. {TOP_SOURCE}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" aria-label="Filtrar por nivel">
        <span className="text-[11px] uppercase tracking-[0.2em] text-subtle">Nivel</span>
        {[
          { key: "todos", label: "Todos" },
          { key: "A", label: "A · liga con modelo propio" },
          { key: "B", label: "B · ratings globales" },
          { key: "C", label: "C · goles recientes" },
          { key: "M", label: "M · solo mercado" },
          { key: "5.4", label: "Selecciones" },
        ]
          .filter((item) => item.key === "todos" || item.key !== "5.4" || (levelCounts["5.4"] ?? 0) > 0)
          .map((item) => (
            <FilterChip
              key={item.key}
              active={level === item.key}
              onClick={() => {
                setLevel(item.key);
                setCount(24);
              }}
            >
              {item.key === "todos" ? item.label : `${item.label} (${levelCounts[item.key] ?? 0})`}
            </FilterChip>
          ))}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Input
          placeholder="Buscar equipo o competición"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCount(24);
          }}
          className="md:max-w-xs"
          aria-label="Buscar equipo o competición"
        />
        <div className="flex flex-wrap gap-2">
          {view === "todos" ? (
          <FilterChip
            active={oddsFilter}
            onClick={() => {
              setOnlyOdds(!onlyOdds);
              setCount(24);
            }}
          >
            {withOddsCount > 0 ? `Con cuota en casas (${withOddsCount})` : "Con cuota en casas (aún sin leer)"}
          </FilterChip>
          ) : null}
          <FilterChip
            active={!onlyReview}
            onClick={() => {
              setOnlyReview(false);
              setCount(24);
            }}
          >
            Todos
          </FilterChip>
          <FilterChip
            active={onlyReview}
            onClick={() => {
              setOnlyReview(true);
              setCount(24);
            }}
          >
            revisar o valor
          </FilterChip>
        </div>
      </div>

      {!board ? (
        <p className="text-sm text-muted">{failed ? "No se pudo cargar el día." : "Cargando los partidos del día…"}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">
          {query.trim() || onlyReview || level !== "todos"
            ? "Ningún partido coincide con el filtro."
            : view === "top"
            ? "Hoy no hay partidos de las competiciones de mayor nivel."
            : "No quedan partidos por jugar hoy. Los finalizados están en Consulta."}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((match) => (
            <MatchReadingCard key={match.id} match={match} />
          ))}
        </div>
      )}

      {count < filtered.length ? (
        <button
          type="button"
          onClick={() => setCount((value) => value + 24)}
          className="mx-auto flex h-11 items-center rounded-full bg-elevated px-5 text-sm text-fg"
        >
          Ver más partidos ({filtered.length - count} restantes)
        </button>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-full px-3 text-xs ring-1 transition",
        active ? "bg-accent text-accent-fg ring-transparent" : "bg-elevated/70 text-muted ring-border hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
