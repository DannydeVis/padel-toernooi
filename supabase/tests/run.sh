#!/bin/sh
# Draait de SQL-controles tegen een lege PostgreSQL 16 (niet tegen Supabase).
# Gebruik: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -e
cd "$(dirname "$0")/.."
DB=padel_account_test
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/auth_emulation.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f account_migration.sql
# Twee keer draaien moet kunnen (staat zo in de kop van de migratie)
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f account_migration.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/account.test.sql
dropdb "$DB"
