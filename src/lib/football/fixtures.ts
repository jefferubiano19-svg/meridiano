import snapshot from "../../../data/snapshot.json";
import type { Fixture } from "./types";

export { bogotaStamp, shiftDay } from "./clock";

export const FIXTURES: Fixture[] = (snapshot.fixtures as Fixture[]).slice().sort(
  (a, b) => +new Date(a.kickoff) - +new Date(b.kickoff),
);

export const FIXTURE_BY_ID: Record<string, Fixture> = Object.fromEntries(
  FIXTURES.map((fixture) => [fixture.id, fixture]),
);

export function getFixture(id: string): Fixture | undefined {
  return FIXTURE_BY_ID[id];
}
