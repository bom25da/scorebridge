import pg from "pg";
import { database } from "./config.ts";
export const db = new pg.Pool({ connectionString: database });
export async function migrate() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(81724011)");
    await client.query(`
 CREATE TABLE IF NOT EXISTS jobs(id uuid PRIMARY KEY, filename text NOT NULL, state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS pages(id uuid PRIMARY KEY, job_id uuid REFERENCES jobs(id) ON DELETE CASCADE, index integer NOT NULL, state text NOT NULL DEFAULT 'QUEUED', stage text NOT NULL DEFAULT '대기', error text, duration_ms integer, generation integer NOT NULL DEFAULT 1, heartbeat timestamptz, has_result boolean NOT NULL DEFAULT false);
 CREATE TABLE IF NOT EXISTS outbox(id bigserial PRIMARY KEY, page_id uuid REFERENCES pages(id) ON DELETE CASCADE, generation integer NOT NULL, sent boolean NOT NULL DEFAULT false);
 `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function summarize(jobId: string) {
  await db.query(
    `UPDATE jobs SET state=(SELECT CASE WHEN bool_or(state IN ('QUEUED','PROCESSING')) THEN 'PROCESSING' WHEN bool_and(state='SUCCEEDED') THEN 'COMPLETED' WHEN bool_or(state='SUCCEEDED') THEN 'PARTIAL' ELSE 'FAILED' END FROM pages WHERE job_id=$1) WHERE id=$1 AND state <> 'DELETING'`,
    [jobId],
  );
}
