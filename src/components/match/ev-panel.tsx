import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatEv, formatOdds, formatPct, MARKET_LABEL, money } from "@/lib/football/format";
import { adviseStake } from "@/lib/football/kelly";
import { expectedValue } from "@/lib/football/model";
import type { MarketKey, MarketOdds, MatchAnalysis } from "@/lib/football/types";
import { periodLoss, useSession } from "@/lib/store/session";
import { cn } from "@/lib/utils";

const KEYS: MarketKey[] = [
  "home",
  "draw",
  "away",
  "dc1x",
  "dc12",
  "dcx2",
  "dnbHome",
  "dnbAway",
  "over25",
  "under25",
  "bttsYes",
  "bttsNo",
  "cornersOver",
  "cornersUnder",
];

function pFor(analysis: MatchAnalysis, key: MarketKey): number {
  if (key === "home") return analysis.p1x2.home;
  if (key === "draw") return analysis.p1x2.draw;
  if (key === "away") return analysis.p1x2.away;
  if (key === "over25") return analysis.pOver25;
  if (key === "under25") return analysis.pUnder25;
  if (key === "bttsYes") return analysis.pBttsYes;
  if (key === "bttsNo") return analysis.pBttsNo;
  if (key === "cornersOver") return analysis.pCornersOver ?? 0;
  if (key === "cornersUnder") return analysis.pCornersUnder ?? 0;
  if (key === "dc1x") return analysis.pDc1x;
  if (key === "dc12") return analysis.pDc12;
  if (key === "dcx2") return analysis.pDcX2;
  const settled = analysis.p1x2.home + analysis.p1x2.away;
  if (key === "dnbHome") return analysis.p1x2.home / settled;
  return analysis.p1x2.away / settled;
}

function evFor(analysis: MatchAnalysis, key: MarketKey, odds: number): number {
  if (key === "dnbHome") {
    return analysis.p1x2.home * (odds - 1) - analysis.p1x2.away;
  }
  if (key === "dnbAway") {
    return analysis.p1x2.away * (odds - 1) - analysis.p1x2.home;
  }
  return expectedValue(pFor(analysis, key), odds);
}

export function EvPanel({
  analysis,
  fixtureId,
  homeName,
  awayName,
}: {
  analysis: MatchAnalysis;
  fixtureId: string;
  homeName: string;
  awayName: string;
}) {
  const session = useSession();
  const stored = session.customOdds[fixtureId] ?? {};
  const [market, setMarket] = useState<MarketKey>("home");
  const oddsRaw = stored[market] ?? analysis.quoted[market];
  const odds = typeof oddsRaw === "number" ? oddsRaw : Number.NaN;
  const tradable = Number.isFinite(odds) && odds > 1;
  const p = pFor(analysis, market);
  const ev = evFor(analysis, market, odds);
  const cooling = session.coolingOffUntil && session.coolingOffUntil > Date.now();

  const advice = useMemo(
    () =>
      adviseStake(p, tradable ? odds : 2, analysis.confidenceLabel, {
        bankroll: session.bankroll,
        kellyFraction: session.kellyFraction,
        unitPercent: session.unitPercent,
        maxStakePercent: session.maxStakePercent,
        minEv: session.minEv,
        minConfidence: session.minConfidence,
        coolingOffUntil: session.coolingOffUntil,
        dailyLoss: periodLoss(session.logs, 24 * 3600 * 1000),
        weeklyLoss: periodLoss(session.logs, 7 * 24 * 3600 * 1000),
        dailyLossLimit: session.dailyLossLimit,
        weeklyLossLimit: session.weeklyLossLimit,
        ageConfirmed: session.ageConfirmed,
      }),
    [p, odds, analysis.confidenceLabel, session],
  );

  const label = (key: MarketKey) => {
    if (key === "home") return homeName;
    if (key === "away") return awayName;
    if (key === "cornersOver") return `Más ${analysis.cornersLine} córners`;
    if (key === "cornersUnder") return `Menos ${analysis.cornersLine} córners`;
    return MARKET_LABEL[key];
  };

  return (
    <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <h2 className="font-display text-xl">Cuota justa y valor esperado</h2>
      <p className="mt-1 text-sm text-muted">
        {analysis.quoteProvider
          ? `La cuota que aparece sola es la que publicó ${analysis.quoteProvider}${
              analysis.quoteProvider === "Wplay" ? " en su tablero" : " vía ESPN"
            }.`
          : "No hay cuota de mercado publicada para este partido."}{" "}
        Si el campo está vacío, esa casa no tenía ese precio: no se inventa. BetPlay no entra: su
        feed de Kambi respondió «No access». El hándicap 0 devuelve la apuesta si hay empate. Un VE
        positivo no implica que el evento ocurra.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {KEYS.filter(
          (key) =>
            (key !== "cornersOver" && key !== "cornersUnder") || analysis.pCornersOver != null,
        ).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setMarket(key)}
            className={cn(
              "h-10 rounded-md px-3 text-xs",
              market === key ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
            )}
          >
            {label(key)}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Stat k="Prob. modelo" v={formatPct(p)} />
        <Stat
          k="Cuota justa"
          v={
            analysis.pCornersOver == null && (market === "cornersOver" || market === "cornersUnder")
              ? "—"
              : formatOdds(1 / Math.min(0.92, Math.max(0.035, p)))
          }
        />
        <div>
          <Label htmlFor="cuota">Cuota de mercado</Label>
          <Input
            id="cuota"
            type="number"
            min={1.01}
            step={0.01}
            className="mt-1"
            value={tradable ? odds.toFixed(2) : ""}
            onChange={(e) =>
              session.setCustomOdds(fixtureId, {
                [market]: Number(e.target.value),
              } as Partial<MarketOdds>)
            }
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat k="VE" v={tradable ? formatEv(ev) : "—"} tone={tradable && ev > 0.03 ? "value" : tradable && ev < 0 ? "danger" : undefined} />
        <Stat k="Kelly completo" v={`${(advice.kellyFull * 100).toFixed(1)}%`} />
        <Stat
          k="Stake sugerido"
          v={advice.allowed ? money(advice.stake, session.currency) : "0"}
        />
      </div>

      <ul className="mt-4 space-y-1 text-sm text-muted">
        {advice.reasons.map((reason) => (
          <li key={reason}>— {reason}</li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          disabled={!tradable || !advice.allowed || Boolean(cooling)}
          onClick={() =>
            session.addLog({
              fixtureId,
              market: label(market),
              odds,
              stake: advice.stake,
              ev,
            })
          }
        >
          Registrar en el diario
        </Button>
        <p className="self-center text-xs text-subtle">
          El diario vive en este dispositivo. No envía dinero a ningún operador.
        </p>
      </div>
    </section>
  );
}

function Stat({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "value" | "danger";
}) {
  return (
    <div className="rounded-lg bg-elevated p-3">
      <p className="text-[11px] uppercase tracking-wider text-subtle">{k}</p>
      <p
        className={cn(
          "mt-1 font-medium tabular-nums",
          tone === "value" && "text-value",
          tone === "danger" && "text-danger",
        )}
      >
        {v}
      </p>
    </div>
  );
}
