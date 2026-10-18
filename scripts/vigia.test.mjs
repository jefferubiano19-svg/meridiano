// Pruebas del vigía: node --test scripts/vigia.test.mjs
// Simulan GitHub, Vercel y los archivos de /data; no tocan nada real.
import assert from "node:assert/strict";
import test from "node:test";
import { vigia } from "./vigia.mjs";

const T = (s) => Date.parse(s);
const DAY = "2026-10-18";
const ME = { login: "jefferubiano19-svg" };
const BOT = { login: "github-actions[bot]" };

/** Ejecución de corte.yml. */
function run(created, extra = {}) {
  return {
    id: Math.floor(Math.random() * 1e9),
    created_at: new Date(T(created)).toISOString(),
    updated_at: new Date(T(created) + 90 * 60000).toISOString(),
    status: "completed",
    conclusion: "success",
    event: "workflow_dispatch",
    triggering_actor: ME,
    ...extra,
  };
}

/** Disparos normales de cron-job.org para los turnos de hoy y ayer hasta `until`. */
function cronRuns(until) {
  const out = [];
  for (const day of ["2026-10-17", DAY]) {
    for (const hm of ["00:15", "12:00", "17:00"]) {
      const at = `${day}T${hm}:30-05:00`;
      if (T(at) < T(until)) out.push(run(at));
    }
  }
  return out;
}

function logRow(mode, day, hm, extra = {}) {
  return {
    corte: mode,
    startedAtBogota: `${day}T${hm}:40-05:00`,
    finishedAtBogota: `${day}T${hm.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, "0"))}:20-05:00`,
    fatal: null,
    predictionsSaved: 100,
    failures: 0,
    ...extra,
  };
}

/** io simulado. `over` reemplaza piezas; registra lo que el vigía hace. */
function fakeIo(now, over = {}) {
  const did = { dispatch: [], cancel: [], enable: 0, hook: 0, issue: null };
  const files = {
    "data/cut-done.json": over.done ?? {},
    "data/cut-log.json": { cuts: over.log ?? [logRow("tarde", "2026-10-17", "17:00")] },
    "data/cut-coverage.json": over.coverage ?? { cut: DAY, corte: "noche", agendaToday: 900, tablesRead: 17, failures: [], consensusTargets: 300, consensusRead: 250 },
  };
  const io = {
    now: T(now),
    file: async (path) => {
      if (over.fileError) throw new Error("API caída");
      return files[path] ?? null;
    },
    runs: async () => {
      if (over.runsError) throw new Error("API caída");
      return over.runs ?? cronRuns(now);
    },
    workflowState: async () => over.state ?? "active",
    enableWorkflow: async () => {
      did.enable += 1;
    },
    cancel: async (id) => {
      did.cancel.push(id);
    },
    dispatch: async (mode) => {
      if (over.dispatchError) throw new Error("403 sin permiso");
      did.dispatch.push(mode);
    },
    failedSteps: async () => over.failedSteps ?? [],
    deployHook: async () => {
      did.hook += 1;
      return over.hookOk ?? true;
    },
    issue: async (report, problems) => {
      if (over.issueError) throw new Error("issues: 403");
      did.issue = problems.length ? "abrir/comentar" : "cerrar";
      return did.issue;
    },
  };
  return { io, did };
}

const doneAll = { noche: DAY, mediodia: DAY, tarde: DAY };
const logToday = [logRow("noche", DAY, "00:15"), logRow("mediodia", DAY, "12:00"), logRow("tarde", DAY, "17:00")];

test("día normal: todo hecho, nada que hacer, aviso cerrado", async () => {
  const { io, did } = fakeIo(`${DAY}T20:50:00-05:00`, { done: doneAll, log: logToday });
  const r = await vigia(io);
  assert.equal(r.color, "verde");
  assert.deepEqual(did.dispatch, []);
  assert.equal(did.issue, "cerrar");
});

test("C: el corte no arrancó → lo lanza (sin alarma, solo nota)", async () => {
  const { io, did } = fakeIo(`${DAY}T00:55:00-05:00`, { runs: cronRuns(`${DAY}T00:00:00-05:00`) });
  const r = await vigia(io);
  assert.deepEqual(did.dispatch, ["noche"]);
  assert.equal(r.problems.length, 0);
  assert.match(r.notes.join(" "), /lo lanzó el vigía/);
});

test("C: dentro del margen de 40 min → espera", async () => {
  const { io, did } = fakeIo(`${DAY}T00:40:00-05:00`, { runs: cronRuns(`${DAY}T00:00:00-05:00`) });
  await vigia(io);
  assert.deepEqual(did.dispatch, []);
});

test("C: hay un corte corriendo → espera", async () => {
  const runs = [...cronRuns(`${DAY}T00:00:00-05:00`), run(`${DAY}T00:15:30-05:00`, { status: "in_progress", conclusion: null, run_started_at: new Date(T(`${DAY}T00:16:00-05:00`)).toISOString() })];
  const { io, did } = fakeIo(`${DAY}T01:50:00-05:00`, { runs });
  await vigia(io);
  assert.deepEqual(did.dispatch, []);
  assert.deepEqual(did.cancel, []);
});

test("B: corte en cola 45 min → lo cancela y lanza el turno", async () => {
  const stuck = run(`${DAY}T00:15:30-05:00`, { status: "queued", conclusion: null });
  const { io, did } = fakeIo(`${DAY}T01:01:00-05:00`, { runs: [...cronRuns(`${DAY}T00:00:00-05:00`), stuck] });
  await vigia(io);
  assert.deepEqual(did.cancel, [stuck.id]);
  assert.deepEqual(did.dispatch, ["noche"]);
});

test("B: corte corriendo 170 min → lo cancela", async () => {
  const stuck = run(`${DAY}T12:00:30-05:00`, { status: "in_progress", conclusion: null, run_started_at: new Date(T(`${DAY}T12:01:00-05:00`)).toISOString() });
  const { io, did } = fakeIo(`${DAY}T14:52:00-05:00`, { done: { noche: DAY }, log: [logRow("noche", DAY, "00:15")], runs: [...cronRuns(`${DAY}T12:00:00-05:00`), stuck] });
  await vigia(io);
  assert.deepEqual(did.cancel, [stuck.id]);
  assert.deepEqual(did.dispatch, ["mediodia"]);
});

test("D: 2 intentos fallidos → lanza el 3.º y avisa", async () => {
  const runs = [...cronRuns(`${DAY}T12:00:00-05:00`), run(`${DAY}T12:00:30-05:00`, { conclusion: "failure" }), run(`${DAY}T12:50:30-05:00`, { conclusion: "failure", triggering_actor: BOT })];
  const { io, did } = fakeIo(`${DAY}T13:50:00-05:00`, { done: { noche: DAY }, log: [logRow("noche", DAY, "00:15")], runs });
  const r = await vigia(io);
  assert.deepEqual(did.dispatch, ["mediodia"]);
  assert.match(r.problems.join(" "), /intento 3/);
  assert.equal(did.issue, "abrir/comentar");
});

test("D: 3 intentos → no insiste y explica qué hacer", async () => {
  const runs = [
    ...cronRuns(`${DAY}T12:00:00-05:00`),
    run(`${DAY}T12:00:30-05:00`, { conclusion: "failure" }),
    run(`${DAY}T12:50:30-05:00`, { conclusion: "failure", triggering_actor: BOT }),
    run(`${DAY}T13:50:30-05:00`, { conclusion: "failure", triggering_actor: BOT }),
  ];
  const { io, did } = fakeIo(`${DAY}T14:50:00-05:00`, { done: { noche: DAY }, log: [logRow("noche", DAY, "00:15")], runs });
  const r = await vigia(io);
  assert.deepEqual(did.dispatch, []);
  assert.match(r.problems.join(" "), /después de 3 intentos.*Qué hacer/);
});

test("E: el turno siguiente arranca en menos de 60 min → no relanza", async () => {
  const { io, did } = fakeIo(`${DAY}T11:30:00-05:00`, { runs: cronRuns(`${DAY}T00:00:00-05:00`) });
  const r = await vigia(io);
  assert.deepEqual(did.dispatch, []);
  assert.match(r.problems.join(" "), /lo cubre el turno siguiente/);
});

test("C: corte caído (fatal) sin cut-done → lo relanza", async () => {
  const runs = [...cronRuns(`${DAY}T00:00:00-05:00`), run(`${DAY}T00:15:30-05:00`, { conclusion: "failure" })];
  const { io, did } = fakeIo(`${DAY}T02:50:00-05:00`, { log: [logRow("noche", DAY, "00:15", { fatal: true })], runs });
  const r = await vigia(io);
  assert.deepEqual(did.dispatch, ["noche"]);
  assert.match(r.lines.join(" "), /se cayó/);
});

test("C: corte terminó sin agenda (sin cut-done) → lo relanza", async () => {
  const runs = [...cronRuns(`${DAY}T00:00:00-05:00`), run(`${DAY}T00:15:30-05:00`)];
  const { io, did } = fakeIo(`${DAY}T02:50:00-05:00`, { log: [logRow("noche", DAY, "00:15", { predictionsSaved: 0 })], runs });
  const r = await vigia(io);
  assert.deepEqual(did.dispatch, ["noche"]);
  assert.match(r.lines.join(" "), /sin leer la agenda/);
});

test("A: flujo corte desactivado → lo reactiva y avisa", async () => {
  const { io, did } = fakeIo(`${DAY}T20:50:00-05:00`, { done: doneAll, log: logToday, state: "disabled_inactivity" });
  const r = await vigia(io);
  assert.equal(did.enable, 1);
  assert.match(r.problems.join(" "), /desactivado.*reactivó/);
});

test("F: falló la publicación en Vercel → vuelve a llamar al deploy hook", async () => {
  const runs = [...cronRuns(`${DAY}T17:00:00-05:00`), run(`${DAY}T17:00:30-05:00`, { conclusion: "failure", updated_at: new Date(T(`${DAY}T18:20:00-05:00`)).toISOString() })];
  const { io, did } = fakeIo(`${DAY}T18:50:00-05:00`, { done: doneAll, log: logToday, runs, failedSteps: ["Publicar en Vercel"] });
  const r = await vigia(io);
  assert.equal(did.hook, 1);
  assert.match(r.notes.join(" "), /Vercel/);
});

test("F: falló Vercel y no hay deploy hook → avisa", async () => {
  const runs = [...cronRuns(`${DAY}T17:00:00-05:00`), run(`${DAY}T17:00:30-05:00`, { conclusion: "failure", updated_at: new Date(T(`${DAY}T18:20:00-05:00`)).toISOString() })];
  const { io } = fakeIo(`${DAY}T18:50:00-05:00`, { done: doneAll, log: logToday, runs, failedSteps: ["Publicar en Vercel"], hookOk: false });
  const r = await vigia(io);
  assert.match(r.problems.join(" "), /VERCEL_DEPLOY_HOOK/);
});

test("F: un fallo de Vercel viejo (más de 65 min) no se repite", async () => {
  const runs = [...cronRuns(`${DAY}T17:00:00-05:00`), run(`${DAY}T17:00:30-05:00`, { conclusion: "failure", updated_at: new Date(T(`${DAY}T18:20:00-05:00`)).toISOString() })];
  const { io, did } = fakeIo(`${DAY}T19:50:00-05:00`, { done: doneAll, log: logToday, runs, failedSteps: ["Publicar en Vercel"] });
  await vigia(io);
  assert.equal(did.hook, 0);
});

test("G: cron-job.org no disparó los 3 últimos turnos → avisa (los cubrió el respaldo)", async () => {
  const runs = [
    run(`2026-10-17T17:20:00-05:00`, { event: "schedule", triggering_actor: BOT }),
    run(`${DAY}T00:40:00-05:00`, { event: "schedule", triggering_actor: BOT }),
    run(`${DAY}T12:25:00-05:00`, { event: "schedule", triggering_actor: BOT }),
  ];
  const { io, did } = fakeIo(`${DAY}T14:50:00-05:00`, { done: { noche: DAY, mediodia: DAY }, log: logToday.slice(0, 2), runs });
  const r = await vigia(io);
  assert.deepEqual(did.dispatch, []);
  assert.match(r.problems.join(" "), /cron-job.org no disparó ninguno.*401/);
});

test("G: cron-job.org falló un solo turno → nota, no alarma", async () => {
  const runs = cronRuns(`${DAY}T14:00:00-05:00`).filter((r) => !r.created_at.startsWith(`${DAY}T17:00`) && !(T(r.created_at) >= T(`${DAY}T12:00:00-05:00`)));
  runs.push(run(`${DAY}T12:41:00-05:00`, { triggering_actor: BOT }));
  const { io } = fakeIo(`${DAY}T14:50:00-05:00`, { done: { noche: DAY, mediodia: DAY }, log: logToday.slice(0, 2), runs });
  const r = await vigia(io);
  assert.equal(r.problems.length, 0);
  assert.match(r.notes.join(" "), /cron-job.org no disparó a su hora: mediodia/);
});

test("I: la API de ejecuciones falla → no lanza a ciegas y avisa", async () => {
  const { io, did } = fakeIo(`${DAY}T01:50:00-05:00`, { runsError: true });
  const r = await vigia(io);
  assert.deepEqual(did.dispatch, []);
  assert.match(r.problems.join(" "), /no pudo leer las ejecuciones/);
});

test("I: lanzar falla (permiso) → lo dice y no se cae", async () => {
  const { io } = fakeIo(`${DAY}T00:55:00-05:00`, { runs: cronRuns(`${DAY}T00:00:00-05:00`), dispatchError: true });
  const r = await vigia(io);
  assert.match(r.problems.join(" "), /no pudo lanzar el corte de noche: 403/);
});

test("I: el aviso no se puede escribir → no se cae", async () => {
  const { io } = fakeIo(`${DAY}T11:30:00-05:00`, { runs: cronRuns(`${DAY}T00:00:00-05:00`), issueError: true });
  const r = await vigia(io);
  assert.match(r.issue, /no se pudo actualizar el aviso/);
});

test("H: datos de más de 14 horas → avisa", async () => {
  const { io } = fakeIo(`${DAY}T20:50:00-05:00`, { done: doneAll, log: [logRow("noche", "2026-10-17", "00:15")] });
  const r = await vigia(io);
  assert.match(r.problems.join(" "), /más de 14 horas/);
});

test("H: agenda de hoy vacía → avisa; tablas, pasos con error y tiempo agotado → notas", async () => {
  const coverage = { cut: DAY, corte: "noche", agendaToday: 0, tablesRead: 0, failures: [{ step: "tablas" }], budgetHit: true, consensusTargets: 300, consensusRead: 20 };
  const { io } = fakeIo(`${DAY}T20:50:00-05:00`, { done: doneAll, log: logToday, coverage });
  const r = await vigia(io);
  assert.match(r.problems.join(" "), /agenda de hoy vacía/);
  const n = r.notes.join(" ");
  for (const word of ["tabla", "pasos con error en el último corte: tablas", "todo su tiempo", "solo 20 de 300"]) assert.match(n, new RegExp(word));
});

test("H: noche sin predicciones → avisa", async () => {
  const { io } = fakeIo(`${DAY}T08:50:00-05:00`, { done: { noche: DAY }, log: [logRow("noche", DAY, "00:15", { predictionsSaved: 0 })] });
  const r = await vigia(io);
  assert.match(r.problems.join(" "), /no guardó ninguna predicción/);
});
