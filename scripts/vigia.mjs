/* ---------------------------------------------------------------------------
 * Vigía de los cortes de Meridiano. Corre en GitHub Actions cada hora (vigia.yml),
 * sin depender de nadie: ni de cron-job.org ni de una conversación con Claude.
 * No escribe en /data ni en el código: lee, lanza o cancela cortes, vuelve a publicar en Vercel y avisa.
 *
 * Casos que atiende (cada uno tiene su prueba en scripts/vigia.test.mjs):
 *  A. Flujo "corte" desactivado por GitHub → lo vuelve a activar y avisa.
 *  B. Corte en cola más de 30 min o corriendo más de 165 min (atascado) → lo cancela; luego se relanza.
 *  C. Turno vencido (40 min después de su hora) sin hacer y sin nada corriendo → lo lanza.
 *     "Hecho" = data/cut-done.json del turno con la fecha de hoy, leído de la rama main en ese momento
 *     (no de la copia que bajó el vigía, para no relanzar un corte que terminó un minuto antes).
 *     Un corte que terminó sin agenda o se cayó no escribe cut-done, así que cuenta como no hecho.
 *  D. Máximo 3 ejecuciones por turno y día (la de cron-job.org + 2 relanzamientos) → después avisa.
 *  E. No relanza si el turno siguiente arranca en menos de 60 min o ya pasó (ese lo cubre).
 *  F. Último corte terminado con el paso "Publicar en Vercel" en error → vuelve a llamar al deploy hook.
 *  G. cron-job.org sin disparar en los 3 últimos turnos → aviso (token vencido o trabajo apagado).
 *  H. Salud de los datos del último corte: caído, agenda vacía, sin predicciones de noche, tablas sin leer,
 *     pasos con error, sin tiempo, pocas cuotas leídas, datos de la app con más de 14 horas.
 *  I. Errores de la API de GitHub → el resumen los dice y la ejecución queda en rojo (GitHub manda correo).
 * Aviso: issue «Vigía de cortes: hay un problema». Se abre o se comenta solo si los problemas cambian; se cierra
 * cuando todo vuelve a estar bien. GitHub manda correo al dueño del repositorio.
 * ------------------------------------------------------------------------- */

import fs from "node:fs";

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;
export const ISSUE_TITLE = "Vigía de cortes: hay un problema";
/** Turnos del día en hora de Bogotá (UTC−5, sin horario de verano). */
export const SLOTS = [
  { mode: "noche", h: 0, m: 15 },
  { mode: "mediodia", h: 12, m: 0 },
  { mode: "tarde", h: 17, m: 0 },
];
const GRACE_MIN = 40;
const MAX_RUNS = 3;
const QUEUED_MAX_MIN = 30;
const RUNNING_MAX_MIN = 165;
const BOT = "github-actions[bot]";

export function bogotaDay(ms) {
  return new Date(ms - 5 * HOUR).toISOString().slice(0, 10);
}
export function slotStart(day, slot) {
  return Date.parse(`${day}T${String(slot.h).padStart(2, "0")}:${String(slot.m).padStart(2, "0")}:00-05:00`);
}
function hhmm(ms) {
  return new Date(ms - 5 * HOUR).toISOString().slice(11, 16);
}
function label(slot) {
  return `${slot.mode} (${String(slot.h).padStart(2, "0")}:${String(slot.m).padStart(2, "0")})`;
}
const ACTIVE = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

/** Turnos ya vencidos (con su hora de inicio) de los últimos `count`, del más reciente al más viejo. */
function pastSlots(now, count) {
  const out = [];
  for (let d = 0; d < 3; d += 1) {
    const day = bogotaDay(now - d * 24 * HOUR);
    for (const slot of SLOTS) {
      const start = slotStart(day, slot);
      if (start + GRACE_MIN * MIN <= now) out.push({ slot, start });
    }
  }
  return out.sort((a, b) => b.start - a.start).slice(0, count);
}

/**
 * Decide y actúa. `io` aísla todo lo externo (GitHub, Vercel, archivos) para poder probarlo:
 *   io.now, io.file(path) → objeto | null (rama main), io.runs() → ejecuciones de corte.yml,
 *   io.workflowState(), io.enableWorkflow(), io.cancel(id), io.dispatch(mode), io.failedSteps(runId),
 *   io.deployHook() → true si llamó, io.issue(report, problems) → texto de lo hecho.
 */
export async function vigia(io) {
  const now = io.now;
  const day = bogotaDay(now);
  const lines = [];
  const problems = [];
  const notes = [];
  const actions = [];
  const guard = async (what, fn, fallback) => {
    try {
      return await fn();
    } catch (error) {
      problems.push(`El vigía no pudo ${what}: ${String(error?.message ?? error).slice(0, 160)}`);
      return fallback;
    }
  };

  // Simulación a mano (Run workflow → simular), para probar en real el aviso y el lanzamiento.
  if (io.simulate === "aviso") problems.push("Prueba del vigía: aviso de prueba. Se cierra solo en la vuelta siguiente; no hay que hacer nada.");
  if (io.simulate === "lanzar") {
    // El turno de la noche ya hecho: el corte arranca, el candado lo ve hecho y termina sin tocar nada.
    const ok = await guard("lanzar el corte de prueba", async () => (await io.dispatch("noche"), true), false);
    if (ok) actions.push("lanzó un corte de prueba (noche, ya hecho: debe terminar solo en pocos minutos)");
  }

  // A. Flujo desactivado.
  const state = await guard("consultar el estado del flujo corte", () => io.workflowState(), "active");
  if (state && state !== "active") {
    const ok = await guard("reactivar el flujo corte", async () => (await io.enableWorkflow(), true), false);
    if (ok) actions.push("reactivó el flujo corte");
    problems.push(
      `GitHub tenía el flujo «corte» desactivado (${state}).${ok ? " El vigía lo reactivó." : " Actívalo en GitHub → Actions → corte → «Enable workflow»."}`,
    );
  }

  let runs = await guard("leer las ejecuciones del corte", () => io.runs(), null);
  const runsKnown = Array.isArray(runs);
  runs = runsKnown ? runs : [];

  // B. Atascados. Uno en cola detrás de otro que está corriendo no está atascado: espera su turno (concurrencia).
  const running = runs.some((r) => r.status === "in_progress");
  for (const run of runs.filter((r) => ACTIVE.has(r.status))) {
    const age = (now - Date.parse(run.run_started_at ?? run.created_at)) / MIN;
    const queued = run.status !== "in_progress";
    if ((queued && !running && age > QUEUED_MAX_MIN) || (!queued && age > RUNNING_MAX_MIN)) {
      const ok = await guard("cancelar un corte atascado", async () => (await io.cancel(run.id), true), false);
      if (ok) {
        run.status = "completed";
        run.conclusion = "cancelled";
        actions.push(`canceló un corte atascado (${queued ? "en cola" : "corriendo"} ${Math.round(age)} min)`);
        notes.push(`un corte estaba atascado ${queued ? "en cola" : "corriendo"} ${Math.round(age)} min y se canceló`);
      }
    }
  }
  const active = runs.filter((r) => ACTIVE.has(r.status));

  // C, D, E. Turnos del día. "Hecho" se lee de main en este momento.
  const done = (await guard("leer data/cut-done.json", () => io.file("data/cut-done.json"), null)) ?? {};
  const log = ((await guard("leer data/cut-log.json", () => io.file("data/cut-log.json"), null)) ?? {}).cuts ?? [];
  for (let i = 0; i < SLOTS.length; i += 1) {
    const slot = SLOTS[i];
    const start = slotStart(day, slot);
    const next = i + 1 < SLOTS.length ? slotStart(day, SLOTS[i + 1]) : slotStart(bogotaDay(now + 24 * HOUR), SLOTS[0]);
    if (now < start) {
      lines.push(`- ${label(slot)}: todavía no le toca.`);
      continue;
    }
    const entry = [...log].reverse().find((row) => row.corte === slot.mode && String(row.startedAtBogota ?? "").startsWith(day));
    if (done[slot.mode] === day) {
      const took = entry?.startedAtBogota && entry?.finishedAtBogota ? Math.round((Date.parse(entry.finishedAtBogota) - Date.parse(entry.startedAtBogota)) / MIN) : null;
      lines.push(`- ${label(slot)}: hecho${entry ? ` a las ${String(entry.startedAtBogota).slice(11, 16)}${took != null ? `, ${took} min` : ""}, ${entry.predictionsSaved ?? "?"} predicciones` : ""}.`);
      continue;
    }
    if (active.length > 0) {
      lines.push(`- ${label(slot)}: hay un corte corriendo o en cola (desde las ${hhmm(Date.parse(active[0].created_at))}); se espera.`);
      continue;
    }
    if (now < start + GRACE_MIN * MIN) {
      lines.push(`- ${label(slot)}: dentro del margen de ${GRACE_MIN} min; se espera.`);
      continue;
    }
    if (!runsKnown) {
      lines.push(`- ${label(slot)}: no hecho, pero el vigía no pudo ver las ejecuciones; no lanza nada a ciegas.`);
      continue;
    }
    const tries = runs.filter((r) => Date.parse(r.created_at) >= start && Date.parse(r.created_at) < next).length;
    const why = entry?.fatal ? "se cayó" : entry ? "terminó sin leer la agenda" : tries > 0 ? "corrió pero no terminó bien" : "no arrancó";
    if (next - now < 60 * MIN) {
      lines.push(`- ${label(slot)}: ${why}; no se relanza: el turno siguiente (${hhmm(next)}) ${now >= next ? "ya pasó" : "está por arrancar"} y lo cubre.`);
      problems.push(`El corte de ${slot.mode} de hoy ${why} y no se relanzó (lo cubre el turno siguiente).`);
      continue;
    }
    if (tries >= MAX_RUNS) {
      lines.push(`- ${label(slot)}: ${why} después de ${tries} intentos. No se insiste más.`);
      problems.push(
        `El corte de ${slot.mode} de hoy ${why} después de ${tries} intentos. Qué hacer: en GitHub abre Actions → corte → la última ejecución en rojo y mira el paso que falló. Si es «npm ci» o «playwright», es un problema de GitHub y suele arreglarse solo en el turno siguiente; si es «npm run corte», copia el error y pásalo a Claude.`,
      );
      continue;
    }
    const ok = await guard(`lanzar el corte de ${slot.mode}`, async () => (await io.dispatch(slot.mode), true), false);
    if (ok) {
      actions.push(`lanzó el corte de ${slot.mode} (intento ${tries + 1} de ${MAX_RUNS})`);
      lines.push(`- ${label(slot)}: ${why}; el vigía lo lanza (intento ${tries + 1} de ${MAX_RUNS}).`);
      if (tries === 0) notes.push(`el corte de ${slot.mode} no arrancó a su hora y lo lanzó el vigía`);
      else problems.push(`El corte de ${slot.mode} de hoy ${why}; el vigía lo relanzó (intento ${tries + 1}).`);
    }
  }

  // F. Último corte terminado: ¿falló la publicación en Vercel? Solo si terminó hace menos de 65 min,
  // para atenderlo una sola vez (el vigía pasa cada hora).
  const finished = runs
    .filter((r) => r.status === "completed")
    .sort((a, b) => Date.parse(b.updated_at ?? b.created_at) - Date.parse(a.updated_at ?? a.created_at));
  const lastRun = finished[0];
  if (lastRun && lastRun.conclusion === "failure" && now - Date.parse(lastRun.updated_at ?? lastRun.created_at) < 65 * MIN) {
    const failed = await guard("leer los pasos del último corte", () => io.failedSteps(lastRun.id), []);
    if (failed.some((name) => /vercel/i.test(name))) {
      const called = await guard("volver a publicar en Vercel", () => io.deployHook(), false);
      if (called) {
        actions.push("volvió a pedir la publicación en Vercel");
        notes.push("la publicación en Vercel del último corte falló y el vigía la volvió a pedir");
      } else {
        problems.push("La publicación en Vercel del último corte falló y el vigía no pudo repetirla (¿falta el secreto VERCEL_DEPLOY_HOOK?).");
      }
    } else if (failed.some((name) => /guardar/i.test(name))) {
      notes.push("el último corte no pudo guardar /data (si el turno queda sin hacer, se relanza)");
    }
  }

  // G. ¿cron-job.org sigue disparando? En cada turno vencido debe haber un disparo manual (no del vigía)
  // entre 2 min antes y 15 min después de su hora.
  if (runsKnown) {
    const recent = pastSlots(now, 3);
    const missing = recent.filter(
      ({ start }) =>
        !runs.some(
          (r) =>
            r.event === "workflow_dispatch" &&
            (r.triggering_actor?.login ?? r.actor?.login) !== BOT &&
            Date.parse(r.created_at) >= start - 2 * MIN &&
            Date.parse(r.created_at) <= start + 15 * MIN,
        ),
    );
    if (recent.length === 3 && missing.length === 3) {
      problems.push(
        "cron-job.org no disparó ninguno de los 3 últimos turnos (los cubrieron el respaldo de GitHub o el vigía). Qué hacer: en cron-job.org revisa el historial de los trabajos «Meridiano»; si la respuesta es 401, el token de GitHub venció: crea uno nuevo (fine-grained, solo este repositorio, Actions: lectura y escritura) y pégalo solo en cron-job.org.",
      );
    } else if (missing.length > 0) {
      notes.push(`cron-job.org no disparó a su hora: ${missing.map(({ slot }) => slot.mode).join(", ")}`);
    }
  }

  // H. Salud de los datos.
  const coverage = (await guard("leer data/cut-coverage.json", () => io.file("data/cut-coverage.json"), null)) ?? {};
  const last = log[log.length - 1];
  if (!last) problems.push("No hay registro de cortes (data/cut-log.json vacío o ilegible).");
  else {
    const age = now - Date.parse(last.finishedAtBogota ?? last.startedAtBogota ?? 0);
    if (age > 14 * HOUR) problems.push("El último corte terminó hace más de 14 horas: los datos de la app están viejos.");
    if (last.fatal) notes.push(`el último corte (${last.corte}) se cayó`);
    if (last.corte === "noche" && !last.fatal && last.predictionsSaved === 0) problems.push("El corte de la noche no guardó ninguna predicción.");
  }
  if (coverage.cut === day || coverage.cut === bogotaDay(now - 24 * HOUR)) {
    if (coverage.agendaToday === 0) problems.push("El último corte leyó la agenda de hoy vacía (¿Flashscore cambió o no respondió?).");
    if (coverage.corte === "noche" && coverage.tablesRead === 0) notes.push("el corte de la noche no leyó ninguna tabla de posiciones");
    if (Array.isArray(coverage.failures) && coverage.failures.length) {
      notes.push(`pasos con error en el último corte: ${[...new Set(coverage.failures.map((f) => f.step))].join(", ")}`);
    }
    if (coverage.budgetHit) notes.push("el último corte usó todo su tiempo (se recortaron lecturas)");
    if (coverage.consensusTargets > 20 && coverage.consensusRead / coverage.consensusTargets < 0.2) {
      notes.push(`leyó cuotas de solo ${coverage.consensusRead} de ${coverage.consensusTargets} partidos objetivo`);
    }
    if (coverage.wplayCopiedDropped > 0) notes.push(`se descartaron ${coverage.wplayCopiedDropped} cuotas de Wplay copiadas de otro partido`);
  }

  const color = problems.length ? "rojo" : notes.length ? "amarillo" : "verde";
  const report = [
    `## Vigía de cortes — ${day} ${hhmm(now)} (Bogotá)`,
    "",
    `Estado: **${color}**`,
    "",
    ...lines,
    "",
    ...(actions.length ? ["### Acciones", ...actions.map((a) => `- ${a}`), ""] : []),
    ...(problems.length ? ["### Problemas", ...problems.map((p) => `- ${p}`), ""] : []),
    ...(notes.length ? ["### Notas", ...notes.map((n) => `- ${n}`), ""] : []),
  ].join("\n");
  let issue = "sin cambios";
  try {
    issue = await io.issue(report, problems);
  } catch (error) {
    issue = `no se pudo actualizar el aviso: ${String(error?.message ?? error).slice(0, 160)}`;
  }
  return { color, report, problems, notes, actions, lines, issue };
}

/* ----------------------------- Conexión real ----------------------------- */

function realIo() {
  const REPO = process.env.GITHUB_REPOSITORY || "jefferubiano19-svg/meridiano";
  const TOKEN = process.env.GITHUB_TOKEN || "";
  const DRY = !TOKEN || process.env.VIGIA_DRY === "si";
  const gh = async (method, path, body, accept = "application/vnd.github+json") => {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: accept,
        Authorization: `Bearer ${TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "meridiano-vigia",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path.split("?")[0]} → ${response.status} ${text.slice(0, 120)}`);
    if (accept.includes("raw")) return text;
    return text ? JSON.parse(text) : null;
  };
  const local = (path) => {
    try {
      return JSON.parse(fs.readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  };
  // En prueba (sin token o VIGIA_DRY=si) no cambia nada en GitHub ni en Vercel: imprime lo que haría.
  const act = (what) => {
    if (DRY) console.log(`[prueba] ${what}`);
    return !DRY;
  };
  return {
    now: process.env.VIGIA_NOW ? Date.parse(process.env.VIGIA_NOW) : Date.now(),
    simulate: process.env.VIGIA_SIMULAR || "",
    async file(path) {
      if (DRY) return local(path);
      try {
        return JSON.parse(await gh("GET", `/repos/${REPO}/contents/${path}?ref=main`, null, "application/vnd.github.raw+json"));
      } catch {
        return local(path);
      }
    },
    async runs() {
      if (process.env.VIGIA_FAKE_RUNS) return local(process.env.VIGIA_FAKE_RUNS)?.workflow_runs ?? [];
      return (await gh("GET", `/repos/${REPO}/actions/workflows/corte.yml/runs?per_page=40`)).workflow_runs ?? [];
    },
    async workflowState() {
      if (DRY) return "active";
      return (await gh("GET", `/repos/${REPO}/actions/workflows/corte.yml`)).state;
    },
    async enableWorkflow() {
      if (act("reactivaría el flujo corte")) await gh("PUT", `/repos/${REPO}/actions/workflows/corte.yml/enable`);
    },
    async cancel(id) {
      if (act(`cancelaría la ejecución ${id}`)) await gh("POST", `/repos/${REPO}/actions/runs/${id}/cancel`);
    },
    async dispatch(mode) {
      if (act(`lanzaría el corte ${mode}`)) await gh("POST", `/repos/${REPO}/actions/workflows/corte.yml/dispatches`, { ref: "main", inputs: { corte: mode } });
    },
    async failedSteps(runId) {
      if (DRY) return [];
      const jobs = (await gh("GET", `/repos/${REPO}/actions/runs/${runId}/jobs`)).jobs ?? [];
      return jobs.flatMap((job) => (job.steps ?? []).filter((step) => step.conclusion === "failure").map((step) => step.name));
    },
    async deployHook() {
      const hook = process.env.VERCEL_DEPLOY_HOOK;
      if (!hook) return false;
      if (!act("llamaría al deploy hook de Vercel")) return true;
      const response = await fetch(hook, { method: "POST" });
      return response.ok;
    },
    async issue(report, problems) {
      if (DRY) return problems.length ? "[prueba] abriría o comentaría el aviso" : "[prueba] cerraría el aviso si estuviera abierto";
      const open = (await gh("GET", `/repos/${REPO}/issues?state=open&per_page=50`)).filter((i) => i.title === ISSUE_TITLE && !i.pull_request);
      const issue = open[0];
      if (problems.length) {
        // Marca invisible con los problemas: solo se vuelve a escribir (y a mandar correo) si cambian.
        const key = `<!-- vigia:${problems.join(" | ").replace(/--/g, "-")} -->`;
        const body = `${report}\n\n_Este aviso lo escribe el vigía (scripts/vigia.mjs). Se cierra solo cuando todo vuelve a estar bien._\n\n${key}`;
        if (!issue) {
          await gh("POST", `/repos/${REPO}/issues`, { title: ISSUE_TITLE, body });
          return "abrió el aviso";
        }
        const comments = await gh("GET", `/repos/${REPO}/issues/${issue.number}/comments?per_page=100`);
        const lastText = comments.length ? comments[comments.length - 1].body : issue.body;
        if (String(lastText).includes(key)) return "aviso abierto, sin cambios";
        await gh("POST", `/repos/${REPO}/issues/${issue.number}/comments`, { body });
        return "comentó el aviso";
      }
      if (issue) {
        await gh("POST", `/repos/${REPO}/issues/${issue.number}/comments`, { body: `Resuelto.\n\n${report}` });
        await gh("PATCH", `/repos/${REPO}/issues/${issue.number}`, { state: "closed" });
        return "cerró el aviso";
      }
      return "sin aviso abierto";
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  vigia(realIo())
    .then((result) => {
      const text = `${result.report}\nAviso: ${result.issue}\n`;
      console.log(text);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
      // El aviso (issue) es el canal de correo y no se repite si nada cambia. La ejecución del vigía solo queda en
      // rojo (GitHub manda otro correo) si hay problemas y el aviso no se pudo escribir.
      if (result.problems.length && /no se pudo/.test(result.issue)) process.exitCode = 1;
    })
    .catch((error) => {
      console.error("vigía:", error);
      process.exitCode = 1;
    });
}
