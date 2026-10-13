import type { AgendaMatch } from "@/lib/football/agenda";
import { getFixture } from "@/lib/football/fixtures";
import { getAnalysis } from "@/lib/football/model";
import { presentAnalysis } from "@/lib/football/publish";
import { publishedFor } from "@/lib/football/published";
import type { ThreeWay } from "@/lib/football/types";

export interface SettledCall {
  label: string;
  hit: boolean;
}

export interface HitRead {
  calls: SettledCall[];
  hits: number;
  total: number;
}

interface PublishedRead {
  p1x2: ThreeWay;
  pOver25: number;
  pBttsYes: number;
  modal: { hg: number; ag: number };
}

function favorite(p: ThreeWay): "home" | "draw" | "away" | null {
  const ranked: ["home" | "draw" | "away", number][] = [
    ["home", p.home],
    ["draw", p.draw],
    ["away", p.away],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

/** Cuenta solo lo que la tarjeta publicó: el lado más probable, más/menos 2.5, ambos marcan y el marcador modal. */
export function settle(homeScore: number, awayScore: number, read: PublishedRead): HitRead {
  const calls: SettledCall[] = [];
  const result = homeScore > awayScore ? "home" : homeScore < awayScore ? "away" : "draw";
  const side = favorite(read.p1x2);
  if (side) {
    calls.push({
      label: side === "home" ? "Local" : side === "draw" ? "Empate" : "Visita",
      hit: side === result,
    });
  }
  if (read.pOver25 !== 0.5) {
    const over = read.pOver25 > 0.5;
    calls.push({
      label: over ? "Más 2.5" : "Menos 2.5",
      hit: over === homeScore + awayScore >= 3,
    });
  }
  if (read.pBttsYes !== 0.5) {
    const yes = read.pBttsYes > 0.5;
    calls.push({
      label: yes ? "Ambos marcan" : "No ambos",
      hit: yes === (homeScore > 0 && awayScore > 0),
    });
  }
  calls.push({
    label: `${read.modal.hg}–${read.modal.ag}`,
    hit: read.modal.hg === homeScore && read.modal.ag === awayScore,
  });
  const hits = calls.filter((call) => call.hit).length;
  return { calls, hits, total: calls.length };
}

const HIT_CACHE = new Map<string, HitRead | null>();

export function hitsForAgenda(match: AgendaMatch): HitRead | null {
  const cached = HIT_CACHE.get(match.id);
  if (cached !== undefined) return cached;
  const read = settleAgenda(match);
  HIT_CACHE.set(match.id, read);
  return read;
}

function settleAgenda(match: AgendaMatch): HitRead | null {
  if (match.status !== "finalizado" || match.homeScore == null || match.awayScore == null) return null;
  if (match.fixtureId) {
    const fixture = getFixture(match.fixtureId);
    if (fixture) {
      const analysis = presentAnalysis(match.id, getAnalysis(fixture), match.kickoff);
      return settle(match.homeScore, match.awayScore, {
        p1x2: analysis.p1x2,
        pOver25: analysis.pOver25,
        pBttsYes: analysis.pBttsYes,
        modal: analysis.mostLikelyScore,
      });
    }
  }
  const recent = publishedFor(match.id, match.kickoff, match.competition);
  if (!recent) return null;
  return settle(match.homeScore, match.awayScore, {
    p1x2: recent.p1x2,
    pOver25: recent.pOver25,
    pBttsYes: recent.pBttsYes,
    modal: recent.mostLikely,
  });
}
