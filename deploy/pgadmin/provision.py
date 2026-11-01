#!/usr/bin/env python3
"""Run on the production host after a backup; never print generated passwords."""
import json
import os
from pathlib import Path
import secrets
import subprocess

ROOT = Path('/opt/spatial-memory')
PRIVATE = ROOT / 'pgadmin/private'
os.umask(0o077)
PRIVATE.mkdir(parents=True, exist_ok=True)
PRIVATE.chmod(0o700)
credentials_path = PRIVATE / 'credentials.json'
if credentials_path.exists():
    credentials = json.loads(credentials_path.read_text())
else:
    credentials = {
        'url': 'https://db.spatialmemory.online',
        'email': 'admin@spatialmemory.online',
        'login_password': secrets.token_urlsafe(30),
        'readonly_username': 'spatial_memory_readonly',
        'readonly_password': secrets.token_urlsafe(30),
        'maintenance_username': 'spatial_memory_maintenance',
        'maintenance_password': secrets.token_urlsafe(30),
    }
    credentials_path.write_text(json.dumps(credentials, ensure_ascii=False, indent=2) + '\n')
credentials_path.chmod(0o600)
password_file = PRIVATE / 'login-password'
password_file.write_text(credentials['login_password'] + '\n')
os.chown(password_file, 5050, 5050)
password_file.chmod(0o400)

def literal(value):
    return "'" + value.replace("'", "''") + "'"

# Object ownership and existing application credentials are unchanged.
# SECURITY DEFINER maintenance functions previously executable by PUBLIC must
# not provide the read-only role a route around table ACLs.
sql = """
BEGIN;
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='spatial_memory_readonly') THEN
    CREATE ROLE spatial_memory_readonly LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='spatial_memory_maintenance') THEN
    CREATE ROLE spatial_memory_maintenance LOGIN;
  END IF;
END
$roles$;
ALTER ROLE spatial_memory_readonly NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 5;
ALTER ROLE spatial_memory_maintenance NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 5;
ALTER ROLE spatial_memory_readonly SET default_transaction_read_only=on;
ALTER ROLE spatial_memory_readonly SET statement_timeout='30s';
ALTER ROLE spatial_memory_maintenance SET statement_timeout='60s';
ALTER ROLE spatial_memory_readonly SET idle_in_transaction_session_timeout='60s';
ALTER ROLE spatial_memory_maintenance SET idle_in_transaction_session_timeout='60s';
GRANT CONNECT ON DATABASE spatial_memory TO spatial_memory_readonly, spatial_memory_maintenance;
GRANT USAGE ON SCHEMA public, auth, migration_archive TO spatial_memory_readonly, spatial_memory_maintenance;
GRANT SELECT ON ALL TABLES IN SCHEMA public, auth, migration_archive TO spatial_memory_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, auth TO spatial_memory_maintenance;
GRANT SELECT ON ALL TABLES IN SCHEMA migration_archive TO spatial_memory_maintenance;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, auth TO spatial_memory_maintenance;
ALTER DEFAULT PRIVILEGES FOR ROLE spatial_memory IN SCHEMA public, auth, migration_archive
  GRANT SELECT ON TABLES TO spatial_memory_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE spatial_memory IN SCHEMA public, auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spatial_memory_maintenance;
ALTER DEFAULT PRIVILEGES FOR ROLE spatial_memory IN SCHEMA migration_archive
  GRANT SELECT ON TABLES TO spatial_memory_maintenance;
ALTER DEFAULT PRIVILEGES FOR ROLE spatial_memory IN SCHEMA public, auth
  GRANT USAGE, SELECT ON SEQUENCES TO spatial_memory_maintenance;
DO $functions$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','auth') AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO spatial_memory_maintenance', fn.signature);
  END LOOP;
END
$functions$;
"""
sql += 'ALTER ROLE spatial_memory_readonly PASSWORD ' + literal(credentials['readonly_password']) + ';\n'
sql += 'ALTER ROLE spatial_memory_maintenance PASSWORD ' + literal(credentials['maintenance_password']) + ';\n'
sql += 'COMMIT;\n'
result = subprocess.run(
    ['docker', 'compose', 'exec', '-T', 'db', 'psql', '-X', '-q', '-v',
     'ON_ERROR_STOP=1', '-U', 'spatial_memory', '-d', 'spatial_memory'],
    cwd=ROOT, input=sql, text=True, capture_output=True,
)
if result.returncode:
    # SQL errors can repeat the query, so redact every credential first.
    error = result.stderr
    for key in ('login_password', 'readonly_password', 'maintenance_password'):
        error = error.replace(credentials[key], '[REDACTED]')
    raise SystemExit(error)
print('pgAdmin login secret and database roles provisioned; credentials stay in pgadmin/private/.')
