import { readFileSync, writeFileSync } from "node:fs";

const RHO = -0.08;

function shrinkRate(observed, games, prior = 1.25, strength = 8) {
  if (games <= 0) return prior;
  return (games * observed + strength * prior) / (games + strength);
}

function poisson(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let term = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) term *= lambda / i;
  return term;
}

function dixonColes(hg, ag, lambdaHome, lambdaAway) {
  if (hg === 0 && ag === 0) return Math.max(0, 1 - lambdaHome * lambdaAway * RHO);
  if (hg === 1 && ag === 0) return Math.max(0, 1 + lambdaAway * RHO);
  if (hg === 0 && ag === 1) return Math.max(0, 1 + lambdaHome * RHO);
  if (hg === 1 && ag === 1) return Math.max(0, 1 - RHO);
  return 1;
}

function scoreboard(lambdaHome, lambdaAway) {
  let mass = 0;
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  for (let hg = 0; hg <= 8; hg += 1) {
    for (let ag = 0; ag <= 8; ag += 1) {
      const p = poisson(hg, lambdaHome) * poisson(ag, lambdaAway) * dixonColes(hg, ag, lambdaHome, lambdaAway);
      mass += p;
      if (hg > ag) pHome += p;
      else if (hg === ag) pDraw += p;
      else pAway += p;
    }
  }
  return { home: pHome / mass, draw: pDraw / mass, away: pAway / mass };
}

const check = scoreboard(1.3, 1.1);
const sum = check.home + check.draw + check.away;
if (Math.abs(sum - 1) > 1e-9) {
  console.error("1X2 no suma 1", sum);
  process.exit(1);
}

const context = JSON.parse(readFileSync("data/match-context.json", "utf8"));
const flash = JSON.parse(readFileSync("data/flashscore.json", "utf8"));
const rows = [];
let brier = 0;
let rps = 0;
const bins = [
  { label: "0–40%", from: 0, to: 0.4, n: 0, hit: 0 },
  { label: "40–50%", from: 0.4, to: 0.5, n: 0, hit: 0 },
  { label: "50–60%", from: 0.5, to: 0.6, n: 0, hit: 0 },
  { label: "60–70%", from: 0.6, to: 0.7, n: 0, hit: 0 },
  { label: "70–100%", from: 0.7, to: 1.01, n: 0, hit: 0 },
];
let played = 0;

for (const [fixtureId, live] of Object.entries(flash.byFixture)) {
  if (live.status !== "finalizado" || live.homeScore == null || live.awayScore == null) continue;
  played += 1;
  const prior = context.byFixture[fixtureId];
  if (!prior || prior.homeFor == null || prior.awayFor == null || prior.homeN < 4 || prior.awayN < 4) continue;
  const lambdaHome = Math.min(3.2, Math.max(0.35, (shrinkRate(prior.homeFor, prior.homeN) + shrinkRate(prior.awayAgainst, prior.awayN)) / 2));
  const lambdaAway = Math.min(3.2, Math.max(0.35, (shrinkRate(prior.awayFor, prior.awayN) + shrinkRate(prior.homeAgainst, prior.homeN)) / 2));
  const probs = [scoreboard(lambdaHome, lambdaAway).home, scoreboard(lambdaHome, lambdaAway).draw, scoreboard(lambdaHome, lambdaAway).away];
  const scored = scoreboard(lambdaHome, lambdaAway);
  const vector = [scored.home, scored.draw, scored.away];
  const outcome = live.homeScore > live.awayScore ? 0 : live.homeScore === live.awayScore ? 1 : 2;
  const actual = [0, 0, 0];
  actual[outcome] = 1;
  const matchBrier = vector.reduce((total, p, index) => total + (p - actual[index]) ** 2, 0);
  let cdfModel = 0;
  let cdfActual = 0;
  let matchRps = 0;
  for (let index = 0; index < 2; index += 1) {
    cdfModel += vector[index];
    cdfActual += actual[index];
    matchRps += (cdfModel - cdfActual) ** 2;
  }
  matchRps /= 2;
  brier += matchBrier;
  rps += matchRps;
  const pick = vector.indexOf(Math.max(...vector));
  const bin = bins.find((item) => vector[pick] >= item.from && vector[pick] < item.to);
  if (bin) {
    bin.n += 1;
    if (pick === outcome) bin.hit += 1;
  }
  rows.push({
    fixtureId,
    score: `${live.homeScore}-${live.awayScore}`,
    pHome: Number(vector[0].toFixed(3)),
    pDraw: Number(vector[1].toFixed(3)),
    pAway: Number(vector[2].toFixed(3)),
    brier: Number(matchBrier.toFixed(4)),
    rps: Number(matchRps.toFixed(4)),
  });
}

const report = {
  builtAt: new Date().toISOString(),
  rule: "Solo partidos ya finalizados y solo con goles anteriores a su inicio. La tabla de temporada no entra, para no usar información posterior.",
  playedInCut: played,
  scored: rows.length,
  brier: rows.length ? Number((brier / rows.length).toFixed(4)) : null,
  rps: rows.length ? Number((rps / rows.length).toFixed(4)) : null,
  bins: bins.map((bin) => ({
    label: bin.label,
    n: bin.n,
    hit: bin.hit,
    rate: bin.n ? Number((bin.hit / bin.n).toFixed(3)) : null,
  })),
  rows,
  sumCheck: Number(sum.toFixed(6)),
};
writeFileSync("data/calibration-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sum: report.sumCheck, scored: rows.length, brier: report.brier, rps: report.rps, bins: report.bins }, null, 2));
