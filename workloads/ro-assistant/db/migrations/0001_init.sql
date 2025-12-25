BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN
  CREATE TYPE app.user_role AS ENUM ('TECH', 'ADMIN', 'PII_APPROVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.current_role()
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.role', true), '');
$$;

-- Minimal base tables needed for workload + audit
CREATE TABLE IF NOT EXISTS app.tenants (
  tenant_id   uuid PRIMARY KEY,
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.users (
  user_id     uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES app.tenants(tenant_id) ON DELETE CASCADE,
  email       text NOT NULL,
  pass_hash   text NOT NULL,
  role        app.user_role NOT NULL DEFAULT 'TECH',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_tenant_isolation ON app.users;
CREATE POLICY users_tenant_isolation
ON app.users
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id());

COMMIT;
