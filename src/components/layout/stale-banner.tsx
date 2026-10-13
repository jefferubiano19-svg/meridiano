import { useEffect, useState } from "react";
import coverage from "../../../data/cut-coverage.json";

/** Horas sin corte a partir de las cuales se avisa. Entre cortes normales hay 12 h. */
const STALE_HOURS = 18;

/** Aviso cuando el último corte terminó hace más de 18 horas (se calcula en el navegador). */
export function StaleBanner() {
  const [hours, setHours] = useState<number | null>(null);
  useEffect(() => {
    const finished = Date.parse((coverage as { finishedAtBogota?: string }).finishedAtBogota ?? "");
    if (Number.isFinite(finished)) setHours((Date.now() - finished) / 3600000);
  }, []);
  if (hours == null || hours <= STALE_HOURS) return null;
  return (
    <p role="status" className="mb-6 rounded-lg bg-elevated px-4 py-3 text-sm text-warn">
      El último corte terminó hace {Math.floor(hours)} horas. Agenda, resultados y probabilidades pueden estar
      desactualizados hasta el próximo corte (00:15 o 12:00, hora de Bogotá).
    </p>
  );
}
