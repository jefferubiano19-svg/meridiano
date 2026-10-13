import { useMemo, useState } from "react";
import { MatchCard } from "@/components/match/match-card";
import { RateCard } from "@/components/match/rate-card";
import { AGENDA, agendaDay, type AgendaMatch } from "@/lib/football/agenda";
import { getFixture } from "@/lib/football/fixtures";
import { getAnalysis } from "@/lib/football/model";
import { recentFor } from "@/lib/football/recent";
import { publishedFor } from "@/lib/football/published";
import { hitsForAgenda, type HitRead } from "@/lib/football/hits";
import { agendaToday } from "@/lib/football/today";

function played(match: AgendaMatch): boolean {
  return agendaDay(match) < agendaToday() || match.status === "finalizado";
}

export function PlayedList() {
  const source = useMemo(() => AGENDA.filter(played), []);
  const days = useMemo(() => [...new Set(source.map(agendaDay))].sort().reverse(), [source]);
  const [day, setDay] = useState("all");
  const [competition, setCompetition] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);

  const competitions = useMemo(() => {
    const pool = day === "all" ? source : source.filter((match) => agendaDay(match) === day);
    return [...new Set(pool.map((match) => match.competition))].sort((a, b) => a.localeCompare(b, "es"));
  }, [source, day]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source.filter((match) => {
      if (day !== "all" && agendaDay(match) !== day) return false;
      if (competition !== "all" && match.competition !== competition) return false;
      if (!q) return true;
      return `${match.home} ${match.away} ${match.competition}`.toLowerCase().includes(q);
    });
  }, [source, day, competition, query]);

  const visible = filtered.slice(0, limit);
  const tally = useMemo(() => {
    let hits = 0;
    let total = 0;
    let matches = 0;
    for (const match of filtered) {
      const read = hitsForAgenda(match);
      if (!read) continue;
      matches += 1;
      hits += read.hits;
      total += read.total;
    }
    return { hits, total, matches };
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(30);
          }}
          placeholder="Filtrar equipo o liga"
          aria-label="Filtrar equipo o liga"
          className="h-11 rounded-lg bg-elevated px-3 text-sm outline-none md:max-w-xs"
        />
        <select
          value={day}
          onChange={(event) => {
            setDay(event.target.value);
            setCompetition("all");
            setLimit(30);
          }}
          aria-label="Fecha"
          className="h-11 rounded-lg bg-elevated px-3 text-sm outline-none"
        >
          <option value="all">Todas las fechas anteriores</option>
          {days.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={competition}
          onChange={(event) => {
            setCompetition(event.target.value);
            setLimit(30);
          }}
          aria-label="Liga"
          className="h-11 rounded-lg bg-elevated px-3 text-sm outline-none md:max-w-md"
        >
          <option value="all">Todas las ligas</option>
          {competitions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-subtle">
        {filtered.length} partidos jugados. Se muestran {visible.length}. El marcador solo si estaba
        publicado.
      </p>
      {tally.matches > 0 ? (
        <p className="text-sm">
          <span className="font-medium text-value tabular-nums">{tally.hits}</span>
          <span className="text-muted">
            {" "}
            de {tally.total} marcas coincidieron con el resultado, en {tally.matches} partidos que
            tenían estimación. Cada marca es el lado con más probabilidad: 1X2, más o menos 2.5,
            ambos marcan y el marcador modal.
          </span>
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((match) => (
          <PlayedCard key={match.id} match={match} />
        ))}
      </div>
      {filtered.length > visible.length ? (
        <button
          type="button"
          onClick={() => setLimit((value) => value + 40)}
          className="h-11 rounded-full bg-elevated px-4 text-sm"
        >
          Ver más ({filtered.length - visible.length})
        </button>
      ) : null}
    </div>
  );
}

function PlayedCard({ match }: { match: AgendaMatch }) {
  if (match.fixtureId) {
    const fixture = getFixture(match.fixtureId);
    if (fixture) return <MatchCard fixture={fixture} analysis={getAnalysis(fixture)} />;
  }
  const score =
    match.homeScore == null || match.awayScore == null
      ? "sin marcador publicado"
      : `${match.homeScore}–${match.awayScore}`;
  const recent = recentFor(match.id);
  const hits: HitRead | null = hitsForAgenda(match);
  const started = match.status === "finalizado" || match.status === "en-juego";
  const shown = publishedFor(match.id, match.kickoff, match.competition);
  const analysis = shown as unknown as Parameters<typeof RateCard>[0]["analysis"];
  const level = shown?.level ?? "C";
  return (
    <RateCard
      href={`/agenda/${match.id}`}
      kicker={match.competition}
      when={`${agendaDay(match)} · ${score}`}
      home={match.home}
      away={match.away}
      analysis={analysis}
      score={
        started
          ? { home: match.homeScore, away: match.awayScore, status: match.status }
          : null
      }
      hits={hits}
      note={
        level === "A" && analysis
          ? "Tarjeta de nivel A: Dixon-Coles de la liga, ajustado antes del partido."
          : recent?.home && recent.away
            ? `Tarjeta de nivel C, calculada después del partido. ${recent.home.n} partidos del local y ${recent.away.n} de la visita, anteriores al inicio.`
            : "NO DISPONIBLE. No hay partidos previos publicados de los dos."
      }
    />
  );
}
