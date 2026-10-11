import { createServerFn } from "@tanstack/react-start";
import type { ComboBoard, ConsultaBoard, DayBoard, LeagueCard, LeaguePage, MatchReading, ModeloBundle, SearchBoard } from "./dto";

export const loadDay = createServerFn({ method: "GET" })
  .validator((input: { day?: string } | undefined) => ({ day: String(input?.day ?? "") }))
  .handler(async ({ data: input }): Promise<DayBoard> => {
    const { dayBoard } = await import("./page-data");
    return dayBoard(input.day);
  });

export const loadCombo = createServerFn({ method: "GET" })
  .validator((input: { which?: string } | undefined) => ({
    which: input?.which === "manana" ? "manana" : "hoy",
  }))
  .handler(async ({ data: input }): Promise<ComboBoard> => {
    const { comboBoard } = await import("./page-data");
    return comboBoard(input.which === "manana" ? "manana" : "hoy");
  });

export const loadFicha = createServerFn({ method: "GET" })
  .validator((input: { id?: string } | undefined) => ({ id: String(input?.id ?? "") }))
  .handler(async ({ data: input }): Promise<MatchReading | null> => {
    const { ficha } = await import("./page-data");
    return ficha(input.id);
  });

export const loadConsulta = createServerFn({ method: "GET" })
  .validator((input: { day?: string } | undefined) => ({ day: String(input?.day ?? "") }))
  .handler(async ({ data: input }): Promise<ConsultaBoard> => {
    const { consultaBoard } = await import("./page-data");
    return consultaBoard(input.day);
  });

export const loadLigas = createServerFn({ method: "GET" }).handler(async (): Promise<LeagueCard[]> => {
  const { leagueIndex } = await import("./page-data");
  return leagueIndex();
});

export const loadLeague = createServerFn({ method: "GET" })
  .validator((input: { id?: string } | undefined) => ({ id: String(input?.id ?? "") }))
  .handler(async ({ data: input }): Promise<LeaguePage | null> => {
    const { leaguePage } = await import("./page-data");
    return leaguePage(input.id);
  });

export const loadSearch = createServerFn({ method: "GET" })
  .validator((input: { home?: string; away?: string; date?: string; competition?: string }) => ({
    home: String(input?.home ?? "").slice(0, 80),
    away: String(input?.away ?? "").slice(0, 80),
    date: String(input?.date ?? "").slice(0, 20),
    competition: String(input?.competition ?? "").slice(0, 80),
  }))
  .handler(async ({ data: input }): Promise<SearchBoard> => {
    const { searchBoard } = await import("./page-data");
    return searchBoard(input);
  });

export const loadModelo = createServerFn({ method: "GET" }).handler(async (): Promise<ModeloBundle> => {
  const { modeloBundle } = await import("./page-data");
  return modeloBundle();
});

export const loadNames = createServerFn({ method: "GET" })
  .validator((input: { ids?: string[] } | undefined) => ({
    ids: Array.isArray(input?.ids) ? input.ids.map((id) => String(id)).slice(0, 200) : [],
  }))
  .handler(async ({ data: input }): Promise<Record<string, string>> => {
    const { fixtureNames } = await import("./page-data");
    return fixtureNames(input.ids);
  });
