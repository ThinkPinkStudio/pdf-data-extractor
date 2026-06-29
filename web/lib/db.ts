import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS magic_tokens (
      id        SERIAL PRIMARY KEY,
      token     TEXT NOT NULL UNIQUE,
      email     TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      used      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_magic_tokens_token ON magic_tokens(token);

    CREATE TABLE IF NOT EXISTS action_logs (
      id         SERIAL PRIMARY KEY,
      timestamp  TEXT NOT NULL,
      email      TEXT,
      action     TEXT NOT NULL,
      resource   TEXT,
      metadata   TEXT,
      ip         TEXT,
      user_agent TEXT,
      success    BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE INDEX IF NOT EXISTS idx_logs_email     ON action_logs(email);
    CREATE INDEX IF NOT EXISTS idx_logs_action    ON action_logs(action);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON action_logs(timestamp);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

export { pool }
