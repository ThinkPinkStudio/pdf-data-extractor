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

    -- Batch: raggruppa N job polizza generati dall'upload ricorsivo di una cartella
    -- (una sottocartella = un job/dossier). Permette all'utente di lanciare
    -- l'elaborazione di un'intera alberatura e tornare più tardi a vederne l'esito.
    CREATE TABLE IF NOT EXISTS batch_jobs (
      id              TEXT PRIMARY KEY,
      email           TEXT NOT NULL,
      label           TEXT NOT NULL,
      upload_complete BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at      BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    ALTER TABLE batch_jobs ADD COLUMN IF NOT EXISTS upload_complete BOOLEAN NOT NULL DEFAULT FALSE;
    -- Timestamp dell'email di fine batch inviata al proprietario: NULL = non ancora
    -- notificato. Serve a inviare la mail UNA sola volta (anche dopo un restart).
    ALTER TABLE batch_jobs ADD COLUMN IF NOT EXISTS notified_at BIGINT;

    CREATE INDEX IF NOT EXISTS idx_batch_jobs_email ON batch_jobs(email);

    -- Job di estrazione polizza eseguiti lato server (continuano a tab chiusa,
    -- recuperabili alla riapertura, riprendibili dopo un restart del container).
    CREATE TABLE IF NOT EXISTS polizza_jobs (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL,
      batch_id      TEXT REFERENCES batch_jobs(id) ON DELETE CASCADE,
      dossier_name  TEXT,
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

    -- ALTER esplicite: CREATE TABLE IF NOT EXISTS non aggiunge colonne a una tabella
    -- polizza_jobs già esistente in produzione (deploy precedenti al batch).
    ALTER TABLE polizza_jobs ADD COLUMN IF NOT EXISTS batch_id TEXT REFERENCES batch_jobs(id) ON DELETE CASCADE;
    ALTER TABLE polizza_jobs ADD COLUMN IF NOT EXISTS dossier_name TEXT;
    -- Prompt extra (istruzioni AI) del profilo scelto per questo dossier, congelato
    -- all'upload: il worker lo usa al posto del settings.polizzaPromptExtra globale.
    ALTER TABLE polizza_jobs ADD COLUMN IF NOT EXISTS prompt_extra TEXT;

    CREATE INDEX IF NOT EXISTS idx_polizza_jobs_email ON polizza_jobs(email);
    CREATE INDEX IF NOT EXISTS idx_polizza_jobs_status ON polizza_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_polizza_jobs_batch ON polizza_jobs(batch_id);

    -- PDF di input del job (base64, come la tabella sessions): consente la ripresa
    -- del job anche dopo un riavvio, senza che il client ricarichi i file.
    CREATE TABLE IF NOT EXISTS polizza_job_files (
      job_id     TEXT NOT NULL REFERENCES polizza_jobs(id) ON DELETE CASCADE,
      idx        INTEGER NOT NULL,
      file_name  TEXT NOT NULL,
      pdf_base64 TEXT NOT NULL,
      PRIMARY KEY (job_id, idx)
    );

    -- CSA Adesioni: archivio dei record generati. Il record completo vive in JSONB;
    -- alcune colonne sono denormalizzate per ricerca e scadenze.
    CREATE TABLE IF NOT EXISTS adesioni_records (
      id             TEXT PRIMARY KEY,
      email          TEXT NOT NULL,
      cognome        TEXT,
      nome           TEXT,
      codice_fiscale TEXT,
      targa          TEXT,
      identificativo TEXT,
      data_inizio    TEXT,
      data_fine      TEXT,
      tipo_movimento TEXT,
      data           JSONB NOT NULL DEFAULT '{}',
      created_at     BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at     BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    -- Archivio CONDIVISO: saved_by traccia l'operatore; status gestisce il ciclo
    -- di vita (pending → archived all'export). email resta per retrocompatibilità.
    ALTER TABLE adesioni_records ADD COLUMN IF NOT EXISTS saved_by TEXT;
    ALTER TABLE adesioni_records ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
    -- Traccia dell'export (parità desktop archiveRecords): lotto e data export.
    ALTER TABLE adesioni_records ADD COLUMN IF NOT EXISTS exported_at BIGINT;
    ALTER TABLE adesioni_records ADD COLUMN IF NOT EXISTS export_batch TEXT;

    CREATE INDEX IF NOT EXISTS idx_adesioni_email  ON adesioni_records(email);
    CREATE INDEX IF NOT EXISTS idx_adesioni_dataf  ON adesioni_records(data_fine);
    CREATE INDEX IF NOT EXISTS idx_adesioni_status ON adesioni_records(status);
  `)
}

export { pool }
