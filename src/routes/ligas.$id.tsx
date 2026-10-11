import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ExportBar } from "@/components/export-bar";
import { MatchReadingCard } from "@/components/match/reading-block";
import { readingsSheet } from "@/lib/export/reading-rows";
import { gd } from "@/lib/football/format";
import type { LeaguePage } from "@/lib/football/dto";
import { loadLeague } from "@/lib/football/pages";

export const Route = createFileRoute("/ligas/$id")({ component: LeagueDetail });

function LeagueDetail() {
  const { id } = Route.useParams();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<LeaguePage | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setPage(undefined);
    void loadLeague({ data: { id } })
      .then((next) => {
        if (live) setPage(next);
      })
      .catch(() => {
        if (live) setPage(null);
      });
    return () => {
      live = false;
    };
  }, [id]);

  const matches = useMemo(() => {
    if (!page) return [];
    const q = query.trim().toLowerCase();
    if (!q) return page.matches;
    return page.matches.filter((match) => `${match.home} ${match.away}`.toLowerCase().includes(q));
  }, [page, query]);

  if (page === undefined) return <p className="text-sm text-muted">Cargando la liga…</p>;
  if (!page) {
    return (
      <p className="text-muted">
        Liga no encontrada.{" "}
        <Link to="/ligas" className="underline">
          Volver
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <Link to="/ligas" className="inline-flex items-center gap-1 text-xs text-subtle">
          <ArrowLeft className="size-3" /> Ligas
        </Link>
        <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-subtle">{page.country}</p>
        <h1 className="mt-1 font-display text-4xl tracking-tight">{page.name}</h1>
        {page.note ? <p className="mt-3 max-w-2xl text-sm text-muted">{page.note}</p> : null}
        <div className="mt-4">
          <ExportBar
            filename={`meridiano-${page.id}`}
            title={page.name}
            build={() => readingsSheet(page.name, matches, "Partidos por jugar de esta liga. No es una promesa de resultado.")}
          />
        </div>
      </header>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filtrar equipo"
        aria-label="Filtrar equipo"
        className="h-11 w-full max-w-xs rounded-lg bg-elevated px-3 text-sm outline-none"
      />
      <div className="grid gap-3 md:grid-cols-2">
        {matches.map((match) => (
          <MatchReadingCard key={match.id} match={match} />
        ))}
      </div>
      {matches.length === 0 ? <p className="text-sm text-muted">No hay partidos por jugar en el filtro.</p> : null}
      {page.table.length > 0 ? (
        <section>
          <h2 className="font-display text-2xl">Referencia de tabla</h2>
          <div className="mt-3 overflow-x-auto rounded-xl bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-subtle">
                <tr>
                  <th className="px-4 py-2">Equipo</th>
                  <th className="px-4 py-2">Pts</th>
                  <th className="px-4 py-2">GF</th>
                  <th className="px-4 py-2">GC</th>
                  <th className="px-4 py-2">DG</th>
                </tr>
              </thead>
              <tbody>
                {page.table.map((team) => (
                  <tr key={team.name} className="border-t border-line">
                    <td className="px-4 py-2">{team.name}</td>
                    <td className="px-4 py-2 tabular-nums">{team.pts}</td>
                    <td className="px-4 py-2 tabular-nums">{team.gf}</td>
                    <td className="px-4 py-2 tabular-nums">{team.ga}</td>
                    <td className="px-4 py-2 tabular-nums">{gd(team.gf, team.ga)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
