import { MISSING, type MatchReading, type Way } from "@/lib/football/dto";
import type { ExportSheet } from "./download";

const SIDE = { home: "local", draw: "empate", away: "visita" } as const;

function cell(way: Way | null): string {
  if (!way) return MISSING;
  return `${way.home.toFixed(4)} / ${way.draw.toFixed(4)} / ${way.away.toFixed(4)}`;
}

export function readingsSheet(title: string, rows: MatchReading[], note: string): ExportSheet {
  return {
    name: title,
    headers: [
      "Local",
      "Visita",
      "Competición",
      "Inicio",
      "Publicada",
      "Modelo",
      "Consenso",
      "Nivel",
      "Confianza",
      "Revisar",
      "Marca",
      "Casa",
      "Cuota",
      "Lectura",
    ],
    rows: rows.map((row) => [
      row.home,
      row.away,
      row.competition,
      row.kickoff,
      cell(row.published),
      cell(row.model),
      cell(row.consensus),
      row.level || MISSING,
      row.confidence || "baja",
      row.revisar ? "revisar" : "",
      row.value ? `valor · ${SIDE[row.value.side]}` : "Sin marca de valor",
      row.value?.house || "",
      row.value ? row.value.odds : "",
      row.value?.readAt || "",
    ]),
    note,
  };
}
