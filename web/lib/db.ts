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

    CREATE TABLE IF NOT EXISTS sessions (
      id         SERIAL PRIMARY KEY,
      email      TEXT NOT NULL,
      file_name  TEXT NOT NULL,
      num_pages  INTEGER NOT NULL DEFAULT 0,
      pdf_base64 TEXT,
      meta       JSONB NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);

    -- Job di estrazione polizza eseguiti lato server (continuano a tab chiusa,
    -- recuperabili alla riapertura, riprendibili dopo un restart del container).
    CREATE TABLE IF NOT EXISTS polizza_jobs (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'queued',
      whole_dossier BOOLEAN NOT NULL DEFAULT FALSE,
      scanned_files JSONB NOT NULL DEFAULT '[]',
      cursor        JSONB NOT NULL DEFAULT '{}',
      progress      JSONB NOT NULL DEFAULT '{}',
      rolling_state JSONB NOT NULL DEFAULT '{}',
      sources       JSONB NOT NULL DEFAULT '{}',
      field_defs    JSONB NOT NULL DEFAULT '[]',
      error         TEXT,
      logs          JSONB NOT NULL DEFAULT '[]',
      created_at    BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at    BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_polizza_jobs_email ON polizza_jobs(email);
    CREATE INDEX IF NOT EXISTS idx_polizza_jobs_status ON polizza_jobs(status);

    -- PDF di input del job (base64, come la tabella sessions): consente la ripresa
    -- del job anche dopo un riavvio, senza che il client ricarichi i file.
    CREATE TABLE IF NOT EXISTS polizza_job_files (
      job_id     TEXT NOT NULL REFERENCES polizza_jobs(id) ON DELETE CASCADE,
      idx        INTEGER NOT NULL,
      file_name  TEXT NOT NULL,
      pdf_base64 TEXT NOT NULL,
      PRIMARY KEY (job_id, idx)
    );
  `)
}

export { pool }
