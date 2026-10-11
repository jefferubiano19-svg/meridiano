import { formatPct } from "@/lib/football/format";
import type { ScoreCell } from "@/lib/football/types";
import { cn } from "@/lib/utils";

export function ScoreMatrix({ cells, highlight }: { cells: ScoreCell[]; highlight: ScoreCell }) {
  const max = Math.max(...cells.map((c) => c.p));
  return (
    <div>
      <p className="mb-3 text-xs uppercase tracking-wider text-subtle">Marcador más probable</p>
      <div className="grid grid-cols-7 gap-1">
        <span />
        {[0, 1, 2, 3, 4, 5].map((ag) => (
          <span key={ag} className="text-center text-[10px] text-subtle tabular-nums">
            {ag}
          </span>
        ))}
        {[0, 1, 2, 3, 4, 5].map((hg) => (
          <div key={hg} className="contents">
            <span className="flex items-center text-[10px] text-subtle tabular-nums">{hg}</span>
            {[0, 1, 2, 3, 4, 5].map((ag) => {
              const cell = cells.find((c) => c.hg === hg && c.ag === ag);
              const p = cell?.p ?? 0;
              const on = highlight.hg === hg && highlight.ag === ag;
              return (
                <div
                  key={`${hg}-${ag}`}
                  title={`${hg}-${ag} · ${formatPct(p, 2)}`}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-xs text-[10px] tabular-nums",
                    on ? "ring-1 ring-accent text-accent-fg" : "text-fg",
                  )}
                  style={{
                    backgroundColor: `color-mix(in oklab, var(--color-value) ${Math.round((p / max) * 72)}%, var(--color-elevated))`,
                  }}
                >
                  {hg}–{ag}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Filas: goles local. Columnas: visitante. Intensidad = probabilidad del modelo de goles.
      </p>
    </div>
  );
}
