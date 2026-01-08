import type { PoolClient } from "pg";
import { AppError } from "../../../../shared/utils/errors";

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

type QueryClient = Pick<PoolClient, "query">;

export const withTenantContext = async <T>(
  client: QueryClient,
  tenantId: string,
  fn: () => Promise<T>
): Promise<T> => {
  const normalized = tenantId?.trim() ?? "";
  if (normalized && !isUuid(normalized)) {
    throw new AppError("Invalid tenant context", { status: 400, code: "TENANT_INVALID" });
  }
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [normalized]);
  return fn();
};
