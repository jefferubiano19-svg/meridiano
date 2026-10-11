import { MatchCard } from "@/components/match/match-card";
import { RateCard } from "@/components/match/rate-card";
import type { CombinadaLeg } from "@/lib/football/combinada";
import { getFixture } from "@/lib/football/fixtures";
import { getAnalysis } from "@/lib/football/model";
import { presentAnalysis, presentRecent } from "@/lib/football/publish";
import { levelCFor, recentFor } from "@/lib/football/recent";

function clock(iso: string): string {
  return new Intl.DateTimeFormat("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Bogota",
  }).format(new Date(iso));
}

export function CouponCard({ leg, index }: { leg: CombinadaLeg; index: number }) {
  const fixture = leg.fixtureId ? getFixture(leg.fixtureId) : undefined;
  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">Pata {index + 1}</p>
      {fixture ? (
        <MatchCard fixture={fixture} analysis={presentAnalysis(leg.id, getAnalysis(fixture), leg.kickoff)} />
      ) : (
        <RateCard
          href={`/agenda/${leg.id}`}
          kicker={leg.competition}
          when={clock(leg.kickoff)}
          home={leg.home}
          away={leg.away}
          analysis={(() => {
            const model = levelCFor(leg.id, leg.kickoff, leg.competition);
            return model ? presentRecent(leg.id, model) : null;
          })()}
          note={(() => {
            const recent = recentFor(leg.id);
            const base = `Pata ${leg.pick}. Tarjeta de nivel C. El detalle abre al pulsar la tarjeta.`;
            return recent?.home && recent.away
              ? `${base} ${recent.home.n} partidos del local y ${recent.away.n} de la visita.`
              : base;
          })()}
        />
      )}
    </div>
  );
}
