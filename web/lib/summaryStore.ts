// RIEPILOGHI GENERALI (26/09/2026) — letture e scritture su polizza_summaries.
//
// Le regole stanno altrove: gli aggregati nel modulo puro
// src/services/summaryAggregate.js (caricato con importSharedService), le
// regole del server senza database in summaryCompose.ts. Qui solo SQL, il
// PATCH OTTIMISTICO (letture fuori dalla transazione, poi SELECT … FOR UPDATE
// + confronto della versione `rev` + UPDATE: due modifiche contemporanee non
// si perdono a vicenda, e nessuna connessione resta presa in transazione
// mentre se ne chiede un'altra al pool) e l'assemblaggio delle dipendenze.
// Nessun controllo di proprietà: il lavoro è condiviso, come batch e job.

import { randomUUID } from 'crypto'
import type { PoolClient } from 'pg'
import { pool } from './db'
import { importSharedService } from './sharedServices'
import { getSettings } from './settingsStore'
import { getFileHashesByJob, getJobLabels, getJobsLight, getLastDoneRuns } from './polizzaJobStore'
import {
  changedColumns, composeDetail, createSummaryCore, loadLiveMaps, memoDeps, patchSummaryCore, previewCore, todayRome,
  SUMMARY_UPDATABLE, type CoreError, type SummaryDeps, type SummaryUpdatable,
} from './summaryCompose'
import type {
  ProfileLike, SummaryDetail, SummaryListItem, SummaryPatchResult, SummaryPreview, SummaryPrefs, SummaryRow,
  SummarySvc, SummaryViewQuery,
} from './summaryTypes'

/** Modulo puro degli aggregati (solo server). */
export const summarySvc = () => importSharedService<SummarySvc>('summaryAggregate.js')

const now = () => Math.floor(Date.now() / 1000)

type Queryable = Pick<PoolClient, 'query'>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowFrom(r: any): SummaryRow {
  return {
    id: r.id,
    name: r.name,
    profile_id: r.profile_id,
    profile_name: r.profile_name ?? null,
    year_field_id: r.year_field_id ?? null,
    due_field_id: r.due_field_id ?? null,
    mode: r.mode === 'snapshot' ? 'snapshot' : 'live',
    job_ids: Array.isArray(r.job_ids) ? r.job_ids.filter((x: unknown) => typeof x === 'string') : [],
    snapshot: r.snapshot && typeof r.snapshot === 'object' ? r.snapshot : null,
    prefs: r.prefs && typeof r.prefs === 'object' && !Array.isArray(r.prefs) ? r.prefs : {},
    field_sigs: Array.isArray(r.field_sigs) ? r.field_sigs.filter((x: unknown) => typeof x === 'string') : [],
    rev: Number(r.rev) || 0,
    created_by: r.created_by,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Elenco senza aggregati né fotografia, dal più recente. Con `fieldSig` anche
 * i riepiloghi che hanno già ammesso quella firma di campi (estrazioni singole).
 * snapshot_at è una colonna: leggere snapshot->>'takenAt' decomprimeva
 * l'intera fotografia di ogni riepilogo.
 */
export async function listSummaries({ profileId, fieldSig }: { profileId?: string; fieldSig?: string | null } = {}): Promise<SummaryListItem[]> {
  const params: string[] = []
  let where = ''
  if (profileId) {
    params.push(profileId)
    where = 'WHERE profile_id = $1'
    if (fieldSig) { params.push(fieldSig); where += ' OR field_sigs ? $2' }
  }
  const { rows } = await pool.query(
    `SELECT id, name, profile_id, profile_name, mode, created_by, created_at, updated_at,
            jsonb_array_length(job_ids) AS job_count, snapshot_at
     FROM polizza_summaries ${where}
     ORDER BY updated_at DESC`,
    params,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    profileId: r.profile_id,
    profileName: r.profile_name ?? null,
    mode: r.mode === 'snapshot' ? 'snapshot' : 'live',
    jobCount: Number(r.job_count) || 0,
    snapshotAt: r.snapshot_at == null ? null : Number(r.snapshot_at),
    createdBy: r.created_by,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }))
}

export async function getSummary(id: string, db: Queryable = pool, { forUpdate = false } = {}): Promise<SummaryRow | null> {
  const { rows } = await db.query(`SELECT * FROM polizza_summaries WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? rowFrom(rows[0]) : null
}

export async function insertSummary(row: SummaryRow, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO polizza_summaries (id, name, profile_id, profile_name, year_field_id, due_field_id, mode, job_ids, snapshot, snapshot_at, prefs, field_sigs, rev, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16)`,
    [row.id, row.name, row.profile_id, row.profile_name, row.year_field_id, row.due_field_id, row.mode,
      JSON.stringify(row.job_ids), row.snapshot ? JSON.stringify(row.snapshot) : null, row.snapshot?.takenAt ?? null,
      JSON.stringify(row.prefs || {}), JSON.stringify(row.field_sigs || []), row.rev || 0,
      row.created_by, row.created_at, row.updated_at],
  )
}

// Colonne modificabili: la whitelist SUMMARY_UPDATABLE sta in summaryCompose
// (con changedColumns, provata senza database); id, profilo, autore e date di
// creazione non cambiano mai.
const UPDATABLE = SUMMARY_UPDATABLE
type Updatable = SummaryUpdatable
const JSON_COLS = new Set<Updatable>(['job_ids', 'snapshot', 'prefs', 'field_sigs'])

/** Aggiornamento parziale delle sole colonne ammesse; updated_at e rev sempre, snapshot_at con la fotografia. */
export async function updateSummary(id: string, patch: Partial<Pick<SummaryRow, Updatable>>, db: Queryable = pool): Promise<void> {
  const sets: string[] = []
  const vals: unknown[] = []
  for (const col of UPDATABLE) {
    if (!(col in patch)) continue
    const v = patch[col]
    vals.push(JSON_COLS.has(col) ? (v == null ? null : JSON.stringify(v)) : v)
    sets.push(`${col} = $${vals.length}${JSON_COLS.has(col) ? '::jsonb' : ''}`)
  }
  if ('snapshot' in patch) {
    vals.push(patch.snapshot?.takenAt ?? null)
    sets.push(`snapshot_at = $${vals.length}`)
  }
  vals.push(now())
  sets.push(`updated_at = $${vals.length}`)
  sets.push('rev = rev + 1')
  vals.push(id)
  await db.query(`UPDATE polizza_summaries SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
}

/** Elimina il riepilogo (i job non si toccano). Restituisce la riga eliminata, o null. */
export async function deleteSummary(id: string): Promise<{ id: string; name: string } | null> {
  const { rows } = await pool.query<{ id: string; name: string }>('DELETE FROM polizza_summaries WHERE id = $1 RETURNING id, name', [id])
  return rows[0] ?? null
}

/** Ultimo riepilogo aggiornato con la stessa chiave di profilo (preferenze da ereditare). */
export async function latestSummaryForProfile(key: string): Promise<Pick<SummaryRow, 'prefs' | 'year_field_id' | 'due_field_id'> | null> {
  const { rows } = await pool.query(
    'SELECT prefs, year_field_id, due_field_id FROM polizza_summaries WHERE profile_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [key],
  )
  if (!rows[0]) return null
  const r = rows[0]
  return { prefs: (r.prefs && typeof r.prefs === 'object' ? r.prefs : {}) as SummaryPrefs, year_field_id: r.year_field_id ?? null, due_field_id: r.due_field_id ?? null }
}

// ─── Dipendenze e composizione ───────────────────────────────────────────────

/** Letture per le regole di summaryCompose; le impostazioni si leggono UNA volta per richiesta. */
export async function makeDeps(): Promise<SummaryDeps & { language: string | undefined }> {
  const settings = await getSettings()
  return {
    profiles: (settings.polizzaProfiles || []) as ProfileLike[],
    language: settings.language,
    now,
    newId: () => randomUUID(),
    loadJobs: getJobsLight,
    loadRuns: getLastDoneRuns,
    loadLabels: getJobLabels,
    loadHashes: getFileHashesByJob,
    latestForProfile: latestSummaryForProfile,
  }
}

/**
 * Chiave del profilo di un job (menu «Aggiungi a un riepilogo») e, per le
 * estrazioni singole, la firma dei campi: null se il job non c'è o il profilo
 * non è ancora deciso.
 */
export async function profileKeyForJob(jobId: string): Promise<{ key: string; sig: string | null } | null> {
  const [svc, deps] = await Promise.all([summarySvc(), makeDeps()])
  const [job] = await deps.loadJobs([jobId])
  if (!job) return null
  const k = svc.profileKeyOf(job, deps.profiles)
  return 'key' in k ? { key: k.key, sig: k.sig } : null
}

export interface DetailOptions {
  values?: 'all'
  prefsOverride?: SummaryPrefs
}

/** Dettaglio di un riepilogo con gli aggregati (null se non esiste). */
export async function loadDetail(id: string, view: SummaryViewQuery = {}, opts: DetailOptions = {}): Promise<SummaryDetail | null> {
  const row = await getSummary(id)
  if (!row) return null
  return detailOf(row, view, opts)
}

async function detailOf(row: SummaryRow, view: SummaryViewQuery, opts: DetailOptions, preloaded?: { svc: SummarySvc; deps: SummaryDeps }): Promise<SummaryDetail> {
  const svc = preloaded?.svc ?? await summarySvc()
  const deps = preloaded?.deps ?? await makeDeps()
  // Fotografia: bastano le sue voci (nessuna lettura dei job). Live: i job e,
  // solo per quelli non 'done', l'ultima run completata.
  const { jobs, runs } = row.mode === 'live' ? await loadLiveMaps(deps, row.job_ids) : { jobs: new Map(), runs: new Map() }
  return composeDetail(svc, { row, jobs, runs, profiles: deps.profiles, today: todayRome(), view, values: opts.values, prefsOverride: opts.prefsOverride })
}

// ─── Operazioni delle route ──────────────────────────────────────────────────

export async function previewSummary(body: unknown): Promise<CoreError | { ok: true; preview: SummaryPreview }> {
  const [svc, deps] = await Promise.all([summarySvc(), makeDeps()])
  return previewCore(svc, deps, body)
}

export async function createSummary(body: unknown, email: string): Promise<CoreError | { ok: true; row: SummaryRow; inherited: boolean }> {
  const [svc, deps] = await Promise.all([summarySvc(), makeDeps()])
  const out = await createSummaryCore(svc, deps, body, email)
  if (out.ok) await insertSummary(out.row)
  return out
}

const PATCH_ATTEMPTS = 3
const NOT_FOUND: CoreError = { ok: false, status: 404, body: { error: 'Riepilogo non trovato', code: 'not-found' } }

/**
 * PATCH OTTIMISTICO. Le letture (riga, job, run, hash) si fanno FUORI da ogni
 * transazione; poi una transazione brevissima blocca la riga (FOR UPDATE),
 * controlla che la versione `rev` sia quella letta e scrive le sole colonne
 * cambiate. Se nel frattempo un'altra modifica ha scritto, si rilegge e si
 * riapplica (fino a 3 volte), poi 409 'conflict'. Prima la transazione teneva
 * una connessione mentre le letture ne chiedevano altre al pool (10 di
 * default, una sempre presa dal lock della run): con 9 PATCH insieme l'app si
 * fermava. Il dettaglio restituito si ricalcola dopo il COMMIT.
 */
export async function patchSummary(id: string, body: unknown, view: SummaryViewQuery = {}): Promise<
  | CoreError
  | { ok: true; name: string; keys: string[]; result: SummaryPatchResult; detail: SummaryDetail }
> {
  const [svc, base] = await Promise.all([summarySvc(), makeDeps()])
  const deps = memoDeps(base)
  for (let attempt = 0; attempt < PATCH_ATTEMPTS; attempt++) {
    const row = await getSummary(id)
    if (!row) return NOT_FOUND
    const out = await patchSummaryCore(svc, deps, row, body)
    if (!out.ok) return out
    const changes = changedColumns(row, out.row)
    const client = await pool.connect()
    let status: 'saved' | 'conflict' | 'gone' = 'saved'
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL lock_timeout = '10s'`)
      const { rows } = await client.query('SELECT rev FROM polizza_summaries WHERE id = $1 FOR UPDATE', [id])
      if (!rows[0]) status = 'gone'
      else if ((Number(rows[0].rev) || 0) !== row.rev) status = 'conflict'
      else await updateSummary(id, changes, client)
      await client.query(status === 'saved' ? 'COMMIT' : 'ROLLBACK')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
    if (status === 'gone') return NOT_FOUND
    if (status === 'conflict') continue
    const fresh = (await getSummary(id)) ?? out.row
    const detail = await detailOf(fresh, view, {}, { svc, deps })
    return { ok: true, name: fresh.name, keys: out.keys, result: out.result, detail }
  }
  return { ok: false, status: 409, body: { error: 'Il riepilogo è stato modificato nello stesso momento da un\'altra richiesta: riprova', code: 'conflict' } }
}
