import { formatOdds, formatPct } from "@/lib/football/format";
import type { ThreeWay } from "@/lib/football/types";
import { cn } from "@/lib/utils";

export function ProbabilityBar({
  p,
  fair,
  compact,
}: {
  p: ThreeWay;
  fair?: { home: number; draw: number; away: number };
  compact?: boolean;
}) {
  const lead = p.home >= p.draw && p.home >= p.away ? "1" : p.away >= p.draw ? "2" : "X";
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 gap-1">
        <span className="rounded-full bg-[#f4f5f0]" style={{ width: `${(p.home * 100).toFixed(2)}%` }} />
        <span className="rounded-full bg-[#8d9384]" style={{ width: `${(p.draw * 100).toFixed(2)}%` }} />
        <span className="rounded-full bg-[#b7c7b0]" style={{ width: `${(p.away * 100).toFixed(2)}%` }} />
      </div>
      <div className={cn("grid grid-cols-3 gap-2", compact ? "text-xs" : "text-sm")}>
        {(
          [
            ["1", p.home, fair?.home],
            ["X", p.draw, fair?.draw],
            ["2", p.away, fair?.away],
          ] as const
        ).map(([label, prob, odds]) => (
          <div
            key={label}
            className={cn(
              "rounded-xl px-2 py-2",
              label === lead ? "bg-[#314033] ring-1 ring-[#b7c7b0]" : "bg-elevated/90",
            )}
          >
            <p className="text-[10px] uppercase tracking-wider text-subtle">{label}</p>
            <p className="font-medium tabular-nums">{formatPct(prob)}</p>
            {odds ? (
              <p className="text-xs text-muted tabular-nums">justa {formatOdds(odds)}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
