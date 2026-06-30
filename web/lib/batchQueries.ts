import { pool } from './db'

// Letture sulle tabelle batch_* (di proprietà del worker, stesso Postgres).
// Se il worker non è ancora mai partito le tabelle non esistono (42P01):
// in quel caso restituiamo stati vuoti invece di errore.

const MISSING_TABLE = '42P01'

export interface RunRow {
  id: number
  status: string
  total_items: number
  done_items: number
  error_items: number
  output_root: string
  root_paths: unknown
  created_at: string
  started_at: string | null
  finished_at: string | null
  paused_until: string | null
}

export interface ItemProgress {
  docIndex: number
  docTotal: number
  pageIndex: number
  pageTotal: number
  docName: string
  totalPagesProcessed: number
}

export interface RunDetail {
  run: RunRow | null
  counts: Record<string, number>
  current: { id: number; folder_path: string; progress: ItemProgress | null } | null
  errors: Array<{ folder_path: string; last_error: string | null; attempts: number }>
  etaMs: number | null
}

export async function listRuns(): Promise<RunRow[]> {
  try {
    const { rows } = await pool.query(
      `SELECT id, status, total_items, done_items, error_items, output_root, root_paths,
              created_at, started_at, finished_at, paused_until
       FROM batch_runs ORDER BY id DESC LIMIT 100`
    )
    return rows as RunRow[]
  } catch (e) {
    if ((e as { code?: string })?.code === MISSING_TABLE) return []
    throw e
  }
}

export async function getRunDetail(id: number): Promise<RunDetail> {
  const empty: RunDetail = { run: null, counts: {}, current: null, errors: [], etaMs: null }
  try {
    const runQ = await pool.query(
      `SELECT id, status, total_items, done_items, error_items, output_root, root_paths,
              created_at, started_at, finished_at, paused_until
       FROM batch_runs WHERE id = $1`,
      [id]
    )
    const run = (runQ.rows[0] as RunRow) ?? null
    if (!run) return empty

    const countsQ = await pool.query(
      `SELECT status, count(*)::int AS n FROM batch_items WHERE run_id = $1 GROUP BY status`,
      [id]
    )
    const counts: Record<string, number> = {}
    for (const r of countsQ.rows as Array<{ status: string; n: number }>) counts[r.status] = r.n

    const curQ = await pool.query(
      `SELECT id, folder_path, last_progress FROM batch_items
       WHERE run_id = $1 AND status = 'processing'
       ORDER BY started_at DESC NULLS LAST LIMIT 1`,
      [id]
    )
    const cur = curQ.rows[0] as { id: number; folder_path: string; last_progress: ItemProgress | null } | undefined
    const current = cur ? { id: cur.id, folder_path: cur.folder_path, progress: cur.last_progress ?? null } : null

    const errQ = await pool.query(
      `SELECT folder_path, last_error, attempts FROM batch_items
       WHERE run_id = $1 AND status = 'error'
       ORDER BY finished_at DESC NULLS LAST LIMIT 50`,
      [id]
    )

    const avgQ = await pool.query(
      `SELECT avg(duration_ms)::int AS avg_ms FROM batch_items WHERE run_id = $1 AND status = 'done'`,
      [id]
    )
    const avgMs = (avgQ.rows[0] as { avg_ms: number | null })?.avg_ms ?? null
    const remaining = (counts.pending || 0) + (counts.processing || 0)
    const etaMs = avgMs && remaining > 0 ? avgMs * remaining : null

    return {
      run,
      counts,
      current,
      errors: errQ.rows as RunDetail['errors'],
      etaMs,
    }
  } catch (e) {
    if ((e as { code?: string })?.code === MISSING_TABLE) return empty
    throw e
  }
}

export async function getReportRows(
  id: number,
  type: 'manifest' | 'errors'
): Promise<Array<Record<string, unknown>>> {
  const where = type === 'errors' ? `AND status = 'error'` : ''
  try {
    const { rows } = await pool.query(
      `SELECT policy_key, folder_path, status, attempts, output_path, last_error
       FROM batch_items WHERE run_id = $1 ${where} ORDER BY id`,
      [id]
    )
    return rows as Array<Record<string, unknown>>
  } catch (e) {
    if ((e as { code?: string })?.code === MISSING_TABLE) return []
    throw e
  }
}
