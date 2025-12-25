import dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";
import bcrypt from "bcryptjs";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const tenantId = process.env.SEED_TENANT_ID ?? "00000000-0000-0000-0000-000000000010";
  const userId = process.env.SEED_USER_ID ?? "00000000-0000-0000-0000-000000000001";
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  try {
    const passHash = await bcrypt.hash(password, 10);
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO app.tenants (tenant_id, name, is_active)
       VALUES ($1, 'Pilot Tenant', true)
       ON CONFLICT (tenant_id) DO UPDATE SET is_active = true`,
      [tenantId]
    );
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query(
      `INSERT INTO app.users (user_id, tenant_id, email, pass_hash, role, is_active)
       VALUES ($1, $2, $3, $4, 'ADMIN', true)
       ON CONFLICT (tenant_id, email) DO UPDATE SET pass_hash = EXCLUDED.pass_hash, role='ADMIN', is_active=true`,
      [userId, tenantId, email, passHash]
    );
    await client.query("COMMIT");
    console.log("Seeded admin user:", email);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
