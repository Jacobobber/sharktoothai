BEGIN;

ALTER TABLE app.users
  ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE app.users
  DROP CONSTRAINT IF EXISTS users_tenant_required;

ALTER TABLE app.users
  ADD CONSTRAINT users_tenant_required
  CHECK (role = 'DEVELOPER' OR tenant_id IS NOT NULL);

DROP POLICY IF EXISTS users_tenant_isolation ON app.users;
CREATE POLICY users_tenant_isolation
ON app.users
USING (
  (app.current_role() = 'DEVELOPER' AND (tenant_id = app.current_tenant_id() OR tenant_id IS NULL))
  OR tenant_id = app.current_tenant_id()
)
WITH CHECK (
  (app.current_role() = 'DEVELOPER' AND (tenant_id = app.current_tenant_id() OR tenant_id IS NULL))
  OR tenant_id = app.current_tenant_id()
);

CREATE OR REPLACE FUNCTION app.auth_login_lookup(p_email text)
RETURNS TABLE(
  user_id uuid,
  tenant_id uuid,
  role app.user_role,
  pass_hash text,
  user_active boolean,
  tenant_active boolean
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT u.user_id,
         u.tenant_id,
         u.role,
         u.pass_hash,
         u.is_active AS user_active,
         CASE
           WHEN u.role = 'DEVELOPER' THEN true
           ELSE t.is_active
         END AS tenant_active
    FROM app.users u
    LEFT JOIN app.tenants t ON t.tenant_id = u.tenant_id
   WHERE LOWER(u.email) = LOWER(p_email)
     AND u.is_active = true
     AND (u.role = 'DEVELOPER' OR t.is_active = true);
$$;

REVOKE ALL ON FUNCTION app.auth_login_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_login_lookup(text) TO app_runtime;

COMMIT;
