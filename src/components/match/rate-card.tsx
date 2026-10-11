import { ProbabilityBar } from "@/components/match/probability-bar";
import { HitLine } from "@/components/match/hit-line";
import { ScoreBoard } from "@/components/match/score-board";
import { formatPct } from "@/lib/football/format";
import type { HitRead } from "@/lib/football/hits";
import type { RecentAnalysis } from "@/lib/football/recent-math";

export function RateCard({
  href,
  kicker,
  when,
  home,
  away,
  analysis,
  corners = "NO DISPONIBLE",
  cornerDetail = "No hay córners publicados de estos dos",
  note,
  pending = false,
  score,
  hits,
}: {
  href?: string;
  kicker: string;
  when: string;
  home: string;
  away: string;
  analysis: RecentAnalysis | null;
  corners?: string;
  cornerDetail?: string;
  note?: string;
  pending?: boolean;
  score?: { home: number | null; away: number | null; status: string } | null;
  hits?: HitRead | null;
}) {
  const body = (
    <>
      <div className="mb-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">{kicker}</p>
        <p className="mt-1 text-xs text-muted">{when}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg leading-tight tracking-tight">{home}</p>
          <p className="text-[11px] text-subtle">Elo —</p>
        </div>
        <span className="text-xs text-subtle">vs</span>
        <div className="min-w-0 flex-1 text-right">
          <p className="truncate font-display text-lg leading-tight tracking-tight">{away}</p>
          <p className="text-[11px] text-subtle">Elo —</p>
        </div>
      </div>
      {score ? (
        <ScoreBoard
          home={home}
          away={away}
          homeScore={score.home}
          awayScore={score.away}
          status={score.status}
          compact
        />
      ) : null}
      {hits ? <HitLine read={hits} /> : null}
      {analysis ? (
        <>
          <div className="mt-4">
            <ProbabilityBar
              p={analysis.p1x2}
              fair={{ home: analysis.fairHome, draw: analysis.fairDraw, away: analysis.fairAway }}
              compact
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Cell
              k="Total goles"
              v={(analysis.lambdaHome + analysis.lambdaAway).toFixed(2)}
              d={`Más 2.5 ${formatPct(analysis.pOver25, 0)}`}
            />
            <Cell
              k="Ambos marcan"
              v={formatPct(analysis.pBttsYes, 0)}
              d={`No ${formatPct(analysis.pBttsNo, 0)}`}
            />
            <Cell k="Córners" v={corners} d={cornerDetail} />
          </div>
          {note ? <p className="mt-3 text-xs text-muted">{note}</p> : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">
          {pending ? "Cargando la estimación…" : "Sin historial publicado de los dos. Sin estimación."}
        </p>
      )}
    </>
  );
  const className =
    "sheet block p-4 pl-5";
  if (!href) return <article className={className}>{body}</article>;
  return (
    <a href={href} className={className}>
      {body}
    </a>
  );
}

function Cell({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div className="rounded-lg bg-elevated px-2 py-2">
      <p className="text-[10px] uppercase leading-tight text-subtle">{k}</p>
      <p className="mt-1 font-medium tabular-nums">{v}</p>
      <p className="text-[11px] text-muted tabular-nums">{d}</p>
    </div>
  );
}
