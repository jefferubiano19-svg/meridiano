import { MISSING, type MatchReading, type Way } from "@/lib/football/dto";
import { formatOdds, formatPct } from "@/lib/football/format";

const SIDE = { home: "local", draw: "empate", away: "visita" } as const;

export function wayText(way: Way | null): string {
  if (!way) return MISSING;
  return `Local ${formatPct(way.home)} · Empate ${formatPct(way.draw)} · Visita ${formatPct(way.away)}`;
}

export function kickLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || MISSING;
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ReadingBlock({ match }: { match: MatchReading }) {
  const readAt = match.value?.readAt;
  return (
    <dl className="mt-3 grid gap-2 text-sm">
      <Row stack k="Probabilidad publicada" v={wayText(match.published)} />
      <Row stack k="Modelo puro" v={wayText(match.model)} />
      <Row stack k="Consenso del mercado" v={wayText(match.consensus)} />
      <Row k="Nivel" v={match.level || MISSING} />
      <Row k="Confianza" v={match.confidence || "baja"} />
      {match.revisar ? (
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-[10px] uppercase tracking-wide text-subtle">Aviso</dt>
          <dd className="rounded-full bg-[#314033] px-2 py-0.5 text-xs text-fg ring-1 ring-[#b7c7b0]/60">revisar</dd>
        </div>
      ) : null}
      {match.value ? (
        <>
          <Row k="Marca" v={`valor · ${SIDE[match.value.side]}`} />
          <Row k="Casa" v={match.value.house || MISSING} />
          <Row k="Cuota" v={formatOdds(match.value.odds)} />
          <Row k="Hora de lectura" v={readAt || MISSING} />
          <p className="text-xs text-muted">No es una recomendación.</p>
        </>
      ) : (
        <p className="text-sm text-muted">Sin marca de valor</p>
      )}
    </dl>
  );
}

function Row({ k, v, stack = false }: { k: string; v: string; stack?: boolean }) {
  if (stack && v !== MISSING) {
    return (
      <div className="grid gap-0.5">
        <dt className="text-[10px] uppercase tracking-wide text-subtle">{k}</dt>
        <dd className="tabular-nums text-fg">{v}</dd>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="text-[10px] uppercase tracking-wide text-subtle">{k}</dt>
      <dd className="text-right tabular-nums text-fg">{v}</dd>
    </div>
  );
}

export function MatchReadingCard({
  match,
  extra,
}: {
  match: MatchReading;
  extra?: string;
}) {
  const score =
    match.homeScore != null && match.awayScore != null ? `${match.homeScore}–${match.awayScore}` : null;
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">{match.competition || MISSING}</p>
      <h2 className="mt-1 font-display text-2xl tracking-tight">
        {match.home} — {match.away}
      </h2>
      <p className="mt-1 text-xs text-muted">
        {kickLabel(match.kickoff)}
        {score ? ` · ${score}` : ""}
        {match.status ? ` · ${match.status}` : ""}
      </p>
      {extra ? <p className="mt-2 text-sm text-fg">{extra}</p> : null}
      <ReadingBlock match={match} />
    </>
  );
  const className = "block rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]";
  if (!match.href) return <article className={className}>{body}</article>;
  return (
    <a href={match.href} className={className}>
      {body}
    </a>
  );
}
