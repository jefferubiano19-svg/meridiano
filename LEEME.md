# Meridiano

Probabilidades de fútbol calculadas por código, sin inteligencia artificial generativa. Sitio:
https://meridiano-beige.vercel.app. Página de transparencia: `/modelo`.

## Cómo funciona, en corto

1. Dos veces al día (00:15 y 12:00, hora de Bogotá) cron-job.org le pide a GitHub que corra el **corte**.
2. El corte lee Flashscore (respetando su robots.txt), actualiza la carpeta `data/`, guarda una predicción
   por partido antes de que empiece y evalúa las de ayer contra el resultado.
3. GitHub guarda los datos y avisa a Vercel, que vuelve a publicar el sitio.
4. Cada corte escribe una revisión automática (`data/review.json`) que se ve en la página Modelo:
   si los cortes llegaron a tiempo, qué tan precisas son las probabilidades y si hay datos raros.

## Qué hacer si algo falla

- La página dice que el último corte tiene más de 18 horas: revisa GitHub → Actions → "corte".
  Puedes correrlo a mano con "Run workflow" (corte `noche` o `mediodia`; `forzar` = `si` para repetir uno ya hecho).
- cron-job.org devuelve 401: el token de GitHub venció o se borró. Crea uno nuevo (fine-grained, solo este
  repositorio, permiso Actions: lectura y escritura) y pégalo solo en cron-job.org. El actual vence el 11 oct 2027.
- Nunca pegues tokens ni el deploy hook de Vercel en un chat.

## Subir cambios de código

Con GitHub Desktop: Fetch origin → Pull si aparece → copiar las carpetas del paquete encima del repositorio →
Commit → Push. No subas archivos de `data/` que ya existan: el corte los actualiza y se perderían datos.

Detalle técnico: `AGENTS.md`.
