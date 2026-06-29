CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS magic_links (
  token      TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  ip_address TEXT
);
CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_links (email);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  last_seen_at    TIMESTAMPTZ,
  ip_address      TEXT,
  user_agent_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_email   ON sessions (email);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- NIS2 audit log — append-only
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_email TEXT,
  action     TEXT NOT NULL,
  resource   TEXT,
  result     TEXT,
  ip_address TEXT,
  user_agent TEXT,
  details    JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_ts     ON audit_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs (user_email, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action, ts DESC);

CREATE TABLE IF NOT EXISTS extraction_history (
  id             TEXT PRIMARY KEY,
  user_email     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_name       TEXT,
  pdf_size_bytes INTEGER,
  fields         JSONB,
  result         JSONB,
  status         TEXT NOT NULL DEFAULT 'completed',
  llm_provider   TEXT,
  duration_ms    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_history_user ON extraction_history (user_email, created_at DESC);

-- Queue jobs — predisposizione per software scanner futuro
CREATE TABLE IF NOT EXISTS queue_jobs (
  id              TEXT PRIMARY KEY,
  submitted_by    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  folder_path     TEXT NOT NULL,
  config          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  result_path     TEXT,
  error           TEXT,
  progress        INTEGER DEFAULT 0,
  total_files     INTEGER DEFAULT 0,
  processed_files INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_jobs (status, created_at DESC);
