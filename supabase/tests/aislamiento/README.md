# Pruebas de aislamiento entre empresas (WP0.2)

Comprueban que **un usuario de una empresa no puede leer, cambiar, borrar ni crear datos de otra**, probando las políticas RLS, los privilegios y las funciones **reales** de este repo: aplican las migraciones de `supabase/migrations/` sobre un Postgres desechable y atacan desde cada rol.

> **Nunca se ejecutan contra Supabase.** `construir-base.sh` y `probar-aislamiento.mjs` se niegan a correr si la URL parece de Supabase (`*.supabase.co`, `*.supabase.com`, `*pooler*`). `construir-base.sh` además **borra** los esquemas `public`, `auth` y `storage` de la base que se le indique.

## Cómo correrlas

Hace falta un Postgres 16 desechable y `psql`. Por ejemplo con Docker:

```bash
docker run --rm -d --name pg-aislamiento -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
export PRUEBAS_DB_URL=postgresql://postgres:postgres@localhost:5432/postgres

bash supabase/tests/aislamiento/construir-base.sh          # emulación de Supabase + todas las migraciones
cd supabase/tests/aislamiento && npm ci
node probar-aislamiento.mjs --detalle                      # sale con código 1 si hay una fuga
```

La base se **usa una vez**: para repetir la prueba hay que volver a correr `construir-base.sh`. En CI lo hace el job `aislamiento` de `.github/workflows/ci.yml` en cada pull request.

Opciones: `--detalle` (lista cada hallazgo), `--tabla=clientes` (una sola tabla), `--actualizar-linea-base` (ver más abajo). `HASTA_MIGRACION=74 bash construir-base.sh` aplica solo hasta esa migración, útil para reproducir el estado anterior a una corrección.

## Qué prueba

| Bloque | Qué intenta | Se considera fuga si… |
|---|---|---|
| **Tablas** (todas las de `public`) | Con cada uno de los 8 roles de la empresa A y como `anon`: `SELECT`, `UPDATE` y `DELETE` sobre filas de otra empresa; `INSERT` de una fila a nombre de otra empresa | afecta a una fila ajena o el `INSERT` pasa la política de RLS |
| **Escalada de privilegios** | Subirse el rol, cambiarse de empresa, mover usuarios, crear empresas o usuarios en otra empresa | alguna de esas operaciones tiene efecto |
| **Storage** | Leer, cambiar, borrar o subir objetos de otra empresa en cada bucket | lo logra (los buckets públicos se leen por diseño; las escrituras no) |
| **Funciones expuestas** | Usar por RPC, como visitante y como admin de A, las funciones `SECURITY DEFINER` contra datos de otra empresa; llamar a todas las `plataforma_*` como admin común | la función hace algo sobre datos ajenos |
| **Columnas protegidas** | Un técnico lee columnas con privilegio revocado (costos y precios) | las lee |
| **Higiene de funciones** | Inventario de funciones `SECURITY DEFINER` sin `search_path`, ejecutables por `anon` o con parámetro de empresa | aparece una **nueva** que no esté en la línea base |

Las filas "ajenas" salen de la empresa demo (que trae datos reales de las migraciones) y de una empresa B que se siembra con un generador de filas. El dueño de una fila de una tabla hija se determina por **todas** sus claves foráneas hacia una empresa; si no se puede determinar, la fila no se usa.

## Qué NO prueba (límites)

- La capa HTTP de PostgREST y del servicio de Storage, GoTrue (autenticación) ni las **Edge Functions**: se prueban las políticas y privilegios de la base, no esas capas. Las Edge Functions usan la clave de service role, que se salta RLS por diseño; su control de acceso se revisa aparte.
- Las tablas que no tienen filas ajenas (ni sembradas ni de la demo) quedan **sin cubrir** y se listan en el resultado.
- Algunos `INSERT` quedan **inconclusos** porque un disparador de negocio los rechaza antes de llegar a RLS (por ejemplo "esta OT ya fue entregada"). No cuentan como fuga ni como cubiertos.
- La emulación de Supabase (`00_shim_supabase.sql`) reproduce lo que las migraciones usan; si Supabase cambia sus privilegios por defecto, hay que actualizarla.

## La línea base de higiene (`linea-base-higiene.json`)

Es la lista de funciones expuestas que alguien **revisó y aceptó**, cada una con su motivo. Las fugas de datos no tienen tolerancia; solo la higiene se compara con la línea base, para que un hallazgo **nuevo** haga fallar la prueba.

- Una entrada con motivo `SIN REVISAR` es una función que aún nadie revisó: está tolerada, no aprobada. Hoy quedan 6 (funciones de disponibilidad de agenda que no tienen guarda visible y reciben ids).
- No basta con regenerar el archivo para aceptar un hallazgo: hay que leer la función, probarla y escribir el motivo.

## Cómo comprobar que la prueba detecta fugas

Después de `construir-base.sh`, introducir a propósito una política rota y correr la prueba debe **fallar**:

```sql
create policy mutacion on public.clientes for select using (true);
```

(Se verificó con políticas de `SELECT` abiertas en tablas con y sin `empresa_id`, un `INSERT` sin `with check` y un `UPDATE` con `SELECT` abierto: en los tres casos la prueba falló.)
