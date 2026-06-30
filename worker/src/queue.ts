import { pool, type BatchItem } from './db'
import type { MatcherConfig } from './config'
import type { PolicyUnit } from './discovery'

export async function createRun(
  roots: string[],
  matcher: MatcherConfig,
  outputRoot: string
): Promise<number> {
  const now = Date.now()
  const { rows } = await pool.query(
    `INSERT INTO batch_runs (status, root_paths, matcher_config, output_root, created_at, started_at)
     VALUES ('running', $1, $2, $3, $4, $4) RETURNING id`,
    [JSON.stringify(roots), JSON.stringify(matcher), outputRoot, now]
  )
  return rows[0].id as number
}

/** Inserisce una polizza in coda; idempotente per (run_id, policy_key). */
export async function enqueueDiscovered(runId: number, u: PolicyUnit): Promise<void> {
  await pool.query(
    `INSERT INTO batch_items (run_id, policy_key, root_path, folder_path, pdf_paths)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (run_id, policy_key) DO NOTHING`,
    [runId, u.policyKey, u.rootPath, u.folderPath, JSON.stringify(u.pdfPaths)]
  )
}

export async function updateRunTotal(runId: number): Promise<void> {
  await pool.query(
    `UPDATE batch_runs SET total_items = (SELECT count(*) FROM batch_items WHERE run_id = $1) WHERE id = $1`,
    [runId]
  )
}

/** Boot recovery: gli item lasciati 'processing' da un crash tornano 'pending'. */
export async function resumeStuck(): Promise<void> {
  await pool.query(`UPDATE batch_items SET status = 'pending', job_id = NULL WHERE status = 'processing'`)
}

/** Riattiva i run in pausa il cui timer è scaduto. */
export async function resumePausedRuns(nowMs: number): Promise<void> {
  await pool.query(
    `UPDATE batch_runs SET status = 'running', paused_until = NULL
     WHERE status = 'paused' AND (paused_until IS NULL OR paused_until <= $1)`,
    [nowMs]
  )
}

/** Prende il prossimo item pending in modo sicuro (un solo worker lo vince). */
export async function claimNextItem(nowMs: number): Promise<BatchItem | null> {
  const { rows } = await pool.query(
    `UPDATE batch_items SET status = 'processing', started_at = $1, attempts = attempts + 1
     WHERE id = (
       SELECT i.id FROM batch_items i
       JOIN batch_runs r ON r.id = i.run_id
       WHERE i.status = 'pending' AND r.status = 'running'
       ORDER BY i.id
       FOR UPDATE OF i SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
    [nowMs]
  )
  return (rows[0] as BatchItem) || null
}

export async function markDone(id: number, outputPath: string, durationMs: number): Promise<void> {
  await pool.query(
    `UPDATE batch_items
     SET status = 'done', output_path = $2, duration_ms = $3, finished_at = $4, last_error = NULL
     WHERE id = $1`,
    [id, outputPath, durationMs, Date.now()]
  )
}

export async function markErrorFinal(id: number, message: string): Promise<void> {
  await pool.query(
    `UPDATE batch_items SET status = 'error', last_error = $2, finished_at = $3 WHERE id = $1`,
    [id, message.slice(0, 2000), Date.now()]
  )
}

/** Persiste l'ultimo progress dell'item (per la barra micro nella UI web). */
export async function updateItemProgress(id: number, progress: unknown): Promise<void> {
  await pool.query(`UPDATE batch_items SET last_progress = $2 WHERE id = $1`, [id, JSON.stringify(progress)])
}

export async function requeueItem(id: number): Promise<void> {
  await pool.query(`UPDATE batch_items SET status = 'pending', job_id = NULL WHERE id = $1`, [id])
}

export async function pauseRun(runId: number, untilMs: number): Promise<void> {
  await pool.query(`UPDATE batch_runs SET status = 'paused', paused_until = $2 WHERE id = $1`, [runId, untilMs])
}

/** Chiude i run senza più item pending/processing, fissando i conteggi finali. */
export async function finalizeRuns(nowMs: number): Promise<void> {
  await pool.query(
    `UPDATE batch_runs r SET status = 'done', finished_at = $1,
       done_items  = (SELECT count(*) FROM batch_items WHERE run_id = r.id AND status = 'done'),
       error_items = (SELECT count(*) FROM batch_items WHERE run_id = r.id AND status = 'error')
     WHERE r.status = 'running'
       AND EXISTS (SELECT 1 FROM batch_items i WHERE i.run_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM batch_items i WHERE i.run_id = r.id AND i.status IN ('pending', 'processing'))`,
    [nowMs]
  )
}
