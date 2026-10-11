import { analyzeCounts, type RecentAnalysis } from "./recent-math";
import { bogotaStamp } from "./clock";
import type { MatchReading } from "./dto";

export interface UploadGame {
  home: string;
  away: string;
  hg: number;
  ag: number;
  competition: string | null;
  cornersHome: number | null;
  cornersAway: number | null;
}

export interface UploadFixture {
  home: string;
  away: string;
  competition: string | null;
  kickoff: string | null;
  oddsHome: number | null;
  oddsDraw: number | null;
  oddsAway: number | null;
  selection: string | null;
}

export interface UploadFicha {
  home: string;
  away: string;
  competition: string | null;
  kickoff: string | null;
  analysis: RecentAnalysis | null;
  homeGames: number;
  awayGames: number;
  corners: string;
  oddsHome: number | null;
  oddsDraw: number | null;
  oddsAway: number | null;
  /** Equipo o empate marcado en un cupón, si el archivo lo trae. */
  selection: string | null;
  /** Liga, Copa o el nombre publicado. */
  kind: string;
  lookup: string;
  source: string[];
  /** Lectura publicada, si el cruce está en la agenda. */
  card?: MatchReading;
}

export interface UploadReport {
  fichas: UploadFicha[];
  rejected: string[];
  readGames: number;
  readFixtures: number;
  note: string;
}

function norm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cell(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function num(value: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(",", ".").replace(/[^\d.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function scorePair(value: string): [number, number] | null {
  const match = value.match(/(\d{1,2})\s*[-:]\s*(\d{1,2})/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function validScore(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 20;
}

function validName(name: string): boolean {
  const clean = name.trim();
  return clean.length >= 2 && clean.length <= 60 && !/^\d+$/.test(clean);
}

function headerIndex(headers: string[], aliases: string[]): number {
  const wanted = aliases.map(norm);
  return headers.findIndex((header) => wanted.includes(norm(header)));
}

function pick(row: unknown[], index: number): string {
  if (index < 0) return "";
  return cell(row[index]);
}

export function rowsToReport(table: unknown[][]): UploadReport {
  return rowsToReportTable(slipToTable(table));
}

function rowsToReportTable(table: unknown[][]): UploadReport {
  const rejected: string[] = [];
  if (table.length < 2) {
    return {
      fichas: [],
      rejected: ["El archivo no trae una tabla con encabezado y filas."],
      readGames: 0,
      readFixtures: 0,
      note: "Sin filas utilizables.",
    };
  }
  const headers = table[0].map((header) => cell(header));
  const homeI = headerIndex(headers, ["local", "home", "equipo local", "equipo1"]);
  const awayI = headerIndex(headers, ["visita", "visitante", "away", "equipo visita", "equipo2"]);
  const scoreI = headerIndex(headers, ["marcador", "resultado", "score"]);
  const hgI = headerIndex(headers, ["goles local", "gf local", "gol local", "hl", "hg"]);
  const agI = headerIndex(headers, ["goles visita", "goles visitante", "gf visita", "gol visita", "ha", "ag"]);
  const compI = headerIndex(headers, ["liga", "competicion", "competencia", "torneo", "competition"]);
  const chI = headerIndex(headers, ["corners local", "cornes local", "tiros de esquina local"]);
  const caI = headerIndex(headers, ["corners visita", "corners visitante", "tiros de esquina visita"]);
  const whenI = headerIndex(headers, ["fecha", "hora", "kickoff", "dia"]);
  const statusI = headerIndex(headers, ["estado", "condicion", "tipo", "jornada"]);
  const ohI = headerIndex(headers, ["cuota local", "cuota 1", "odds home"]);
  const odI = headerIndex(headers, ["cuota empate", "cuota x", "odds draw"]);
  const oaI = headerIndex(headers, ["cuota visita", "cuota 2", "odds away"]);
  const selI = headerIndex(headers, ["seleccion", "seleccion del cupon", "pick"]);
  const cuotaI = headerIndex(headers, ["cuota", "cuotas", "odds", "cuota publicada"]);
  const pjH = headerIndex(headers, ["pj local", "partidos local"]);
  const gfH = headerIndex(headers, ["gf local", "goles a favor local"]);
  const gcH = headerIndex(headers, ["gc local", "goles en contra local"]);
  const pjA = headerIndex(headers, ["pj visita", "partidos visita", "pj visitante"]);
  const gfA = headerIndex(headers, ["gf visita", "goles a favor visita", "gf visitante"]);
  const gcA = headerIndex(headers, ["gc visita", "goles en contra visita", "gc visitante"]);

  if (homeI < 0 || awayI < 0) {
    return {
      fichas: [],
      rejected: ["Faltan columnas de local y visita. Sirven: local, visita, marcador."],
      readGames: 0,
      readFixtures: 0,
      note: "Encabezado no reconocido.",
    };
  }

  const games: UploadGame[] = [];
  const fixtures: UploadFixture[] = [];
  const aggregates: UploadFicha[] = [];
  let section: string | null = null;

  table.slice(1).forEach((row, index) => {
    const line = index + 2;
    const home = pick(row, homeI);
    const away = pick(row, awayI);
    if (!away && home) {
      section = home;
      return;
    }
    if (!home && !away) return;
    if (!validName(home) || !validName(away)) {
      rejected.push(`Fila ${line}: nombre de equipo no válido.`);
      return;
    }
    if (norm(home) === norm(away)) {
      rejected.push(`Fila ${line}: local y visita son el mismo nombre.`);
      return;
    }
    const competition = pick(row, compI) || section;
    const status = norm(pick(row, statusI));
    const kickoff = writtenWhen(pick(row, whenI));
    const day = dayOf(kickoff);
    const saysPlayed = /final|jugado|termin|descanso/.test(status);
    const saysUpcoming = /por jugar|proximo|pendiente|programado|fixture|vs/.test(status);
    const aggregateN = [pjH, gfH, gcH, pjA, gfA, gcA].every((i) => i >= 0);
    if (aggregateN) {
      const counts = [pjH, gfH, gcH, pjA, gfA, gcA].map((i) => num(pick(row, i)));
      if (counts.some((value) => value == null || !Number.isInteger(value) || value < 0 || value > 80)) {
        rejected.push(`Fila ${line}: los totales de partidos o goles no son enteros válidos.`);
        return;
      }
      const [hn, hgf, hga, an, agf, aga] = counts as number[];
      if (hn < 1 || an < 1) {
        rejected.push(`Fila ${line}: hace falta al menos un partido de cada equipo.`);
        return;
      }
      const analysis = analyzeCounts(hn, hgf, hga, an, agf, aga);
      aggregates.push({
        home,
        away,
        competition,
        kickoff: pick(row, whenI) || null,
        analysis,
        homeGames: hn,
        awayGames: an,
        corners: "sin dato",
        oddsHome: odd(pick(row, ohI)),
        oddsDraw: odd(pick(row, odI)),
        oddsAway: odd(pick(row, oaI)),
        kind: kindOf(competition),
        selection: pick(row, selI) || null,
        lookup: "Totales escritos en el archivo. Se contrastan con el tablero antes de estimar.",
        source: [`Totales del archivo: ${home} ${hgf} a favor y ${hga} en contra en ${hn}; ${away} ${agf}-${aga} en ${an}.`],
      });
      return;
    }

    let hg: number | null = null;
    let ag: number | null = null;
    const fromScore = scorePair(pick(row, scoreI));
    if (fromScore) [hg, ag] = fromScore;
    if (hg == null) hg = num(pick(row, hgI));
    if (ag == null) ag = num(pick(row, agI));
    if (hg == null && ag == null) {
      if (saysPlayed || (day && day < bogotaStamp())) {
        rejected.push(`Fila ${line}: figura como ya jugado, o con fecha pasada, y no trae marcador.`);
        return;
      }
      fixtures.push({
        home,
        away,
        competition,
        kickoff,
        ...priced(home, away, pick(row, selI), odd(pick(row, cuotaI)), odd(pick(row, ohI)), odd(pick(row, odI)), odd(pick(row, oaI))),
      });
      return;
    }
    if ((saysUpcoming || (day && day > bogotaStamp())) && hg != null && ag != null) {
      rejected.push(`Fila ${line}: tiene marcador y a la vez parece un partido por jugar.`);
      return;
    }
    if (hg == null || ag == null || !validScore(hg) || !validScore(ag)) {
      rejected.push(`Fila ${line}: marcador no válido.`);
      return;
    }
    const ch = num(pick(row, chI));
    const ca = num(pick(row, caI));
    if ((ch != null && !validScore(ch)) || (ca != null && !validScore(ca))) {
      rejected.push(`Fila ${line}: córners fuera de rango. Esa fila entra sin córners.`);
    }
    games.push({
      home,
      away,
      hg,
      ag,
      competition,
      cornersHome: ch != null && validScore(ch) ? ch : null,
      cornersAway: ca != null && validScore(ca) ? ca : null,
    });
  });

  const fichas = aggregates.length > 0 ? aggregates.slice(0, 24) : fichasFromGames(fixtures, games);
  const shown = Math.max(aggregates.length, fixtures.length);
  return {
    fichas,
    rejected,
    readGames: games.length,
    readFixtures: fixtures.length + aggregates.length,
    note:
      fichas.length === 0
        ? "No hay partidos por jugar identificables. Las filas con marcador se toman como historial, no como partido a estimar."
        : shown > fichas.length
          ? `Se identificaron partidos por jugar. Se muestran ${fichas.length}.`
          : "Partidos por jugar identificados en el archivo. La ficha se completa con el tablero publicado cuando el cruce existe.",
  };
}

export function kindOf(competition: string | null): string {
  const name = norm(competition ?? "");
  if (!name) return "Sin competición en el archivo";
  if (/copa|champions|libertadores|sudamericana|\bcup\b/.test(name)) return "Copa";
  if (/liga|league|serie|primera|segunda|premier|bundesliga|campeonato/.test(name)) return "Liga";
  return "Competición";
}

function dayOf(value: string | null): string | null {
  if (!value) return null;
  const iso = value.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = value.match(/(\d{1,2})[-/](\d{1,2})[-/](20\d{2})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const months: Record<string, string> = {
    ene: "01",
    jan: "01",
    feb: "02",
    mar: "03",
    abr: "04",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    ago: "08",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dic: "12",
    dec: "12",
  };
  const named = value.toLowerCase().match(/(\d{1,2})\s+([a-záéíóú]{3})/);
  if (named && months[named[2].slice(0, 3)]) {
    return `2026-${months[named[2].slice(0, 3)]}-${named[1].padStart(2, "0")}`;
  }
  return null;
}

function writtenWhen(value: string): string | null {
  if (!value) return null;
  const day = dayOf(value);
  const time = value.match(/(\d{1,2}:\d{2})/);
  if (!day) return value;
  return time ? `${day} ${time[1]}` : day;
}

function priced(
  home: string,
  away: string,
  selection: string,
  single: number | null,
  homeOdd: number | null,
  drawOdd: number | null,
  awayOdd: number | null,
): { oddsHome: number | null; oddsDraw: number | null; oddsAway: number | null; selection: string | null } {
  const picked = selection.trim();
  if (single != null && picked) {
    const side = norm(picked);
    if (side === "empate" || side === "x" || side === "draw") drawOdd = single;
    else if (sameSide(picked, home)) homeOdd = single;
    else if (sameSide(picked, away)) awayOdd = single;
  }
  return { oddsHome: homeOdd, oddsDraw: drawOdd, oddsAway: awayOdd, selection: picked || null };
}

function sameSide(selection: string, team: string): boolean {
  const left = norm(selection);
  const right = norm(team);
  if (!left || !right) return false;
  return left === right || (left.length >= 4 && right.includes(left)) || (right.length >= 4 && left.includes(right));
}

function slipToTable(table: unknown[][]): unknown[][] {
  if (table.length < 2) return table;
  const headers = table[0].map((header) => cell(header));
  if (headerIndex(headers, ["local", "home", "equipo local", "equipo1"]) >= 0) return table;
  const eventI = headerIndex(headers, [
    "descripcion del evento",
    "descripcion",
    "evento",
    "partido",
    "encuentro",
  ]);
  if (eventI < 0) return table;
  const whenI = headerIndex(headers, ["fecha y hora del evento", "fecha y hora", "fecha", "hora", "kickoff"]);
  const scoreI = headerIndex(headers, ["resultado", "marcador", "score"]);
  const selI = headerIndex(headers, ["seleccion", "seleccion del cupon", "pick"]);
  const cuotaI = headerIndex(headers, ["cuotas", "cuota", "odds"]);
  const rows: unknown[][] = [["local", "visita", "marcador", "competicion", "estado", "fecha", "seleccion", "cuota"]];
  for (const row of table.slice(1)) {
    const event = pick(row, eventI);
    const teams = event.split(/\s+v(?:s\.?)?\s+/i);
    if (teams.length !== 2) continue;
    const result = pick(row, scoreI);
    const played = scorePair(result) != null;
    rows.push([
      teams[0].trim(),
      teams[1].trim(),
      played ? result : "",
      "",
      played ? "finalizado" : "por jugar",
      pick(row, whenI),
      pick(row, selI),
      pick(row, cuotaI),
    ]);
  }
  return rows.length > 1 ? rows : table;
}

function odd(value: string): number | null {
  const n = num(value);
  if (n == null || n <= 1 || n >= 100) return null;
  return Math.round(n * 1000) / 1000;
}

function same(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

function sideTotals(team: string, games: UploadGame[]) {
  let n = 0;
  let gf = 0;
  let ga = 0;
  let corners = 0;
  let cornerN = 0;
  const source: string[] = [];
  for (const game of games) {
    if (same(game.home, team)) {
      n += 1;
      gf += game.hg;
      ga += game.ag;
      if (game.cornersHome != null) {
        corners += game.cornersHome;
        cornerN += 1;
      }
      source.push(`${game.hg}-${game.ag} ante ${game.away}`);
    } else if (same(game.away, team)) {
      n += 1;
      gf += game.ag;
      ga += game.hg;
      if (game.cornersAway != null) {
        corners += game.cornersAway;
        cornerN += 1;
      }
      source.push(`${game.ag}-${game.hg} ante ${game.home}`);
    }
  }
  return { n, gf, ga, corners, cornerN, source };
}

function fichasFromGames(fixtures: UploadFixture[], games: UploadGame[]): UploadFicha[] {
  const targets = fixtures.length
    ? fixtures
    : uniquePairs(games).map((pair) => ({
        home: pair.home,
        away: pair.away,
        competition: pair.competition,
        kickoff: null,
        oddsHome: null,
        oddsDraw: null,
        oddsAway: null,
        selection: null,
      }));
  const fichas: UploadFicha[] = [];
  for (const fixture of targets) {
    if (fichas.length >= 24) break;
    const home = sideTotals(fixture.home, games);
    const away = sideTotals(fixture.away, games);
    const analysis = home.n > 0 && away.n > 0 ? analyzeCounts(home.n, home.gf, home.ga, away.n, away.gf, away.ga) : null;
    let corners = "sin dato";
    if (home.n > 0 && away.n > 0 && home.cornerN === home.n && away.cornerN === away.n) {
      const mean = home.corners / home.cornerN + away.corners / away.cornerN;
      corners = `media ${mean.toFixed(1)} en los partidos del archivo`;
    }
    fichas.push({
      home: fixture.home,
      away: fixture.away,
      competition: fixture.competition,
      kickoff: fixture.kickoff,
      analysis,
      homeGames: home.n,
      awayGames: away.n,
      corners,
      oddsHome: fixture.oddsHome,
      oddsDraw: fixture.oddsDraw,
      oddsAway: fixture.oddsAway,
      selection: fixture.selection,
      kind: kindOf(fixture.competition),
      lookup: "Aún sin cruce con el tablero.",
      source: [...home.source.slice(0, 6).map((line) => `${fixture.home}: ${line}`), ...away.source.slice(0, 6).map((line) => `${fixture.away}: ${line}`)],
    });
  }
  return fichas;
}

function uniquePairs(games: UploadGame[]): Array<{ home: string; away: string; competition: string | null }> {
  const seen = new Set<string>();
  const pairs: Array<{ home: string; away: string; competition: string | null }> = [];
  for (const game of games) {
    const key = [norm(game.home), norm(game.away)].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ home: game.home, away: game.away, competition: game.competition });
  }
  return pairs;
}
