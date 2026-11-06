#!/usr/bin/env bash
# Construye una base de PRUEBAS: la deja vacía, aplica la emulación de
# Supabase y luego TODAS las migraciones, en orden, cada una en su
# transacción. Si una falla, se detiene y dice cuál.
#
# Uso:
#   PRUEBAS_DB_URL=postgresql://usuario:clave@127.0.0.1:5432/vpai_test \
#     bash supabase/tests/aislamiento/construir-base.sh
#
# SEGURIDAD: se niega a correr contra una base que parezca de Supabase
# (host *.supabase.co / *.supabase.com / *.pooler.*), para que nadie apunte
# esto a producción por error. Recrea el esquema public: BORRA lo que haya.
set -euo pipefail

: "${PRUEBAS_DB_URL:?Falta PRUEBAS_DB_URL (base de PRUEBAS, nunca producción)}"

case "$PRUEBAS_DB_URL" in
  *supabase.co*|*supabase.com*|*pooler*)
    echo "::error::PRUEBAS_DB_URL parece una base de Supabase. Esta prueba solo corre sobre una base local o desechable." >&2
    exit 1 ;;
esac

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
sql() { psql "$PRUEBAS_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

echo "Limpiando la base de pruebas…"
sql -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists storage cascade; create schema public; grant all on schema public to public;"

echo "Aplicando la emulación de Supabase…"
sql -f "$AQUI/00_shim_supabase.sql"
sql -f "$AQUI/01_cuentas_demo.sql"

total=0
# HASTA_MIGRACION=74 aplica solo hasta esa migración (útil para reproducir el estado anterior a una corrección).
HASTA="${HASTA_MIGRACION:-9999}"
for archivo in "$RAIZ"/supabase/migrations/*.sql; do
  nombre="$(basename "$archivo")"
  [ "$((10#${nombre:0:4}))" -gt "$HASTA" ] && continue
  if ! sql --single-transaction -f "$archivo" >/dev/null 2>"$AQUI/.ultimo-error.txt"; then
    echo "::error::Falló la migración ${nombre}:" >&2
    cat "$AQUI/.ultimo-error.txt" >&2
    exit 1
  fi
  total=$((total + 1))
done
echo "Listo: ${total} migraciones aplicadas."
