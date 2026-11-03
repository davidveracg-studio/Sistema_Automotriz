#!/usr/bin/env bash
# Automatiza el paso del PR: abre el PR de una rama hacia main y, cuando el CI
# de esa rama pasa, lo fusiona y lanza el deploy. Lo usa
# .github/workflows/pr-automatico.yml; la lógica vive aquí para poder probarla.
#
#   RAMA=ccr-xyz TITULO=... MENSAJE=... scripts/pr-automatico.sh abrir
#   RAMA=ccr-xyz SHA=<commit verificado por el CI>  scripts/pr-automatico.sh fusionar
#
# Seguridad:
# - Solo actúa sobre ramas ccr-* y claude/** (el resto de las ramas no se toca).
# - Solo fusiona si el último commit del PR es EXACTAMENTE el que el CI verificó
#   (--match-head-commit): un commit posterior sin verificar nunca se cuela.
# - La etiqueta `no-automerge` (o un PR en borrador) detiene la fusión.
# - Un merge hecho con el token de Actions no dispara el workflow de deploy
#   (regla de GitHub contra bucles), así que el deploy se lanza a mano.
set -euo pipefail

: "${RAMA:?Falta RAMA}"
ACCION="${1:-}"

case "$RAMA" in
  ccr-* | claude/*) ;;
  *)
    echo "La rama '$RAMA' no está en el patrón automático (ccr-*, claude/**); no se hace nada."
    exit 0
    ;;
esac

prs_abiertos() {
  gh pr list --head "$RAMA" --base main --state open --json number,headRefOid,isDraft,labels
}

abrir() {
  local existentes
  existentes="$(prs_abiertos)"
  if [ "$(jq 'length' <<<"$existentes")" -gt 0 ]; then
    echo "Ya hay un PR abierto para '$RAMA' (#$(jq -r '.[0].number' <<<"$existentes")); nada que crear."
    return 0
  fi

  local titulo
  titulo="$(head -n1 <<<"${TITULO:-}")"
  titulo="${titulo:-Cambios de $RAMA}"
  local cuerpo
  cuerpo="${MENSAJE:-}

---
PR abierto automáticamente (.github/workflows/pr-automatico.yml). Se fusionará solo cuando el CI pase y se publicará en producción. Para impedirlo, agrega la etiqueta \`no-automerge\` o pásalo a borrador."

  local salida
  if salida="$(gh pr create --base main --head "$RAMA" --title "$titulo" --body "$cuerpo" 2>&1)"; then
    echo "$salida"
  elif grep -qi "no commits between" <<<"$salida"; then
    echo "La rama '$RAMA' no tiene cambios respecto de main; no se abre PR."
  else
    echo "::error::No se pudo abrir el PR: $salida"
    return 1
  fi
}

fusionar() {
  : "${SHA:?Falta SHA (commit verificado por el CI)}"
  local datos
  datos="$(prs_abiertos)"
  if [ "$(jq 'length' <<<"$datos")" -eq 0 ]; then
    echo "No hay PR abierto para '$RAMA' (¿ya se fusionó?); nada que hacer."
    return 0
  fi

  local numero cabeza borrador bloqueado
  numero="$(jq -r '.[0].number' <<<"$datos")"
  cabeza="$(jq -r '.[0].headRefOid' <<<"$datos")"
  borrador="$(jq -r '.[0].isDraft' <<<"$datos")"
  bloqueado="$(jq -r '[.[0].labels[].name] | index("no-automerge") != null' <<<"$datos")"

  if [ "$borrador" = "true" ]; then
    echo "El PR #$numero es un borrador; no se fusiona."
    return 0
  fi
  if [ "$bloqueado" = "true" ]; then
    echo "El PR #$numero tiene la etiqueta no-automerge; no se fusiona."
    return 0
  fi
  if [ "$cabeza" != "$SHA" ]; then
    echo "El PR #$numero ya tiene commits más nuevos que el verificado por el CI ($SHA); se espera su propio CI."
    return 0
  fi

  echo "CI verde sobre $SHA: fusionando el PR #$numero."
  gh pr merge "$numero" --merge --match-head-commit "$SHA"
  echo "Lanzando el deploy (el merge con el token de Actions no lo dispara solo)."
  gh workflow run deploy-vercel.yml --ref main
}

case "$ACCION" in
  abrir) abrir ;;
  fusionar) fusionar ;;
  *)
    echo "Uso: pr-automatico.sh abrir|fusionar" >&2
    exit 2
    ;;
esac
