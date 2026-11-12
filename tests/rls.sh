#!/usr/bin/env bash
# Runs supabase/schema.sql and tests/rls.sql against a throw-away local PostgreSQL cluster.
# Needs PostgreSQL binaries (initdb, pg_ctl, psql). Supabase's roles and auth.uid() are stubbed
# exactly as Supabase defines them: auth.uid() reads the "sub" claim of the request's JWT.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
work="$(mktemp -d)"; port="${PGPORT_TEST:-54329}"
run() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$work"
cleanup() { run "$bin/pg_ctl -D $work/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
run "$bin/initdb -D $work/data -U postgres -A trust" >/dev/null
run "$bin/pg_ctl -D $work/data -o '-p $port -k $work -c listen_addresses=' -l $work/log -w start" >/dev/null
psql="$bin/psql -h $work -p $port -U postgres -v ON_ERROR_STOP=1 -q"
cat > "$work/prelude.sql" <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
SQL
cp "$here/../supabase/schema.sql" "$here/rls.sql" "$work/"; chmod -R a+rX "$work"/*.sql
run "$psql -f $work/prelude.sql"
run "$psql -f $work/schema.sql" 2>&1 | grep -v NOTICE || true
run "$psql -f $work/schema.sql" >/dev/null 2>&1   # running it twice must be safe
run "$psql -f $work/rls.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //' | grep -E "^(ok |FAIL|RLS:)|ERROR" | tee "$work/out.txt"
grep -q "^RLS: all checks passed" "$work/out.txt" || { echo "RLS test FAILED"; exit 1; }
echo "$(grep -c '^ok ' "$work/out.txt") checks passed on PostgreSQL $($bin/postgres --version | awk '{print $3}')"
