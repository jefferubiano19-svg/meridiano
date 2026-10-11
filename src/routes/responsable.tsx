import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ExportBar } from "@/components/export-bar";
import { useSession } from "@/lib/store/session";

export const Route = createFileRoute("/responsable")({ component: ResponsiblePage });

function ResponsiblePage() {
  const startCoolingOff = useSession((s) => s.startCoolingOff);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-subtle">Juego responsable</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">El fútbol no es una inversión</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          Meridiano es una herramienta de análisis estadístico. No opera apuestas, no custodia fondos
          y no puede garantizar un resultado. Si decides apostar en otro sitio, asume que puedes
          perder todo el dinero.
        </p>
        <div className="mt-4">
          <ExportBar
            filename="meridiano-limites"
            title="Limites"
            build={() => ({
              name: "Limites",
              headers: ["Apartado", "Texto"],
              rows: [
                ["Principio", "Solo con dinero que no necesitas para rentas, comida o deudas."],
                ["Principio", "Nunca persigas pérdidas."],
                ["Principio", "Un valor esperado positivo es una media, no un resultado."],
                ["Principio", "No analices bajo efectos del alcohol ni para regular el ánimo."],
                ["Principio", "Si ocultan el hábito o piden prestado para jugar, páralo y pide ayuda."],
                ["España", "JugarBien / DGOJ — jugarbien.es"],
                ["México", "CONADIC. Teléfono de la vida: 800 911 2000."],
                ["Reino Unido e internacional", "BeGambleAware y Gamblers Anonymous."],
                ["Brasil", "CVV 188. Jogo responsável junto a operadores licenciados."],
              ],
              note: "Meridiano no opera apuestas y no garantiza un resultado.",
            })}
          />
        </div>
      </header>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Principios</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li>Solo con dinero que no necesitas para rentas, comida o deudas.</li>
          <li>Nunca persigas pérdidas. Una racha adversa no “se debe” recuperar.</li>
          <li>Un VE positivo es una media; la varianza puede durar cientos de partidos.</li>
          <li>No analices bajo efectos del alcohol ni para regular el ánimo.</li>
          <li>Si ocultan el hábito o piden prestado para jugar, páralo y pide ayuda.</li>
        </ul>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Señales de alarma</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li>— Pensar en apuestas la mayor parte del día.</li>
          <li>— Subir el stake para “recuperar”.</li>
          <li>— Mentir sobre el tiempo o el dinero dedicado.</li>
          <li>— Irritabilidad al intentar parar.</li>
          <li>— Usar el modelo como justificación para saltarse un límite.</li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => startCoolingOff(24)}>
            Pausar 24 h
          </Button>
          <Button variant="secondary" onClick={() => startCoolingOff(168)}>
            Pausar 7 días
          </Button>
          <Button asChild variant="outline">
            <Link to="/riesgo">Ir a límites</Link>
          </Button>
        </div>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Ayuda por país</h2>
        <ul className="mt-3 space-y-3 text-sm">
          <li>
            <p className="font-medium">España</p>
            <p className="text-muted">
              JugarBien / DGOJ —{" "}
              <a className="underline" href="https://www.jugarbien.es" target="_blank" rel="noreferrer">
                jugarbien.es
              </a>
            </p>
          </li>
          <li>
            <p className="font-medium">México</p>
            <p className="text-muted">
              CONADIC — orientación en adicciones. Teléfono de la vida: 800 911 2000.
            </p>
          </li>
          <li>
            <p className="font-medium">Reino Unido e internacional</p>
            <p className="text-muted">
              <a className="underline" href="https://www.begambleaware.org" target="_blank" rel="noreferrer">
                BeGambleAware
              </a>
              {" · "}
              <a className="underline" href="https://www.gamblersanonymous.org" target="_blank" rel="noreferrer">
                Gamblers Anonymous
              </a>
            </p>
          </li>
          <li>
            <p className="font-medium">Brasil</p>
            <p className="text-muted">CVV 188 — apoyo emocional. Jogo responsável junto a operadores licenciados.</p>
          </li>
        </ul>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-xl">Aviso legal breve</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Los contenidos se ofrecen con fines informativos y educativos. No constituyen asesoramiento
          financiero ni de apuestas, y la aplicación no coloca apuestas. Cuando hay una cuota de
          mercado, es un precio publicado por Wplay.co o, si ese partido no estaba en su tablero, por
          DraftKings a través de ESPN. Es una lectura de ese momento, no una línea en vivo. BetPlay no
          entregó su feed (Kambi respondió «No access»); no se muestra ningún precio de esa casa. Hay
          que contrastar la línea en el operador antes de decidir nada. El usuario es responsable de
          cumplir la ley de su jurisdicción, incluida la edad mínima legal.
        </p>
      </section>
    </div>
  );
}
