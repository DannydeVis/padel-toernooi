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
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f admin_migration.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f admin_migration.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/admin.test.sql
# Het lek: eerst de bestaande policies, dan de migratie (twee keer)
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "drop table if exists public.tournaments, public.tournament_starts, public.tournament_durations cascade"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/legacy_tables.sql
for f in rls_migration.sql signup_migration.sql competition_migration.sql security_migration.sql security_migration.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/security.test.sql
dropdb "$DB"
