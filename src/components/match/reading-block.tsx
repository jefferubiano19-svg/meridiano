import { MISSING, type MatchReading, type Way } from "@/lib/football/dto";
import { formatOdds, formatPct } from "@/lib/football/format";
import { betSlip, MARKETS, useBetSlip } from "@/lib/store/bet-slip";

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
      {match.consensus || !match.wplay ? (
        <Row stack k="Consenso del mercado" v={wayText(match.consensus)} />
      ) : (
        <Row stack k="Mercado (solo Wplay)" v={wayText(match.wplay)} />
      )}
      <Row k="Nivel" v={levelText(match.level)} />
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

const LEVELS: Record<string, string> = {
  A: "A · Dixon-Coles de la liga",
  B: "B · ratings globales",
  C: "C · goles recientes",
  "5.4": "Selecciones · Elo",
  M: "M · solo mercado",
};

function levelText(level: string | null | undefined): string {
  if (!level) return MISSING;
  return LEVELS[level] ?? level;
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
      {match.homeEs || match.awayEs ? (
        <p className="mt-0.5 text-xs text-muted">
          En español: {match.homeEs || match.home} — {match.awayEs || match.away}
        </p>
      ) : null}
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
  return (
    <article className={className}>
      {match.href ? (
        <a href={match.href} className="block">
          {body}
        </a>
      ) : (
        body
      )}
      <AddToBet match={match} />
    </article>
  );
}

/** Agregar el partido a "Mi apuesta" sin salir de la ficha. Solo partidos por jugar con probabilidad. */
export function AddToBet({ match }: { match: MatchReading }) {
  const slip = useBetSlip();
  const kick = Date.parse(match.kickoff);
  const open = match.status === "por-jugar" && (!Number.isFinite(kick) || kick > Date.now());
  if (!open || !match.published) return null;
  const chosen = slip.find((leg) => leg.id === match.id);
  const label = `${match.home} — ${match.away}`;
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-[10px] uppercase tracking-wide text-subtle">Agregar a mi apuesta</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {MARKETS.slice(0, 5).map((market) => {
          const active = chosen?.market === market.key;
          return (
            <button
              key={market.key}
              type="button"
              title={market.label}
              aria-pressed={active}
              onClick={() => (active ? betSlip.remove(match.id) : betSlip.put(match.id, market.key, label))}
              className={
                active
                  ? "h-9 min-w-11 rounded-full bg-accent px-3 text-sm font-medium text-accent-fg"
                  : "h-9 min-w-11 rounded-full bg-elevated px-3 text-sm text-muted ring-1 ring-border hover:text-fg"
              }
            >
              {market.short}
            </button>
          );
        })}
        {slip.length ? (
          <a href="/apuesta" className="ml-auto text-xs text-fg underline">
            Ver mi apuesta ({slip.length})
          </a>
        ) : null}
      </div>
    </div>
  );
}
