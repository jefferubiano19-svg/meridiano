import type { PastRole, TeamRecord } from "@/lib/football/sheets";

function when(ts: number | null): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    timeZone: "America/Bogota",
  }).format(new Date(ts * 1000));
}

function roleLine(rows: PastRole[] | undefined): string | null {
  if (!rows || rows.length === 0) return null;
  return rows
    .map((row) => {
      const where = row.opponent ? ` ante ${row.opponent}` : "";
      const score = row.score ? ` (${row.score})` : "";
      return `${row.role === "titular" ? "Titular" : "Suplente"} en ${row.competition}${where}${score}`;
    })
    .join(" · ");
}

export function TeamRecordBlock({
  name,
  record,
  competition,
}: {
  name: string;
  record: TeamRecord;
  competition: string;
}) {
  const titulares = record.players.filter((player) => player.role === "titular");
  const suplentes = record.players.filter((player) => player.role === "suplente");

  return (
    <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <h3 className="font-display text-xl tracking-tight">{name}</h3>
      <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-subtle">
        Historial publicado
      </p>
      {record.history.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Flashscore no publicó partidos recientes de este equipo.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {record.history.map((match) => (
            <li key={match.id} className="flex items-baseline justify-between gap-3">
              <span>
                <span className="text-muted">{when(match.ts)} · {match.competition}</span>
                <span className="mt-0.5 block">
                  {match.home} {match.score ?? "–"} {match.away}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-5 text-[11px] uppercase tracking-[0.14em] text-subtle">
        {record.formation ? `${record.formation} · ` : ""}
        {competition}
      </p>
      {record.players.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Flashscore no publicó la alineación de este partido. No se completa con una convocatoria
          inventada.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          <PlayerList title="Titulares" players={titulares} roles={record.roles} />
          <PlayerList title="Suplentes" players={suplentes} roles={record.roles} />
        </div>
      )}
    </div>
  );
}

function PlayerList({
  title,
  players,
  roles,
}: {
  title: string;
  players: TeamRecord["players"];
  roles: TeamRecord["roles"];
}) {
  if (players.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      <ul className="mt-2 space-y-2">
        {players.map((player) => {
          const past = roleLine(roles[player.id]);
          return (
            <li key={player.id} className="text-sm">
              <span className="tabular-nums text-muted">{player.shirt ? `${player.shirt} ` : ""}</span>
              {player.name}
              {player.club ? <span className="text-muted"> · {player.club}</span> : null}
              {past ? <span className="mt-0.5 block text-xs text-subtle">{past}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
