import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { RequestContext } from "../../../../shared/types/api";
import { AppError } from "../../../../shared/utils/errors";

export type DbClient = {
  query: <T extends QueryResultRow = any>(text: string, params?: any[]) => Promise<QueryResult<T>>;
  release: () => void;
};

const connectionString = process.env.DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString }) : undefined;

const ensureContext = (ctx: RequestContext) => {
  if (!ctx.requestId || !ctx.userId || !ctx.role) {
    throw new AppError("RLS context incomplete", { status: 400, code: "RLS_CONTEXT_MISSING" });
  }
  if (!ctx.tenantId && ctx.role !== "DEVELOPER") {
    throw new AppError("RLS context incomplete", { status: 400, code: "RLS_CONTEXT_MISSING" });
  }
};

const setRlsContext = async (client: PoolClient, ctx: RequestContext) => {
  await client.query("SELECT set_config('app.request_id', $1, true)", [ctx.requestId]);
  await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId ?? ""]);
  await client.query("SELECT set_config('app.role', $1, true)", [ctx.role]);
};

export const getRlsClient = async (ctx: RequestContext): Promise<DbClient> => {
  ensureContext(ctx);
  if (!pool) {
    throw new AppError("DATABASE_URL not configured", { status: 500, code: "DB_NOT_CONFIGURED" });
  }
  const client = await pool.connect();
  await setRlsContext(client, ctx);
  return {
    query: (text, params) => client.query(text, params),
    release: () => client.release()
  };
};

type TxFn<T> = (client: DbClient) => Promise<T>;

export const runWithTransaction = async <T>(ctx: RequestContext, fn: TxFn<T>): Promise<T> => {
  ensureContext(ctx);
  if (!pool) {
    throw new AppError("DATABASE_URL not configured", { status: 500, code: "DB_NOT_CONFIGURED" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setRlsContext(client, ctx);
    const result = await fn({
      query: (text, params) => client.query(text, params),
      release: () => client.release()
    });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// DB-USAGE-GUARD: pool.query must not be used outside this module.
export const withRequestContext = async <T>(
  ctx: RequestContext,
  fn: (client: DbClient) => Promise<T>
): Promise<T> => {
  ensureContext(ctx);
  if (!pool) {
    throw new AppError("DATABASE_URL not configured", { status: 500, code: "DB_NOT_CONFIGURED" });
  }
  const client = await pool.connect();
  try {
    await setRlsContext(client, ctx);
    return await fn({
      query: (text, params) => client.query(text, params),
      release: () => client.release()
    });
  } finally {
    client.release();
  }
};
