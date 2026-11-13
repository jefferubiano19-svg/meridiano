# Meridiano — guía técnica

App de probabilidades de fútbol (1X2, goles, ambos marcan) para partidos de la agenda de Flashscore.
No usa modelos de lenguaje: todo lo calcula código determinista. Este archivo describe el sistema
tal como funciona hoy; si el código y este texto no coinciden, manda el código.

## Piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| App web | `src/` (TanStack Start + Vite + Nitro, preset Vercel) | Lee `/data` en el build y muestra fichas, listas, combinada y la página Modelo. |
| Corte | `scripts/corte.mjs` (Node 22 + Playwright Chromium) | Lee Flashscore, actualiza `/data`, guarda predicciones y evalúa las de ayer. |
| Programación | `.github/workflows/corte.yml` | Corre el corte. Lo dispara cron-job.org (00:15, 12:00 y 17:00 Bogotá) por `workflow_dispatch`; no tiene `schedule` propio (GitHub lo atrasaba hasta 2 h y repetía cortes); si falta un turno, el vigía (`vigia.yml`) lo relanza. Antes de correr hace `git pull` para que el candado vea el estado más reciente. Al final hace commit de `data/` y llama al deploy hook de Vercel. |
| Despliegue | Vercel | Reconstruye la app con los datos nuevos tras cada corte. |

Secretos: `VERCEL_DEPLOY_HOOK` en GitHub Actions. El token de cron-job.org vive solo en cron-job.org.
Nunca se escriben secretos ni datos personales en el repositorio.

## Vigía

`.github/workflows/vigia.yml` corre `scripts/vigia.mjs` cada hora (minuto 50 UTC) con el `GITHUB_TOKEN` del flujo
(permisos `actions: write`, `issues: write`). Revisa los turnos del día con `cut-done.json`, `cut-log.json` y la API de
ejecuciones de `corte.yml`; relanza por `workflow_dispatch` un turno vencido (40 min de margen) si no hay otro corriendo,
máximo 3 ejecuciones por turno y nunca a menos de 60 min del turno siguiente. Escribe el resumen de la ejecución y
mantiene el issue «Vigía de cortes: hay un problema» (lo abre o comenta solo si los problemas cambian; lo cierra al
resolverse). No escribe en `data/`. Pruebas: `node --test scripts/vigia.test.mjs` (23 casos: atascos, reintentos, Vercel, cron-job.org, flujo desactivado, errores de la API, datos dañados). Prueba en seco: `VIGIA_DRY=si node scripts/vigia.mjs`.

## Corte (orden)

1. Candado: un corte de cada tipo por día (`data/cut-done.json`). `FORZAR=si` lo repite.
2. Agenda de hoy y mañana y resultados de ayer desde `m.flashscore.co` (versión Lite). Prefijos de país en español → inglés (`places.ts`).
3. Corrige marcadores con la página de resultados de ayer.
4. Fichas de partidos finalizados (xG, córners, alineaciones) con el tiempo que sobre del presupuesto de 110 min (el job tiene 150).
5. Noche: tablas de 17 ligas → `data/standings-auto.json`.
6. Ratings del Nivel B → `data/ratings.json`. Cuotas de 5 casas (Betano, Wplay, Stake, Bwin, BetPlay; solo esas: el runner de GitHub está en EE. UU. y Flashscore a veces muestra bet365.us u otras, que se descartan al leer, al guardar, en el cierre, en las marcas y en la revisión) (desde el 27 oct 2026 Flashscore filtra por ubicación: `browserPages` reescribe `geoIpCode=CO` / `geoIpSubdivisionCode=CODC` en las peticiones a `global.ds.lsapp.eu/odds/` y, si la pestaña Cuotas no aparece, `readOdds` abre `#/comparacion-de-cuotas/1x2-cuotas/partido`; diagnóstico a mano: `diag.yml` → `data/diag-cuotas.json`) de hasta 450 partidos de hoy y de mañana que ya tienen cuota (máx. 90 min; si la página no tiene pestaña Cuotas se pasa al siguiente sin esperar; ligas fuertes con 1X2, goles y ambos marcan; el resto solo 1X2; no se lee una cuota a menos de 10 min del inicio) → `data/combo-odds.json`. Cuotas 1X2 de Wplay de la Lite → `data/wplay-odds.json` (3 días). El lector busca la caja de cuotas solo entre un partido y el siguiente; filas nuevas llevan `v: 2`. Las viejas copiadas de otro partido (misma hora de lectura y mismas 3 cuotas) se descartan (`wplay-clean.ts`), y un partido que sale sin cuota pierde la guardada.
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
- 3+ casas vigentes: consenso solo (Shin, mediana), `CONSENSUS_WEIGHT = 1` desde el 15 oct 2026 (257 partidos: 0,1929 contra 0,1963 de la mezcla 0,8; IC de la diferencia −0,0054 a −0,0014; gana en la mitad reciente y en todos los niveles). La mezcla 0,8 sigue medida como sombra en `review.json` (`modelBlend`).
- Sin consenso, con Wplay leída antes del inicio: 80 % Wplay sin margen + 20 % modelo (desde el 13 oct 2026; evidencia: 543 partidos, RPS −0,0154, IC 95 % −0,024 a −0,007).
- Sin mercado: modelo.

Marca de valor: 3+ casas y EV ≥ 3 % contra el consenso sin la casa juzgada. El modelo solo no marca valor.

**Mejor cuota** (`publish.ts` `bestOdds`): por resultado, la casa que más paga entre las leídas (pestaña Cuotas; Wplay de la
Lista si no está en la pestaña) y el margen que queda. Solo informa; no cambia ninguna probabilidad. Se ve en la ficha y en Apuesta.

**Valor del día** (`src/lib/football/valor.ts`, página `/valor`): con 3+ casas, la mejor cuota de cada resultado contra el
consenso de esas mismas casas; se muestra si da entre +3 % y +15 % por apuesta, con la cuota mínima ((1 + 3 %) ÷ prob.).
El corte guarda cada selección la primera vez que aparece en `data/valor-registro.json` (no se edita) y `review.ts`
→ `pickResults` la mide igual que las marcas. La lectura de cierre cubre marcas y selecciones.

**Cierre** (`.github/workflows/cierre.yml`, minuto 23 de cada hora): `CORTE=cierre` lee la tabla 1X2 de los partidos con
marca de valor que empiezan en 10–130 min y la guarda en `data/cierres.json` (solo ese archivo). Si no hay marcas por
cerrar, la vuelta termina sin instalar nada. `review.ts` → `valueResults`: retorno real de las marcas (IC 95 %), contra la
misma casa al cierre y contra el consenso de cierre (`evClose`, la medida que decide; 30 cierres para una primera
lectura, 100 para concluir). La página Modelo lo muestra en «¿Las marcas de valor ganan?».

**Aviso, cuota vigente y listas (4 nov 2026)**:
- Aviso: tras el paso `valor-del-dia`, `notifyPicks` comenta en el issue «Valor del día: selecciones nuevas» con @dueño
  (correo de GitHub) las selecciones nuevas que no han empezado. `corte.yml` da `issues: write` y `GITHUB_TOKEN`.
- Cuota vigente: `cierre()` relee también, cada hora, las selecciones que empiezan entre 130 min y 24 h (15 como máximo, sin reintentos)
  → `data/vigentes.json`. `vigentes.ts` → `currentOdds` toma la lectura más reciente (vigentes o cierres) y `/valor`
  dice si la selección sigue con valor (`recheck`). Solo informa: la medición sigue con `cierres.json`.
- Niveles por probabilidad en `/valor` (regla del 5 nov 2026, reemplaza el filtro de cuota < 4): «Alta · 40 % o más»
  (por defecto), «25 % o más» y «Todas»; puesto 1 a N por probabilidad entre las que siguen con valor. Base: 195
  resueltas al 4 nov (40 %+: 22 de 39, +17 % en plata, +5,2 % al cierre; < 20 %: 5 de 73, −42 % en plata; todas las
  franjas con valor al cierre positivo). `review.ts` → `pickTiers` mide cada nivel en todo el histórico y, aparte,
  solo desde el 5 nov (`forward`, la prueba limpia: el corte se eligió mirando el histórico). El registro no cambia:
  se siguen guardando todas las selecciones. `pickResultsLow` (cuota < 4) se sigue calculando.
- El aviso por correo ordena por probabilidad y marca el nivel (Alta / Media / Baja).
- **Regla v2 de «Valor del día» (5 nov 2026, pedida por el usuario):** `valor.ts` → `VALUE_MIN_PROB = 0,40`: solo se
  registran y muestran resultados de 40 % o más (filas nuevas con `rule: "v2"`). Además de 1X2, **doble oportunidad**
  (`dc`: 1X, 12, X2) y **empate no válido** (`dnb`: local, visita) con la probabilidad del mismo consenso 1X2
  (`doublePicks`; dnb: valor = p_gana × cuota + p_empate − 1). Lectura: paso `cuotas-dobles` del corte (`readDoubleMarkets`,
  por la dirección de la pestaña `/cuotas/doble-oportunidad/` y `/cuotas/draw-no-bet/`; el clic no abre; se comprueba el
  encabezado «1X12X2» o «12»; filas incompletas se descartan); 120 partidos con 3+ casas en las próximas 30 h, máx.
  25 min → `combo-odds.json` `markets.dc` / `markets.dnb` y `doubleReadAt`. El cierre de cada hora también lee esos
  mercados para las selecciones dc/dnb (cuota vigente en `vigentes.json` → `double`). `review.ts` liquida dc (dos
  resultados) y dnb (empate = se devuelve) y mide contra el consenso 1X2 de cierre; `pickRuleV2` (total y por mercado)
  es la prueba limpia. La página `/valor` ya no tiene filtros de nivel: muestra solo la regla v2.
- Listas: al final de cada corte, `scripts/listas.mjs` (proceso aparte) guarda «Partido hoy» y «Partido» en
  `data/listas.json` (una por día y corte, 30 días); `listas.ts` → `listHistory` muestra en «Partido hoy» cuántas acertó
  la lista de la madrugada de cada día.
- La página Modelo muestra «¿“Valor del día” gana?» (`pickResults`); las marcas de valor se siguen midiendo
  (`valueResults`) pero no se muestran.

**Búsqueda de valor de cada hora y aviso «ya no tiene valor» (11 nov 2026):** base: las selecciones se registraban a
una mediana de 14,7 h del inicio y solo 73 de 187 (39 %) seguían con valor al cierre en la misma casa.
- `cierre()` lee además hasta 25 partidos con 3+ casas colombianas en `combo-odds.json` que empiezan entre 130 min y
  6 h (`SCAN_HOURS`) y que no están ya en cierre o cuota vigente; primero los que llevan más tiempo sin leerse
  (`vigentes.json`). Tope de 15 min para la vuelta principal (`stop` de `browserPages`; la búsqueda va al final).
  Las lecturas van a `vigentes.json`.
- Con cada lectura a más de 130 min del inicio (búsqueda y cuota vigente) aplica la regla v2 (`valuePicks`,
  `doublePicks`) y registra lo nuevo en **`data/valor-hora.json`** (`rule: "v2"`, `source: "hora"`), archivo aparte de
  `valor-registro.json` para que el corte y el cierre, que pueden correr a la vez, no choquen al hacer push.
  `readPicks()` junta los dos (revisión, objetivos del cierre, duplicados del corte); `pickKey` es la clave común.
  No registra dentro de la ventana de cierre: la lectura del registro no puede ser la misma con que se mide.
- Aviso: `notifyPicks(picks, origen)` y `notifyLost` comentan en el issue #3 vía `commentValor`. «Ya no tiene valor»:
  selección v2 registrada, sin empezar, cuya mejor cuota colombiana de ahora queda debajo de la mínima calculada con
  el consenso de ahora (+3 %); solo con 3+ casas leídas; una vez por selección (`data/avisos.json`, 3 días).
  `/valor` usa la misma regla (`still` = mejor cuota ≥ mínima), también cuando el valor pasa del +15 %.
- Revisión del 12 nov 2026 (21 vueltas, todas bien, 1–5 min): ~40 % de las lecturas del cierre salían vacías. Causa
  (diag.yml): desde EE. UU. Flashscore no muestra la pestaña Cuotas en Colombia, Uruguay, CAN, Liga MX Femenil,
  etc., aunque la API del comparador trae las 5 casas colombianas; dependía del servidor (a veces sí, a veces no).
  Arreglo: `readOddsApi` — si no hay pestaña ni tabla, `readOdds` pide `oce` (comparador, vista de Colombia) y
  `dsof` (local/visita por `side`; la API no pone siempre al local primero) con `page.request` (robots.txt revisado)
  → filas 1X2 (`viaApi`) y `doubles` (dc 1X/12/X2, dnb). Primera vuelta con el arreglo: 3 de 3 bien, cierre guardado.
  Además `browserPages(jobs, stop, again)` relee una vez al final las que no traen 3 casas (`lastRun.retried`,
  `retriedOk`); tope de la vuelta principal 18 min.
- Revisión del 13 nov 2026: 430 de 430 lecturas del cierre con 3+ casas en 24 h (antes ~40 % vacías); local/visita
  por API igual al corte en 152 de 152 partidos con favorito claro. **Dobles con consenso viejo:** la 1X2 del paso de
  cuotas y los dobles se leían con una mediana de 63 min de diferencia (hasta 11 h), y varias selecciones dc/dnb
  eran solo movimiento del mercado (Ebreichsdorf 1,85 → 1,62 entre las dos lecturas; «empate o ASK Ybbs» a 2,10 con
  +3 % contra el consenso viejo, sin valor contra el de la misma hora). Arreglo: el paso `cuotas-dobles` devuelve la
  1X2 de la misma visita y `storeDouble` la guarda con los dobles (`readAtBogota` = `doubleReadAt`); sin 1X2 fresca
  borra los dobles. El paso `valor-del-dia` y `vigentes.ts` → `doubleOffers` usan dobles solo si
  `doubleReadAt === readAtBogota`. Las 23 dc/dnb del corte registradas antes del 13 nov se leyeron así (el registro
  no se edita; se miden igual contra el cierre). Avisos «ya no tiene valor»
  con la mínima redondeada (`+ 0,005`): 1,14 contra 1,1401 ya no se avisa; `/valor` igual.
- `cierre.yml`: `issues: write`, `GITHUB_TOKEN`, timeout 35 min; el paso «¿Hay…?» cuenta también los partidos de la
  búsqueda; guarda `cierres.json`, `vigentes.json`, `valor-hora.json` y `avisos.json`. `lastRun` agrega `scan`, `added`, `lost`.
- `/valor` muestra las selecciones de `valor-hora.json` (`vigentes.ts` → `hourPicks`, `MatchReading.hourPicks`) que
  no salen con la cuota del corte. `review.ts` → `pickRuleV2.bySource` (corte / hora).

**Mis apuestas** (página `/mis-apuestas`, 11 nov 2026): el usuario anota sus apuestas reales (fecha, partido, mercado,
selección, casa, cuota, monto, resultado, combinada). Solo en el navegador (`src/lib/store/mis-apuestas.ts`,
localStorage `meridiano-mis-apuestas`, con try/catch); nada va al repositorio. Separa «siguiendo las reglas» (sola, casa
indicada, cuota ≥ mínima de «Valor del día»; `followedRules`) de «sin seguir las reglas», compara con `pickRuleV2.all`
y avisa de combinadas y cuotas debajo de la mínima. Botón «Anotar mi apuesta» en cada tarjeta de `/valor` (borrador en
memoria, `setDraft`/`takeDraft`). Exporta a PDF y Excel.

**El rival marca** (página `/rival`): de las listas «Partido hoy» y «Partido» (mañana), la probabilidad de que el no
favorito haga al menos un gol, con los goles esperados que reproducen la 1X2 publicada (`engine.ts` → `rivalScores`,
`lambdasFor`). `review.ts` → `rivalGoal` la mide contra los marcadores (Brier contra la frecuencia y calibración por
tramos; 28 oct 2026: 9.247 partidos, 0,2180 contra 0,2236; por encima de 80 % exagera: 83 % dicho, 75 % real). Sin
recalibrar: la recalibración logística no mejoró fuera de muestra (IC de la mejora −0,0006 a +0,0012).
`lambdasFor` busca en rejilla cuando Newton no converge (favoritos de ~90 % terminaban en 4,0 y 4,0).

**Sombras** (se guardan, no se publican): xG, Elo de clubes, temporada Liga BetPlay (`season.ts`). La sombra
«favoritos» (corrección de favoritos fuertes, `favorites.ts` → `adjustFavorite`, 5 nov 2026) se quitó el 11 nov 2026:
en 3.419 partidos no mejoró la RPS publicada. Base: con favorito de 65 %+, ganó 77,9 % contra 74,4 % dicho (femenino 87,4 / 78,0; copas
84,2 / 75,8), estable antes y después del 24 oct; prueba fuera de muestra −0,0002 de RPS (IC −0,0006 a +0,0002).
Una sombra se publica solo con ≥ 500 partidos comparados y el IC 95 % de la diferencia de RPS entero bajo cero.
Congelamiento de parámetros hasta 500 partidos comparables con el consenso.

## Agenda

Mejoras del 5 nov 2026:
- Resumen arriba (`dayBoard` → `yesterday`): cuántas veces ganó ayer el favorito de cada partido contra lo esperado.
- Insignias por partido (`withBadges` en page-data.ts): «Valor del día» (regla v2) y «El rival marca NN %» (70 %+);
  también en «Partido hoy» y «Partido». «Favorito con valor (en prueba)» se quitó el 11 nov 2026 (−1,6 % en 92
  partidos); se sigue midiendo en `favoritos-registro.json`.
- Filtro «Con 3+ casas · más confiable», activo por defecto cuando hay 10+ partidos con consenso.
- 6 nov 2026: «Partido hoy» y «Partido» muestran por defecto el modo **«Favorito o empate (más seguro)»** (puesto,
  ✔/✘ y avance con doble oportunidad; botón para «Gana el favorito»). Listas del 4 y 5 nov: gana el favorito 10/20 y
  15/20 (esperado 10,6 y 15,8: calibradas); favorito o empate 14/20 y 18/20. Desde el 9 nov 2026 la lista vuelve a tener siempre 20, separados en «Confiables» (favorito de 60 %+, `LIST_MIN_PROBABILITY`) y «Menos seguros», con aciertos de los confiables aparte en el historial; guarda la probabilidad de empate (`draw`).
- «Partido hoy» usa la **lista fija** de la madrugada (`listas.ts` → `savedList`; `frozenPick`) con ✔/✘ y avance del
  día; si aún no hay lista guardada, la calcula. Cada partido muestra «favorito o empate» (calibrado: 85–90 % → 89 %,
  90–95 % → 94 %).
- «Favorito con valor» EN PRUEBA (`valor.ts` → `favoritePick`, 65 %+ con la corrección de favoritos y +3 a +15 % de
  valor): registro aparte `data/favoritos-registro.json` (lo escribe el corte), medido en `review.ts` →
  `favoriteResults`; no entra en «Valor del día» ni en el aviso hasta tener 100 jugados con resultado positivo.

Filtros: «Con cuota en casas», «revisar o valor», «Nivel» (A, B, C, M, selecciones) y la vista «Mejores ligas»:
los 20 partidos del día de las competiciones de `top-leagues.ts` (continentales UEFA/CONMEBOL por jerarquía oficial;
ligas por el ranking de Opta de julio 2026, con fuente y advertencia en el archivo). Actualizar la lista cuando Opta publique otro ranking.

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
