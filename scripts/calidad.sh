#!/usr/bin/env bash
# Compuerta de calidad ub-mode para el núcleo del dinero de Meridiano (ver AGENTS.md → «Disciplina de código»).
#   1. Pruebas del núcleo (npm run test:football).
#   2. Cobertura LCOV de Node (npm run coverage).
#   3. crapper: ninguna función del núcleo con CRAP ≥ 10.
#   4. dryer: ningún par de funciones del núcleo con parecido ≥ 0,8.
# Mutación (lenta, a mano): npm run calidad:mutacion
# Las herramientas (github.com/unclebob/crapper, dryer, mutator) se clonan en .tools/ en el commit fijado abajo.
set -euo pipefail

cd "$(dirname "$0")/.."
TOOLS="${CALIDAD_TOOLS:-.tools}"
CORE=(
  src/lib/football/mercados.ts
  src/lib/football/valor.ts
  src/lib/football/review.ts
  src/lib/store/mis-apuestas.ts
  src/lib/share.ts
)
# Revisadas por duplicados junto con el núcleo.
DRY_ALSO=(src/lib/football/engine.ts)

declare -A PIN=(
  [crapper]=c757ec79a6c15dc815238bbd9c2f4601eb54d3cc
  [dryer]=66ff6d21a42c04afcad89c78a80066176d1294b0
  [mutator]=29afb427129b6bf03699286966fc55ec8a4830d7
)

tool() {
  local name="$1"
  if [ ! -x "$TOOLS/$name/$name" ]; then
    mkdir -p "$TOOLS"
    git clone -q "https://github.com/unclebob/$name" "$TOOLS/$name"
    git -C "$TOOLS/$name" checkout -q "${PIN[$name]}"
  fi
  echo "$TOOLS/$name/$name"
}

if [ "${1:-}" = "mutacion" ]; then
  tool crapper >/dev/null
  npm run -s coverage
  for file in "${CORE[@]}"; do
    "$(tool mutator)" --use-existing-coverage --test-command "npm run -s test:football" --max-workers 4 "$file"
  done
  exit 0
fi

echo "== Pruebas del núcleo"
npm run -s test:football

echo "== Cobertura"
npm run -s coverage

echo "== CRAP < 10"
"$(tool crapper)" --use-existing-coverage --threshold 9.99 "${CORE[@]}" | sed -n '/^Function/,$p'

echo "== Duplicados < 0,8"
report="$("$(tool dryer)" --threshold 0.8 "${CORE[@]}" "${DRY_ALSO[@]}" 2>&1)"
echo "$report" | tail -20
if ! grep -q "No duplicate candidates found." <<<"$report"; then
  echo "dryer encontró duplicados (umbral 0,8)" >&2
  exit 3
fi

echo "Compuerta de calidad: bien."
