import { Link } from "@tanstack/react-router";
import { ProbabilityBar } from "@/components/match/probability-bar";
import { ScoreMatrix } from "@/components/match/score-matrix";
import { ScoreBoard } from "@/components/match/score-board";
import { HitLine } from "@/components/match/hit-line";
import { settle } from "@/lib/football/hits";
import { AGENDA } from "@/lib/football/agenda";
import { formatPct } from "@/lib/football/format";
import { flashscoreStatusLabel } from "@/lib/football/flashscore";
import { analyzeRecent, levelCFor, recentFor, type SideRead } from "@/lib/football/recent";
import { findBook, BOOK_FETCHED_AT } from "@/lib/football/books";

function when(ts: number | null): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    timeZone: "America/Bogota",
  }).format(new Date(ts * 1000));
}

function kickoff(iso: string): string {
  return new Intl.DateTimeFormat("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Bogota",
  }).format(new Date(iso));
}

export function AgendaFicha({ id, pick, page }: { id: string; pick?: string; page?: boolean }) {
  const match = AGENDA.find((item) => item.id === id);
  if (!match) return null;
  const recent = recentFor(match.id);
  const home = recent?.home ?? null;
  const away = recent?.away ?? null;
  const analysis =
    levelCFor(match.id, match.kickoff, match.competition) ??
    (home && away ? analyzeRecent(home, away, match.kickoff, match.competition) : null);
  const book = findBook(match.home, match.away);
  const started = match.status === "finalizado" || match.status === "en-juego";
  const settled =
    match.status === "finalizado" && analysis && match.homeScore != null && match.awayScore != null
      ? settle(match.homeScore, match.awayScore, {
          p1x2: analysis.p1x2,
          pOver25: analysis.pOver25,
          pBttsYes: analysis.pBttsYes,
          modal: analysis.mostLikely,
        })
      : null;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.16em] text-subtle">{match.competition}</p>
        {page ? (
          <h1 className="mt-2 font-display text-3xl tracking-tight md:text-4xl">
            {match.home} — {match.away}
          </h1>
        ) : (
          <h2 className="mt-2 font-display text-3xl tracking-tight md:text-4xl">
            {match.home} — {match.away}
          </h2>
        )}
        <p className="mt-2 text-sm text-muted">
          {kickoff(match.kickoff)} · {flashscoreStatusLabel(match.status)}
        </p>
        {started ? (
          <ScoreBoard
            home={match.home}
            away={match.away}
            homeScore={match.homeScore}
            awayScore={match.awayScore}
            status={match.status}
          />
        ) : null}
        {settled ? <HitLine read={settled} /> : null}
        {pick ? <p className="mt-2 text-sm">Pata del cupón: {pick}</p> : null}
        {match.fixtureId ? (
          <p className="mt-3 text-sm">
            <Link to="/partido/$id" params={{ id: match.fixtureId }} className="underline">
              Abrir la ficha completa
            </Link>
            , con xG, cuotas, córners y convocatoria.
          </p>
        ) : null}
      </header>

      {analysis && home && away ? (
        <section className="space-y-4 rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
          <h3 className="font-display text-xl">Estimación</h3>
          <p className="text-sm text-muted">
            Sale de los últimos {home.n} partidos publicados de {match.home} y los últimos {away.n} de{" "}
            {match.away}, contraídos hacia 1.25 goles con 8 partidos de peso. Una racha corta no se
            trata como tasa estable. Goles esperados {analysis.lambdaHome.toFixed(2)}–
            {analysis.lambdaAway.toFixed(2)}. Marcador modal {analysis.mostLikely.hg}–
            {analysis.mostLikely.ag} ({formatPct(analysis.mostLikely.p, 0)}). No es un pronóstico
            cerrado. La cuota de la casa solo se muestra si Wplay publicó estos dos nombres.
          </p>
          <ProbabilityBar
            p={analysis.p1x2}
            fair={{ home: analysis.fairHome, draw: analysis.fairDraw, away: analysis.fairAway }}
          />
          <div className="grid grid-cols-3 gap-2">
            <Market
              k="Total goles"
              v={(analysis.lambdaHome + analysis.lambdaAway).toFixed(2)}
              d={`Más 2.5 ${formatPct(analysis.pOver25, 0)} · menos ${formatPct(analysis.pUnder25, 0)}`}
            />
            <Market
              k="Ambos marcan"
              v={formatPct(analysis.pBttsYes, 0)}
              d={`No ${formatPct(analysis.pBttsNo, 0)}`}
            />
            <Market k="Córners" v="sin dato" d="No hay córners publicados de estos dos" />
          </div>
          <p className="text-sm text-muted">
            Doble oportunidad 1X {formatPct(analysis.p1x2.home + analysis.p1x2.draw, 0)} · 12{" "}
            {formatPct(analysis.p1x2.home + analysis.p1x2.away, 0)} · X2{" "}
            {formatPct(analysis.p1x2.draw + analysis.p1x2.away, 0)}. Cuota justa{" "}
            {analysis.fairHome.toFixed(2)} / {analysis.fairDraw.toFixed(2)} / {analysis.fairAway.toFixed(2)}.
          </p>
          {book ? (
            <p className="text-sm text-muted">
              Wplay.co, leído {BOOK_FETCHED_AT}: {book.homeOdd.toFixed(2)} / {book.drawOdd.toFixed(2)} /{" "}
              {book.awayOdd.toFixed(2)}
              {book.over25 ? ` · más 2.5 ${book.over25.toFixed(2)}` : ""}
              {book.under25 ? ` · menos 2.5 ${book.under25.toFixed(2)}` : ""}
              {book.bttsYes ? ` · ambos anotan ${book.bttsYes.toFixed(2)}` : ""}
              {book.bttsNo ? ` · no ${book.bttsNo.toFixed(2)}` : ""}
              {book.cornersOver && book.cornersLine
                ? ` · córners más ${book.cornersLine} a ${book.cornersOver.toFixed(2)}`
                : ""}
              . No es una recomendación.
            </p>
          ) : (
            <p className="text-sm text-muted">
              Wplay no tenía este partido en el cupón leído. Betano no abrió. BetPlay y Rushbet no
              trajeron precios en el HTML. No se inventa una cuota.
            </p>
          )}
          <ScoreMatrix cells={analysis.matrix} highlight={analysis.mostLikely} />
        </section>
      ) : (
        <p className="rounded-xl bg-surface p-5 text-sm text-muted shadow-[var(--shadow-border)]">
          No hay partidos recientes publicados de los dos equipos. No se inventa una probabilidad.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Games name={match.home} side={home} />
        <Games name={match.away} side={away} />
      </div>
    </div>
  );
}

function Market({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div className="rounded-lg bg-elevated px-2 py-2">
      <p className="text-[10px] uppercase leading-tight text-subtle">{k}</p>
      <p className="mt-1 font-medium tabular-nums">{v}</p>
      <p className="text-[11px] text-muted tabular-nums">{d}</p>
    </div>
  );
}

function Games({ name, side }: { name: string; side: SideRead | null }) {
  return (
    <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <h3 className="font-display text-xl">{name}</h3>
      {!side ? (
        <p className="mt-2 text-sm text-muted">Sin partidos recientes publicados.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-subtle">
            {side.gf} goles a favor y {side.ga} en contra en {side.n} partidos.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {side.games.map((game, index) => (
              <li key={`${game.ts}-${index}`}>
                <span className="text-muted">
                  {when(game.ts)} · {game.competition}
                </span>
                <span className="mt-0.5 block">
                  {game.goalsFor}–{game.goalsAgainst} ante {game.opponent ?? "rival no publicado"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
