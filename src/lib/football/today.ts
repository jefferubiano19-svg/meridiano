import { formatPct } from "./format";
import type { FlashscoreMatch } from "./flashscore";
import type { MatchAnalysis } from "./types";
import type { PastMatch, TeamRecord } from "./sheets";

export { agendaToday, agendaTomorrow, bogotaDay, bogotaStamp, shiftDay } from "./clock";

function tally(history: PastMatch[]): { w: number; d: number; l: number; n: number; competitions: string[] } {
  let w = 0;
  let d = 0;
  let l = 0;
  let n = 0;
  const competitions = new Set<string>();
  for (const match of history) {
    if (!match.score || (match.side !== "home" && match.side !== "away")) continue;
    const [homeGoals, awayGoals] = match.score.split("–").map((part) => Number(part));
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
    const goalsFor = match.side === "home" ? homeGoals : awayGoals;
    const goalsAgainst = match.side === "home" ? awayGoals : homeGoals;
    n += 1;
    if (goalsFor > goalsAgainst) w += 1;
    else if (goalsFor === goalsAgainst) d += 1;
    else l += 1;
    competitions.add(match.competition);
  }
  return { w, d, l, n, competitions: [...competitions] };
}

function formSentence(name: string, record: TeamRecord): string | null {
  const row = tally(record.history);
  if (row.n === 0) return null;
  const where = row.competitions.length ? ` en ${row.competitions.join(", ")}` : "";
  return `${name}: ${row.w} victorias, ${row.d} empates y ${row.l} derrotas en ${row.n} partidos publicados${where}.`;
}

export function todayReading(
  homeName: string,
  awayName: string,
  analysis: MatchAnalysis,
  live: FlashscoreMatch | undefined,
  home: TeamRecord | undefined,
  away: TeamRecord | undefined,
): string | null {
  const lines: string[] = [];
  if (home) {
    const sentence = formSentence(homeName, home);
    if (sentence) lines.push(sentence);
  }
  if (away) {
    const sentence = formSentence(awayName, away);
    if (sentence) lines.push(sentence);
  }
  if (home?.formation || away?.formation) {
    const bits = [
      home?.formation ? `${homeName} ${home.formation}` : null,
      away?.formation ? `${awayName} ${away.formation}` : null,
    ].filter(Boolean);
    lines.push(`Alineación publicada por Flashscore: ${bits.join(" · ")}.`);
  } else if (home && away && home.players.length === 0 && away.players.length === 0) {
    lines.push("Flashscore todavía no publicó la alineación de este partido.");
  }
  if (!live || live.status === "por-jugar") {
    lines.push(
      `Estimación previa: ${formatPct(analysis.p1x2.home, 0)} local, ${formatPct(analysis.p1x2.draw, 0)} empate, ${formatPct(analysis.p1x2.away, 0)} visita. No es un pronóstico cerrado.`,
    );
  } else if (live.xgHome != null && live.xgAway != null) {
    lines.push(
      `xG de este partido en Flashscore: ${live.xgHome.toFixed(2)}–${live.xgAway.toFixed(2)}. La barra de probabilidades es la estimación previa, no el marcador.`,
    );
  }
  return lines.length ? lines.join(" ") : null;
}

export function recordSentence(name: string, record: TeamRecord): string | null {
  return formSentence(name, record);
}
