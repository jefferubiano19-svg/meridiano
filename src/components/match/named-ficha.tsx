import { ProbabilityBar } from "@/components/match/probability-bar";
import { ScoreMatrix } from "@/components/match/score-matrix";
import { MatchCard } from "@/components/match/match-card";
import { formatPct } from "@/lib/football/format";
import { findBook, BOOK_FETCHED_AT } from "@/lib/football/books";
import type { NamedFicha } from "@/lib/football/named";
import type { SideRead } from "@/lib/football/recent";

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

export function NamedFichaView({ ficha }: { ficha: NamedFicha }) {
  if (ficha.kind === "vacio") {
    return <p className="rounded-xl bg-surface p-5 text-sm text-muted shadow-[var(--shadow-border)]">{ficha.note}</p>;
  }
  if (ficha.kind === "modelo") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">{ficha.note}</p>
        <MatchCard fixture={ficha.fixture} analysis={ficha.analysis} />
      </div>
    );
  }
  const { analysis } = ficha;
  const book = findBook(ficha.home, ficha.away);
  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.16em] text-subtle">{ficha.competition}</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight md:text-4xl">
          {ficha.home} — {ficha.away}
        </h2>
        <p className="mt-2 text-sm text-muted">{kickoff(ficha.when)} · Por jugar</p>
      </header>
      <section className="space-y-4 rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h3 className="font-display text-xl">Estimación</h3>
        <p className="text-sm text-muted">
          {ficha.note} Una racha corta no se trata como tasa estable. Goles esperados{" "}
          {analysis.lambdaHome.toFixed(2)}–{analysis.lambdaAway.toFixed(2)}. Marcador modal{" "}
          {analysis.mostLikely.hg}–{analysis.mostLikely.ag} ({formatPct(analysis.mostLikely.p, 0)}). No es un
          pronóstico cerrado.
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
          <Market k="Ambos marcan" v={formatPct(analysis.pBttsYes, 0)} d={`No ${formatPct(analysis.pBttsNo, 0)}`} />
          <Market k="Córners" v="sin dato" d="No hay córners publicados de estos dos" />
        </div>
        <p className="text-sm text-muted">
          Doble oportunidad 1X {formatPct(analysis.p1x2.home + analysis.p1x2.draw, 0)} · 12{" "}
          {formatPct(analysis.p1x2.home + analysis.p1x2.away, 0)} · X2{" "}
          {formatPct(analysis.p1x2.draw + analysis.p1x2.away, 0)}. Cuota justa {analysis.fairHome.toFixed(2)} /{" "}
          {analysis.fairDraw.toFixed(2)} / {analysis.fairAway.toFixed(2)}.
        </p>
        {book ? (
          <p className="text-sm text-muted">
            Wplay.co, leído {BOOK_FETCHED_AT}: {book.homeOdd.toFixed(2)} / {book.drawOdd.toFixed(2)} /{" "}
            {book.awayOdd.toFixed(2)}. No es una recomendación.
          </p>
        ) : (
          <p className="text-sm text-muted">No hay cuota de casa publicada para estos dos nombres. No se inventa.</p>
        )}
        <ScoreMatrix cells={analysis.matrix} highlight={analysis.mostLikely} />
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <Games name={ficha.home} side={ficha.homeSide} />
        <Games name={ficha.away} side={ficha.awaySide} />
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
