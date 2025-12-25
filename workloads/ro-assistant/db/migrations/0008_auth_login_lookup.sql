DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
END
$$;

BEGIN;

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
  SELECT u.user_id, u.tenant_id, u.role, u.pass_hash, u.is_active AS user_active, t.is_active AS tenant_active
    FROM app.users u
    JOIN app.tenants t ON t.tenant_id = u.tenant_id
   WHERE LOWER(u.email) = LOWER(p_email)
     AND u.is_active = true
     AND t.is_active = true;
$$;

REVOKE ALL ON FUNCTION app.auth_login_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_login_lookup(text) TO app_runtime;

COMMIT;
