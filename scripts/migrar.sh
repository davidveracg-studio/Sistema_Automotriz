#!/usr/bin/env bash
# Aplica a la base las migraciones de supabase/migrations/ que aún no se han
# aplicado, en orden, cada una en su propia transacción. Pensado para CI.
#
# - Lleva el registro en public.migraciones_aplicadas (sin acceso desde la API:
#   RLS activa y sin políticas).
# - LINEA_BASE: las migraciones con número <= a esta se aplicaron a mano en el
#   SQL Editor antes de existir este script; la primera vez se registran como
#   aplicadas sin ejecutarlas.
# - Si una migración falla, se revierte esa migración y el script termina con
#   error: las siguientes no se ejecutan.
#
# Uso:
#   SUPABASE_DB_URL=postgresql://... scripts/migrar.sh            # aplica
#   SUPABASE_DB_URL=postgresql://... scripts/migrar.sh --listar   # solo lista pendientes
set -euo pipefail

LINEA_BASE="${LINEA_BASE:-68}"
DIRECTORIO="${DIRECTORIO_MIGRACIONES:-supabase/migrations}"
MODO="${1:-aplicar}"

: "${SUPABASE_DB_URL:?Falta SUPABASE_DB_URL (cadena de conexión de Postgres)}"

sql() { psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

sql -c "create table if not exists public.migraciones_aplicadas (
  archivo text primary key,
  aplicada_en timestamptz not null default now(),
  origen text not null default 'ci'
);
alter table public.migraciones_aplicadas enable row level security;"

if [ "$(sql -At -c 'select count(*) from public.migraciones_aplicadas')" = "0" ]; then
  echo "Primera ejecución: registrando como ya aplicadas las migraciones <= ${LINEA_BASE}."
  for archivo in "$DIRECTORIO"/*.sql; do
    nombre="$(basename "$archivo")"
    numero=$((10#${nombre:0:4}))
    if [ "$numero" -le "$LINEA_BASE" ]; then
      sql -c "insert into public.migraciones_aplicadas (archivo, origen) values ('${nombre}', 'manual') on conflict do nothing;"
    fi
  done
fi

pendientes=0
for archivo in "$DIRECTORIO"/*.sql; do
  nombre="$(basename "$archivo")"
  ya="$(sql -At -c "select 1 from public.migraciones_aplicadas where archivo = '${nombre}'")"
  [ -n "$ya" ] && continue
  pendientes=$((pendientes + 1))
  if [ "$MODO" = "--listar" ]; then
    echo "Pendiente: ${nombre}"
    continue
  fi
  echo "Aplicando ${nombre}…"
  sql --single-transaction -f "$archivo"
  sql -c "insert into public.migraciones_aplicadas (archivo) values ('${nombre}');"
done

if [ "$pendientes" -eq 0 ]; then
  echo "No hay migraciones pendientes."
fi
