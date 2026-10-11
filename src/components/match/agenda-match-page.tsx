import { Link } from "@tanstack/react-router";
import { AgendaFicha } from "@/components/match/agenda-ficha";
import { AGENDA } from "@/lib/football/agenda";

export function AgendaMatchPage({ id }: { id: string }) {
  const match = AGENDA.find((item) => item.id === id);
  if (!match) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted">Ese partido no está en el tablero de estos días.</p>
        <Link to="/" className="mt-4 inline-block text-sm underline">
          Volver a la agenda
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-muted underline">
        Agenda
      </Link>
      <AgendaFicha id={id} page />
    </div>
  );
}
