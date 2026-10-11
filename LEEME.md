# Meridiano

Aplicación de probabilidades de fútbol. Los partidos viven en `/data` como archivos `.json`. La puerta de edad (18+) sigue. No hay registro de usuarios ni panel de administración.

## Qué hace el corte

`npm run corte` ejecuta el corte de la sección 4.1 sin un modelo de lenguaje:

1. Lee `robots.txt` y no abre las rutas prohibidas.
2. Espera al menos 3 segundos entre páginas.
3. Baja la agenda de hoy y de mañana, y los resultados de ayer, desde `m.flashscore.co`.
4. Abre las fichas de los partidos ya finalizados de ayer (xG, córners, remates, alineaciones) y la pestaña Cuotas de los partidos del Combo. No abre las fichas del Combo de hoy para estadísticas: esos partidos aún no se juegan.
5. Calcula las probabilidades con el motor de nivel C, solo de partidos que aún no empiezan.
6. Aplica las pruebas de la sección 4.7. Una cuota fuera de margen o una probabilidad que no suma 1 no se guarda.
7. Escribe el resultado en `/data`. Un marcador solo se guarda si el partido está finalizado.

La primera vez, en la máquina donde corre el corte:

```bash
npm ci
npx playwright install --with-deps chromium
npm run corte
```

## Subir a GitHub

1. Crea un repositorio vacío en GitHub.
2. En esta carpeta:

```bash
git init
git add .
git commit -m "Publicar Meridiano"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/meridiano.git
git push -u origin main
```

3. En el repositorio: Settings → Actions → General → Workflow permissions → elige **Read and write permissions**. Sin eso, el corte no puede guardar `/data`.
4. El archivo `.github/workflows/corte.yml` corre solo a las 00:15 y a las 12:00, hora de Bogotá (05:15 y 17:00 UTC). También se puede lanzar a mano en Actions → corte → Run workflow.

## Publicar en Vercel

1. Entra en [vercel.com](https://vercel.com) y elige **Add New → Project**.
2. Importa el repositorio de GitHub.
3. Framework: Vite. El comando de build ya está en `package.json` (`npm run build`).
4. No hace falta base de datos ni variable `DATABASE_URL`. No hay contador de visitas.
5. Pulsa Deploy.

Cada corte hace un commit en `/data`. Si Vercel está conectado al repositorio, ese commit publica de nuevo la página con los datos nuevos. Los JSON se leen al construir: un cambio en `/data` no se ve en el sitio hasta el siguiente deploy.

## Lo que no está

- No hay cuentas, correos ni panel de administración.
- El valor por modelo sigue apagado. El corte no inventa un dato que la página no entregó.
