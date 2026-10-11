import { createFileRoute } from "@tanstack/react-router";
import { ComboList } from "@/components/match/combo-list";

export const Route = createFileRoute("/combinada")({ component: CombinadaPage });

function CombinadaPage() {
  return <ComboList which="hoy" />;
}
