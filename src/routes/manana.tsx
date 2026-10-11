import { createFileRoute } from "@tanstack/react-router";
import { ComboList } from "@/components/match/combo-list";

export const Route = createFileRoute("/manana")({ component: MananaPage });

function MananaPage() {
  return <ComboList which="manana" />;
}
