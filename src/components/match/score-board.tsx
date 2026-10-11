export function ScoreBoard({
  home,
  away,
  homeScore,
  awayScore,
  status,
  compact = false,
}: {
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  compact?: boolean;
}) {
  if (status !== "finalizado" && status !== "en-juego") return null;
  const clock = status === "finalizado" ? "Final" : "En juego";
  return (
    <div className={compact ? "mt-3 rounded-lg bg-elevated px-3 py-2" : "mt-4 rounded-xl bg-elevated px-4 py-3"}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted">{home}</p>
          <p className={compact ? "font-display text-3xl tabular-nums leading-none" : "font-display text-4xl tabular-nums leading-none"}>
            {homeScore ?? "–"}
          </p>
        </div>
        <p className="pb-1 text-center text-[11px] uppercase tracking-[0.16em] text-subtle">{clock}</p>
        <div className="min-w-0 text-right">
          <p className="truncate text-xs text-muted">{away}</p>
          <p className={compact ? "font-display text-3xl tabular-nums leading-none" : "font-display text-4xl tabular-nums leading-none"}>
            {awayScore ?? "–"}
          </p>
        </div>
      </div>
      {status === "en-juego" ? (
        <p className="mt-2 text-center text-[11px] text-subtle">
          El corte no publicó el minuto. El marcador no se guarda hasta que el partido está finalizado.
        </p>
      ) : null}
    </div>
  );
}
