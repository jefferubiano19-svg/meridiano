import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { shiftDay } from "@/lib/football/clock";
import type { MatchReading } from "@/lib/football/dto";
import { ExportBar } from "@/components/export-bar";
import { kickLabel } from "@/components/match/reading-block";
import { loadDay, loadModelo } from "@/lib/football/pages";
import { useAgendaToday } from "@/lib/football/use-today";
import {
  bestFromOffers,
  consensusFromOffers,
  doublePicks,
  MARKET_NAME,
  pickLabel,
  VALUE_MAX_EV,
  VALUE_MIN_EV,
  VALUE_MIN_PROB,
  VALUE_RULE_SINCE,
  valuePicks,
  type DoubleMarket,
} from "@/lib/football/valor";
import { betSlip } from "@/lib/store/bet-slip";
import { myBets } from "@/lib/store/mis-apuestas";

export const Route = createFileRoute("/valor")({ component: ValorPage });

/* ---------------------------------------------------------------------------
 * «Valor del día»: selecciones de hoy y mañana donde la mejor cuota de las casas paga más de lo que vale el
 * resultado según el consenso de las casas (reglas en src/lib/football/valor.ts). Regla v2 (5 nov 2026): solo
 * resultados de 40 % o más, y además de 1X2, doble oportunidad y empate no válido. El corte guarda cada selección
 * (data/valor-registro.json) y la revisión automática la mide; la lectura de cada hora dice si sigue con valor.
 * ------------------------------------------------------------------------- */

type Market = "1x2" | DoubleMarket;

interface Pick {
  market: Market;
  outcomeIndex: 0 | 1 | 2;
  prob: number;
  pDraw: number;
  house: string;
  odds: number;
  ev: number;
  fair: number;
  minOdds: number;
}

interface Row {
  match: MatchReading;
  pick: Pick;
  rank?: number | null;
  total?: number;
  /** «hora»: la encontró la búsqueda de cada hora (no estaba en el corte); foundAt = hora de esa lectura. */
  source?: "corte" | "hora";
  foundAt?: string;
  /** Lectura de cada hora (cierre.yml), si es más reciente que la del corte. */
  now: { readAt: string; still: boolean; house: string; odds: number; minOdds: number } | null;
}

type Stat = { n: number; mean: number | null; low: number | null; high: number | null };
type Result = { settled: number; roi: Stat; closed: number; evClose: Stat; verdict: string };

const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
const num = (value: number) => value.toFixed(2).replace(".", ",");
const houseName = (house: string) => house.replace(/\.(co|latam)$/i, "");
const SLIP = ["home", "draw", "away"] as const;
const SLIP_DC = ["1X", "12", "X2"] as const;

function money(stat: Stat | undefined): string {
  if (!stat || stat.mean == null) return "sin datos todavía";
  const base = `${stat.mean >= 0 ? "+" : "−"}${Math.abs(stat.mean * 100)
    .toFixed(1)
    .replace(".", ",")} % por apuesta`;
  if (stat.n < 20 || stat.low == null || stat.high == null)
    return `${base} en ${stat.n} (muy pocas para concluir)`;
  return `${base} (IC 95 % ${(stat.low * 100).toFixed(1).replace(".", ",")} % a ${(stat.high * 100).toFixed(1).replace(".", ",")} %, ${stat.n} selecciones)`;
}

/** Todas las selecciones con valor de un partido, con las ofertas dadas (1X2 y, si hay, mercados dobles). */
function picksOf(
  offers1x2: { house: string; odds: number[] }[],
  double:
    | { dc: { house: string; odds: number[] }[]; dnb: { house: string; odds: number[] }[] }
    | null
    | undefined,
  minProb: number,
): { probs: number[]; picks: Pick[] } | null {
  const probs = consensusFromOffers(offers1x2);
  const best = bestFromOffers(offers1x2);
  if (!probs || !best) return null;
  const picks: Pick[] = valuePicks(probs, best, offers1x2.length, minProb).map((pick) => ({
    ...pick,
    market: "1x2",
    pDraw: 0,
  }));
  if (double) picks.push(...doublePicks(probs, double.dc, double.dnb, minProb));
  return { probs, picks };
}

/** Revisa la selección con la lectura más reciente: ¿la mejor casa todavía paga por encima de lo que vale? */
function recheck(match: MatchReading, pick: Pick, readAt?: string): Row["now"] {
  const current = match.current;
  const base = readAt ?? (pick.market === "1x2" ? match.bestOdds?.readAt : match.double?.readAt);
  if (!current || !(current.readAt > (base ?? ""))) return null;
  if (pick.market !== "1x2" && !current.double) return null;
  // Para decir si sigue con valor solo cuenta el valor, no el nivel de probabilidad.
  const again = picksOf(current.offers, current.double, 0);
  if (!again) return null;
  const same = again.picks.find(
    (item) => item.market === pick.market && item.outcomeIndex === pick.outcomeIndex,
  );
  const [home, draw, away] = again.probs;
  const prob =
    pick.market === "1x2"
      ? again.probs[pick.outcomeIndex]
      : pick.market === "dc"
        ? [home + draw, home + away, draw + away][pick.outcomeIndex]
        : pick.outcomeIndex === 0
          ? home
          : away;
  const minOdds =
    pick.market === "dnb" ? (1 + VALUE_MIN_EV - draw) / prob : (1 + VALUE_MIN_EV) / prob;
  const offers =
    pick.market === "1x2"
      ? current.offers
      : pick.market === "dc"
        ? (current.double?.dc ?? [])
        : (current.double?.dnb ?? []);
  const slot = pick.market === "dnb" ? (pick.outcomeIndex === 0 ? 0 : 1) : pick.outcomeIndex;
  const top = offers.reduce<{ house: string; odds: number } | null>(
    (acc, offer) =>
      offer.odds[slot] > (acc?.odds ?? 0) ? { house: offer.house, odds: offer.odds[slot] } : acc,
    null,
  );
  if (!top) return null;
  return {
    readAt: current.readAt,
    // Sigue con valor si la mejor cuota de ahora llega a la mínima de ahora (también cuando pasa del +15 %).
    still: Boolean(same) || top.odds >= minOdds,
    house: top.house,
    odds: top.odds,
    minOdds,
  };
}

function ValorPage() {
  const today = useAgendaToday();
  const navigate = useNavigate();
  const [matches, setMatches] = useState<MatchReading[] | null>(null);
  const [records, setRecords] = useState<{
    all: Result | null;
    v2: Result | null;
    byMarket: { market: Market; results: Result }[];
    bySource: { source: "corte" | "hora"; results: Result }[];
    alta: Result | null;
  }>({
    all: null,
    v2: null,
    byMarket: [],
    bySource: [],
    alta: null,
  });
  const [order, setOrder] = useState<"rank" | "time">("rank");

  useEffect(() => {
    let live = true;
    void Promise.all([
      loadDay({ data: { day: today } }),
      loadDay({ data: { day: shiftDay(today, 1) } }),
    ])
      .then(([a, b]) => {
        if (live) setMatches([...a.matches, ...b.matches]);
      })
      .catch(() => {
        if (live) setMatches([]);
      });
    void loadModelo()
      .then((bundle) => {
        const review = bundle.review as unknown as {
          pickResults?: Result;
          pickRuleV2?: {
            all: Result;
            byMarket: { market: Market; results: Result }[];
            bySource?: { source: "corte" | "hora"; results: Result }[];
          };
          pickTiers?: { key: string; all: Result }[];
        } | null;
        if (live)
          setRecords({
            all: review?.pickResults ?? null,
            v2: review?.pickRuleV2?.all ?? null,
            byMarket: review?.pickRuleV2?.byMarket ?? [],
            bySource: review?.pickRuleV2?.bySource ?? [],
            alta: review?.pickTiers?.find((tier) => tier.key === "alta")?.all ?? null,
          });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [today]);

  const rows = useMemo(() => {
    const now = Date.now();
    const out: Row[] = [];
    for (const match of matches ?? []) {
      if (match.status !== "por-jugar" || !(Date.parse(match.kickoff) - now > 10 * 60 * 1000))
        continue;
      const picks: Pick[] = [];
      if (match.consensus && match.bestOdds) {
        // Ofertas 1X2 con la mejor cuota de cada resultado (la página no tiene cada casa por separado).
        const probs = [match.consensus.home, match.consensus.draw, match.consensus.away];
        const best = [match.bestOdds.home, match.bestOdds.draw, match.bestOdds.away];
        picks.push(
          ...valuePicks(probs, best, match.bestOdds.houses).map((pick) => ({
            ...pick,
            market: "1x2" as const,
            pDraw: 0,
          })),
        );
        if (match.double) picks.push(...doublePicks(probs, match.double.dc, match.double.dnb));
      }
      for (const pick of picks) out.push({ match, pick, source: "corte", now: recheck(match, pick) });
      // Las que encontró la búsqueda de cada hora (data/valor-hora.json) y no salen con la cuota del corte.
      for (const hour of match.hourPicks ?? []) {
        if (picks.some((pick) => pick.market === hour.market && pick.outcomeIndex === hour.outcomeIndex)) continue;
        const pick: Pick = {
          ...hour,
          fair: hour.market === "dnb" ? (1 - hour.pDraw) / hour.prob : 1 / hour.prob,
          minOdds:
            hour.market === "dnb"
              ? (1 + VALUE_MIN_EV - hour.pDraw) / hour.prob
              : (1 + VALUE_MIN_EV) / hour.prob,
        };
        out.push({ match, pick, source: "hora", foundAt: hour.readAt, now: recheck(match, pick, hour.readAt) });
      }
    }
    // Puesto 1 a N: entre las que siguen con valor, 1 es la que más probabilidad tiene de ganarse. Las que ya
    // perdieron el valor no llevan puesto y van al final.
    const ranked = out
      .filter((row) => row.now?.still !== false)
      .sort((a, b) => b.pick.prob - a.pick.prob || a.match.kickoff.localeCompare(b.match.kickoff));
    const rank = new Map(ranked.map((row, index) => [row, index + 1]));
    const gone = out.filter((row) => row.now?.still === false);
    const live =
      order === "rank"
        ? ranked
        : [...ranked].sort((a, b) => a.match.kickoff.localeCompare(b.match.kickoff));
    return [...live, ...gone].map((row) => ({
      ...row,
      rank: rank.get(row) ?? null,
      total: ranked.length,
    }));
  }, [matches, order]);

  const label = (row: Row) =>
    pickLabel(
      row.pick.market,
      row.pick.outcomeIndex,
      row.match.homeEs || row.match.home,
      row.match.awayEs || row.match.away,
    );

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">
          Cada día · hoy y mañana
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Valor del día</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Selecciones donde la casa que mejor paga da más de lo que vale el resultado según el
          consenso de las casas (entre +{pct(VALUE_MIN_EV)} y +{pct(VALUE_MAX_EV)} por apuesta).
          Desde el {VALUE_RULE_SINCE.split("-").reverse().join("/")} solo entran resultados que se
          cumplen <strong className="text-fg">{`${Math.round(VALUE_MIN_PROB * 100)} %`} o más</strong> de las veces, y
          se buscan también en <strong className="text-fg">doble oportunidad</strong> (dos
          resultados a la vez) y <strong className="text-fg">empate no válido</strong> (si empata,
          se devuelve lo apostado). No es una recomendación: la decisión sobre apostar se toma al
          llegar a 300 selecciones resueltas.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Orden">
          {[
            { key: "rank" as const, label: "Por probabilidad (1 primero)" },
            { key: "time" as const, label: "Por hora" },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={order === option.key}
              onClick={() => setOrder(option.key)}
              className={`h-9 rounded-full px-4 text-sm ring-1 ring-border ${order === option.key ? "bg-fg text-bg" : "bg-elevated text-fg"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-2 max-w-2xl text-xs text-muted">
          #1 es la selección con más probabilidad de ganarse entre las que siguen con valor. Cada
          selección nueva llega por correo y la cuota se revisa cada hora. Juntarlas en combinada
          multiplica las probabilidades hacia abajo.
        </p>
        <div className="mt-4">
          <ExportBar
            filename="meridiano-valor-del-dia"
            title="Valor del día"
            build={() => ({
              name: "Valor del día",
              headers: [
                "Puesto",
                "Inicio",
                "Competición",
                "Partido",
                "Mercado",
                "Selección",
                "Casa",
                "Cuota",
                "Cuota mínima",
                "Se gana",
                "Empate (se devuelve)",
                "Cuota justa",
                "Valor por $100",
                "Cuota vigente",
                "¿Sigue con valor?",
              ],
              rows: rows.map((row) => [
                row.rank ?? null,
                row.match.kickoff.slice(0, 16).replace("T", " "),
                row.match.competition,
                `${row.match.home} — ${row.match.away}`,
                MARKET_NAME[row.pick.market],
                label(row),
                houseName(row.pick.house),
                Number(row.pick.odds.toFixed(2)),
                Number(row.pick.minOdds.toFixed(2)),
                pct(row.pick.prob),
                row.pick.market === "dnb" ? pct(row.pick.pDraw) : null,
                Number(row.pick.fair.toFixed(2)),
                Number((row.pick.ev * 100).toFixed(1)),
                row.now
                  ? `${num(row.now.odds)} en ${houseName(row.now.house)} (${row.now.readAt.slice(11, 16)})`
                  : null,
                row.now ? (row.now.still ? "sí" : "no") : null,
              ]),
              note: `Reglas: ${`${Math.round(VALUE_MIN_PROB * 100)} %`} o más de probabilidad; solo en la casa indicada, a la cuota mínima o más; sola, nunca en combinada; una por partido. ${records.v2 ? `Regla actual: ${records.v2.verdict}. Resultado: ${money(records.v2.roi)}.` : ""}`,
            })}
          />
        </div>
      </header>

      <section className="rounded-xl bg-surface p-4 text-sm shadow-[var(--shadow-border)]">
        <h2 className="font-display text-lg">¿Han ganado hasta ahora?</h2>
        <div className="mt-2 space-y-2 text-muted">
          <p>
            <strong className="text-fg">Regla actual</strong> (desde el{" "}
            {VALUE_RULE_SINCE.split("-").reverse().join("/")}, la prueba limpia):{" "}
            {records.v2
              ? `${records.v2.settled} resueltas · resultado ${money(records.v2.roi)} · contra el cierre ${money(records.v2.evClose)}.`
              : "se mide desde el próximo corte."}
          </p>
          {records.byMarket.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-xs">
              {records.byMarket.map((item) => (
                <li key={item.market}>
                  {MARKET_NAME[item.market]}: {item.results.settled} resueltas ·{" "}
                  {money(item.results.roi)}
                </li>
              ))}
              {records.bySource.map((item) => (
                <li key={item.source}>
                  {item.source === "hora" ? "Encontradas en la búsqueda de cada hora" : "Encontradas en el corte"}:{" "}
                  {item.results.settled} resueltas · {money(item.results.roi)}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs">
            Antes de la regla, las de {`${Math.round(VALUE_MIN_PROB * 100)} %`} o más:{" "}
            {records.alta ? money(records.alta.roi) : "sin datos"}. Todas las selecciones desde el
            18/10:{" "}
            {records.all
              ? `${money(records.all.roi)}; contra el cierre ${money(records.all.evClose)}`
              : "sin datos"}
            .
          </p>
        </div>
      </section>

      <section className="rounded-xl bg-surface p-4 text-sm leading-relaxed text-muted shadow-[var(--shadow-border)]">
        <h2 className="font-display text-lg text-fg">Cómo usarlo</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Busca el partido en la casa indicada (no en otra) y el mercado indicado: resultado,
            doble oportunidad o empate no válido.
          </li>
          <li>
            Apuesta solo si esa casa paga la cuota mínima o más. Si paga menos, ya no tiene valor:
            no se apuesta.
          </li>
          <li>
            <strong className="text-fg">Cada selección sola, nunca en combinada</strong>, una por
            partido y siempre la misma cantidad pequeña.
          </li>
          <li>
            Aun con 40 % o más se pierden varias: el valor aparece después de muchas apuestas
            iguales.
          </li>
        </ol>
      </section>

      {matches == null ? (
        <p className="text-sm text-muted">Cargando partidos de hoy y mañana…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">
          Hoy y mañana no hay ninguna selección de {`${Math.round(VALUE_MIN_PROB * 100)} %`} o más con valor. No apostar
          también es una decisión válida: es lo que dice la regla.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const { match, pick, now, rank, total } = row;
            const sameMatch = rows.filter((other) => other.match.id === match.id).length;
            return (
              <article
                key={`${match.id}-${pick.market}-${pick.outcomeIndex}`}
                className={`rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] ${now && !now.still ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">
                    {match.competition}
                  </p>
                  {rank ? (
                    <span
                      className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold tabular-nums text-accent-fg"
                      title={`Puesto ${rank} de ${total} por probabilidad de ganarse`}
                    >
                      #{rank}
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-1 font-display text-xl tracking-tight">
                  {match.home} — {match.away}
                </h2>
                <p className="mt-1 text-xs text-muted">{kickLabel(match.kickoff)}</p>
                <p className="mt-3 text-[11px] uppercase tracking-wide text-subtle">
                  {MARKET_NAME[pick.market]}
                </p>
                <p className="text-base text-fg">
                  <strong>{label(row)}</strong>
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">Se gana</dt>
                    <dd>
                      {pct(pick.prob)}
                      {pick.market === "dnb" ? (
                        <span className="text-xs text-muted">
                          {" "}
                          · empate {pct(pick.pDraw)} (se devuelve)
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">Cuota justa</dt>
                    <dd>{num(pick.fair)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">Mejor cuota</dt>
                    <dd>
                      {num(pick.odds)} · {houseName(pick.house)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">
                      Cuota mínima
                    </dt>
                    <dd className="text-value">{num(pick.minOdds)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">
                      Por cada $100
                    </dt>
                    <dd className="text-value">+${(pick.ev * 100).toFixed(1).replace(".", ",")}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-subtle">
                      Casas leídas
                    </dt>
                    <dd>
                      {pick.market === "1x2"
                        ? (match.bestOdds?.houses ?? "—")
                        : ((pick.market === "dc"
                            ? match.double?.dc.length
                            : match.double?.dnb.length) ?? "—")}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 rounded-lg bg-elevated p-3 text-xs leading-relaxed text-fg ring-1 ring-border">
                  <p>
                    <strong>
                      Solo en {houseName(pick.house)}, mercado «{MARKET_NAME[pick.market]}», a{" "}
                      {num(pick.minOdds)} o más.
                    </strong>{" "}
                    En otra casa o con menos cuota ya no tiene valor: no se apuesta.
                  </p>
                  <p className="mt-1">
                    <strong>Sola, nunca en combinada.</strong> El valor medido es de apuestas
                    sueltas.
                  </p>
                  {sameMatch > 1 ? (
                    <p className="mt-1">
                      <strong>
                        Este partido tiene {sameMatch} selecciones: juega solo una (la de puesto más
                        alto).
                      </strong>
                    </p>
                  ) : null}
                </div>
                {now ? (
                  <p
                    className={`mt-2 rounded-lg px-3 py-2 text-xs ${now.still ? "bg-elevated text-fg" : "bg-elevated text-danger"}`}
                  >
                    <strong>Cuota vigente ({now.readAt.slice(11, 16)}):</strong> {num(now.odds)} en{" "}
                    {houseName(now.house)} · mínima {num(now.minOdds)}.{" "}
                    {now.still ? "Sigue con valor." : "Ya no tiene valor: no se apuesta."}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted">
                  {row.source === "hora"
                    ? `Encontrada en la búsqueda de cada hora (${String(row.foundAt ?? "").slice(11, 16)})`
                    : `Cuota leída en el último corte${
                        (pick.market === "1x2" ? match.bestOdds?.readAt : match.double?.readAt)
                          ? ` (${String(pick.market === "1x2" ? match.bestOdds?.readAt : match.double?.readAt).slice(11, 16)})`
                          : ""
                      }`}
                  {now ? "; arriba, la lectura más reciente" : "; se relee cada hora"}. Verifica que
                  siga igual en la casa.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="h-9 rounded-full bg-accent px-3 text-xs text-accent-fg"
                  onClick={() => {
                    myBets.setDraft({
                      date: match.kickoff.slice(0, 10),
                      match: `${match.home} — ${match.away}`,
                      market: MARKET_NAME[pick.market],
                      selection: label(row),
                      house: houseName(pick.house),
                      odds: 0,
                      combo: false,
                      valor: { house: houseName(pick.house), minOdds: pick.minOdds, prob: pick.prob, matchId: match.id },
                    });
                    void navigate({ to: "/mis-apuestas" });
                  }}
                >
                  Anotar mi apuesta
                </button>
                {pick.market === "dnb" ? null : (
                  <button
                    type="button"
                    className="mt-3 h-9 rounded-full bg-elevated px-3 text-xs text-fg ring-1 ring-border"
                    onClick={() =>
                      betSlip.put(
                        match.id,
                        pick.market === "dc" ? SLIP_DC[pick.outcomeIndex] : SLIP[pick.outcomeIndex],
                        `${match.home} — ${match.away}`,
                      )
                    }
                  >
                    Revisar en Apuesta
                  </button>
                )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
