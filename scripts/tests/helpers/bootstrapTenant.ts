import { randomUUID } from "crypto";

type QueryClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

type BootstrapOptions = {
  tenantId?: string;
  userId?: string;
  userEmail?: string;
  role?: string;
  piiEnabled?: boolean;
};

type BootstrapResult = {
  tenantId: string;
  userId?: string;
};

export const bootstrapTenant = async (
  client: QueryClient,
  options: BootstrapOptions = {}
): Promise<BootstrapResult> => {
  const tenantId = options.tenantId ?? randomUUID();
  const userId = options.userId ?? randomUUID();
  const piiEnabled = options.piiEnabled ?? true;

  await client.query(
    `INSERT INTO app.tenants (tenant_id, name, is_active, pii_enabled)
     VALUES ($1, $2, true, $3)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, `Test Tenant ${tenantId.slice(0, 8)}`, piiEnabled]
  );

  const usersTable = await client.query("SELECT to_regclass('app.users') AS regclass");
  if (usersTable.rows[0]?.regclass) {
    const email = options.userEmail ?? `test-${userId}@example.com`;
    const role = options.role ?? "ADMIN";
    await client.query(
      `INSERT INTO app.users (user_id, tenant_id, email, pass_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, tenantId, email, "test-hash", role]
    );
  }

  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

  return { tenantId, userId: usersTable.rows[0]?.regclass ? userId : undefined };
};
