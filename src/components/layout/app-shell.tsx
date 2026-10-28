import { Link, useRouterState } from "@tanstack/react-router";
import { StaleBanner } from "./stale-banner";
import {
  BookOpen,
  CalendarDays,
  History,
  Scale,
  Shield,
  SunMedium,
  Tickets,
  Trophy,
  Upload,
  Search,
  Calculator,
  Gem,
  Goal,
} from "lucide-react";
import { type ReactNode } from "react";
import { MeridianMark } from "@/components/brand/mark";
import { AgeGate } from "@/components/layout/age-gate";
import { shiftDay } from "@/lib/football/clock";
import { useAgendaToday } from "@/lib/football/use-today";
import { cn } from "@/lib/utils";
import { openWhatsAppShare } from "@/lib/preview-embedder-origin";

const NAV = [
  { to: "/", label: "Agenda", icon: CalendarDays, date: "" },
  { to: "/ligas", label: "Ligas", icon: Trophy, date: "" },
  { to: "/combinada", label: "Partido hoy", icon: Tickets, date: "hoy" },
  { to: "/manana", label: "Partido", icon: SunMedium, date: "manana" },
  { to: "/valor", label: "Valor del día", icon: Gem, date: "" },
  { to: "/rival", label: "El rival marca", icon: Goal, date: "" },
  { to: "/consulta", label: "Consulta", icon: History, date: "" },
  { to: "/buscar", label: "Partido", icon: Search, date: "" },
  { to: "/apuesta", label: "Apuesta", icon: Calculator, date: "" },
  { to: "/riesgo", label: "Riesgo", icon: Scale, date: "" },
  { to: "/modelo", label: "Modelo", icon: BookOpen, date: "" },
  { to: "/responsable", label: "Límites", icon: Shield, date: "" },
  { to: "/cargar", label: "Cargar", icon: Upload, date: "" },
] as const;

function shortDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const today = useAgendaToday();
  const dates: Record<string, string> = {
    hoy: shortDate(today),
    manana: shortDate(shiftDay(today, 1)),
  };

  return (
    <div className="min-h-dvh overflow-x-hidden bg-transparent text-fg">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-40 border-b border-[#b7c7b0]/30 bg-[#1c2219]/85 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-[1680px] px-5">
          <div className="flex h-14 items-center justify-between gap-4">
            <Link to="/" className="flex shrink-0 items-center gap-2.5">
              <MeridianMark className="size-8" />
              <div className="leading-tight">
                <p className="font-display text-lg tracking-tight">Meridiano</p>
                <p className="hidden text-[11px] uppercase tracking-[0.16em] text-subtle lg:block">
                  Probabilidades, no promesas
                </p>
              </div>
            </Link>
            <div className="flex shrink-0 items-center gap-2 text-xs text-subtle">
              <ShareLink />
              <span className="rounded-full bg-elevated px-2 py-1 text-[10px] uppercase tracking-wider text-muted">
                18+
              </span>
            </div>
          </div>
          <nav className="hidden grid-cols-10 gap-2 pb-3 lg:grid" aria-label="Principal">
            {NAV.map((item) => {
              const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              const when = item.date ? dates[item.date] : "";
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex h-12 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-full px-2 text-sm leading-none transition-colors",
                    active ? "bg-[#314033] text-fg ring-1 ring-[#b7c7b0]/50" : "text-muted hover:bg-elevated/80 hover:text-fg",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <item.icon className="size-4 shrink-0" />
                    {item.label}
                  </span>
                  {when ? <span className="text-[10px] text-subtle">{when}</span> : null}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-[1680px] px-5 pt-3 pb-24 md:pb-12">
        <StaleBanner />
        {children}
      </main>

      <nav
        className="fixed right-0 bottom-0 left-0 z-40 border-t border-[#b7c7b0]/30 bg-[#1c2219]/95 backdrop-blur-md lg:hidden"
        aria-label="Móvil"
      >
        <ul className="flex w-max min-w-full">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const when = item.date ? dates[item.date] : "";
            return (
              <li key={item.to} className="min-w-[4.6rem] flex-1">
                <Link
                  to={item.to}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-wide",
                    active ? "text-fg" : "text-subtle",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                  {when ? <span className="normal-case tracking-normal">{when}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <AgeGate />
    </div>
  );
}

function ShareLink() {
  return (
    <button
      type="button"
      onClick={() => openWhatsAppShare()}
      className="inline-flex h-8 items-center rounded-full bg-elevated px-2 text-[10px] uppercase tracking-wider text-muted"
    >
      WhatsApp
    </button>
  );
}
