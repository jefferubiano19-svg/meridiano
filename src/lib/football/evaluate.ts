export const EVAL_GOAL = 500;

export interface Way {
  home: number;
  draw: number;
  away: number;
}

type Actual = "home" | "draw" | "away";

interface PredictionRow {
  id?: string;
  matchId?: string;
  home?: string;
  away?: string;
  kickoff?: string;
  calculatedAt?: string;
  afterKickoff?: boolean;
  model?: Way | null;
  consensus?: Way | null;
  published?: Way | null;
  probabilities?: Way | null;
  shadow?: { wplay?: Way | null; xg?: Way | null; clubElo?: Way | null } | null;
}

interface AgendaRow {
  0: string;
  1: string;
  5: string;
  6: number | null;
  7: number | null;
}

interface Mark {
  closingOdds?: number | null;
  clv?: number | null;
}

function wayOf(value: unknown): Way | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Way;
  if (!(row.home > 0) || !(row.draw > 0) || !(row.away > 0)) return null;
  return { home: row.home, draw: row.draw, away: row.away };
}

export function rps(p: Way, actual: Actual): number {
  const home = actual === "home" ? 1 : 0;
  const draw = actual === "draw" ? 1 : 0;
  const cdfP1 = p.home;
  const cdfP2 = p.home + p.draw;
  return 0.5 * ((cdfP1 - home) ** 2 + (cdfP2 - (home + draw)) ** 2);
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function latestByMatch(records: PredictionRow[]): Map<string, PredictionRow> {
  const latest = new Map<string, PredictionRow>();
  for (const row of records) {
    if (!row.matchId || row.afterKickoff) continue;
    const kickoff = Date.parse(row.kickoff ?? "");
    const at = Date.parse(row.calculatedAt ?? "");
    if (!Number.isFinite(kickoff) || !Number.isFinite(at) || !(at < kickoff)) continue;
    const prev = latest.get(row.matchId);
    if (!prev || String(row.calculatedAt) > String(prev.calculatedAt)) latest.set(row.matchId, row);
  }
  return latest;
}

function shadowMean(rows: { shadowRps: Record<string, number | null>; published: number | null }[], key: string) {
  const pairs = rows.filter((row) => row.shadowRps[key] != null && row.published != null);
  return {
    n: pairs.length,
    rps: mean(pairs.map((row) => row.shadowRps[key] as number)),
    rpsPublished: mean(pairs.map((row) => row.published as number)),
  };
}

/** Evaluación en vivo. No edita predicciones. La sombra no se publica. */
export function evaluateRegistry(input: {
  records: PredictionRow[];
  matches: AgendaRow[];
  marks: Mark[];
  previous?: { rows?: unknown; hits?: unknown; matches?: unknown };
  at: string;
}) {
  const scores = new Map<string, [number, number]>();
  for (const row of input.matches) {
    if (row[5] !== "finalizado" || row[6] == null || row[7] == null) continue;
    scores.set(row[0], [row[6], row[7]]);
  }
  const byMatch = [];
  for (const [matchId, row] of latestByMatch(input.records)) {
    const score = scores.get(matchId);
    if (!score) continue;
    const actual: Actual = score[0] > score[1] ? "home" : score[0] === score[1] ? "draw" : "away";
    const model = wayOf(row.model);
    const published = wayOf(row.published) ?? wayOf(row.probabilities);
    const consensus = wayOf(row.consensus);
    const comparable = Boolean(model && published && consensus);
    const shadow = {
      wplay: wayOf(row.shadow?.wplay),
      xg: wayOf(row.shadow?.xg),
      clubElo: wayOf(row.shadow?.clubElo),
    };
    byMatch.push({
      matchId,
      rowId: row.id ?? null,
      home: row.home ?? null,
      away: row.away ?? null,
      kickoff: row.kickoff ?? null,
      score,
      actual,
      comparable,
      rpsModel: comparable && model ? rps(model, actual) : null,
      rpsPublished: comparable && published ? rps(published, actual) : null,
      rpsConsensus: comparable && consensus ? rps(consensus, actual) : null,
      distance: comparable && published && consensus ? rps(published, actual) - rps(consensus, actual) : null,
      shadowRps: {
        wplay: shadow.wplay ? rps(shadow.wplay, actual) : null,
        xg: shadow.xg ? rps(shadow.xg, actual) : null,
        clubElo: shadow.clubElo ? rps(shadow.clubElo, actual) : null,
      },
      publishedRps: published ? rps(published, actual) : null,
    });
  }
  const same = byMatch.filter((row) => row.comparable);
  const closed = input.marks.filter((mark) => typeof mark.clv === "number" && (mark.closingOdds ?? 0) > 1);
  const evaluated = byMatch.length;
  const compared = evaluated >= EVAL_GOAL;
  const shadowBlock = (key: "wplay" | "xg" | "clubElo") => {
    const item = shadowMean(byMatch, key);
    const better = item.rps != null && item.rpsPublished != null ? item.rps < item.rpsPublished : null;
    return { ...item, lowerRpsThanPublished: better };
  };
  return {
    readAtBogota: input.at,
    rule: "Se evalúa la última predicción guardada antes del inicio. La fila no se edita. El RPS del modelo, de la publicada y del consenso se calcula en los mismos partidos. Con menos de 500 no se dice que esté calibrado y ninguna sombra se publica.",
    goal: EVAL_GOAL,
    evaluated,
    predictionRows: input.records.length,
    comparable: same.length,
    rpsModel: mean(same.map((row) => row.rpsModel as number)),
    rpsPublished: mean(same.map((row) => row.rpsPublished as number)),
    rpsConsensus: mean(same.map((row) => row.rpsConsensus as number)),
    distance:
      same.length > 0
        ? (mean(same.map((row) => row.rpsPublished as number)) as number) -
          (mean(same.map((row) => row.rpsConsensus as number)) as number)
        : null,
    distanceRule: "RPS de la publicada menos RPS del consenso, en los mismos partidos. Negativa: la publicada fue mejor.",
    valueMarks: input.marks.length,
    valueMarksWithClose: closed.length,
    clvMean: mean(closed.map((mark) => mark.clv as number)),
    shadow: {
      published: false,
      compared,
      waiting: compared ? 0 : EVAL_GOAL - evaluated,
      rule: "Sección 9.2: una sombra solo podría reemplazar a la publicada si su RPS es menor en los mismos partidos. El corte no cambia la publicada.",
      wplay: compared ? shadowBlock("wplay") : null,
      xg: compared ? shadowBlock("xg") : null,
      clubElo: compared ? shadowBlock("clubElo") : null,
    },
    matches: input.previous?.matches ?? evaluated,
    hits: input.previous?.hits ?? null,
    rows: input.previous?.rows ?? [],
    byMatch,
  };
}
