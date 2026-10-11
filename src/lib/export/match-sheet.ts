import type { ExportSheet } from "@/lib/export/download";
import { AGENDA, type AgendaMatch } from "@/lib/football/agenda";
import { findBook, BOOK_FETCHED_AT } from "@/lib/football/books";
import type { CombinadaLeg } from "@/lib/football/combinada";
import { confidenceCopy, formatKickoff, formatOdds, formatPct } from "@/lib/football/format";
import { getFixture } from "@/lib/football/fixtures";
import { flashscoreFor, flashscoreStatusLabel, FLASHSCORE_SOURCE } from "@/lib/football/flashscore";
import { getLeague } from "@/lib/football/leagues";
import type { PartidoHit } from "@/lib/football/lookup";
import { getAnalysis } from "@/lib/football/model";
import type { NamedFicha } from "@/lib/football/named";
import { presentAnalysis, presentRecent } from "@/lib/football/publish";
import { levelCFor, recentFor, type SideRead } from "@/lib/football/recent";
import type { RecentAnalysis } from "@/lib/football/recent-math";
import { sheetFor, type TeamRecord } from "@/lib/football/sheets";
import { getTeam } from "@/lib/football/teams";
import type { Fixture, MatchAnalysis, ScoreCell, Team, ThreeWay } from "@/lib/football/types";
import type { UploadFicha } from "@/lib/football/upload-sheet";

export const FICHA_HEADERS = [
  "Partido",
  "Competición",
  "Jornada",
  "Fecha",
  "Sede",
  "Estado",
  "Publicado",
  "Confianza",
  "1",
  "X",
  "2",
  "Justa 1",
  "Justa X",
  "Justa 2",
  "Total goles",
  "Más 2.5",
  "Justa más 2.5",
  "Menos 2.5",
  "Justa menos 2.5",
  "Ambos marcan",
  "Justa ambos",
  "No",
  "Justa no",
  "Córners",
  "Goles esperados",
  "Marcador modal",
  "Marcadores",
  "Doble oportunidad",
  "Hándicap 0",
  "Cuota de casa",
  "Valor",
  "Modelo",
  "Elo",
  "Local",
  "Visita",
  "Lectura",
  "Historial local",
  "Historial visita",
  "Convocatoria local",
  "Convocatoria visita",
  "Nota",
];

const CLEAR = new Set([
  "1",
  "X",
  "2",
  "Justa 1",
  "Justa X",
  "Justa 2",
  "Total goles",
  "Más 2.5",
  "Justa más 2.5",
  "Menos 2.5",
  "Justa menos 2.5",
  "Ambos marcan",
  "Justa ambos",
  "No",
  "Justa no",
  "Goles esperados",
  "Marcador modal",
  "Marcadores",
  "Doble oportunidad",
  "Hándicap 0",
]);

type Cell = string | number | null;
type Fields = Partial<Record<(typeof FICHA_HEADERS)[number], Cell>>;

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return formatPct(value);
}

function odd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return formatOdds(value);
}

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

function when(ts: number | null): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    timeZone: "America/Bogota",
  }).format(new Date(ts * 1000));
}

function rowFrom(fields: Fields): Cell[] {
  return FICHA_HEADERS.map((header) => fields[header] ?? "");
}

function blankNumbers(row: Cell[]): Cell[] {
  return row.map((cell, index) => (CLEAR.has(FICHA_HEADERS[index] ?? "") ? "" : cell));
}

function history(side: SideRead | null): string {
  if (!side || side.games.length === 0) return "Sin partidos recientes publicados.";
  const shown = side.games.slice(0, 8);
  const games = shown
    .map((game) => `${when(game.ts)} ${game.goalsFor}-${game.goalsAgainst} ante ${game.opponent ?? "rival no publicado"}`)
    .join(" · ");
  const more = side.games.length > shown.length ? ` Y ${side.games.length - shown.length} anteriores publicados.` : "";
  return `${side.gf} a favor y ${side.ga} en contra en ${side.n} partidos. ${games}.${more}`;
}

function sheetHistory(record: TeamRecord | undefined, fallback: SideRead | null): string {
  if (!record || record.history.length === 0) return history(fallback);
  const shown = record.history.slice(0, 8);
  const games = shown
    .map((match) => `${when(match.ts)} ${match.competition}: ${match.home} ${match.score ?? "-"} ${match.away}`)
    .join(" · ");
  const more = record.history.length > shown.length ? ` Y ${record.history.length - shown.length} anteriores publicados.` : "";
  return `${games}.${more}`;
}

function squad(record: TeamRecord | undefined): string {
  if (!record || record.players.length === 0) {
    return "Flashscore no publicó la alineación. No se completa con una convocatoria inventada.";
  }
  const line = (role: "titular" | "suplente") =>
    record.players
      .filter((player) => player.role === role)
      .map((player) => {
        const past = record.roles[player.id]?.[0];
        const pastText = past
          ? ` (${past.role === "titular" ? "titular" : "suplente"} en ${past.competition}${past.opponent ? ` ante ${past.opponent}` : ""})`
          : "";
        return `${player.shirt ? `${player.shirt} ` : ""}${player.name}${pastText}`;
      })
      .join(", ");
  const formation = record.formation ? `${record.formation}. ` : "";
  return `${formation}Titulares: ${line("titular") || "no publicados"}. Suplentes: ${line("suplente") || "no publicados"}.`;
}

function bookLine(home: string, away: string): string {
  const book = findBook(home, away);
  if (!book) return "Wplay no tenía este partido en el cupón leído. No se inventa una cuota.";
  const parts = [`${book.homeOdd.toFixed(2)} / ${book.drawOdd.toFixed(2)} / ${book.awayOdd.toFixed(2)}`];
  if (book.over25) parts.push(`más 2.5 ${book.over25.toFixed(2)}`);
  if (book.under25) parts.push(`menos 2.5 ${book.under25.toFixed(2)}`);
  if (book.bttsYes) parts.push(`ambos anotan ${book.bttsYes.toFixed(2)}`);
  if (book.bttsNo) parts.push(`no ${book.bttsNo.toFixed(2)}`);
  if (book.cornersOver && book.cornersLine) parts.push(`córners más ${book.cornersLine} a ${book.cornersOver.toFixed(2)}`);
  return `Wplay.co, leído ${book.wplayTime ?? BOOK_FETCHED_AT}: ${parts.join(" · ")}. No es una recomendación.`;
}

function scores(cells: ScoreCell[]): string {
  return [...cells]
    .filter((cell) => cell.hg <= 5 && cell.ag <= 5)
    .sort((a, b) => b.p - a.p)
    .slice(0, 6)
    .map((cell) => `${cell.hg}-${cell.ag} (${pct(cell.p)})`)
    .join(" · ");
}

function cornerFair(value: number): string {
  return (1 / Math.min(0.92, Math.max(0.035, value))).toFixed(2);
}

function cornersOf(analysis: MatchAnalysis): string {
  if (analysis.cornerHome == null || analysis.cornerAway == null) {
    return "NO DISPONIBLE. FotMob no publicó el dato de los dos.";
  }
  const total = (analysis.cornerHome + analysis.cornerAway).toFixed(1);
  const split = `${analysis.cornerHome.toFixed(1)}-${analysis.cornerAway.toFixed(1)}`;
  if (analysis.pCornersOver == null || analysis.pCornersUnder == null) {
    return `${total} (${split}). Sin línea publicada.`;
  }
  return `${total} (${split}). Más ${analysis.cornersLine} ${pct(analysis.pCornersOver)} justa ${cornerFair(analysis.pCornersOver)} · menos ${pct(analysis.pCornersUnder)} justa ${cornerFair(analysis.pCornersUnder)}.`;
}

function teamFacts(team: Team): string {
  const xg = team.xg != null && team.xgPlayed ? (team.xg / team.xgPlayed).toFixed(2) : "—";
  const xga = team.xga != null && team.xgPlayed ? (team.xga / team.xgPlayed).toFixed(2) : "—";
  const corners =
    team.corners != null && team.cornersPlayed ? (team.corners / team.cornersPlayed).toFixed(1) : "—";
  const home = team.home.gp ? `${team.home.gf}-${team.home.ga} en ${team.home.gp}` : "—";
  const away = team.away.gp ? `${team.away.gf}-${team.away.ga} en ${team.away.gp}` : "—";
  const source = [team.statsSource, team.eloSource].filter(Boolean).join(" · ");
  return `Elo ${team.elo != null ? team.elo : "sin fuente"}. Forma ${team.form || "—"}. PJ ${team.gp}. Pts ${team.pts}. GF/GC ${team.gf}/${team.ga}. xG/partido ${xg}. xGA/partido ${xga}. Córners/partido ${corners}. En casa ${home}. Fuera ${away}.${source ? ` ${source}` : ""}`;
}

function namedTeam(id: string): { name: string; team: Team | null } {
  try {
    const team = getTeam(id);
    return { name: team.name, team };
  } catch {
    return { name: id, team: null };
  }
}

function published(fixtureId: string): string {
  const live = flashscoreFor(fixtureId);
  if (!live) return "Este partido no salió en el tablero de Flashscore.co entre el 3 y el 10 de octubre.";
  const head =
    live.status === "por-jugar"
      ? "Por jugar. El marcador todavía no está publicado."
      : `${live.homeScore ?? "-"}-${live.awayScore ?? "-"} · ${flashscoreStatusLabel(live.status)}`;
  const extra: string[] = [];
  if (live.xgHome != null && live.xgAway != null) extra.push(`xG ${live.xgHome.toFixed(2)}-${live.xgAway.toFixed(2)}`);
  if (live.possessionHome) extra.push(`posesión ${live.possessionHome}-${live.possessionAway}`);
  if (live.shotsHome) extra.push(`remates ${live.shotsHome}-${live.shotsAway}`);
  if (live.cornersHome != null) extra.push(`córners ${live.cornersHome}-${live.cornersAway}`);
  const tail = extra.length ? ` ${extra.join(" · ")}.` : "";
  return `${head}${tail} Cifras publicadas en ${FLASHSCORE_SOURCE}. No sustituyen la estimación previa del modelo.`;
}

function doubleChance(p: ThreeWay): string {
  return `1X ${pct(p.home + p.draw)} · 12 ${pct(p.home + p.away)} · X2 ${pct(p.draw + p.away)}`;
}

function handicap(home: string, away: string, p: ThreeWay, fairHome?: number, fairAway?: number): string {
  const settled = p.home + p.away;
  if (settled <= 0) return "";
  const homeP = pct(p.home / settled);
  const awayP = pct(p.away / settled);
  if (fairHome == null || fairAway == null) return `${home} ${homeP} · ${away} ${awayP}`;
  return `${home} ${homeP} justa ${odd(fairHome)} · ${away} ${awayP} justa ${odd(fairAway)}`;
}

export function analysisRow(
  fixture: Fixture,
  analysis: MatchAnalysis,
  titlePrefix = "",
  extraNote = "",
): Cell[] {
  const home = namedTeam(fixture.homeId);
  const away = namedTeam(fixture.awayId);
  const linked = AGENDA.find((match) => match.fixtureId === fixture.id);
  const recent = linked ? recentFor(linked.id) : undefined;
  const sheet = sheetFor(fixture.id);
  const live = flashscoreFor(fixture.id);
  const agendaScore =
    linked && linked.homeScore != null && linked.awayScore != null ? `${linked.homeScore}-${linked.awayScore}` : "";
  const status = live
    ? live.status === "por-jugar"
      ? "Por jugar"
      : `${flashscoreStatusLabel(live.status)} · ${live.homeScore ?? "-"}-${live.awayScore ?? "-"}`
    : agendaScore
      ? agendaScore
      : "Por jugar";
  const modal = analysis.topScores?.[0] ?? analysis.mostLikelyScore;
  const settled = analysis.p1x2.home + analysis.p1x2.away;
  const noSheet = sheet
    ? ""
    : "Sin historial de Flashscore para este partido. No se inventa una convocatoria.";
  const note = [fixture.note, extraNote, noSheet].filter(Boolean).join(" ");
  const pure = analysis.modelPure
    ? `Modelo puro ${pct(analysis.modelPure.home)} / ${pct(analysis.modelPure.draw)} / ${pct(analysis.modelPure.away)}.`
    : "";
  const level =
    analysis.level === "C"
      ? "Tarjeta de nivel C. No es una ficha completa."
      : analysis.level
        ? `Nivel ${analysis.level}.`
        : "";
  return rowFrom({
    Partido: `${titlePrefix}${home.name} — ${away.name}`,
    Competición: fixture.competition || getLeague(fixture.leagueId).name,
    Jornada: fixture.round,
    Fecha: formatKickoff(fixture.kickoff, fixture.leagueId),
    Sede: fixture.venue,
    Estado: status,
    Publicado: published(fixture.id),
    Confianza: `${confidenceCopy(analysis.confidenceLabel)} · ${analysis.confidence}`,
    "1": pct(analysis.p1x2.home),
    X: pct(analysis.p1x2.draw),
    "2": pct(analysis.p1x2.away),
    "Justa 1": odd(analysis.fair.home),
    "Justa X": odd(analysis.fair.draw),
    "Justa 2": odd(analysis.fair.away),
    "Total goles": (analysis.lambdaHome + analysis.lambdaAway).toFixed(2),
    "Más 2.5": pct(analysis.pOver25),
    "Justa más 2.5": odd(analysis.fair.over25),
    "Menos 2.5": pct(analysis.pUnder25),
    "Justa menos 2.5": odd(analysis.fair.under25),
    "Ambos marcan": pct(analysis.pBttsYes),
    "Justa ambos": odd(analysis.fair.bttsYes),
    No: pct(analysis.pBttsNo),
    "Justa no": odd(analysis.fair.bttsNo),
    Córners: cornersOf(analysis),
    "Goles esperados": `${analysis.lambdaHome.toFixed(2)}-${analysis.lambdaAway.toFixed(2)}`,
    "Marcador modal": modal ? `${modal.hg}-${modal.ag} (${pct(modal.p)})` : "",
    Marcadores: scores(analysis.matrix),
    "Doble oportunidad": `1X ${pct(analysis.pDc1x)} justa ${odd(analysis.fair.dc1x)} · 12 ${pct(analysis.pDc12)} justa ${odd(analysis.fair.dc12)} · X2 ${pct(analysis.pDcX2)} justa ${odd(analysis.fair.dcx2)}`,
    "Hándicap 0":
      settled > 0
        ? `${home.name} ${pct(analysis.p1x2.home / settled)} justa ${odd(analysis.fair.dnbHome)} · ${away.name} ${pct(analysis.p1x2.away / settled)} justa ${odd(analysis.fair.dnbAway)}`
        : "",
    "Cuota de casa": bookLine(home.name, away.name),
    Valor:
      analysis.valueFlag === "valor" || analysis.valueFlag === "revisar"
        ? (analysis.valueNote ?? "Revisar: el modelo y el consenso difieren más de 10 puntos.")
        : "",
    Modelo: [level, pure].filter(Boolean).join(" "),
    Elo:
      analysis.eloHome != null && analysis.eloAway != null
        ? `Elo ${analysis.eloHome}-${analysis.eloAway}.${analysis.eloHomeWin != null ? ` Expectativa de victoria del local, sin empate, ${pct(analysis.eloHomeWin)}.` : ""}`
        : "Sin Elo de clubes en este corte. ClubElo no respondió y no se sustituye por un número propio.",
    Local: home.team ? teamFacts(home.team) : "Sin ficha de equipo en el corte.",
    Visita: away.team ? teamFacts(away.team) : "Sin ficha de equipo en el corte.",
    Lectura: [...analysis.reasons, analysis.inputs].filter(Boolean).join(" "),
    "Historial local": sheetHistory(sheet?.home, recent?.home ?? null),
    "Historial visita": sheetHistory(sheet?.away, recent?.away ?? null),
    "Convocatoria local": sheet ? squad(sheet.home) : "",
    "Convocatoria visita": sheet ? squad(sheet.away) : "",
    Nota: note,
  });
}

function recentFields(input: {
  title: string;
  competition: string;
  whenLabel: string;
  status: string;
  home: string;
  away: string;
  analysis: RecentAnalysis;
  note: string;
  homeSide: SideRead | null;
  awaySide: SideRead | null;
  cuota?: string;
}): Fields {
  const { analysis } = input;
  const lectura = `Sale de los últimos ${input.homeSide?.n ?? 0} partidos publicados del local y los últimos ${input.awaySide?.n ?? 0} de la visita. Una racha corta no se trata como tasa estable.`;
  return {
    Partido: input.title,
    Competición: input.competition,
    Fecha: input.whenLabel,
    Estado: input.status,
    Confianza: "",
    "1": pct(analysis.p1x2.home),
    X: pct(analysis.p1x2.draw),
    "2": pct(analysis.p1x2.away),
    "Justa 1": odd(analysis.fairHome),
    "Justa X": odd(analysis.fairDraw),
    "Justa 2": odd(analysis.fairAway),
    "Total goles": (analysis.lambdaHome + analysis.lambdaAway).toFixed(2),
    "Más 2.5": pct(analysis.pOver25),
    "Menos 2.5": pct(analysis.pUnder25),
    "Ambos marcan": pct(analysis.pBttsYes),
    No: pct(analysis.pBttsNo),
    Córners: "NO DISPONIBLE. No hay córners publicados de estos dos.",
    "Goles esperados": `${analysis.lambdaHome.toFixed(2)}-${analysis.lambdaAway.toFixed(2)}`,
    "Marcador modal": `${analysis.mostLikely.hg}-${analysis.mostLikely.ag} (${pct(analysis.mostLikely.p)})`,
    Marcadores: scores(analysis.matrix),
    "Doble oportunidad": doubleChance(analysis.p1x2),
    "Hándicap 0": handicap(input.home, input.away, analysis.p1x2),
    "Cuota de casa": input.cuota ?? bookLine(input.home, input.away),
    Modelo: "Tarjeta de nivel C. No es una ficha completa.",
    Elo: "Elo —",
    Lectura: lectura,
    "Historial local": history(input.homeSide),
    "Historial visita": history(input.awaySide),
    Nota: input.note,
  };
}

export function agendaFichaRow(match: AgendaMatch, titlePrefix = ""): Cell[] {
  const title = `${titlePrefix}${match.home} — ${match.away}`;
  const whenLabel = clock(match.kickoff);
  const score = match.homeScore == null || match.awayScore == null ? "" : `${match.homeScore}-${match.awayScore}`;
  const status = `${flashscoreStatusLabel(match.status)}${score ? ` · ${score}` : ""}`;
  const recent = recentFor(match.id);
  const started = match.status !== "por-jugar" || Date.parse(match.kickoff) <= Date.now();
  if (!started && match.fixtureId) {
    const fixture = getFixture(match.fixtureId);
    if (fixture) return analysisRow(fixture, presentAnalysis(match.id, getAnalysis(fixture), match.kickoff), titlePrefix);
  }
  const raw = levelCFor(match.id, match.kickoff, match.competition);
  const analysis = raw ? presentRecent(match.id, raw) : null;
  if (!analysis) {
    return blankNumbers(
      rowFrom({
        Partido: title,
        Competición: match.competition,
        Fecha: whenLabel,
        Estado: status,
        Córners: "NO DISPONIBLE",
        "Cuota de casa": bookLine(match.home, match.away),
        "Historial local": history(recent?.home ?? null),
        "Historial visita": history(recent?.away ?? null),
        Nota: started
          ? "El partido ya empezó. Sin probabilidad previa."
          : "NO DISPONIBLE. No hay partidos previos publicados de los dos.",
      }),
    );
  }
  const note = raw?.level === "A"
    ? "Tarjeta de nivel A: Dixon-Coles de la liga, ajustado antes del partido."
    : started
    ? `Tarjeta de nivel ${raw?.level ?? "C"}, calculada después del partido. ${recent?.home?.n ?? 0} partidos del local y ${recent?.away?.n ?? 0} de la visita, anteriores al inicio.`
    : `Tarjeta de nivel ${raw?.level ?? "C"}. No es una ficha completa. ${recent?.home?.n ?? 0} partidos del local y ${recent?.away?.n ?? 0} de la visita, anteriores al inicio.`;
  return rowFrom(
    recentFields({
      title,
      competition: match.competition,
      whenLabel,
      status,
      home: match.home,
      away: match.away,
      analysis,
      note,
      homeSide: recent?.home ?? null,
      awaySide: recent?.away ?? null,
    }),
  );
}

export function comboFichaRow(leg: CombinadaLeg, index: number): Cell[] {
  const prefix = `Pata ${index + 1} · ${leg.pick} · `;
  const match = AGENDA.find((item) => item.id === leg.id);
  if (match) return agendaFichaRow(match, prefix);
  const fixture = leg.fixtureId ? getFixture(leg.fixtureId) : undefined;
  if (fixture) return analysisRow(fixture, presentAnalysis(leg.id, getAnalysis(fixture), leg.kickoff), prefix);
  return rowFrom({
    Partido: `${prefix}${leg.home} — ${leg.away}`,
    Competición: leg.competition,
    Fecha: leg.kickoff,
    Nota: "Esa pata no está en la agenda ni en una ficha de liga.",
  });
}

export function hitFichaRow(hit: PartidoHit): Cell[] {
  if (hit.kind === "fixture") {
    const fixture = getFixture(hit.id);
    if (!fixture) {
      return rowFrom({
        Partido: `${hit.home} — ${hit.away}`,
        Competición: hit.competition,
        Fecha: hit.day,
        Nota: "Ese partido no está en el corpus.",
      });
    }
    return analysisRow(fixture, getAnalysis(fixture));
  }
  const match = AGENDA.find((item) => item.id === hit.id);
  if (match) return agendaFichaRow(match);
  return rowFrom({
    Partido: `${hit.home} — ${hit.away}`,
    Competición: hit.competition,
    Fecha: hit.day,
    Nota: "Ese cruce no está en la agenda publicada.",
  });
}

export function namedFichaRow(ficha: NamedFicha): Cell[] {
  if (ficha.kind === "modelo") return analysisRow(ficha.fixture, ficha.analysis, "", ficha.note);
  if (ficha.kind === "vacio") return rowFrom({ Partido: "Sin ficha", Nota: ficha.note });
  return rowFrom(
    recentFields({
      title: `${ficha.home} — ${ficha.away}`,
      competition: ficha.competition,
      whenLabel: clock(ficha.when),
      status: "Por jugar",
      home: ficha.home,
      away: ficha.away,
      analysis: ficha.analysis,
      note: ficha.note,
      homeSide: ficha.homeSide,
      awaySide: ficha.awaySide,
      cuota: bookLine(ficha.home, ficha.away),
    }),
  );
}

function fileOdds(ficha: UploadFicha): string {
  const show = (n: number) => {
    const text = n.toFixed(3);
    return text.endsWith("0") ? n.toFixed(2) : text;
  };
  const parts = [
    ficha.oddsHome != null ? `local ${show(ficha.oddsHome)}` : "",
    ficha.oddsDraw != null ? `empate ${show(ficha.oddsDraw)}` : "",
    ficha.oddsAway != null ? `visita ${show(ficha.oddsAway)}` : "",
  ].filter(Boolean);
  if (!parts.length) return "Sin cuota de casa en el archivo.";
  return `Dato del archivo, no verificado: ${parts.join(" · ")}. No entra al cálculo.`;
}

function uploadHistory(team: string, source: string[]): string {
  const lines = source.filter((line) => line.startsWith(`${team}:`));
  if (!lines.length) return "Sin partidos leídos de este equipo en el archivo.";
  return lines.join(" · ");
}

export function uploadFichaRow(ficha: UploadFicha): Cell[] {
  const note = [
    ficha.lookup,
    ficha.selection ? `Selección leída: ${ficha.selection}.` : "",
    "El número del archivo no entra al cálculo.",
  ]
    .filter(Boolean)
    .join(" ");
  const shared = {
    Partido: `${ficha.home} — ${ficha.away}`,
    Competición: ficha.competition ?? "Competición no publicada",
    Fecha: ficha.kickoff ?? "",
    Estado: ficha.kind,
    Córners: "NO DISPONIBLE. El archivo no entra al cálculo.",
    "Cuota de casa": fileOdds(ficha),
    "Historial local": uploadHistory(ficha.home, ficha.source),
    "Historial visita": uploadHistory(ficha.away, ficha.source),
    Nota: note,
  };
  if (!ficha.analysis) return blankNumbers(rowFrom(shared));
  return rowFrom({
    ...recentFields({
      title: `${ficha.home} — ${ficha.away}`,
      competition: ficha.competition ?? "Competición no publicada",
      whenLabel: ficha.kickoff ?? "",
      status: ficha.kind,
      home: ficha.home,
      away: ficha.away,
      analysis: ficha.analysis,
      note,
      homeSide: null,
      awaySide: null,
      cuota: fileOdds(ficha),
    }),
    "Historial local": uploadHistory(ficha.home, ficha.source),
    "Historial visita": uploadHistory(ficha.away, ficha.source),
    Córners: "NO DISPONIBLE. El archivo no entra al cálculo.",
    Lectura: `${ficha.homeGames} partidos leídos del local y ${ficha.awayGames} de la visita. ${note}`,
  });
}

export function fixturesSheet(fixtures: Fixture[], note: string): ExportSheet {
  return {
    name: "Fichas",
    headers: FICHA_HEADERS,
    rows: fixtures.map((fixture) => {
      const linked = AGENDA.find((match) => match.fixtureId === fixture.id);
      const analysis = linked ? presentAnalysis(linked.id, getAnalysis(fixture), linked.kickoff) : getAnalysis(fixture);
      return analysisRow(fixture, analysis);
    }),
    note,
  };
}

export function agendaSheet(matches: AgendaMatch[], note: string): ExportSheet {
  return {
    name: "Fichas",
    headers: FICHA_HEADERS,
    rows: matches.map((match) => agendaFichaRow(match)),
    note,
  };
}

export function oneFixtureSheet(id: string): ExportSheet {
  const fixture = getFixture(id);
  if (!fixture) return { name: "Fichas", headers: ["Aviso"], rows: [["Ese partido no está en el corpus."]] };
  return fixturesSheet([fixture], "Ficha calculada con el corte publicado. No es una promesa de resultado.");
}
