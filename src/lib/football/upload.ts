import { createServerFn } from "@tanstack/react-start";
import type { RecentAnalysis } from "./recent-math";
import { rowsToReport, kindOf, type UploadFicha, type UploadReport } from "./upload-sheet";

const MAX_BYTES = 2_500_000;

export const readUpload = createServerFn({ method: "POST" })
  .validator((input: { filename: string; mime: string; base64: string }) => ({
    filename: String(input.filename ?? "").slice(0, 180),
    mime: String(input.mime ?? ""),
    base64: String(input.base64 ?? ""),
  }))
  .handler(async ({ data }): Promise<UploadReport> => {
    const buf = Buffer.from(data.base64, "base64");
    if (buf.length < 8 || buf.length > MAX_BYTES) {
      return empty("El archivo tiene que pesar entre unos bytes y 2,5 MB.");
    }
    const name = data.filename.toLowerCase();
    const excel = name.endsWith(".xlsx");
    const csv = name.endsWith(".csv");
    if (!excel && !csv) {
      return empty("Por ahora solo se aceptan archivos Excel o CSV");
    }
    try {
      if (csv) return enrich(rowsToReport(tableFromText(buf.toString("utf8"))));
      const XLSX = await import("xlsx");
      const book = XLSX.read(buf, { type: "buffer" });
      const sheet = book.Sheets[book.SheetNames[0]];
      const table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
      return enrich(rowsToReport(table));
    } catch {
      return empty("No se pudo leer ese archivo. Revisa que sea Excel o CSV.");
    }
  });

function empty(note: string): UploadReport {
  return { fichas: [], rejected: [note], readGames: 0, readFixtures: 0, note };
}

function tokens(value: string): string[] {
  const stop = new Set(["fc", "cf", "sc", "ac", "cd", "club", "deportivo", "de", "del"]);
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token && !stop.has(token));
}

function sameName(a: string, b: string): boolean {
  const left = tokens(a).join(" ");
  const right = tokens(b).join(" ");
  return left.length > 0 && left === right;
}

async function enrich(report: UploadReport): Promise<UploadReport> {
  if (report.fichas.length === 0) return report;
  const { publishedFor } = await import("./published");
  const levelCFor = (id: string, kickoff: string, competition?: string) =>
    publishedFor(id, kickoff, competition ?? "") as unknown as RecentAnalysis | null;
  const { readingById } = await import("./page-data");
  const { readFileSync } = await import("node:fs");
  const dir = `${process.cwd()}/data`;
  const agenda = JSON.parse(readFileSync(`${dir}/agenda.json`, "utf8")) as {
    matches: [string, string, string, string, string, string, number | null, number | null, null, string | null][];
  };
  const history = JSON.parse(readFileSync(`${dir}/agenda-read.json`, "utf8")) as {
    byId: Record<
      string,
      {
        h: { games: [number | null, string, string | null, number, number][] } | null;
        a: { games: [number | null, string, string | null, number, number][] } | null;
      }
    >;
  };
  const fichas = report.fichas.map((ficha) => attach(ficha, agenda.matches, history.byId, levelCFor, readingById));
  return {
    ...report,
    fichas,
    note: "Se separan los partidos por jugar. Si el cruce existe en el tablero, la ficha usa esos resultados publicados y la liga o copa de esa línea. No se modifica el resto de Meridiano.",
  };
}

function attach(
  ficha: UploadFicha,
  matches: [string, string, string, string, string, string, number | null, number | null, null, string | null][],
  history: Record<
    string,
    {
      h: { games: [number | null, string, string | null, number, number][] } | null;
      a: { games: [number | null, string, string | null, number, number][] } | null;
    }
  >,
  levelCFor: (id: string, kickoff: string, competition?: string) => RecentAnalysis | null,
  readingById: (id: string) => UploadFicha["card"] | null,
): UploadFicha {
  let best: { score: number; flipped: boolean; row: (typeof matches)[number] } | null = null;
  let closed: (typeof matches)[number] | null = null;
  const fileDay = (ficha.kickoff ?? "").slice(0, 10);
  const fileComp = tokens(ficha.competition ?? "");
  for (const row of matches) {
    const direct = sameName(ficha.home, row[3]) && sameName(ficha.away, row[4]);
    const swapped = sameName(ficha.home, row[4]) && sameName(ficha.away, row[3]);
    if (!direct && !swapped) continue;
    if (row[5] !== "por-jugar") {
      closed = row;
      continue;
    }
    const flipped = !direct && swapped;
    let score = 2;
    const published = tokens(row[2]);
    if (fileComp.some((token) => published.includes(token))) score += 3;
    if (fileDay && row[1].startsWith(fileDay)) score += 2;
    if (!best || score > best.score || (score === best.score && row[1] < best.row[1])) {
      best = { score, row, flipped };
    }
  }
  if (!best) {
    return {
      ...ficha,
      analysis: null,
      lookup: closed
        ? "El partido ya empezó o terminó. No recibe probabilidad previa."
        : "No está en la agenda publicada, o el nombre no tiene equivalencia verificada. No se calcula con los números del archivo.",
    };
  }
  const row = best.row;
  const published = levelCFor(row[0], row[1], row[2]);
  const analysis = published && best.flipped ? swapSides(published) : published;
  const read = history[row[0]];
  const homeGames = best.flipped ? read?.a?.games : read?.h?.games;
  const awayGames = best.flipped ? read?.h?.games : read?.a?.games;
  const source = sourceLines(ficha.home, homeGames).concat(sourceLines(ficha.away, awayGames));
  return {
    ...ficha,
    competition: row[2],
    kickoff: row[1].slice(0, 16).replace("T", " "),
    kind: kindOf(row[2]),
    analysis,
    homeGames: homeGames?.length ?? 0,
    awayGames: awayGames?.length ?? 0,
    corners: "sin dato",
    lookup: `Por jugar · ${row[2]}. Cruce con el tablero, sin cambiar las otras secciones.`,
    source: source.length > 0 ? source : ficha.source,
    card: readingById(row[0]) ?? undefined,
  };
}

function swapSides(analysis: RecentAnalysis): RecentAnalysis {
  return {
    ...analysis,
    lambdaHome: analysis.lambdaAway,
    lambdaAway: analysis.lambdaHome,
    p1x2: { home: analysis.p1x2.away, draw: analysis.p1x2.draw, away: analysis.p1x2.home },
    fairHome: analysis.fairAway,
    fairAway: analysis.fairHome,
    mostLikely: { hg: analysis.mostLikely.ag, ag: analysis.mostLikely.hg, p: analysis.mostLikely.p },
    matrix: analysis.matrix.map((cell) => ({ hg: cell.ag, ag: cell.hg, p: cell.p })),
  };
}

function sourceLines(
  team: string,
  games: [number | null, string, string | null, number, number][] | undefined,
): string[] {
  if (!games) return [];
  return games.slice(0, 6).map((game) => `${team}: ${game[3]}-${game[4]} ante ${game[2] ?? "rival no publicado"} · ${game[1]}`);
}

function tableFromText(text: string): unknown[][] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : null;
  if (delimiter) {
    return lines.map((line) => splitDelimited(line, delimiter));
  }
  const rows: unknown[][] = [["local", "marcador", "visita", "competicion"]];
  for (const line of lines) {
    const match = line.match(/^(.+?)\s+(\d{1,2}\s*[-:]\s*\d{1,2})\s+(.+?)(?:\s{2,}(.+))?$/);
    if (!match) continue;
    rows.push([match[1].trim(), match[2].replace(/\s/g, ""), match[3].trim(), match[4]?.trim() ?? ""]);
  }
  return rows.length > 1 ? rows : [];
}

function splitDelimited(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((part) => part.trim().replace(/^"|"$/g, ""));
}
