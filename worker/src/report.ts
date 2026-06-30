import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { pool } from './db'
import { toCsv } from './csv'

/** Manifest di tutte le polizze del run (policy_key → cartella → stato → output). */
export async function writeManifest(runId: number, outRoot: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT policy_key, folder_path, status, attempts, output_path, last_error
     FROM batch_items WHERE run_id = $1 ORDER BY id`,
    [runId]
  )
  const csv = toCsv(rows as Array<Record<string, unknown>>, [
    'policy_key', 'folder_path', 'status', 'attempts', 'output_path', 'last_error',
  ])
  await mkdir(outRoot, { recursive: true })
  const p = join(outRoot, `_manifest_run${runId}.csv`)
  await writeFile(p, csv)
  return p
}

/** Report delle sole polizze fallite. */
export async function writeErrorReport(runId: number, outRoot: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT policy_key, folder_path, attempts, last_error
     FROM batch_items WHERE run_id = $1 AND status = 'error' ORDER BY id`,
    [runId]
  )
  const csv = toCsv(rows as Array<Record<string, unknown>>, [
    'policy_key', 'folder_path', 'attempts', 'last_error',
  ])
  await mkdir(outRoot, { recursive: true })
  const p = join(outRoot, `_errors_run${runId}.csv`)
  await writeFile(p, csv)
  return p
}

export async function printSummary(runId: number): Promise<void> {
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS n FROM batch_items WHERE run_id = $1 GROUP BY status`,
    [runId]
  )
  const by: Record<string, number> = {}
  for (const r of rows as Array<{ status: string; n: number }>) by[r.status] = r.n
  const total = Object.values(by).reduce((a, b) => a + b, 0)
  console.log(
    `Run #${runId}: totale ${total} | done ${by.done || 0} | error ${by.error || 0} | ` +
      `pending ${by.pending || 0} | processing ${by.processing || 0}`
  )
}
