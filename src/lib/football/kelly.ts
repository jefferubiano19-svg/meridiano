import type { ConfidenceLabel } from "./types";

function expectedValue(probability: number, decimalOdds: number): number {
  if (decimalOdds <= 1) return -1;
  return probability * decimalOdds - 1;
}

export interface StakeAdvice {
  kellyFull: number;
  kellyUsed: number;
  stake: number;
  stakePct: number;
  allowed: boolean;
  reasons: string[];
}

export interface RiskLimits {
  bankroll: number;
  kellyFraction: number;
  unitPercent: number;
  maxStakePercent: number;
  minEv: number;
  minConfidence: ConfidenceLabel;
  coolingOffUntil: number | null;
  dailyLoss: number;
  weeklyLoss: number;
  dailyLossLimit: number;
  weeklyLossLimit: number;
  ageConfirmed: boolean;
}

const CONF_RANK: Record<ConfidenceLabel, number> = { baja: 0, media: 1, alta: 2 };

export function kellyFraction(probability: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const edge = probability * decimalOdds - 1;
  if (edge <= 0) return 0;
  return Math.max(0, (b * probability - (1 - probability)) / b);
}

export function adviseStake(
  probability: number,
  decimalOdds: number,
  confidence: ConfidenceLabel,
  limits: RiskLimits,
): StakeAdvice {
  const reasons: string[] = [];
  const ev = expectedValue(probability, decimalOdds);
  const full = kellyFraction(probability, decimalOdds);
  const now = Date.now();

  if (!limits.ageConfirmed) reasons.push("Confirma que tienes 18 años o más para usar la mesa de riesgo.");
  if (limits.coolingOffUntil && limits.coolingOffUntil > now) {
    reasons.push("Periodo de pausa activo. Las sugerencias de stake están bloqueadas.");
  }
  if (ev < limits.minEv) reasons.push("El valor esperado está por debajo de tu umbral.");
  if (CONF_RANK[confidence] < CONF_RANK[limits.minConfidence]) {
    reasons.push("La confianza del modelo no alcanza tu filtro mínimo.");
  }
  if (limits.dailyLoss <= -Math.abs(limits.dailyLossLimit) && limits.dailyLossLimit > 0) {
    reasons.push("Límite de pérdida diaria alcanzado.");
  }
  if (limits.weeklyLoss <= -Math.abs(limits.weeklyLossLimit) && limits.weeklyLossLimit > 0) {
    reasons.push("Límite de pérdida semanal alcanzado.");
  }
  if (full <= 0) reasons.push("Sin ventaja cuantificada: stake sugerido = 0.");

  const used = full * Math.min(limits.kellyFraction, 0.25);
  const cappedPct = Math.min(used, limits.maxStakePercent / 100, 0.02);
  const stake = Math.floor(limits.bankroll * cappedPct * 100) / 100;
  const allowed = reasons.length === 0 && stake > 0;

  if (allowed && limits.kellyFraction <= 0.25) {
    reasons.push("Kelly fraccional: se usa solo una parte de la fórmula para reducir la varianza.");
  }

  return {
    kellyFull: full,
    kellyUsed: used,
    stake: allowed ? stake : 0,
    stakePct: allowed ? cappedPct * 100 : 0,
    allowed,
    reasons,
  };
}

export function simulateDrawdown(opts: {
  probability: number;
  odds: number;
  fraction: number;
  bets: number;
  paths: number;
}): { p5: number; median: number; p95: number; ruin: number } {
  const { probability, odds, fraction, bets, paths } = opts;
  const finals: number[] = [];
  let ruin = 0;
  for (let p = 0; p < paths; p += 1) {
    let bank = 1;
    for (let i = 0; i < bets; i += 1) {
      const f = Math.min(0.08, Math.max(0, kellyFraction(probability, odds) * fraction));
      const stake = bank * f;
      if (stake <= 0) break;
      const win = Math.random() < probability;
      bank += win ? stake * (odds - 1) : -stake;
      if (bank < 0.15) {
        ruin += 1;
        bank = 0.15;
        break;
      }
    }
    finals.push(bank);
  }
  finals.sort((a, b) => a - b);
  const at = (q: number) => finals[Math.min(finals.length - 1, Math.floor(q * (finals.length - 1)))];
  return { p5: at(0.05), median: at(0.5), p95: at(0.95), ruin: ruin / paths };
}
