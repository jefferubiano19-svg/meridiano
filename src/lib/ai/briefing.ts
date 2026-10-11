import { createServerFn } from "@tanstack/react-start";

export interface BriefingInput {
  home: string;
  away: string;
  league: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  lambdaHome: number;
  lambdaAway: number;
  confidence: number;
  note: string;
}

export const generateBriefing = createServerFn({ method: "POST" })
  .validator((input: BriefingInput) => input)
  .handler(async () => {
    return { ok: false as const, error: "La lectura cualitativa no está en esta versión." };
  });
