import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MatchReadingCard } from "@/components/match/reading-block";
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
  return <MatchReadingCard match={{ ...match, href: "" }} />;
}
