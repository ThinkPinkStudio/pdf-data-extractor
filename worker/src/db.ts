import pg from 'pg'
import { loadConfig } from './config'

const cfg = loadConfig()

export const pool = new pg.Pool({ connectionString: cfg.databaseUrl })

export type RunStatus = 'queued' | 'running' | 'paused' | 'done' | 'cancelled'
export type ItemStatus = 'pending' | 'processing' | 'done' | 'error' | 'skipped'

export interface BatchItem {
  id: number
  run_id: number
  policy_key: string
  root_path: string
  folder_path: string
  pdf_paths: string[]
  status: ItemStatus
  attempts: number
  last_error: string | null
  job_id: string | null
  output_path: string | null
}

// Tabelle batch_* di proprietà dell'orchestratore (schema creato qui, non da
// initDb del web). Postgres condiviso col web (decisione di design §7).
export async function initBatchSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS batch_runs (
      id             SERIAL PRIMARY KEY,
      status         TEXT NOT NULL DEFAULT 'queued',
      root_paths     JSONB NOT NULL,
      matcher_config JSONB NOT NULL,
      output_root    TEXT NOT NULL,
      total_items    INTEGER NOT NULL DEFAULT 0,
      done_items     INTEGER NOT NULL DEFAULT 0,
      error_items    INTEGER NOT NULL DEFAULT 0,
      paused_until   BIGINT,
      created_at     BIGINT NOT NULL,
      started_at     BIGINT,
      finished_at    BIGINT
    );

    CREATE TABLE IF NOT EXISTS batch_items (
      id           SERIAL PRIMARY KEY,
      run_id       INTEGER NOT NULL REFERENCES batch_runs(id) ON DELETE CASCADE,
      policy_key   TEXT NOT NULL,
      root_path    TEXT NOT NULL,
      folder_path  TEXT NOT NULL,
      pdf_paths    JSONB NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      attempts     INTEGER NOT NULL DEFAULT 0,
      last_error   TEXT,
      last_progress JSONB,
      job_id       TEXT,
      output_path  TEXT,
      started_at   BIGINT,
      finished_at  BIGINT,
      duration_ms  INTEGER,
      UNIQUE (run_id, policy_key)
    );

    CREATE INDEX IF NOT EXISTS idx_batch_items_run_status ON batch_items(run_id, status);
  `)
}
