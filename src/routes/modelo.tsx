import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExportBar } from "@/components/export-bar";
import type { ModeloBundle } from "@/lib/football/dto";
import { loadModelo } from "@/lib/football/pages";

export const Route = createFileRoute("/modelo")({ component: ModelPage });

function ModelPage() {
  const [query, setQuery] = useState("");
  const [bundle, setBundle] = useState<ModeloBundle | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
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

  const { report, evaluations: ev, cut, variant } = bundle;
  const sources = bundle.sources.filter((source) => source.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Transparencia</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Cómo estima Meridiano</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          Las probabilidades las calcula código, no un modelo de lenguaje. Cada partido usa el nivel más alto
          con datos: A es Dixon-Coles si football-data.co.uk pasó el control de RPS; B es la tabla ESPN y
          el xG de FotMob; C es solo la forma reciente de goles. El mercado se lee con Shin y, si no
          converge, con el proporcional. Una cuota con margen fuera de 0 a 15% se descarta.
        </p>
        <div className="mt-4">
          <ExportBar
            filename="meridiano-modelo"
            title="Modelo"
            build={() => ({
              name: "Modelo",
              headers: ["Apartado", "Detalle"],
              rows: [
                ["Corte", bundle.fetchedAt],
                ["Brier", String(report.brier ?? "")],
                ["RPS", String(report.rps ?? "")],
                ["Finalizados", String(report.playedInCut)],
                ["Con historial", String(report.scored)],
                ["Regla", report.rule],
                ...report.bins.map((bin) => [
                  bin.label,
                  `${bin.n} casos${bin.n ? ` · se cumplió ${bin.hit} (${Math.round((bin.rate ?? 0) * 100)}%)` : ""}`,
                ]),
                ...sources.map((source) => ["Fuente", source]),
              ],
              note: "Con la muestra de este corte no se puede decir que el modelo esté calibrado.",
            })}
          />
        </div>
      </header>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Parámetros que usa el código</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Vigentes el 5 oct 2026. Si esta lista no coincide con el cálculo, manda el código. No se dice que
          el modelo esté calibrado: la muestra publicada sigue bajo 500 partidos.
        </p>
        <ul className="mt-4 space-y-2 text-sm text-muted">
          <li>Nivel A: Dixon-Coles, vida media 120 días, ξ = ln(2)/120. Peso 0,5 de la fuerza de los cierres, elegido en 2025/26. Localía por liga ya medida. Sin temperatura. En los mismos 1.066 partidos, la distancia con signo (modelo − Shin) pasa de +{variant.distanciaAnterior.toFixed(3)} a +{variant.distancia.toFixed(3)}. Positiva: el mercado sigue siendo mejor. Una liga no entra ni sale hasta 300 partidos fuera de muestra. Ninguna llega: la Conference tiene 121.</li>
          <li>Ascendidos con menos de 6 partidos en su liga: el ajuste con la división anterior no superó al respaldo (RPS 0,255 contra 0,213 en 76 partidos). Esos partidos quedan en Nivel B o C.</li>
          <li>Selecciones: Elo de eloratings.net anterior al partido. La regresión es de la propia competición (Nations League, 702; amistosos, 2.372) y lleva temperatura 0,95, estimada antes de 2025. La localía va dentro de esa regresión. Si la sede publicada es neutral, la localía es 0. No se suma otro +100 de Elo encima. No se usa la tabla de liga.</li>
          <li>Nivel B: tabla de temporada. Contracción de 6 partidos si hay xG. Con 4 partidos previos de cada uno, mitad temporada y mitad serie de 120 días. Tope de local ±15 %.</li>
          <li>Nivel C: solo goles anteriores al inicio, vida media 120 días, contracción de 8 partidos hacia la media de la liga. 1,25 solo si la liga no tiene partidos previos. Localía de la liga, tope ±15 %. Si no hay media, local × 1,10 y visita × 0,91. Rho −0,08. Una tarjeta así no es una ficha completa.</li>
          <li>Cada gol esperado queda entre 0,20 y 4,00. La matriz va de 0-0 a 10-10 y se muestra hasta 6-6. Cuota justa entre 1,09 y 28,57.</li>
          <li>Probabilidad publicada: con al menos 3 casas vigentes, 80 % consenso y 20 % modelo, en log-odds. Sin consenso, el modelo. El 0,8 es fijo hasta estimarlo por liga. El modelo puro, el consenso y la publicada se guardan por separado.</li>
          <li>Valor por modelo: apagado. Solo se activaría si el Nivel A baja el RPS del consenso con 300 partidos de esa liga y el CLV de 100 marcas es positivo. Si modelo y consenso se separan más de 10 puntos, es revisar, nunca valor.</li>
          <li>Valor por casas: valor esperado del consenso, sin la casa juzgada, de 3 % o más, cuota vigente, al menos 3 casas restantes y más de 10 minutos para el inicio.</li>
          <li>Congelamiento: no hay más ajustes de parámetros hasta 500 predicciones evaluadas. Hoy hay {ev.predictionRows} filas guardadas y {ev.evaluated} evaluadas de {ev.goal}. La recolección de datos no se congela.</li>
          <li>Córners: solo contra una línea publicada. Sin línea, el mercado queda en blanco.</li>
          <li>Kings League, fútbol sala, playa y fútbol 7: sin probabilidad. Descanso menor a 4 días: ataque −3 %. Bajas, rotación y técnico: 0 mientras no estén en el corte. H2H: 15 % solo en Nivel B o C, y solo con 3 enfrentamientos en tres años.</li>
        </ul>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Registro del corte</h2>
        <ul className="mt-4 space-y-2 text-sm text-muted">
          <li>Agenda: Flashscore.co, contrastada con FotMob, 3 oct 2026, 16:19 Bogotá. 5.421 partidos. BeSoccer bloqueó la consulta.</li>
          <li>Corte Lite, {cut.readAtBogota}, hora de Bogotá. Hoy {cut.today} partidos. Mañana {cut.tomorrow}. Ayer {cut.yesterday} en la página de resultados. Cuotas 1X2 de Wplay: {cut.oddsWith1x2} de {cut.oddsListed}. Ninguna salió del margen 0 a 15 %.</li>
          <li>Fichas y forma: Flashscore, 3 oct 2026. 158 fichas de convocatoria. La forma de la agenda cubre casi todos los partidos y solo trae goles.</li>
          <li>Tablas: ESPN, 3 oct 2026, 07:09 UTC. 357 equipos y 234 partidos con ficha de temporada. xG y córners a favor: FotMob, mismo corte.</li>
          <li>Validación de www.flashscore.co: 5 oct 2026, superada en clasificaciones, estadísticas de ficha y cuotas. Feed de resultados: 10 de 10 marcadores. Cuotas por casa: 1X2 de Wplay idéntico a la Lite en 16 de 18 fichas.</li>
          <li>football-data.co.uk: legible el 5 oct 2026, 38 ligas con cuotas de cierre. El Nivel A usa esos cierres. Understat no está en el corte.</li>
          <li>Ampliación desde el corte del 6 oct: fichas de ayer, alineaciones del Combo, bajas de Transfermarkt y ClubElo. Se guardan con fuente y hora. No entran al cálculo hasta que el backtest lo apruebe.</li>
          {bundle.coveragePoints.map((point) => (
            <li key={point.id}>
              {point.label}: {point.read} leídos{point.expected != null ? ` de ${point.expected}` : ""}. {point.note}
            </li>
          ))}
          <li>Elo de selecciones: eloratings.net, 5 oct 2026. ClubElo respondió 502.</li>
          <li>Registro de predicciones: {ev.predictionRows} filas, {ev.evaluated} evaluadas de {ev.goal}. Una fila no se edita. Marcas de valor: {ev.valueMarks}. CLV promedio: {ev.clvMean == null ? "sin cierre" : Number(ev.clvMean).toFixed(3)}.</li>
          <li>Muestra del corte: {report.scored} partidos, Brier {report.brier ?? "—"}, RPS {report.rps ?? "—"}. Con menos de 500 no se dice que el modelo esté calibrado. Una tarjeta solo con goles previos es nivel C, no una ficha completa.</li>
        </ul>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Evaluación en vivo</h2>
        <ul className="mt-4 space-y-2 text-sm text-muted">
          <li>Partidos evaluados: {ev.evaluated} de {ev.goal}. Con menos de 500 no se dice que el modelo esté calibrado.</li>
          <li>
            Distancia de la publicada al mercado, con signo:{" "}
            {ev.distance == null ? "—" : `${ev.distance > 0 ? "+" : ""}${Number(ev.distance).toFixed(4)}`}
            . {ev.distanceRule}
          </li>
          <li>Marcas de valor: {ev.valueMarks}.</li>
          <li>CLV promedio: {ev.clvMean == null ? "sin cierre" : Number(ev.clvMean).toFixed(3)}.</li>
          <li>
            RPS en los mismos {ev.comparable} partidos: modelo{" "}
            {ev.rpsModel == null ? "—" : Number(ev.rpsModel).toFixed(4)}, publicada{" "}
            {ev.rpsPublished == null ? "—" : Number(ev.rpsPublished).toFixed(4)}, consenso{" "}
            {ev.rpsConsensus == null ? "—" : Number(ev.rpsConsensus).toFixed(4)}.
          </li>
        </ul>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Calibración del corte</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {report.rule} Partidos finalizados en el corte: {report.playedInCut}. Con historial previo
          suficiente: {report.scored}. Brier medio {report.brier ?? "—"}. RPS medio {report.rps ?? "—"}.
          Un Brier de 0 sería perfecto y uno cercano a 0,67 no mejora al azar. Con {report.scored}{" "}
          partidos no se puede decir que el modelo esté calibrado.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-subtle">
              <tr>
                <th className="py-2 pr-4">Probabilidad del favorito</th>
                <th className="py-2 pr-4">Casos</th>
                <th className="py-2">Se cumplió</th>
              </tr>
            </thead>
            <tbody>
              {report.bins.map((bin) => (
                <tr key={bin.label} className="border-t border-line">
                  <td className="py-2 pr-4">{bin.label}</td>
                  <td className="py-2 pr-4 tabular-nums">{bin.n}</td>
                  <td className="py-2 tabular-nums">{bin.n ? `${bin.hit} (${Math.round((bin.rate ?? 0) * 100)}%)` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Nivel A</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {bundle.dixonRule} Corte {bundle.dixonAt ?? "sin publicar"}. Vida media 120 días. El parámetro de
          regularización se eligió con la temporada 2025/26 y se midió, sin reajustarlo, en 2026/27 hasta
          el 4 oct.
        </p>
        <ul className="mt-4 space-y-2 text-sm text-muted">
          {bundle.dixon.length === 0 ? <li>El control de RPS todavía no tiene resultado.</li> : null}
          {bundle.dixon.map((row) => (
            <li key={row.league}>
              {row.league}: {row.published ? "publicado" : "no publicado"}
              {row.rpsModel != null
                ? ` · RPS modelo ${row.rpsModel.toFixed(3)} · Nivel B ${row.rpsBaseline?.toFixed(3) ?? "—"} · cierre ${row.rpsMarket?.toFixed(3) ?? "—"} · n ${row.n}`
                : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Fuentes de este corte</h2>
        <p className="mt-1 text-sm text-muted">Descargado {bundle.fetchedAt}.</p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filtrar fuente"
          aria-label="Filtrar fuente"
          className="mt-3 h-11 w-full max-w-xs rounded-lg bg-elevated px-3 text-sm outline-none"
        />
        <ul className="mt-4 space-y-2 text-sm text-muted">
          {sources.map((source) => (
            <li key={source}>{source}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Qué no se publica si no está</h2>
        <ul className="mt-4 space-y-2 text-sm text-muted">
          <li>Bajas, cambio de técnico y rotación: no están en el corte. El ajuste queda en cero.</li>
          <li>Elo de clubes: ClubElo respondió 502. En liga doméstica el Elo no entra al 1X2. No hay rating interno publicado.</li>
          <li>Understat: sin corte. El peso del xG por partido en el Nivel A queda en cero.</li>
          <li>Cuotas directas de Betano, BetPlay y Rushbet: el 4 oct el precio no vino en el HTML. No se citan.</li>
          <li>Sede de un amistoso: si la página no dice que es neutral, no se anula la localía de la regresión. No se inventa la sede.</li>
          <li>Clasificación en una eliminatoria: no hay marcador global. No se calcula.</li>
          <li>Córners: solo el promedio de saques a favor de FotMob, y solo contra una línea publicada.</li>
          <li>Un archivo cargado no verifica un dato. Si el partido no está en la agenda, o ya empezó, no hay probabilidad previa.</li>
        </ul>
      </section>
    </div>
  );
}
