import { Link } from "@tanstack/react-router";
import { ArrowLeft, Bookmark, PenLine } from "lucide-react";
import { useState } from "react";
import { generateBriefing } from "@/lib/ai/briefing";
import { EvPanel } from "@/components/match/ev-panel";
import { ProbabilityBar } from "@/components/match/probability-bar";
import { ScoreMatrix } from "@/components/match/score-matrix";
import { SideMarkets } from "@/components/match/side-markets";
import { TeamRecordBlock } from "@/components/match/team-record";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confidenceCopy, formatKickoffLong, formatOdds, formatPct } from "@/lib/football/format";
import { getFixture } from "@/lib/football/fixtures";
import { getLeague } from "@/lib/football/leagues";
import { getAnalysis } from "@/lib/football/model";
import { HitLine } from "@/components/match/hit-line";
import { ScoreBoard } from "@/components/match/score-board";
import { settle } from "@/lib/football/hits";
import { AGENDA } from "@/lib/football/agenda";
import { presentAnalysis } from "@/lib/football/publish";
import { flashscoreFor, FLASHSCORE_SOURCE } from "@/lib/football/flashscore";
import { getTeam } from "@/lib/football/teams";
import { sheetFor } from "@/lib/football/sheets";
import { useSession } from "@/lib/store/session";

export function MatchPage({ id }: { id: string }) {
  const fixture = getFixture(id);
  if (!fixture) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted">Partido no encontrado.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-fg underline">
          Volver a la agenda
        </Link>
      </div>
    );
  }

  const home = getTeam(fixture.homeId);
  const away = getTeam(fixture.awayId);
  const league = getLeague(fixture.leagueId);
  const linked = AGENDA.find((match) => match.fixtureId === fixture.id);
  const analysis = linked ? presentAnalysis(linked.id, getAnalysis(fixture), linked.kickoff) : getAnalysis(fixture);
  const live = flashscoreFor(fixture.id);
  const listed = linked;
  const boardStatus =
    live && live.status !== "por-jugar" ? live.status : listed?.status === "finalizado" || listed?.status === "en-juego" ? listed.status : live?.status ?? "";
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
  const sheet = sheetFor(fixture.id);
  const watchlist = useSession((s) => s.watchlist);
  const toggleWatch = useSession((s) => s.toggleWatch);
  const watched = watchlist.includes(fixture.id);

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex h-11 items-center gap-2 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        Agenda
      </Link>

      <header className="rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)] md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-subtle">
            {league.name} · {fixture.round}
          </p>
          <div className="flex items-center gap-2">
            <Badge
              tone={
                analysis.confidenceLabel === "alta"
                  ? "value"
                  : analysis.confidenceLabel === "baja"
                    ? "warn"
                    : "default"
              }
            >
              Confianza {confidenceCopy(analysis.confidenceLabel)} · {analysis.confidence}
            </Badge>
            <button
              type="button"
              onClick={() => toggleWatch(fixture.id)}
              className="flex size-11 items-center justify-center rounded-md text-muted hover:text-fg"
              aria-label="Seguir"
            >
              <Bookmark className={watched ? "size-4 fill-current text-fg" : "size-4"} />
            </button>
          </div>
        </div>
        <h1 className="mt-4 font-display text-3xl tracking-tight md:text-4xl">
          {home.name} — {away.name}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {formatKickoffLong(fixture.kickoff, fixture.leagueId)} · {fixture.venue}
        </p>
        {boardStatus === "finalizado" || boardStatus === "en-juego" ? (
          <ScoreBoard
            home={home.name}
            away={away.name}
            homeScore={homeScore}
            awayScore={awayScore}
            status={boardStatus}
          />
        ) : live ? (
          <div className="mt-4 rounded-xl bg-elevated px-4 py-3 text-sm">
            <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">Flashscore.co</p>
            <p className="mt-1">Por jugar. El marcador todavía no está publicado.</p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-subtle">
            Este partido no salió en el tablero de Flashscore.co entre el 3 y el 10 de octubre.
          </p>
        )}
        {settled ? <HitLine read={settled} /> : null}
        {live && live.xgHome != null && live.xgAway != null ? (
          <p className="mt-2 text-xs text-muted tabular-nums">
            xG {live.xgHome.toFixed(2)}–{live.xgAway.toFixed(2)}
            {live.possessionHome ? ` · posesión ${live.possessionHome}–${live.possessionAway}` : ""}
            {live.shotsHome ? ` · remates ${live.shotsHome}–${live.shotsAway}` : ""}
            {live.cornersHome ? ` · córners ${live.cornersHome}–${live.cornersAway}` : ""}
            <span className="text-subtle"> · {FLASHSCORE_SOURCE}</span>
          </p>
        ) : null}
        {fixture.note ? <p className="mt-2 text-xs text-warn">{fixture.note}</p> : null}
        {fixture.market?.provider === "Wplay" && fixture.market.eventUrl ? (
          <p className="mt-2 text-xs text-subtle">
            Cuotas leídas en{" "}
            <a className="underline" href={fixture.market.eventUrl} target="_blank" rel="noreferrer">
              Wplay
            </a>
            . No es una invitación a apostar.
          </p>
        ) : null}
        <div className="mt-6">
          <ProbabilityBar p={analysis.p1x2} fair={analysis.fair} />
        </div>
        <div className="mt-4">
          <SideMarkets analysis={analysis} />
        </div>
        <p className="mt-4 text-xs text-subtle">
          Goles esperados {analysis.lambdaHome.toFixed(2)} – {analysis.lambdaAway.toFixed(2)}.
          {analysis.cornerHome != null && analysis.cornerAway != null
            ? ` Córners esperados ${analysis.cornerHome.toFixed(1)} – ${analysis.cornerAway.toFixed(1)}.`
            : " Córners: FotMob no publicó el dato de los dos."}{" "}
          Marcador modal {analysis.mostLikelyScore.hg}–{analysis.mostLikelyScore.ag} (
          {formatPct(analysis.mostLikelyScore.p)}).
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <TeamFacts team={home} side="Local" />
        <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="text-xs uppercase tracking-wider text-subtle">Lectura del modelo</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {analysis.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-subtle">{analysis.inputs}</p>
        </div>
        <TeamFacts team={away} side="Visitante" />
      </div>

      {sheet ? (
        <section className="space-y-3">
          <h2 className="font-display text-xl">Historial y convocatoria</h2>
          <p className="max-w-2xl text-sm text-muted">
            Cada partido reciente lleva la competición que publicó Flashscore. Titular o suplente es
            el papel en ese partido, no uno fijo: puede cambiar entre liga, copa o selección. Si no
            hay alineación, no se rellena.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <TeamRecordBlock name={home.name} record={sheet.home} competition={sheet.competition} />
            <TeamRecordBlock name={away.name} record={sheet.away} competition={sheet.competition} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted">
          Sin historial de Flashscore para este partido. No se inventa una convocatoria.
        </p>
      )}

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Mercados derivados</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <MarketRow
            title="Más / menos 2.5"
            aLabel="Más"
            aP={analysis.pOver25}
            aOdd={analysis.fair.over25}
            bLabel="Menos"
            bP={analysis.pUnder25}
            bOdd={analysis.fair.under25}
          />
          <MarketRow
            title="Doble oportunidad"
            aLabel="1X"
            aP={analysis.pDc1x}
            aOdd={analysis.fair.dc1x}
            bLabel="X2"
            bP={analysis.pDcX2}
            bOdd={analysis.fair.dcx2}
          />
          <MarketRow
            title="Hándicap 0 (empate anula)"
            aLabel={home.short}
            aP={analysis.p1x2.home / (analysis.p1x2.home + analysis.p1x2.away)}
            aOdd={analysis.fair.dnbHome}
            bLabel={away.short}
            bP={analysis.p1x2.away / (analysis.p1x2.home + analysis.p1x2.away)}
            bOdd={analysis.fair.dnbAway}
          />
          <MarketRow
            title="Ambos marcan"
            aLabel="Sí"
            aP={analysis.pBttsYes}
            aOdd={analysis.fair.bttsYes}
            bLabel="No"
            bP={analysis.pBttsNo}
            bOdd={analysis.fair.bttsNo}
          />
          {analysis.pCornersOver != null && analysis.pCornersUnder != null ? (
            <MarketRow
              title={`Córners, más / menos ${analysis.cornersLine}`}
              aLabel="Más"
              aP={analysis.pCornersOver}
              aOdd={1 / Math.min(0.92, Math.max(0.035, analysis.pCornersOver))}
              bLabel="Menos"
              bP={analysis.pCornersUnder}
              bOdd={1 / Math.min(0.92, Math.max(0.035, analysis.pCornersUnder))}
            />
          ) : (
            <p className="text-sm text-muted">Córners: sin estadística publicada en FotMob para este partido.</p>
          )}
        </div>
        <p className="mt-3 text-xs text-subtle">
          Más/menos y ambos marcan salen del Poisson con el xG de FotMob, o con los goles de ESPN si
          no hay xG. Los córners usan los saques a favor publicados por FotMob, no una estimación.
        </p>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">De dónde sale el 1X2</h2>
        <p className="mt-1 text-sm text-muted">
          Una sola matriz de Poisson. Si los dos equipos tienen xG en FotMob, los goles esperados son
          el promedio del xG propio y el xG concedido del rival. El Elo, cuando existe, se muestra
          aparte y no se mezcla: no hay un modelo de empate publicado junto a ese Elo.
        </p>
        {analysis.eloHome != null && analysis.eloAway != null && analysis.eloHomeWin != null ? (
          <p className="mt-3 text-sm tabular-nums">
            Elo {analysis.eloHome} – {analysis.eloAway}. Expectativa de victoria del local, sin empate,{" "}
            {formatPct(analysis.eloHomeWin)}.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Sin Elo de clubes en este corte. ClubElo no respondió y no se sustituye por un número propio.
          </p>
        )}
      </section>

      <ScoreMatrix cells={analysis.matrix} highlight={analysis.mostLikelyScore} />

      <EvPanel
        analysis={analysis}
        fixtureId={fixture.id}
        homeName={home.name}
        awayName={away.name}
      />

      <BriefingBlock home={home.name} away={away.name} league={league.name} analysis={analysis} />

      <p className="text-xs leading-relaxed text-subtle">
        Esto no es consejo de apuesta ni una recomendación de inversión. Las probabilidades son
        estimaciones con error. El azar, las rotaciones y el VAR no están en el modelo.
      </p>
    </div>
  );
}

function TeamFacts({ team, side }: { team: ReturnType<typeof getTeam>; side: string }) {
  const xg = team.xg != null && team.xgPlayed ? (team.xg / team.xgPlayed).toFixed(2) : "—";
  const xga = team.xga != null && team.xgPlayed ? (team.xga / team.xgPlayed).toFixed(2) : "—";
  const corners =
    team.corners != null && team.cornersPlayed
      ? (team.corners / team.cornersPlayed).toFixed(1)
      : "—";
  return (
    <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <p className="text-[11px] uppercase tracking-wider text-subtle">{side}</p>
      <h3 className="mt-1 font-medium">{team.name}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Fact k="Elo" v={team.elo != null ? String(team.elo) : "sin fuente"} />
        <Fact k="Forma" v={team.form || "—"} />
        <Fact k="PJ" v={String(team.gp)} />
        <Fact k="Pts" v={String(team.pts)} />
        <Fact k="GF / GC" v={`${team.gf} / ${team.ga}`} />
        <Fact k="xG / partido" v={xg} />
        <Fact k="xGA / partido" v={xga} />
        <Fact k="Córners / partido" v={corners} />
        <Fact
          k="En casa"
          v={team.home.gp ? `${team.home.gf}-${team.home.ga} en ${team.home.gp}` : "—"}
        />
        <Fact
          k="Fuera"
          v={team.away.gp ? `${team.away.gf}-${team.away.ga} en ${team.away.gp}` : "—"}
        />
      </dl>
      <p className="mt-3 text-[11px] text-subtle">
        {team.statsSource ?? "Sin xG ni córners en FotMob."}
        {team.eloSource ? ` · ${team.eloSource}` : ""}
      </p>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] text-subtle">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

function MarketRow({
  title,
  aLabel,
  aP,
  aOdd,
  bLabel,
  bP,
  bOdd,
}: {
  title: string;
  aLabel: string;
  aP: number;
  aOdd: number;
  bLabel: string;
  bP: number;
  bOdd: number;
}) {
  return (
    <div className="rounded-lg bg-elevated p-4">
      <p className="text-xs uppercase tracking-wider text-subtle">{title}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-sm">{aLabel}</p>
          <p className="font-medium tabular-nums">{formatPct(aP)}</p>
          <p className="text-xs text-muted">justa {formatOdds(aOdd)}</p>
        </div>
        <div>
          <p className="text-sm">{bLabel}</p>
          <p className="font-medium tabular-nums">{formatPct(bP)}</p>
          <p className="text-xs text-muted">justa {formatOdds(bOdd)}</p>
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  name,
  p,
  strong,
}: {
  name: string;
  p: { home: number; draw: number; away: number };
  strong?: boolean;
}) {
  return (
    <tr className={strong ? "text-fg" : "text-muted"}>
      <td className="py-2 pr-3">{name}</td>
      <td>{formatPct(p.home)}</td>
      <td>{formatPct(p.draw)}</td>
      <td>{formatPct(p.away)}</td>
    </tr>
  );
}

function BriefingBlock({
  home,
  away,
  league,
  analysis,
}: {
  home: string;
  away: string;
  league: string;
  analysis: ReturnType<typeof getAnalysis>;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const result = await generateBriefing({
        data: {
          home,
          away,
          league,
          pHome: analysis.p1x2.home,
          pDraw: analysis.p1x2.draw,
          pAway: analysis.p1x2.away,
          lambdaHome: analysis.lambdaHome,
          lambdaAway: analysis.lambdaAway,
          confidence: analysis.confidence,
          note: analysis.inputs,
        },
      });
      if (result.ok) setText(result.text);
      else setError(result.error);
    } catch {
      setError("No se pudo completar la lectura.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <h2 className="font-display text-xl">Lectura cualitativa</h2>
      <p className="mt-1 text-sm text-muted">
        Opcional y bajo demanda. Interpreta los números; no cambia las probabilidades ni sugiere una
        apuesta.
      </p>
      <Button className="mt-4" variant="secondary" disabled={loading} onClick={run}>
        <PenLine className="size-4" />
        {loading ? "Redactando…" : "Generar lectura"}
      </Button>
      {text ? <p className="mt-4 text-sm leading-relaxed text-fg">{text}</p> : null}
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
