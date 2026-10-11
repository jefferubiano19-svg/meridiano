import { formatPct } from "@/lib/football/format";
import type { MatchAnalysis } from "@/lib/football/types";

export function SideMarkets({ analysis }: { analysis: MatchAnalysis }) {
  const goals = analysis.lambdaHome + analysis.lambdaAway;
  const corners =
    analysis.cornerHome != null && analysis.cornerAway != null
      ? analysis.cornerHome + analysis.cornerAway
      : null;
  return (
    <div className="grid grid-cols-3 gap-2">
      <Cell
        k="Total goles"
        v={goals.toFixed(2)}
        d={`Más 2.5 ${formatPct(analysis.pOver25, 0)}`}
      />
      <Cell
        k="Ambos marcan"
        v={formatPct(analysis.pBttsYes, 0)}
        d={`No ${formatPct(analysis.pBttsNo, 0)}`}
      />
      <Cell
        k="Córners"
        v={corners == null ? "sin dato" : corners.toFixed(1)}
        d={
          corners == null
            ? "FotMob no publicó"
            : analysis.pCornersOver == null
              ? "sin línea publicada"
              : `Más ${analysis.cornersLine} ${formatPct(analysis.pCornersOver, 0)}`
        }
      />
    </div>
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