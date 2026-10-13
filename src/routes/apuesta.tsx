import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { shiftDay } from "@/lib/football/clock";
import type { MatchReading } from "@/lib/football/dto";
import { loadDay } from "@/lib/football/pages";
import { matchesSearch, searchText } from "@/lib/football/search";
import { useAgendaToday } from "@/lib/football/use-today";
import { betSlip, MARKETS, useBetSlip, type Market } from "@/lib/store/bet-slip";

export const Route = createFileRoute("/apuesta")({ component: BetCheckPage });

/* ---------------------------------------------------------------------------
 * Revisar una apuesta antes de hacerla: para cada selección, la probabilidad
 * publicada de Meridiano, la cuota justa y si la casa paga más o menos de lo que
 * vale. Para una combinada, la probabilidad de acertarla completa y lo que
 * devuelve en promedio. Las selecciones se agregan desde la ficha de cada partido
 * o desde el buscador y quedan solo en este navegador. No recomienda apostar.
 * ------------------------------------------------------------------------- */

interface Leg {
  match: MatchReading;
  market: Market;
  odds: string;
}

function probability(match: MatchReading, market: Market): number | null {
  const p = match.published;
  if (!p) return null;
  if (market === "home") return p.home;
  if (market === "draw") return p.draw;
  if (market === "away") return p.away;
  if (market === "1X") return p.home + p.draw;
  if (market === "X2") return p.draw + p.away;
  return p.home + p.away;
}

function parseOdds(text: string): number | null {
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) && value > 1 ? value : null;
}

const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
const num = (value: number) => value.toFixed(2).replace(".", ",");
const pesos = (value: number) => `$${Math.round(value).toLocaleString("es-CO")}`;

function BetCheckPage() {
  const today = useAgendaToday();
  const [matches, setMatches] = useState<MatchReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const slip = useBetSlip();
  const [stakeText, setStakeText] = useState("10000");

  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([loadDay({ data: { day: today } }), loadDay({ data: { day: shiftDay(today, 1) } })])
      .then(([a, b]) => {
        if (live) setMatches([...a.matches, ...b.matches].filter((match) => match.published));
      })
      .catch(() => {
        if (live) setMatches([]);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [today]);

  const byId = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const legs: Leg[] = slip.flatMap((item) => {
    const match = byId.get(item.id);
    return match ? [{ match, market: item.market, odds: item.odds }] : [];
  });
  const missing = loading ? [] : slip.filter((item) => !byId.has(item.id));

  const found = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return [];
    const chosen = new Set(legs.map((leg) => leg.match.id));
    return matches
      .filter((match) => !chosen.has(match.id))
      .filter((match) => matchesSearch(q, searchText([match.home, match.away, match.competition, match.homeEs, match.awayEs])))
      .slice(0, 8);
  }, [query, matches, legs]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = legs.map((leg) => {
    const p = probability(leg.match, leg.market);
    const odds = parseOdds(leg.odds);
    const ev = p != null && odds != null ? p * odds - 1 : null;
    return { leg, p, odds, fair: p ? 1 / p : null, ev };
  });
  const complete = rows.length > 0 && rows.every((row) => row.p != null && row.odds != null);
  const jointP = complete ? rows.reduce((acc, row) => acc * (row.p as number), 1) : null;
  const jointOdds = complete ? rows.reduce((acc, row) => acc * (row.odds as number), 1) : null;
  const jointEv = jointP != null && jointOdds != null ? jointP * jointOdds - 1 : null;
  const stake = Number(stakeText.replace(/\D/g, "")) || 0;

  const update = (index: number, change: { market?: Market; odds?: string }) => betSlip.update(legs[index].match.id, change);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Antes de apostar</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Revisar mi apuesta</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Agrega los partidos de tu boleta, elige lo que apostaste y escribe la cuota de la casa. Meridiano te dice
          cuántas veces se cumple cada selección, si la casa la paga por encima o por debajo de lo que vale y qué
          pasa al juntarlas en una combinada. También puedes agregarlos desde la ficha de cada partido con los
          botones 1 · X · 2. Tu apuesta queda solo en este navegador. No es una recomendación.
        </p>
      </header>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">1 · Agrega los partidos</h2>
        <Input
          className="mt-3 md:max-w-md"
          placeholder={loading ? "Cargando partidos de hoy y mañana…" : "Busca un equipo (hoy o mañana)"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Buscar partido"
        />
        {found.length ? (
          <ul className="mt-3 space-y-2">
            {found.map((match) => (
              <li key={match.id}>
                <button
                  type="button"
                  className="w-full rounded-lg bg-elevated px-3 py-2 text-left text-sm hover:ring-1 hover:ring-border"
                  onClick={() => {
                    betSlip.put(match.id, "home", `${match.home} — ${match.away}`);
                    setQuery("");
                  }}
                >
                  <span className="block text-[11px] uppercase tracking-wide text-subtle">{match.competition}</span>
                  {match.home} — {match.away}
                  <span className="text-muted"> · {match.kickoff.slice(5, 16).replace("T", " ")}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : query.trim().length >= 2 && !loading ? (
          <p className="mt-3 text-sm text-muted">Ningún partido de hoy o mañana con probabilidad coincide.</p>
        ) : null}
      </section>

      {missing.length ? (
        <section className="rounded-xl bg-surface p-4 text-sm text-muted shadow-[var(--shadow-border)]">
          {missing.map((item) => (
            <p key={item.id} className="flex items-center justify-between gap-3">
              <span>{item.label}: ya empezó o salió de la agenda de hoy y mañana.</span>
              <button type="button" className="text-xs underline" onClick={() => betSlip.remove(item.id)}>
                Quitar
              </button>
            </p>
          ))}
        </section>
      ) : null}

      {rows.length ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">2 · Tus selecciones</h2>
            <button type="button" className="text-xs text-muted underline" onClick={() => betSlip.clear()}>
              Vaciar
            </button>
          </div>
          {rows.map((row, index) => {
            // Margen de ±3 %: dentro de eso la cuota es más o menos justa (misma regla que la marca de valor).
            const bad = row.ev != null && row.ev < -0.03;
            const good = row.ev != null && row.ev >= 0.03;
            return (
              <div key={row.leg.match.id} className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-subtle">{row.leg.match.competition}</p>
                    <p className="font-medium">
                      {row.leg.match.home} — {row.leg.match.away}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-muted underline"
                    onClick={() => betSlip.remove(row.leg.match.id)}
                  >
                    Quitar
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    className="h-10 rounded-lg bg-elevated px-2 text-sm"
                    value={row.leg.market}
                    onChange={(event) => update(index, { market: event.target.value as Market })}
                    aria-label="Lo que apostaste"
                  >
                    {MARKETS.map((market) => (
                      <option key={market.key} value={market.key}>
                        {market.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="h-10 w-28"
                    inputMode="decimal"
                    placeholder="Cuota"
                    value={row.leg.odds}
                    onChange={(event) => update(index, { odds: event.target.value })}
                    aria-label="Cuota de la casa"
                  />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">Se cumple</dt>
                    <dd>{row.p != null ? pct(row.p) : "NO DISPONIBLE"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">Cuota justa</dt>
                    <dd>{row.fair != null ? num(row.fair) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">La casa paga</dt>
                    <dd>{row.odds != null ? num(row.odds) : "escribe la cuota"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">Por cada $100</dt>
                    <dd className={bad ? "text-danger" : good ? "text-value" : ""}>
                      {row.ev != null ? `${row.ev >= 0 ? "+" : "−"}$${Math.abs(row.ev * 100).toFixed(1).replace(".", ",")}` : "—"}
                    </dd>
                  </div>
                </dl>
                {row.ev != null ? (
                  <p className={`mt-2 text-xs ${bad ? "text-danger" : good ? "text-value" : "text-muted"}`}>
                    {bad
                      ? "La casa paga menos de lo que vale: en promedio pierdes con esta selección."
                      : good
                        ? "La casa paga más de lo que vale según Meridiano. Revisa que la cuota sea la actual."
                        : "Cuota cercana a lo que vale: sin ventaja para ti ni para la casa, aparte de su margen."}
                  </p>
                ) : null}
                {row.p != null && row.p < 0.55 ? (
                  <p className="mt-1 text-xs text-warn">
                    Se cumple menos de 55 % de las veces: falla casi una de cada dos.
                  </p>
                ) : null}
                {row.leg.match.revisar ? (
                  <p className="mt-1 text-xs text-warn">El modelo y las casas no coinciden en este partido («revisar»).</p>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {rows.length > 1 ? (
        <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-display text-xl">3 · Si las juntas en una combinada</h2>
          {complete && jointP != null && jointOdds != null && jointEv != null ? (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-elevated px-3 py-3">
                  <dt className="text-[10px] uppercase tracking-wide text-subtle">Acertar todas</dt>
                  <dd className="mt-1 font-medium">{pct(jointP)}</dd>
                </div>
                <div className="rounded-lg bg-elevated px-3 py-3">
                  <dt className="text-[10px] uppercase tracking-wide text-subtle">Se gana</dt>
                  <dd className="mt-1 font-medium">1 de cada {Math.max(1, Math.round(1 / jointP))}</dd>
                </div>
                <div className="rounded-lg bg-elevated px-3 py-3">
                  <dt className="text-[10px] uppercase tracking-wide text-subtle">Cuota total</dt>
                  <dd className="mt-1 font-medium">{num(jointOdds)}</dd>
                </div>
                <div className="rounded-lg bg-elevated px-3 py-3">
                  <dt className="text-[10px] uppercase tracking-wide text-subtle">Cuota justa total</dt>
                  <dd className="mt-1 font-medium">{num(1 / jointP)}</dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor="stake" className="text-muted">
                  Si apuestas
                </label>
                <Input
                  id="stake"
                  className="h-10 w-36"
                  inputMode="numeric"
                  value={stakeText}
                  onChange={(event) => setStakeText(event.target.value)}
                />
              </div>
              <p className={`mt-3 text-sm ${jointEv < 0 ? "text-danger" : "text-value"}`}>
                Ganas {pesos(stake * jointOdds)} {pct(jointP)} de las veces. En promedio, de {pesos(stake)} vuelven{" "}
                {pesos(stake * (1 + jointEv))} ({jointEv >= 0 ? "+" : "−"}
                {pct(Math.abs(jointEv))}).
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Cada partido que agregas multiplica la probabilidad hacia abajo y el margen de la casa hacia arriba. Se
                asume que los partidos no dependen entre sí.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">Escribe la cuota de todas las selecciones para ver el resultado.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
