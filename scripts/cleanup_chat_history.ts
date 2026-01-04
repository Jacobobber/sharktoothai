import dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";

const retentionDays = Number(process.env.CHAT_RETENTION_DAYS ?? 30);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM chat.messages WHERE created_at < now() - ($1::text || ' days')::interval`,
      [retentionDays]
    );
    await client.query(
      `DELETE FROM chat.conversations WHERE last_message_at < now() - ($1::text || ' days')::interval`,
      [retentionDays]
    );
    await client.query("COMMIT");
    console.log(`Chat retention cleanup completed for ${retentionDays} days.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
