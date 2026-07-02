import { pool } from './db'
import { randomUUID } from 'crypto'
import { flattenRollingState, initRollingState } from './polizzaRolling'

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export interface JobCursor {
  docIndex?: number
  pageIndex?: number // ultima pagina COMPLETATA (0 = nessuna)
  totalPagesProcessed?: number
}

export interface JobProgress {
  docIndex: number
  docTotal: number
  pageIndex: number
  pageTotal: number
  docName: string
  totalPagesProcessed: number
  receivedAt: number
}

export interface JobRow {
  id: string
  email: string
  batch_id: string | null
  dossier_name: string | null
  status: JobStatus
  whole_dossier: boolean
  scanned_files: string[]
  cursor: JobCursor
  progress: JobProgress | Record<string, never>
  rolling_state: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  sources: Record<string, { file: string; page: number }>
  field_defs: { id: string; label: string; description?: string; sheet?: string }[]
  error: string | null
  logs: string[]
  created_at: number
  updated_at: number
}

export interface JobInputFile { file_name: string; pdf_base64: string }

const now = () => Math.floor(Date.now() / 1000)

export async function createJob(params: {
  email: string
  wholeDossier: boolean
  scannedFiles: string[]
  fieldDefs: JobRow['field_defs']
  rollingState: Record<string, unknown>
  files: JobInputFile[]
  batchId?: string
  dossierName?: string
}): Promise<string> {
  const id = randomUUID()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO polizza_jobs (id, email, batch_id, dossier_name, status, whole_dossier, scanned_files, field_defs, rolling_state, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'queued',$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$9)`,
      [id, params.email, params.batchId ?? null, params.dossierName ?? null, params.wholeDossier,
        JSON.stringify(params.scannedFiles), JSON.stringify(params.fieldDefs),
        JSON.stringify(params.rollingState || {}), now()]
    )
    for (let i = 0; i < params.files.length; i++) {
      const f = params.files[i]
      await client.query(
        `INSERT INTO polizza_job_files (job_id, idx, file_name, pdf_base64) VALUES ($1,$2,$3,$4)`,
        [id, i, f.file_name, f.pdf_base64]
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return id
}

// ─── Batch: raggruppa N job polizza (una sottocartella caricata = un job) ──────
export interface BatchItemInput { dossierName: string; files: JobInputFile[] }

export interface BatchRow { id: string; email: string; label: string; created_at: number; updated_at: number }

export async function createBatch(params: {
  email: string
  label: string
  wholeDossier: boolean
  fieldDefs: JobRow['field_defs']
  items: BatchItemInput[]
}): Promise<{ batchId: string; jobIds: string[] }> {
  const batchId = randomUUID()
  await pool.query(
    `INSERT INTO batch_jobs (id, email, label, created_at, updated_at) VALUES ($1,$2,$3,$4,$4)`,
    [batchId, params.email, params.label, now()]
  )

  const jobIds: string[] = []
  for (const item of params.items) {
    const jobId = await createJob({
      email: params.email,
      wholeDossier: params.wholeDossier,
      scannedFiles: item.files.map((f) => f.file_name),
      fieldDefs: params.fieldDefs,
      rollingState: initRollingState(params.fieldDefs),
      files: item.files,
      batchId,
      dossierName: item.dossierName,
    })
    jobIds.push(jobId)
  }
  return { batchId, jobIds }
}

export async function getBatch(id: string): Promise<{ batch: BatchRow; jobs: JobRow[] } | null> {
  const { rows: batchRows } = await pool.query<BatchRow>('SELECT * FROM batch_jobs WHERE id = $1', [id])
  const batch = batchRows[0]
  if (!batch) return null
  const { rows: jobs } = await pool.query<JobRow>(
    'SELECT * FROM polizza_jobs WHERE batch_id = $1 ORDER BY created_at, id', [id]
  )
  return { batch, jobs }
}

export interface BatchSummary extends BatchRow {
  total: number
  queued: number
  running: number
  done: number
  error: number
  canceled: number
}

export async function listBatches(email: string): Promise<BatchSummary[]> {
  const { rows } = await pool.query<BatchSummary>(
    `SELECT b.*,
       COUNT(j.id)::int AS total,
       COUNT(j.id) FILTER (WHERE j.status = 'queued')::int AS queued,
       COUNT(j.id) FILTER (WHERE j.status = 'running')::int AS running,
       COUNT(j.id) FILTER (WHERE j.status = 'done')::int AS done,
       COUNT(j.id) FILTER (WHERE j.status = 'error')::int AS error,
       COUNT(j.id) FILTER (WHERE j.status = 'canceled')::int AS canceled
     FROM batch_jobs b
     LEFT JOIN polizza_jobs j ON j.batch_id = b.id
     WHERE b.email = $1
     GROUP BY b.id
     ORDER BY b.created_at DESC`,
    [email]
  )
  return rows
}

// Prossimo job da elaborare in un batch: prima un eventuale 'running' rimasto a metà
// (es. dopo un restart del container, da riprendere dal suo cursor), poi i 'queued'
// nell'ordine di creazione — per l'orchestrazione sequenziale.
export async function getNextPendingBatchJob(batchId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM polizza_jobs WHERE batch_id = $1 AND status IN ('running','queued')
     ORDER BY (status = 'running') DESC, created_at, id LIMIT 1`,
    [batchId]
  )
  return rows[0]?.id ?? null
}

// Batch con almeno un job non ancora in stato terminale (per la ripresa al boot).
export async function listActiveBatchIds(): Promise<string[]> {
  const { rows } = await pool.query<{ batch_id: string }>(
    `SELECT DISTINCT batch_id FROM polizza_jobs WHERE batch_id IS NOT NULL AND status IN ('queued','running')`
  )
  return rows.map((r) => r.batch_id)
}

export async function getJob(id: string): Promise<JobRow | null> {
  const { rows } = await pool.query<JobRow>('SELECT * FROM polizza_jobs WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function getActiveJob(email: string): Promise<JobRow | null> {
  // Job più recente dell'utente (running prima, poi qualsiasi recente) per l'auto-restore.
  const { rows } = await pool.query<JobRow>(
    `SELECT * FROM polizza_jobs WHERE email = $1
     ORDER BY (status IN ('running','queued')) DESC, updated_at DESC LIMIT 1`,
    [email]
  )
  return rows[0] ?? null
}

export async function getJobStatus(id: string): Promise<JobStatus | null> {
  const { rows } = await pool.query<{ status: JobStatus }>('SELECT status FROM polizza_jobs WHERE id = $1', [id])
  return rows[0]?.status ?? null
}

export async function getJobFiles(id: string): Promise<{ idx: number; file_name: string; pdf_base64: string }[]> {
  const { rows } = await pool.query(
    'SELECT idx, file_name, pdf_base64 FROM polizza_job_files WHERE job_id = $1 ORDER BY idx',
    [id]
  )
  return rows
}

// Job singoli (non appartenenti a un batch) da riprendere al boot. I job figli di
// un batch sono esclusi qui: la loro ripresa è sequenziale, guidata dall'orchestratore
// batch (vedi listActiveBatchIds/polizzaBatchWorker), non da un avvio in parallelo.
export async function listResumableJobs(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM polizza_jobs WHERE status IN ('running','queued') AND batch_id IS NULL ORDER BY created_at`
  )
  return rows.map((r) => r.id)
}

// Aggiornamento parziale: solo le colonne fornite. I valori JSON vengono serializzati.
const JSON_COLS = new Set(['scanned_files', 'cursor', 'progress', 'rolling_state', 'sources', 'field_defs', 'logs'])
export async function updateJob(id: string, patch: Partial<Record<keyof JobRow, unknown>>): Promise<void> {
  const cols = Object.keys(patch)
  if (!cols.length) return
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const c of cols) {
    if (JSON_COLS.has(c)) { sets.push(`${c} = $${i}::jsonb`); vals.push(JSON.stringify(patch[c as keyof JobRow])) }
    else { sets.push(`${c} = $${i}`); vals.push(patch[c as keyof JobRow]) }
    i++
  }
  sets.push(`updated_at = $${i}`); vals.push(now()); i++
  vals.push(id)
  await pool.query(`UPDATE polizza_jobs SET ${sets.join(', ')} WHERE id = $${i}`, vals)
}

// Snapshot pubblico per il client (valori piatti + metadati job).
export function jobSnapshot(job: JobRow) {
  return {
    jobId: job.id,
    batchId: job.batch_id,
    dossierName: job.dossier_name,
    status: job.status,
    wholeDossier: job.whole_dossier,
    scannedFiles: job.scanned_files || [],
    fieldDefs: job.field_defs || [],
    values: flattenRollingState(job.rolling_state),
    sources: job.sources || {},
    progress: job.progress && Object.keys(job.progress).length ? job.progress : null,
    error: job.error || null,
    logs: job.logs || [],
    updatedAt: job.updated_at,
  }
}

export async function cancelJob(id: string, email: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE polizza_jobs SET status = 'canceled', updated_at = $1
     WHERE id = $2 AND email = $3 AND status IN ('running','queued')`,
    [now(), id, email]
  )
  return (rowCount ?? 0) > 0
}
