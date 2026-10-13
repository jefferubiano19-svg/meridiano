# Meridiano — guía técnica

App de probabilidades de fútbol (1X2, goles, ambos marcan) para partidos de la agenda de Flashscore.
No usa modelos de lenguaje: todo lo calcula código determinista. Este archivo describe el sistema
tal como funciona hoy; si el código y este texto no coinciden, manda el código.

## Piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| App web | `src/` (TanStack Start + Vite + Nitro, preset Vercel) | Lee `/data` en el build y muestra fichas, listas, combinada y la página Modelo. |
| Corte | `scripts/corte.mjs` (Node 22 + Playwright Chromium) | Lee Flashscore, actualiza `/data`, guarda predicciones y evalúa las de ayer. |
| Programación | `.github/workflows/corte.yml` | Corre el corte. Lo dispara cron-job.org (00:15, 12:00 y, opcional, 17:00 "tarde" Bogotá) por `workflow_dispatch`; los `schedule` de GitHub son respaldo. Al final hace commit de `data/` y llama al deploy hook de Vercel. |
| Despliegue | Vercel | Reconstruye la app con los datos nuevos tras cada corte. |

Secretos: `VERCEL_DEPLOY_HOOK` en GitHub Actions. El token de cron-job.org vive solo en cron-job.org.
Nunca se escriben secretos ni datos personales en el repositorio.

## Corte (orden)

1. Candado: un corte de cada tipo por día (`data/cut-done.json`). `FORZAR=si` lo repite.
2. Agenda de hoy y mañana y resultados de ayer desde `m.flashscore.co` (versión Lite). Prefijos de país en español → inglés (`places.ts`).
3. Corrige marcadores con la página de resultados de ayer.
4. Fichas de partidos finalizados (xG, córners, alineaciones) con el tiempo que sobre del presupuesto de 110 min (el job tiene 150).
5. Noche: tablas de 17 ligas → `data/standings-auto.json`.
6. Ratings del Nivel B → `data/ratings.json`. Cuotas de 5 casas (Betano, Wplay, Stake, Bwin, BetPlay) de hasta 450 partidos de hoy y de mañana que ya tienen cuota (máx. 75 min; ligas fuertes con 1X2, goles y ambos marcan; el resto solo 1X2; no se lee una cuota a menos de 10 min del inicio) → `data/combo-odds.json`. Cuotas 1X2 de Wplay de la Lite → `data/wplay-odds.json` (3 días).
7. Predicciones de partidos por empezar → `data/predictions.json` (una fila no se edita).
8. Evaluación de lo finalizado → `data/evaluations.json`; marcas de valor y CLV.
9. Registro: `data/cut-coverage.json` (último corte), `data/cut-log.json` (últimos 90) y revisión automática `data/review.json` (`src/lib/football/review.ts`).

Reglas de lectura: respetar `robots.txt`, 3 s entre páginas, User-Agent propio. Rutas prohibidas por robots
(no abrir): `m.flashscore.co/partido/`, `m.flashscore.co/clasificacion/`, y en www `/en-directo/`,
`/finalizados/`, `/proximos/`, `/clasificacion/`, `*/dia-2..7/`, `*/dia+2..7/`.

## Motor

- **Nivel A** (`dixon.ts`): Dixon-Coles por liga (16 ligas, `data/dixon.json`, ajuste del 5 oct 2026 con football-data.co.uk) mezclado con la fuerza de mercado (peso 0,5).
- **Nivel B** (`ratings.ts`, `data/ratings.json`): ratings globales de ataque/defensa (Poisson con ridge 10, nivel por competición con ridge 20, vida media 120 d, sede desconocida = 0,5). Los ajusta cada corte con `ratingGames()` de `recent.ts`. Backtest 4–12 oct, 4.428 partidos: RPS 0,2148 vs 0,2253 del motor anterior; +279 partidos cubiertos.
- **Nivel C** (`recent.ts`): respaldo; goles recientes, vida media 120 días, contracción 8.
- **Nivel M** (`publish.ts` `marketOnly`): sin modelo pero con cuotas: se publica el mercado solo.
- **Selecciones** (`nations.ts`): Elo de eloratings.net con regresión por competición.
- Matriz de marcadores con rho de Dixon-Coles (`engine.ts`); goles esperados entre 0,20 y 4,00.

**Publicada** (`publish.ts`), en log-odds:
- 3+ casas vigentes: 80 % consenso (Shin, mediana) + 20 % modelo.
- Sin consenso, con Wplay leída antes del inicio: 80 % Wplay sin margen + 20 % modelo (desde el 13 oct 2026; evidencia: 543 partidos, RPS −0,0154, IC 95 % −0,024 a −0,007).
- Sin mercado: modelo.

Marca de valor: 3+ casas y EV ≥ 3 % contra el consenso sin la casa juzgada. El modelo solo no marca valor.

**Sombras** (se guardan, no se publican): xG, Elo de clubes, temporada Liga BetPlay (`season.ts`).
Una sombra se publica solo con ≥ 500 partidos comparados y el IC 95 % de la diferencia de RPS entero bajo cero.
Congelamiento de parámetros hasta 500 partidos comparables con el consenso.

## Revisión automática

`review.ts` calcula, en cada corte: semáforo de cortes (7 días), cobertura por nivel, evaluación con IC 95 %
y etapa (< 150 muestra insuficiente, 150–499 preliminar, ≥ 500 formal), Wplay como mercado, sombras,
calibración y anomalías de datos. La página `/modelo` la muestra. Solo mide; no cambia parámetros.

## Comandos

```bash
npm ci
npm run build          # app
npm run corte          # corte (CORTE=noche|mediodia, FORZAR=si)
npx tsc --noEmit -p .  # tipos
```

## Al cambiar código

- No cambiar parámetros del motor sin backtest fuera de muestra y sin pasar la regla de 500.
- No editar filas existentes de `data/predictions.json`.
- Archivos de `data/` que escribe el corte no se suben a mano: se pisarían datos nuevos.
