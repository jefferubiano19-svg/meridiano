import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bookmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProbabilityBar } from "@/components/match/probability-bar";
import { SideMarkets } from "@/components/match/side-markets";
import { HitLine } from "@/components/match/hit-line";
import { ScoreBoard } from "@/components/match/score-board";
import { agendaByFixture } from "@/lib/football/agenda";
import { settle } from "@/lib/football/hits";
import { formatKickoff, formatPct } from "@/lib/football/format";
import type { FlashscoreMatch } from "@/lib/football/flashscore";
import { agendaToday, bogotaDay, todayReading } from "@/lib/football/today";
import { getLeague } from "@/lib/football/leagues";
import { getTeam } from "@/lib/football/teams";
import type { Fixture, MatchAnalysis } from "@/lib/football/types";
import { useSession } from "@/lib/store/session";
import { cn } from "@/lib/utils";

export function MatchCard({
  fixture,
  analysis,
}: {
  fixture: Fixture;
  analysis: MatchAnalysis;
}) {
  const home = getTeam(fixture.homeId);
  const away = getTeam(fixture.awayId);
  const league = getLeague(fixture.leagueId);
  const [live, setLive] = useState<FlashscoreMatch | undefined>();
  const [reading, setReading] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void Promise.all([import("@/lib/football/flashscore"), import("@/lib/football/sheets")]).then(
      ([flash, sheets]) => {
        if (!current) return;
        const next = flash.flashscoreFor(fixture.id);
        setLive(next);
        const sheet = bogotaDay(fixture.kickoff) === agendaToday() ? sheets.sheetFor(fixture.id) : undefined;
        setReading(
          sheet ? todayReading(home.name, away.name, analysis, next, sheet.home, sheet.away) : null,
        );
      },
    );
    return () => {
      current = false;
    };
  }, [fixture.id, fixture.kickoff, home.name, away.name, analysis]);
  const watchlist = useSession((s) => s.watchlist);
  const toggleWatch = useSession((s) => s.toggleWatch);
  const watched = watchlist.includes(fixture.id);
  const listed = agendaByFixture(fixture.id);
  const boardStatus =
    live && live.status !== "por-jugar"
      ? live.status
      : listed?.status === "finalizado" || listed?.status === "en-juego"
        ? listed.status
        : "";
  const homeScore = live && live.homeScore != null ? live.homeScore : listed?.homeScore ?? null;
  const awayScore = live && live.awayScore != null ? live.awayScore : listed?.awayScore ?? null;
  const settled =
    boardStatus === "finalizado" && homeScore != null && awayScore != null
      ? settle(homeScore, awayScore, {
          p1x2: analysis.p1x2,
          pOver25: analysis.pOver25,
          pBttsYes: analysis.pBttsYes,
          modal: analysis.mostLikelyScore,
        })
      : null;

  return (
    <article className="sheet p-4 pl-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">
            {league.short} · {fixture.round}
          </p>
          <p className="mt-1 text-xs text-muted">{formatKickoff(fixture.kickoff, fixture.leagueId)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            tone={
              analysis.confidenceLabel === "alta"
                ? "value"
                : analysis.confidenceLabel === "media"
                  ? "default"
                  : "warn"
            }
          >
            Conf. {analysis.confidence}
          </Badge>
          <button
            type="button"
            aria-label={watched ? "Quitar de seguimiento" : "Seguir partido"}
            onClick={() => toggleWatch(fixture.id)}
            className={cn(
              "flex size-10 items-center justify-center rounded-md text-muted hover:text-fg",
              watched && "text-fg",
            )}
          >
            <Bookmark className={cn("size-4", watched && "fill-current")} />
          </button>
        </div>
      </div>

      <Link to="/partido/$id" params={{ id: fixture.id }} className="block">
        <div className="flex items-center justify-between gap-3">
          <TeamRow team={home} align="left" />
          <span className="text-xs text-subtle">vs</span>
          <TeamRow team={away} align="right" />
        </div>
        {fixture.note ? <p className="mt-2 text-xs text-warn">{fixture.note}</p> : null}
        {boardStatus === "finalizado" || boardStatus === "en-juego" ? (
          <ScoreBoard
            home={home.name}
            away={away.name}
            homeScore={homeScore}
            awayScore={awayScore}
            status={boardStatus}
            compact
          />
        ) : null}
        {settled ? <HitLine read={settled} /> : null}
        {live && live.xgHome != null && live.xgAway != null ? (
          <p className="mt-1 text-xs text-muted tabular-nums">
            xG del partido {live.xgHome.toFixed(2)}–{live.xgAway.toFixed(2)}
            {live.cornersHome != null ? ` · córners ${live.cornersHome}–${live.cornersAway}` : ""}
          </p>
        ) : null}
        <div className="mt-4">
          <ProbabilityBar p={analysis.p1x2} fair={analysis.fair} compact />
        </div>
        {analysis.modelPure ? (
          <p className="mt-2 text-xs tabular-nums text-muted">
            Modelo puro {formatPct(analysis.modelPure.home, 0)} / {formatPct(analysis.modelPure.draw, 0)} /{" "}
            {formatPct(analysis.modelPure.away, 0)}
            {analysis.eloHome != null && analysis.eloAway != null ? ` · Elo ${analysis.eloHome}–${analysis.eloAway}` : ""}
          </p>
        ) : null}
        <div className="mt-3">
          <SideMarkets analysis={analysis} />
        </div>
        {reading ? <p className="mt-3 text-xs leading-relaxed text-muted">{reading}</p> : null}
        {analysis.valueFlag === "valor" && analysis.valueNote ? (
          <p className="mt-3 text-xs text-value">{analysis.valueNote}</p>
        ) : null}
        {analysis.valueFlag === "revisar" ? (
          <p className="mt-3 text-xs text-warn">
            {analysis.valueNote ?? "Revisar: el modelo y el consenso difieren más de 10 puntos."}
          </p>
        ) : null}
      </Link>
    </article>
  );
}

function TeamRow({
  team,
  align,
}: {
  team: ReturnType<typeof getTeam>;
  align: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0 flex-1", align === "right" && "text-right")}>
      <p className="truncate font-display text-lg leading-tight tracking-tight">{team.name}</p>
      <p className="text-[11px] text-subtle tabular-nums">
        {team.elo != null ? `Elo ${team.elo}` : "Elo —"}
        {team.xg != null && team.xgPlayed ? ` · xG ${(team.xg / team.xgPlayed).toFixed(2)}` : ""}
        {team.form ? ` · ${team.form}` : ""}
      </p>
    </div>
  );
}
