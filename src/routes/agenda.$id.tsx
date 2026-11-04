import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExportBar } from "@/components/export-bar";
import { MatchReadingCard } from "@/components/match/reading-block";
import { readingsSheet } from "@/lib/export/reading-rows";
import type { MatchReading } from "@/lib/football/dto";
import { loadFicha } from "@/lib/football/pages";

export const Route = createFileRoute("/agenda/$id")({ component: Page });

function Page() {
  const { id } = Route.useParams();
  const [match, setMatch] = useState<MatchReading | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setMatch(undefined);
    void loadFicha({ data: { id } })
      .then((next) => {
        if (live) setMatch(next);
      })
      .catch(() => {
        if (live) setMatch(null);
      });
    return () => {
      live = false;
    };
  }, [id]);
  if (match === undefined) return <p className="text-sm text-muted">Cargando la ficha…</p>;
  if (!match) return <p className="text-sm text-muted">Ese partido no está en la agenda publicada.</p>;
  return (
    <div className="space-y-4">
      <ExportBar
        filename={`meridiano-${match.home}-${match.away}`}
        title={`${match.home} — ${match.away}`}
        build={() => readingsSheet("Partido", [match], "Probabilidades publicadas por Meridiano. No es una recomendación.")}
      />
      <MatchReadingCard match={{ ...match, href: "" }} />
    </div>
  );
}
