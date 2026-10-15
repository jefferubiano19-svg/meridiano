import { useEffect, useMemo, useState } from "react";
import { AGENDA_DAYS, agendaOnDay, type AgendaMatch } from "@/lib/football/agenda";
import { MatchCard } from "@/components/match/match-card";
import { RateCard } from "@/components/match/rate-card";
import { getFixture } from "@/lib/football/fixtures";
import { flashscoreStatusLabel } from "@/lib/football/flashscore";
import { getAnalysis } from "@/lib/football/model";
import { presentAnalysis, publication } from "@/lib/football/publish";
import { nationForMatch } from "@/lib/football/nations";
import { INCOMPATIBLE, recentFor } from "@/lib/football/recent";
import { publishedFor } from "@/lib/football/published";
import { useAgendaToday } from "@/lib/football/use-today";
import { cn } from "@/lib/utils";

function clock(iso: string): string {
  return new Intl.DateTimeFormat("es", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Bogota",
  }).format(new Date(iso));
}

function dayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "America/Bogota",
  }).format(new Date(Date.UTC(year, month - 1, date, 17)));
}

function matchesQuery(query: string, home: string, away: string, competition: string): boolean {
  const stop = new Set(["fc", "cf", "sc", "ac", "cd", "club", "deportivo", "de", "del"]);
  const tokens = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token && !stop.has(token));
  const wanted = tokens(query);
  if (wanted.length === 0) return true;
  const have = tokens(`${home} ${away} ${competition}`);
  return wanted.every((token) =>
    have.some((name) => name === token || name.startsWith(token) || (token.startsWith(name) && name.length >= 3)),
  );
}

export function AgendaBoard() {
  const today = useAgendaToday();
  const openDays = AGENDA_DAYS.filter((item) => item >= today);
  const [day, setDay] = useState(openDays.includes(today) ? today : (openDays[0] ?? today));
  useEffect(() => {
    setDay((current) => (current < today ? today : current));
  }, [today]);
  const [competition, setCompetition] = useState("all");
  const [query, setQuery] = useState("");
  const [onlyModel, setOnlyModel] = useState(false);
  const [limit, setLimit] = useState(12);

  const dayMatches = useMemo(
    () => agendaOnDay(day).filter((match) => match.status !== "finalizado" && match.status !== "cancelado"),
    [day],
  );

  const competitions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const match of dayMatches) counts.set(match.competition, (counts.get(match.competition) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  }, [dayMatches]);

  const filtered = useMemo(() => {
    const rank: Record<string, number> = {
      "en-juego": 0,
      "por-jugar": 1,
      finalizado: 2,
      aplazado: 3,
      cancelado: 4,
      "sin-resultado": 5,
    };
    return dayMatches
      .filter((match) => {
        if (competition !== "all" && match.competition !== competition) return false;
        if (onlyModel && !match.fixtureId) return false;
        if (!query.trim()) return true;
        return matchesQuery(query, match.home, match.away, match.competition);
      })
      .sort(
        (a, b) =>
          (rank[a.status] ?? 5) - (rank[b.status] ?? 5) ||
          a.kickoff.localeCompare(b.kickoff) ||
          a.competition.localeCompare(b.competition, "es"),
      );
  }, [dayMatches, competition, onlyModel, query]);

  const visible = filtered.slice(0, limit);
  const rest = filtered.length - visible.length;
  const groups = useMemo(() => {
    const map = new Map<string, AgendaMatch[]>();
    for (const match of visible) {
      const list = map.get(match.competition) ?? [];
      list.push(match);
      map.set(match.competition, list);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {openDays.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setDay(item);
              setCompetition("all");
              setLimit(24);
            }}
            className={cn(
              "h-10 shrink-0 rounded-full px-3 text-xs",
              item === day ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
            )}
          >
            {dayLabel(item)}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar equipo o liga"
          aria-label="Buscar equipo o liga"
          className="h-11 rounded-lg bg-elevated px-3 text-sm outline-none md:max-w-xs"
        />
        <select
          value={competition}
          onChange={(event) => setCompetition(event.target.value)}
          aria-label="Liga"
          className="h-11 rounded-lg bg-elevated px-3 text-sm outline-none md:max-w-md"
        >
          <option value="all">Todas las ligas de este día ({competitions.length})</option>
          {competitions.map(([name, count]) => (
            <option key={name} value={name}>
              {name} ({count})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setOnlyModel((value) => !value)}
          className={cn(
            "h-10 shrink-0 rounded-full px-3 text-xs",
            onlyModel ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
          )}
        >
          Solo con ficha completa
        </button>
      </div>

      <p className="text-xs text-subtle">
        Este día hay {dayMatches.length} partidos en {competitions.length} ligas. Se muestran {visible.length}{" "}
        de {filtered.length}. El resto sigue en esta agenda, con Ver más. Lo ya jugado está en Consulta.
      </p>

      {groups.length === 0 ? (
        <p className="text-sm text-muted">Ningún partido coincide.</p>
      ) : (
        groups.map(([name, matches]) => (
          <section key={name} className="space-y-2">
            <h2 className="text-sm font-medium text-muted">{name}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {matches.map((match) => (
                <AgendaCard key={match.id} match={match} />
              ))}
            </div>
          </section>
        ))
      )}
      {rest > 0 ? (
        <button
          type="button"
          onClick={() => setLimit((value) => value + 40)}
          className="mx-auto flex h-11 items-center rounded-full bg-elevated px-5 text-sm text-fg"
        >
          Ver más partidos ({rest} restantes)
        </button>
      ) : null}
    </div>
  );
}

function AgendaCard({ match }: { match: AgendaMatch }) {
  const started = match.status !== "por-jugar" || Date.parse(match.kickoff) <= Date.now();
  if (!started && match.fixtureId) {
    const fixture = getFixture(match.fixtureId);
    if (fixture) {
      return <MatchCard fixture={fixture} analysis={presentAnalysis(match.id, getAnalysis(fixture), match.kickoff)} />;
    }
  }
  const blocked = INCOMPATIBLE.test(match.competition);
  // Probabilidad publicada (mercado + modelo) de la única fuente; el modelo solo no se muestra aquí.
  const shown = blocked || started ? null : publishedFor(match.id, match.kickoff, match.competition);
  const raw = shown && shown.level !== "M" ? shown : null;
  const nation = shown?.level === "5.4" ? nationForMatch(match.id) : null;
  const analysis = shown as unknown as Parameters<typeof RateCard>[0]["analysis"];
  const pub = shown && shown.modelPure ? publication(match.id, shown.modelPure, shown.lambdaHome + shown.lambdaAway) : null;
  const recent = recentFor(match.id);
  const score =
    match.status === "sin-resultado"
      ? "Sin resultado publicado"
      : match.homeScore == null || match.awayScore == null
        ? "Por jugar"
        : `${match.homeScore}–${match.awayScore}`;
  const note = blocked
    ? "Formato no compatible con el modelo."
    : started
      ? "El partido ya empezó. Sin probabilidad previa."
      : nation
        ? `Sección 5.4. Elo ${nation.eloHome} contra ${nation.eloAway}, regresión de ${nation.fit}.${pub?.review ? ` ${pub.review}` : ""}`
        : shown?.level === "M"
          ? "Nivel M: sin modelo para este partido. Probabilidad del mercado sin el margen de la casa."
        : analysis && recent?.home && recent.away
          ? `Tarjeta de nivel ${raw?.level ?? "C"}${raw?.level === "A" ? ": Dixon-Coles de la liga." : ". No es una ficha completa."} ${recent.home.n} partidos del local y ${recent.away.n} de la visita, anteriores al inicio.${pub?.review ? ` ${pub.review}` : ""}`
          : "NO DISPONIBLE. No hay partidos previos publicados de los dos.";
  return (
    <RateCard
      href={match.fixtureId ? `/partido/${match.fixtureId}` : `/agenda/${match.id}`}
      kicker={match.competition}
      when={`${clock(match.kickoff)} · ${score} · ${flashscoreStatusLabel(match.status)}`}
      home={match.home}
      away={match.away}
      analysis={analysis}
      note={note}
    />
  );
}
