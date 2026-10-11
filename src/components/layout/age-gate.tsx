import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/store/session";

export function AgeGate() {
  const confirmAge = useSession((s) => s.confirmAge);

  return (
    <div
      data-age-gate
      className="fixed inset-x-0 bottom-16 z-50 border-t border-border bg-surface px-4 py-2 shadow-[var(--shadow-border)] lg:bottom-0"
    >
      <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Análisis para mayores de 18. No es una casa de apuestas ni garantiza resultados.
        </p>
        <Button type="button" variant="secondary" data-age-accept onClick={() => confirmAge()}>
          Tengo 18 años o más
        </Button>
      </div>
    </div>
  );
}