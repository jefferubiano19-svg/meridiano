import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ProbabilityBar } from "@/components/match/probability-bar";
import { ReadingBlock } from "@/components/match/reading-block";
import { ExportBar } from "@/components/export-bar";
import { ScoreMatrix } from "@/components/match/score-matrix";
import { readingsSheet } from "@/lib/export/reading-rows";
import { formatOdds, formatPct } from "@/lib/football/format";
import type { UploadFicha, UploadReport } from "@/lib/football/upload-sheet";
import { readUpload } from "@/lib/football/upload";

export const Route = createFileRoute("/cargar")({ component: CargarPage });

function CargarPage() {
  const [report, setReport] = useState<UploadReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  async function onFile(file: File | null) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".csv")) {
      setReport(null);
      setError("Por ahora solo se aceptan archivos Excel o CSV");
      return;
    }
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const base64 = await fileToBase64(file);
      const result = await readUpload({
        data: { filename: file.name, mime: file.type, base64 },
      });
      setReport(result);
    } catch {
      setError("No se pudo procesar el archivo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Archivo del usuario</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Cargar partidos</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Sube un Excel (.xlsx) o un CSV. Se separan los partidos por jugar de los
          que ya tienen marcador, y se lee la liga o la copa. Con esos nombres se busca el partido
          en el mismo tablero de los demás. La ficha usa esos resultados publicados. Si no aparece,
          no se inventa. El resto de ítems no cambia.
        </p>
        <div className="mt-4">
          <ExportBar
            filename="meridiano-cargar"
            title="Cargar"
            build={() =>
              readingsSheet(
                "Fichas",
                (report?.fichas ?? []).flatMap((ficha) => (ficha.card ? [ficha.card] : [])),
                report?.note ?? "Todavía no hay un archivo cargado. El número del archivo no entra al cálculo.",
              )
            }
          />
        </div>
      </header>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <p className="text-sm text-muted">
          Columnas de la plantilla: local, visita, competición y fecha. También entiende marcador
          y cuotas si vienen en el archivo.
        </p>
        <a
          href="/plantilla-partidos.csv"
          download="plantilla-partidos.csv"
          className="mt-4 inline-flex h-11 items-center rounded-full bg-elevated px-4 text-sm text-fg"
        >
          Descargar plantilla CSV
        </a>
        <label className="mt-4 flex h-12 cursor-pointer items-center justify-center rounded-full bg-accent px-4 text-sm text-accent-fg">
          {busy ? "Leyendo…" : "Elegir archivo"}
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={busy}
            onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </section>

      {report ? (
        <section className="space-y-3">
          <p className="text-sm text-muted">
            {report.note} Filas de resultados: {report.readGames}. Partidos a estimar:{" "}
            {report.readFixtures || report.fichas.length}.
          </p>
          {report.rejected.length > 0 ? (
            <ul className="space-y-1 text-sm text-muted">
              {report.rejected.slice(0, 20).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrar equipo"
            aria-label="Filtrar equipo"
            className="h-11 w-full max-w-xs rounded-lg bg-elevated px-3 text-sm outline-none"
          />
          <div className="grid gap-4">
            {report.fichas
              .filter((ficha) =>
                `${ficha.home} ${ficha.away} ${ficha.competition ?? ""}`
                  .toLowerCase()
                  .includes(query.trim().toLowerCase()),
              )
              .map((ficha) => (
              <FichaCard key={`${ficha.home}-${ficha.away}-${ficha.kickoff ?? ""}`} ficha={ficha} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function FichaCard({ ficha }: { ficha: UploadFicha }) {
  const analysis = ficha.analysis;
  return (
    <article className="space-y-4 rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">
        {ficha.kind} · {ficha.competition ?? "Competición no publicada"}
        {ficha.kickoff ? ` · ${ficha.kickoff}` : ""}
      </p>
      <h2 className="font-display text-2xl tracking-tight">
        {ficha.home} — {ficha.away}
      </h2>
      <p className="text-xs text-subtle">{ficha.lookup}</p>
      {ficha.card ? <ReadingBlock match={ficha.card} /> : null}
      {ficha.selection ? (
        <p className="text-sm">
          Selección leída: {ficha.selection}
          {publishedOdds(ficha) ? ` · dato del archivo, no verificado ${publishedOdds(ficha)}` : ""}
        </p>
      ) : null}
      <p className="text-xs text-subtle">
        {ficha.homeGames} partidos leídos del local y {ficha.awayGames} del visita.
      </p>
      {analysis ? (
        <>
          <ProbabilityBar
            p={analysis.p1x2}
            fair={{ home: analysis.fairHome, draw: analysis.fairDraw, away: analysis.fairAway }}
          />
          <div className="grid grid-cols-3 gap-2">
            <Cell
              k="Total goles"
              v={(analysis.lambdaHome + analysis.lambdaAway).toFixed(2)}
              d={`Más 2.5 ${formatPct(analysis.pOver25, 0)}`}
            />
            <Cell k="Ambos marcan" v={formatPct(analysis.pBttsYes, 0)} d={`No ${formatPct(analysis.pBttsNo, 0)}`} />
            <Cell k="Córners" v="NO DISPONIBLE" d="El archivo no entra al cálculo" />
          </div>
          <p className="text-sm text-muted">
            Cuota justa {formatOdds(analysis.fairHome)} / {formatOdds(analysis.fairDraw)} /{" "}
            {formatOdds(analysis.fairAway)}
            {publishedOdds(ficha) ? "" : " · sin cuota de casa en el archivo"}. Marcador modal {analysis.mostLikely.hg}-
            {analysis.mostLikely.ag}. No es un pronóstico cerrado.
          </p>
          <ScoreMatrix cells={analysis.matrix} highlight={analysis.mostLikely} />
        </>
      ) : (
        <p className="text-sm text-muted">
          {ficha.lookup || "Sin estimación. El archivo no reemplaza un dato verificado."}
        </p>
      )}
      {ficha.source.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted">
          {ficha.source.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function publishedOdds(ficha: UploadFicha): string {
  const show = (n: number) => {
    const text = n.toFixed(3);
    return text.endsWith("0") ? n.toFixed(2) : text;
  };
  const parts = [
    ficha.oddsHome != null ? `local ${show(ficha.oddsHome)}` : "",
    ficha.oddsDraw != null ? `empate ${show(ficha.oddsDraw)}` : "",
    ficha.oddsAway != null ? `visita ${show(ficha.oddsAway)}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function Cell({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div className="rounded-lg bg-elevated px-2 py-2">
      <p className="text-[10px] uppercase leading-tight text-subtle">{k}</p>
      <p className="mt-1 text-sm font-medium tabular-nums">{v}</p>
      <p className="text-[11px] text-muted">{d}</p>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("lectura"));
    reader.readAsDataURL(file);
  });
}
