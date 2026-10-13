import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ExportBar } from "@/components/export-bar";
import type { ModeloBundle } from "@/lib/football/dto";
import { loadModelo } from "@/lib/football/pages";
import type { Light, Stat } from "@/lib/football/review";

export const Route = createFileRoute("/modelo")({ component: ModelPage });

const LIGHT_TEXT: Record<Light, string> = {
  verde: "Bien",
  amarillo: "Atención",
  rojo: "Falla",
  gris: "Sin muestra",
};

const LIGHT_CLASS: Record<Light, string> = {
  verde: "text-value",
  amarillo: "text-warn",
  rojo: "text-danger",
  gris: "text-subtle",
};

function fix(value: number | null | undefined, digits = 4): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits).replace(".", ",");
}

function signed(value: number | null | undefined, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${fix(value, digits)}`;
}

function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${Math.round(value * 100)} %`;
}

function interval(stat: Stat): string {
  if (stat.mean == null) return "sin datos";
  if (stat.low == null || stat.high == null) return `${signed(stat.mean)} (n ${stat.n})`;
  return `${signed(stat.mean)} · IC 95 % ${signed(stat.low)} a ${signed(stat.high)} · n ${stat.n}`;
}

function corteName(value: string | null): string {
  return value === "mediodia" ? "mediodía" : (value ?? "—");
}

function ci(stat: Stat): string {
  return stat.low == null || stat.high == null ? "—" : `${signed(stat.low, 3)} a ${signed(stat.high, 3)}`;
}

function word(stat: Stat, minimum: number): string {
  if (stat.n < minimum || stat.low == null || stat.high == null) return "Falta muestra";
  if (stat.high < 0) return "Mejora";
  if (stat.low > 0) return "Empeora";
  return "Igual";
}

/** Lectura de una diferencia de RPS (negativa = mejora). */
function verdict(stat: Stat, minimum: number): string {
  if (stat.n < minimum || stat.low == null || stat.high == null) return `Sin conclusión: faltan partidos (mínimo ${minimum}).`;
  if (stat.high < 0) return "Mejora: todo el intervalo está bajo cero.";
  if (stat.low > 0) return "Empeora: todo el intervalo está sobre cero.";
  return "Sin diferencia demostrable: el intervalo cruza el cero.";
}

function bogotaClock(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <h2 className="font-display text-xl">{title}</h2>
      {note ? <p className="mt-2 text-sm leading-relaxed text-muted">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LightCard({ label, light, detail }: { label: string; light: Light; detail: string }) {
  return (
    <div className="rounded-lg bg-elevated p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">{label}</p>
      <p className={`mt-1 font-display text-lg ${LIGHT_CLASS[light]}`}>{LIGHT_TEXT[light]}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-subtle">
          <tr>
            {head.map((cell) => (
              <th key={cell} className="whitespace-nowrap py-2 pr-4 font-normal">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border">
              {row.map((cell, column) => (
                <td key={column} className={`whitespace-nowrap py-2 pr-4 ${column > 0 ? "tabular-nums" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelPage() {
  const [bundle, setBundle] = useState<ModeloBundle | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setNow(Date.now());
    void loadModelo()
      .then((next) => {
        if (live) setBundle(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!bundle) {
    return <p className="text-sm text-muted">{failed ? "No se pudo cargar el modelo." : "Cargando el modelo…"}</p>;
  }

  const { lastCut, review } = bundle;
  const finished = Date.parse(lastCut.finishedAtBogota ?? "");
  const hours = now != null && Number.isFinite(finished) ? (now - finished) / 3600000 : null;
  const ev = review?.evaluation;

  // Una sola línea de estado para quien usa la app: lo peor entre cortes, datos y antigüedad.
  const status = (() => {
    if (lastCut.fatal) return { light: "rojo" as Light, text: "Atención: el último corte se cayó antes de terminar. Los datos pueden estar incompletos." };
    if (hours != null && hours > 18) return { light: "rojo" as Light, text: `Atención: el último corte fue hace ${Math.floor(hours)} horas. Los datos de hoy pueden estar incompletos.` };
    if (review?.cuts.light === "rojo") return { light: "rojo" as Light, text: "Atención: faltaron cortes esta semana." };
    if (review?.anomalies.light === "rojo") return { light: "rojo" as Light, text: "Atención: hay datos dañados. Revisa el detalle técnico." };
    if (review && review.cuts.done < review.cuts.expected) return { light: "amarillo" as Light, text: "Funciona, pero faltó algún corte esta semana." };
    return { light: "verde" as Light, text: "Todo normal: los cortes están corriendo y los datos están al día." };
  })();

  const exportRows = (): string[][] => {
    const rows: string[][] = [
      ["Último corte", `${corteName(lastCut.corte)} · ${bogotaClock(lastCut.startedAtBogota)}`],
      ["Predicciones del corte", String(lastCut.predictionsSaved ?? "—")],
    ];
    if (review && ev) {
      rows.push(
        ["Revisión", review.generatedAt],
        ["Cortes", `${LIGHT_TEXT[review.cuts.light]} · ${review.cuts.done} de ${review.cuts.expected} · ${review.cuts.late} tarde`],
        ["Etapa de evaluación", `${ev.stage} · ${ev.comparable} comparables de ${ev.goal}`],
        ["RPS publicada", fix(ev.rpsPublished)],
        ["RPS consenso", fix(ev.rpsConsensus)],
        ["Distancia publicada − consenso", interval(ev.distance)],
        ["Wplay como mercado (publicada − modelo)", interval(review.wplayMarket.diff)],
        ...review.shadows.map((shadow) => [`Sombra ${shadow.label}`, interval(shadow.diff)]),
        ...review.calibration.map((bin) => [`Calibración ${bin.label}`, `${bin.n} casos · esperado ${pct(bin.expected)} · real ${pct(bin.observed)}`]),
        ...review.anomalies.items.map((item) => [`Anomalía: ${item.label}`, String(item.count)]),
      );
    }
    return rows;
  };

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Transparencia</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Cómo estima Meridiano</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Las probabilidades las calcula código, sin modelo de lenguaje. Dos cortes al día (00:15 y 12:00, hora de
          Bogotá) leen Flashscore, guardan una predicción por partido antes del inicio y, al otro día, la comparan con
          el resultado. Esta página se arma con lo que escribió el último corte.
        </p>
        <div className="mt-4">
          <ExportBar
            filename="meridiano-modelo"
            title="Modelo"
            build={() => ({
              name: "Modelo",
              headers: ["Apartado", "Detalle"],
              rows: exportRows(),
              note: "RPS: error de la probabilidad 1X2 (0 es perfecto; más bajo es mejor). IC 95 %: intervalo de confianza.",
            })}
          />
        </div>
      </header>

      <Section title="Estado">
        <p className={`text-sm ${status.light === "verde" ? "text-value" : status.light === "rojo" ? "text-danger" : "text-warn"}`}>
          {status.text}
        </p>
        <p className="mt-1 text-xs text-subtle">
          Último corte: {corteName(lastCut.corte)}, {bogotaClock(lastCut.finishedAtBogota)}
          {hours != null ? ` (hace ${hours < 1 ? "menos de 1 hora" : `${Math.floor(hours)} h`})` : ""}. Próximo: 00:15 o
          12:00, hora de Bogotá.
        </p>
      </Section>

      <Section title="Cómo se calcula">
        <ul className="space-y-2 text-sm leading-relaxed text-muted">
          <li>
            Cada partido recibe la probabilidad del mejor modelo que tenga datos para los dos equipos:
          </li>
          <li>
            <strong className="text-fg">Nivel A</strong>: modelo propio de cada una de 16 ligas principales, ajustado con
            sus resultados y cuotas de cierre.
          </li>
          <li>
            <strong className="text-fg">Nivel B</strong>: fuerza de ataque y defensa de cada equipo, calculada con todos
            sus resultados recientes y teniendo en cuenta contra quién los logró. Se actualiza en cada corte.
          </li>
          <li>
            <strong className="text-fg">Nivel C</strong>: respaldo con los goles recientes, cuando el equipo no tiene
            suficientes datos para el Nivel B.
          </li>
          <li>
            <strong className="text-fg">Selecciones</strong>: Elo de eloratings.net.
          </li>
          <li>
            <strong className="text-fg">Nivel M</strong>: equipos sin datos pero con cuotas: se muestra la probabilidad
            del mercado, sin el margen de la casa.
          </li>
          <li>
            <strong className="text-fg">Torneos internacionales de clubes</strong> (Champions, Libertadores, AFC…):
            el modelo no sabe cuánto vale una liga frente a otra, así que no se usa. Se muestra solo el mercado cuando el
            corte lee las cuotas; antes de eso, no hay probabilidad.
          </li>
          <li>
            <strong className="text-fg">Probabilidad publicada</strong>: si hay cuotas, 80 % mercado (consenso de 3 o
            más casas, o Wplay si no hay consenso) y 20 % modelo. Sin cuotas, solo el modelo.
          </li>
          <li>
            Marca de valor: solo cuando una casa paga más que el consenso de las demás (3 % o más). El modelo solo nunca
            marca valor.
          </li>
          <li>
            No entran: bajas, rotaciones ni cambio de técnico (no hay fuente estable), clasificación global en
            eliminatorias, Kings League, fútbol sala, playa y fútbol 7. Juveniles y reservas no van a la combinada.
          </li>
          <li>Ninguna probabilidad es una garantía.</li>
        </ul>
      </Section>

      <details className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <summary className="cursor-pointer font-display text-xl">Detalle técnico</summary>
        <p className="mt-2 text-sm text-muted">
          Mediciones automáticas de cada corte. Sirven para detectar fallas; no cambian ninguna probabilidad.
        </p>
        <div className="mt-6 space-y-8">
        {review && ev ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <LightCard
              label="Cortes (7 días)"
              light={review.cuts.light}
              detail={`${review.cuts.done} de ${review.cuts.expected} turnos hechos · ${review.cuts.late} con más de 15 min de retraso · ${review.cuts.fatal} caídos.`}
            />
            <LightCard
              label="Precisión"
              light={ev.light}
              detail={`${ev.stage}: ${ev.comparable} partidos comparables con el mercado, meta ${ev.goal}.`}
            />
            <LightCard
              label="Datos"
              light={review.anomalies.light}
              detail={`${review.anomalies.items.filter((item) => item.count > 0 && item.key !== "conflictos").length} tipos de anomalía con casos.`}
            />
            <LightCard
              label="Valor (CLV)"
              light={review.value.withClose >= 100 ? (review.value.clv.low != null && review.value.clv.low > 0 ? "verde" : "amarillo") : "gris"}
              detail={`${review.value.marks} marcas, ${review.value.withClose} con cuota de cierre. ${review.value.stage}.`}
            />
          </div>
        ) : null}
      {review && ev ? (
        <>
          <Section
            title="Precisión"
            note={
              <>
                RPS mide el error de la probabilidad 1X2: 0 es perfecto, más bajo es mejor. La comparación justa es en
                los mismos partidos que tienen consenso. Etapas: menos de 150 comparables, muestra insuficiente; 150 a
                499, lectura preliminar; 500 o más, medición formal.
              </>
            }
          >
            <p className="text-sm text-muted">
              Evaluados {ev.evaluated}. Comparables con consenso {ev.comparable} de {ev.goal}. RPS en esos partidos:
              modelo {fix(ev.rpsModel)}, publicada {fix(ev.rpsPublished)}, consenso {fix(ev.rpsConsensus)}.
            </p>
            <p className="mt-2 text-sm text-muted">
              Distancia publicada − consenso: {interval(ev.distance)}. {verdict(ev.distance, 150)}
            </p>
            <div className="mt-4">
              <Table
                head={["Nivel", "Evaluados", "RPS", "Con consenso", "Dist.", "IC 95 %"]}
                rows={ev.byLevel.map((row) => [
                  row.level,
                  row.n,
                  fix(row.rpsPublished, 3),
                  row.comparable,
                  signed(row.distance.mean, 3),
                  ci(row.distance),
                ])}
              />
            </div>
          </Section>

          <Section
            title="Mercado y sombras"
            note="Diferencia de RPS contra la publicada en los mismos partidos. Negativa: la variante acierta más."
          >
            <p className="text-sm text-muted">
              Wplay como mercado (publicada contra modelo solo): {interval(review.wplayMarket.diff)}.{" "}
              {verdict(review.wplayMarket.diff, 150)}
            </p>
            <div className="mt-4">
              <Table
                head={["Sombra", "Partidos", "Dif.", "IC 95 %", "Lectura"]}
                rows={review.shadows.map((shadow) => [
                  shadow.label,
                  shadow.diff.n,
                  signed(shadow.diff.mean, 3),
                  ci(shadow.diff),
                  word(shadow.diff, 500),
                ])}
              />
            </div>
          </Section>

          <Section
            title="Calibración"
            note="Probabilidad publicada del favorito contra la frecuencia con que ganó. Calibrado: las dos columnas parecidas."
          >
            <Table
              head={["Favorito", "Casos", "Esperado", "Real"]}
              rows={review.calibration.map((bin) => [bin.label, bin.n, pct(bin.expected), pct(bin.observed)])}
            />
          </Section>

          <Section title="Cortes de los últimos 7 días">
            <Table
              head={["Inicio", "Corte", "Retraso", "Predicciones", "Con consenso", "Fallos"]}
              rows={[...review.cuts.list]
                .reverse()
                .map((row) => [
                  bogotaClock(row.when),
                  corteName(row.corte),
                  row.delayMin == null ? "—" : `${row.delayMin} min`,
                  row.predictions ?? "—",
                  row.withConsensus ?? "—",
                  row.failures,
                ])}
            />
          </Section>

          <Section title="Anomalías de datos">
            <ul className="space-y-2 text-sm text-muted">
              {review.anomalies.items.map((item) => (
                <li key={item.key}>
                  <span className={item.count > 0 ? "text-warn" : "text-value"}>{item.count}</span> · {item.label}
                  {item.examples.length ? <span className="block text-xs text-subtle">{item.examples.slice(0, 3).join(" · ")}</span> : null}
                </li>
              ))}
            </ul>
          </Section>
        </>
      ) : null}

      <Section title="Nivel A por liga" note={bundle.dixonRule}>
        <Table
          head={["Liga", "Estado", "RPS modelo", "RPS tabla", "RPS cierre", "Partidos"]}
          rows={bundle.dixon.map((row) => [
            row.league,
            row.published ? "publicado" : "no publicado",
            fix(row.rpsModel, 3),
            fix(row.rpsBaseline, 3),
            fix(row.rpsMarket, 3),
            row.n ?? "—",
          ])}
        />
      </Section>

      <Section title="Fuentes">
        <ul className="space-y-2 text-sm text-muted">
          <li>Flashscore (www y versión Lite): agenda, resultados, tablas, cuotas por casa y fichas. Se respeta su robots.txt.</li>
          <li>football-data.co.uk: resultados y cuotas de cierre para el ajuste del Nivel A.</li>
          <li>eloratings.net: Elo de selecciones.</li>
          <li>Archivo de la Liga BetPlay 2026 cargado por el usuario: solo para la sombra de temporada.</li>
          {bundle.tables.length ? (
            <li>
              Tablas automáticas:{" "}
              {bundle.tables.map((table) => `${table.competition} (${table.teams})`).join(" · ")}.
            </li>
          ) : null}
        </ul>
      </Section>

        </div>
      </details>
    </div>
  );
}
