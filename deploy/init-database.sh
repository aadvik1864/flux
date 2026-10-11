#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$POSTGRES_APP_PASSWORD" <<'SQL'
CREATE ROLE flux_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE flux TO flux_app;
GRANT USAGE, CREATE ON SCHEMA public TO flux_app;
SQL
