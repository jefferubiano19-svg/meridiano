import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ExportBar } from "@/components/export-bar";
import { CONFEDERATIONS, OPTA_RANK_2026 } from "@/lib/football/coverage";
import { LEAGUES } from "@/lib/football/leagues";
import type { LeagueCard } from "@/lib/football/dto";
import { loadLigas } from "@/lib/football/pages";

export const Route = createFileRoute("/ligas")({ component: LeaguesPage });

function LeaguesPage() {
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<LeagueCard[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadLigas()
      .then((next) => {
        if (live) setCards(next);
      })
      .catch(() => {
        if (live) setCards([]);
      });
    return () => {
      live = false;
    };
  }, []);
  const byId = useMemo(() => new Map((cards ?? []).map((card) => [card.id, card])), [cards]);
  const leagues = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LEAGUES;
    return LEAGUES.filter((league) => `${league.name} ${league.country} ${league.short}`.toLowerCase().includes(q));
  }, [query]);
  return (
    <div className="space-y-10">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Cobertura</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Dónde hay modelo</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          El corpus con probabilidades cubre las ligas de arriba, más Champions y Libertadores. El
          resto del ranking aparece como mapa: sin goles esperados no hay cuota justa.
        </p>
        <div className="mt-4">
          <ExportBar
            filename="meridiano-ligas"
            title="Ligas"
            build={() => ({
              name: "Ligas",
              headers: ["Liga", "Pais", "Equipos", "Partidos por jugar", "Lider"],
              rows: leagues.map((league) => {
                const card = byId.get(league.id);
                return [league.name, league.country, card?.teams ?? "", card?.upcoming ?? "", card?.leader ?? ""];
              }),
              note: "Cobertura del corte. Sin goles esperados no hay cuota justa.",
            })}
          />
        </div>
      </header>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filtrar liga o país"
        aria-label="Filtrar liga o país"
        className="h-11 w-full max-w-xs rounded-lg bg-elevated px-3 text-sm outline-none"
      />
      {!cards ? <p className="text-sm text-muted">Cargando ligas…</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {leagues.map((league) => {
          const card = byId.get(league.id);
          return (
            <Link
              key={league.id}
              to="/ligas/$id"
              params={{ id: league.id }}
              className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
            >
              <p className="text-[11px] uppercase tracking-wider text-subtle">{league.country}</p>
              <h2 className="mt-1 font-display text-2xl">{league.name}</h2>
              <p className="mt-3 text-sm text-muted">
                {card ? `${card.teams} equipos · ${card.upcoming} partidos en agenda` : "Cargando…"}
              </p>
              {card?.leader ? (
                <p className="mt-2 text-xs text-subtle">
                  Referencia de tabla: {card.leader}
                  {card.leaderPts != null ? ` · ${card.leaderPts} pts` : ""}
                </p>
              ) : null}
              {league.note ? <p className="mt-2 text-xs text-muted">{league.note}</p> : null}
            </Link>
          );
        })}
      </div>

      <section>
        <h2 className="font-display text-2xl">Confederaciones</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CONFEDERATIONS.map((item) => (
            <article key={item.id} className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="text-[11px] uppercase tracking-wider text-subtle">{item.id}</p>
              <h3 className="mt-1 font-medium">{item.region}</h3>
              <p className="mt-2 text-sm text-muted">Clubes: {item.clubs}</p>
              <p className="text-sm text-muted">Selecciones: {item.nations}</p>
            </article>
          ))}
        </div>
        <p className="mt-3 text-xs text-subtle">
          El Mundial de Clubes y la Intercontinental cruzan confederaciones. Meridiano no asigna
          probabilidad a una final intercontinental sin un corpus de goles de ambos lados.
        </p>
      </section>

      <section>
        <h2 className="font-display text-2xl">Ranking de ligas 2026</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Orden de referencia de fuerza de liga. “Con modelo” significa que hay equipos, xG y
          partidos en esta app. El resto está en el mapa, no en el motor.
        </p>
        <ol className="mt-4 divide-y divide-border rounded-xl bg-surface shadow-[var(--shadow-border)]">
          {OPTA_RANK_2026.map((row) => (
            <li key={`${row.rank}-${row.country}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="flex min-w-0 items-baseline gap-3">
                <span className="w-6 tabular-nums text-subtle">{row.rank}</span>
                <span className="truncate">
                  {row.name}
                  <span className="text-muted"> · {row.country}</span>
                </span>
              </span>
              <span className="shrink-0 text-[11px] uppercase tracking-wider text-subtle">
                {row.modeled ? "Con modelo" : row.confederation}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-subtle">
          En Colombia, Dimayor organiza la Liga BetPlay y la Copa BetPlay. El Torneo de Ascenso es
          la segunda división y todavía no entra al corpus.
        </p>
      </section>
    </div>
  );
}
