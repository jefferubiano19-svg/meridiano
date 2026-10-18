# Meridiano

Probabilidades de fútbol calculadas por código, sin inteligencia artificial generativa. Sitio:
https://meridiano-beige.vercel.app. Página de transparencia: `/modelo`.

## Cómo funciona, en corto

1. Tres veces al día (00:15, 12:00 y 17:00, hora de Bogotá) cron-job.org le pide a GitHub que corra el **corte**.
   Si alguno no arranca, el vigía (abajo) lo lanza.
2. El corte lee Flashscore (respetando su robots.txt), actualiza la carpeta `data/`, guarda una predicción
   por partido antes de que empiece y evalúa las de ayer contra el resultado.
3. GitHub guarda los datos y avisa a Vercel, que vuelve a publicar el sitio.
4. Cada corte escribe una revisión automática (`data/review.json`) que se ve en la página Modelo:
   si los cortes llegaron a tiempo, qué tan precisas son las probabilidades y si hay datos raros.

## El vigía (funciona solo, sin Claude)

Cada hora, en el minuto 50, GitHub corre el **vigía** (`scripts/vigia.mjs`). Revisa los 3 cortes del día y:

- Si un corte no arrancó, se cayó o terminó sin leer la agenda, lo vuelve a lanzar (hasta 3 ejecuciones por turno;
  no lo relanza si el turno siguiente está a menos de una hora).
- Si un corte quedó atascado (en cola más de 30 min o corriendo más de 2 h 45 min), lo cancela y lo relanza.
- Si el corte terminó pero la publicación en Vercel falló, la vuelve a pedir.
- Si GitHub desactivó el corte, lo reactiva.
- Si cron-job.org deja de disparar 3 turnos seguidos (token vencido), te avisa qué hacer.
- Revisa los datos del último corte: agenda vacía, sin predicciones, tablas sin leer, pasos con error, datos viejos.
- Si algo no se pudo arreglar solo, abre un aviso en GitHub → Issues con el título
  **«Vigía de cortes: hay un problema»**. GitHub te manda un correo. El aviso dice qué pasó y qué hacer.
- Cuando todo vuelve a estar bien, cierra el aviso solo.

Para ver el estado cuando quieras: GitHub → Actions → **vigia** → la última ejecución → el resumen
(verde, amarillo o rojo, y cada corte del día con su hora y sus predicciones).

## Qué hacer si algo falla

- La página dice que el último corte tiene más de 18 horas: revisa GitHub → Actions → "corte".
  Puedes correrlo a mano con "Run workflow" (corte `noche`, `mediodia` o `tarde`; `forzar` para repetir uno ya hecho).
- Llega un correo del vigía: abre el aviso en GitHub → Issues y sigue lo que dice. Si dice que el error está en
  «npm run corte», copia el error de esa ejecución y pásalo a Claude.
- cron-job.org devuelve 401: el token de GitHub venció o se borró. Crea uno nuevo (fine-grained, solo este
  repositorio, permiso Actions: lectura y escritura) y pégalo solo en cron-job.org. El actual vence el 11 oct 2027.
- Nunca pegues tokens ni el deploy hook de Vercel en un chat.

## Subir cambios de código

Con GitHub Desktop: Fetch origin → Pull si aparece → copiar las carpetas del paquete encima del repositorio →
Commit → Push. No subas archivos de `data/` que ya existan: el corte los actualiza y se perderían datos.

Detalle técnico: `AGENTS.md`.
