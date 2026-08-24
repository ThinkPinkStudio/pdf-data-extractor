import { pool } from './db'
import { createHash, randomUUID } from 'crypto'
import { flattenRollingState, initRollingState } from './polizzaRolling'
import { importSharedService } from './sharedServices'
import { getSettings } from './settingsStore'

// Identità del contenuto: SHA-256 dei byte del PDF. Stesso file = stesso hash,
// in qualunque cartella e con qualunque nome (cache OCR, dedup, riconoscimento
// fascicoli già elaborati).
export function hashPdfBase64(pdfBase64: string): string {
  return createHash('sha256').update(Buffer.from(pdfBase64, 'base64')).digest('hex')
}

// 'mismatch': BLOCCATO dal pre-check di pertinenza (contenuto ≠ profilo scelto),
// in attesa del "Procedi comunque" dell'utente o di una rielaborazione.
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled' | 'mismatch'

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
  prompt_extra: string | null
  duplicate_of: string | null
  // Run di TEST: id del job SORGENTE di cui riusa i PDF (mai duplicati) e
  // override puntuale dei settings (whitelist nel worker: modello/strategia).
  source_job_id: string | null
  settings_override: Record<string, unknown> | null
  // Identità del profilo scelto all'upload + esito del pre-check di pertinenza.
  profile_id: string | null
  profile_name: string | null
  precheck: Record<string, unknown> | null
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
  promptExtra?: string
  profileId?: string
  profileName?: string
}): Promise<string> {
  const id = randomUUID()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO polizza_jobs (id, email, batch_id, dossier_name, status, whole_dossier, scanned_files, field_defs, prompt_extra, profile_id, profile_name, rolling_state, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'queued',$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11::jsonb,$12,$12)`,
      [id, params.email, params.batchId ?? null, params.dossierName ?? null, params.wholeDossier,
        JSON.stringify(params.scannedFiles), JSON.stringify(params.fieldDefs),
        params.promptExtra ?? null, params.profileId ?? null, params.profileName ?? null,
        JSON.stringify(params.rollingState || {}), now()]
    )
    for (let i = 0; i < params.files.length; i++) {
      const f = params.files[i]
      await client.query(
        `INSERT INTO polizza_job_files (job_id, idx, file_name, pdf_base64, file_hash) VALUES ($1,$2,$3,$4,$5)`,
        [id, i, f.file_name, f.pdf_base64, hashPdfBase64(f.pdf_base64)]
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  // Riconoscimento fascicolo GIÀ ELABORATO: stesso insieme di hash contenuto di un
  // job completato → si annota duplicate_of (l'utente può riusarne i risultati con
  // un'azione esplicita; mai automatico — un motore migliorato può dare di più).
  try {
    const dup = await findIdenticalCompletedJob(id)
    if (dup) {
      await pool.query(`UPDATE polizza_jobs SET duplicate_of = $1 WHERE id = $2`, [dup.id, id])
      await pool.query(
        `UPDATE polizza_jobs SET logs = logs || $1::jsonb WHERE id = $2`,
        [JSON.stringify([`[${new Date().toTimeString().slice(0, 8)}] Fascicolo IDENTICO (stessi file per contenuto) al job già completato "${dup.dossier_name || dup.id}": puoi riusarne i risultati dalla pagina Elaborazioni.`]), id]
      )
    }
  } catch { /* il rilevamento duplicati non deve mai bloccare la creazione */ }
  return id
}

// Job COMPLETATO con lo stesso identico insieme di file per hash contenuto (nomi e
// ordine irrilevanti). Confronta solo job in cui TUTTI gli hash sono presenti
// (le righe precedenti alla migrazione hanno file_hash NULL e vengono ignorate).
export async function findIdenticalCompletedJob(jobId: string): Promise<{ id: string; dossier_name: string | null } | null> {
  const { rows } = await pool.query<{ id: string; dossier_name: string | null }>(
    `WITH mine AS (
       SELECT array_agg(DISTINCT file_hash ORDER BY file_hash) AS hashes,
              COUNT(*) AS n, COUNT(file_hash) AS n_hashed
       FROM polizza_job_files WHERE job_id = $1
     )
     SELECT j.id, j.dossier_name
     FROM polizza_jobs j, mine
     WHERE j.status = 'done' AND j.id <> $1
       AND mine.n > 0 AND mine.n = mine.n_hashed
       AND (SELECT array_agg(DISTINCT f.file_hash ORDER BY f.file_hash)
              FROM polizza_job_files f WHERE f.job_id = j.id AND f.file_hash IS NOT NULL)
           = mine.hashes
       AND NOT EXISTS (SELECT 1 FROM polizza_job_files f2 WHERE f2.job_id = j.id AND f2.file_hash IS NULL)
     ORDER BY j.updated_at DESC LIMIT 1`,
    [jobId]
  )
  return rows[0] ?? null
}

// ─── Cache OCR per hash contenuto ────────────────────────────────────────────
// L'OCR tesseract di un PDF scansionato costa minuti: lo stesso identico file
// (doppioni tra cartelle, fascicoli ricaricati, retry) riusa i testi pagina.
// OCR_FORMAT versiona il FORMATO del testo (2 = griglia spaziale a colonne
// preservate): al bump le voci vecchie diventano miss e si rigenerano al primo
// rilancio — senza, i fascicoli in cache non vedrebbero MAI il testo nuovo.
export const OCR_FORMAT = 2

export async function getOcrCache(fileHash: string): Promise<string[] | null> {
  const { rows } = await pool.query<{ pages: string[]; format: number }>(
    'SELECT pages, format FROM ocr_cache WHERE file_hash = $1', [fileHash]
  )
  if (!rows[0] || (rows[0].format ?? 1) !== OCR_FORMAT) return null
  return rows[0].pages ?? null
}

// true se in cache c'è una voce per questo hash ma in un FORMATO vecchio:
// serve solo al log del worker ("ri-OCR per aggiornamento formato", non "mai
// visto") — in produzione un miss inatteso sembrerebbe una cache rotta.
export async function hasStaleOcrCache(fileHash: string): Promise<boolean> {
  const { rows } = await pool.query<{ format: number }>(
    'SELECT format FROM ocr_cache WHERE file_hash = $1', [fileHash]
  )
  return !!rows[0] && (rows[0].format ?? 1) !== OCR_FORMAT
}

export async function putOcrCache(fileHash: string, fileName: string, pages: string[]): Promise<void> {
  await pool.query(
    `INSERT INTO ocr_cache (file_hash, file_name, num_pages, pages, created_at, format)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (file_hash) DO UPDATE SET file_name = $2, num_pages = $3, pages = $4::jsonb, format = $6`,
    [fileHash, fileName, pages.length, JSON.stringify(pages), now(), OCR_FORMAT]
  )
}

// Riuso dei risultati di un fascicolo identico già completato: copia valori, fonti
// e definizione campi dal job sorgente e marca il job come done — senza OCR né
// chiamate al modello. Azione esplicita dell'utente. Ritorna null se il job non è
// riusabile (in esecuzione, già done) o la sorgente non è più valida.
export async function reuseResultsFromJob(id: string, byEmail?: string): Promise<JobRow | null> {
  const job = await getJob(id)
  if (!job || job.status === 'running' || job.status === 'done') return null
  const sourceId = job.duplicate_of
  if (!sourceId) return null
  const src = await getJob(sourceId)
  if (!src || src.status !== 'done') return null
  const logs = Array.isArray(job.logs) ? [...job.logs] : []
  logs.push(`[${new Date().toTimeString().slice(0, 8)}] — Risultati RIUSATI dal job identico "${src.dossier_name || src.id}"${byEmail ? ` (richiesto da ${byEmail})` : ''}: nessun OCR né estrazione rifatti —`)
  await updateJob(id, {
    status: 'done',
    error: null,
    cursor: {},
    progress: {},
    rolling_state: src.rolling_state || {},
    sources: src.sources || {},
    field_defs: src.field_defs || [],
    logs,
  })
  return await getJob(id)
}

// ─── Batch: raggruppa N job polizza (una sottocartella caricata = un job) ──────
// Upload a chunk: il client crea il batch (vuoto) e poi carica un dossier alla volta
// via addDossierToBatch, così una connessione caduta a metà perde solo il dossier in
// corso, non l'intero batch. markUploadComplete chiude il flusso di ingresso.
export interface BatchRow {
  id: string
  email: string
  label: string
  upload_complete: boolean
  created_at: number
  updated_at: number
}

export async function initBatch(params: { email: string; label: string }): Promise<string> {
  const batchId = randomUUID()
  await pool.query(
    `INSERT INTO batch_jobs (id, email, label, upload_complete, created_at, updated_at) VALUES ($1,$2,$3,FALSE,$4,$4)`,
    [batchId, params.email, params.label, now()]
  )
  return batchId
}

export async function getBatchRow(id: string): Promise<BatchRow | null> {
  const { rows } = await pool.query<BatchRow>('SELECT * FROM batch_jobs WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function addDossierToBatch(params: {
  batchId: string
  email: string
  wholeDossier: boolean
  fieldDefs: JobRow['field_defs']
  dossierName: string
  files: JobInputFile[]
  promptExtra?: string
  profileId?: string
  profileName?: string
}): Promise<string> {
  return createJob({
    email: params.email,
    wholeDossier: params.wholeDossier,
    scannedFiles: params.files.map((f) => f.file_name),
    fieldDefs: params.fieldDefs,
    rollingState: initRollingState(params.fieldDefs),
    files: params.files,
    batchId: params.batchId,
    dossierName: params.dossierName,
    promptExtra: params.promptExtra,
    profileId: params.profileId,
    profileName: params.profileName,
  })
}

// Reclamo ATOMICO della notifica di fine batch: imposta notified_at solo se ancora
// NULL, così un solo chiamante "vince" e invia l'email una volta sola (anche se
// l'orchestratore riparte dopo un restart). Ritorna proprietario, etichetta e
// conteggi dei job; null se già notificato (o batch inesistente).
export async function claimBatchNotification(batchId: string): Promise<
  { email: string; label: string; total: number; done: number; error: number; canceled: number; mismatch: number } | null
> {
  const { rows } = await pool.query<{ email: string; label: string }>(
    `UPDATE batch_jobs SET notified_at = $1 WHERE id = $2 AND notified_at IS NULL RETURNING email, label`,
    [now(), batchId]
  )
  if (!rows.length) return null
  const { rows: counts } = await pool.query<{ total: number; done: number; error: number; canceled: number; mismatch: number }>(
    `SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'done')::int AS done,
       COUNT(*) FILTER (WHERE status = 'error')::int AS error,
       COUNT(*) FILTER (WHERE status = 'canceled')::int AS canceled,
       COUNT(*) FILTER (WHERE status = 'mismatch')::int AS mismatch
     FROM polizza_jobs WHERE batch_id = $1`,
    [batchId]
  )
  return { email: rows[0].email, label: rows[0].label, ...counts[0] }
}

export async function markUploadComplete(batchId: string): Promise<void> {
  await pool.query(`UPDATE batch_jobs SET upload_complete = TRUE, updated_at = $1 WHERE id = $2`, [now(), batchId])
}

export async function isUploadComplete(batchId: string): Promise<boolean> {
  const { rows } = await pool.query<{ upload_complete: boolean }>(
    'SELECT upload_complete FROM batch_jobs WHERE id = $1', [batchId]
  )
  return rows[0]?.upload_complete ?? true
}

// Al boot nessun client può più essere a metà upload verso un processo appena
// riavviato: i batch ancora "aperti" vengono chiusi forzatamente prima di riprenderli,
// altrimenti l'orchestratore resterebbe in attesa per sempre di dossier che non
// arriveranno più (vedi instrumentation.ts).
export async function forceUploadCompleteForActiveBatches(): Promise<void> {
  await pool.query(`UPDATE batch_jobs SET upload_complete = TRUE WHERE upload_complete = FALSE`)
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
  mismatch: number
}

// Lavoro CONDIVISO nel team: elenca i batch di TUTTI gli utenti (la colonna email
// resta come "proprietario", mostrata nell'interfaccia). L'isolamento per email è
// stato rimosso di proposito perché i colleghi devono vedere/gestire il lavoro altrui.
export async function listBatches(): Promise<BatchSummary[]> {
  const { rows } = await pool.query<BatchSummary>(
    `SELECT b.*,
       COUNT(j.id)::int AS total,
       COUNT(j.id) FILTER (WHERE j.status = 'queued')::int AS queued,
       COUNT(j.id) FILTER (WHERE j.status = 'running')::int AS running,
       COUNT(j.id) FILTER (WHERE j.status = 'done')::int AS done,
       COUNT(j.id) FILTER (WHERE j.status = 'error')::int AS error,
       COUNT(j.id) FILTER (WHERE j.status = 'canceled')::int AS canceled,
       COUNT(j.id) FILTER (WHERE j.status = 'mismatch')::int AS mismatch
     FROM batch_jobs b
     LEFT JOIN polizza_jobs j ON j.batch_id = b.id
     GROUP BY b.id
     ORDER BY b.created_at DESC`
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

// I job di TEST non hanno righe in polizza_job_files: i PDF si leggono dal job
// SORGENTE (source_job_id, risolto sempre alla RADICE alla creazione del test:
// una sola risalita). Sorgente cancellato → nessun file (accettato).
async function sourceJobIdOf(id: string): Promise<string | null> {
  const { rows } = await pool.query<{ source_job_id: string | null }>(
    'SELECT source_job_id FROM polizza_jobs WHERE id = $1', [id]
  )
  return rows[0]?.source_job_id ?? null
}

export async function getJobFiles(id: string): Promise<{ idx: number; file_name: string; pdf_base64: string; file_hash: string | null }[]> {
  const q = 'SELECT idx, file_name, pdf_base64, file_hash FROM polizza_job_files WHERE job_id = $1 ORDER BY idx'
  const { rows } = await pool.query(q, [id])
  if (rows.length) return rows
  const src = await sourceJobIdOf(id)
  if (!src) return rows
  const { rows: fromSrc } = await pool.query(q, [src])
  return fromSrc
}

// UN solo PDF di un job, per la visualizzazione nel browser (i valori estratti
// citano file+pagina: da lì si apre l'originale e si verifica a mano).
export async function getJobFile(id: string, idx: number): Promise<{ file_name: string; pdf_base64: string } | null> {
  const q = 'SELECT file_name, pdf_base64 FROM polizza_job_files WHERE job_id = $1 AND idx = $2'
  const { rows } = await pool.query(q, [id, idx])
  if (rows[0]) return rows[0]
  const src = await sourceJobIdOf(id)
  if (!src) return null
  const { rows: fromSrc } = await pool.query(q, [src, idx])
  return fromSrc[0] || null
}

// Estrazioni SINGOLE (fuori batch) di tutti gli utenti, per la pagina
// Elaborazioni: il DB le ha sempre conservate (PDF compresi), questa vista le
// rende visibili, esportabili e rilanciabili come i batch. Le più recenti prima.
export async function listSingleJobs(limit = 100): Promise<JobRow[]> {
  const { rows } = await pool.query<JobRow>(
    `SELECT * FROM polizza_jobs WHERE batch_id IS NULL ORDER BY created_at DESC LIMIT $1`,
    [Math.max(1, Math.min(500, limit))]
  )
  return rows
}

// Scope per la CHAT archivio: tutti i job completati (singoli E di batch), con
// nome leggibile e lista file — servono a scegliere "un fascicolo" o "un
// documento" da interrogare. L'id è il job_id = scope ermetico dei punti Qdrant.
export async function listJobsForChat(limit = 300): Promise<{ id: string; label: string; files: string[] }[]> {
  const { rows } = await pool.query<{ id: string; dossier_name: string | null; scanned_files: string[]; batch_label: string | null }>(
    `SELECT j.id, j.dossier_name, j.scanned_files, b.label AS batch_label
     FROM polizza_jobs j LEFT JOIN batch_jobs b ON b.id = j.batch_id
     WHERE j.status = 'done'
     ORDER BY j.updated_at DESC LIMIT $1`,
    [Math.max(1, Math.min(1000, limit))]
  )
  return rows.map((r) => ({
    id: r.id,
    label: `${r.batch_label ? `${r.batch_label} / ` : ''}${r.dossier_name || (r.scanned_files?.[0] ? `${r.scanned_files[0]}${(r.scanned_files.length > 1) ? ` (+${r.scanned_files.length - 1})` : ''}` : r.id.slice(0, 8))}`,
    files: r.scanned_files || [],
  }))
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
const JSON_COLS = new Set(['scanned_files', 'cursor', 'progress', 'rolling_state', 'sources', 'field_defs', 'logs', 'settings_override', 'precheck'])
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
    owner: job.email,
    dossierName: job.dossier_name,
    status: job.status,
    wholeDossier: job.whole_dossier,
    scannedFiles: job.scanned_files || [],
    fieldDefs: job.field_defs || [],
    values: flattenRollingState(job.rolling_state),
    sources: job.sources || {},
    progress: job.progress && Object.keys(job.progress).length ? job.progress : null,
    duplicateOf: job.duplicate_of || null,
    sourceJobId: job.source_job_id || null,
    promptExtra: job.prompt_extra ?? null,
    profileId: job.profile_id || null,
    profileName: job.profile_name || null,
    precheck: job.precheck || null,
    error: job.error || null,
    logs: job.logs || [],
    updatedAt: job.updated_at,
    reliability: Object.fromEntries(
      Object.entries(job.rolling_state || {})
        .filter(([, e]) => e && typeof e === 'object' && typeof (e as { reliable?: unknown }).reliable === 'number')
        .map(([k, e]) => [k, { reliable: (e as { reliable: number }).reliable, verified: (e as { verified?: string[] }).verified || [] }]),
    ),
  }
}

// Run di TEST: nuovo job COPIA che riusa i PDF del sorgente (zero duplicazione,
// zero ri-OCR grazie alla cache per hash) e NON tocca mai il job originale —
// serve a confrontare modelli/profili/impostazioni fianco a fianco.
// batch_id = NULL: appare tra le "Estrazioni singole", riparte al boot col
// resumer dei singoli, mai preso dall'orchestratore batch.
export async function createTestJob(params: {
  sourceJobId: string
  email: string
  fieldDefs: JobRow['field_defs']
  promptExtra: string | null
  settingsOverride: Record<string, unknown>
  label: string
}): Promise<JobRow | null> {
  const src = await getJob(params.sourceJobId)
  if (!src) return null
  // Test di un test: si risale sempre alla RADICE, così il fallback dei file
  // resta a un solo livello e la catena non si allunga mai.
  const rootId = src.source_job_id || src.id
  const id = randomUUID()
  await pool.query(
    `INSERT INTO polizza_jobs
       (id, email, batch_id, dossier_name, status, whole_dossier, scanned_files, field_defs, prompt_extra,
        rolling_state, source_job_id, settings_override, logs, created_at, updated_at)
     VALUES ($1,$2,NULL,$3,'queued',$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12,$12)`,
    [id, params.email, params.label, src.whole_dossier,
      JSON.stringify(src.scanned_files || []), JSON.stringify(params.fieldDefs),
      params.promptExtra, JSON.stringify(initRollingState(params.fieldDefs)),
      rootId, JSON.stringify(params.settingsOverride || {}),
      JSON.stringify([`[${new Date().toTimeString().slice(0, 8)}] — Run di TEST creata da "${src.dossier_name || src.id}" da ${params.email} —`]),
      now()]
  )
  return getJob(id)
}

// Rilancio di un job: riporta il job in coda azzerando errore, cursore,
// progresso e stato rolling (ri-inizializzato dai field_defs congelati
// all'upload). Vale per i FALLITI/ANNULLATI (riprova) ma anche per i COMPLETATI
// (rielaborazione: i PDF sono già in polizza_job_files, un motore migliorato può
// dare risultati migliori sugli stessi file — è il senso di avere il database).
// Ritorna la riga aggiornata (serve il batch_id per riavviare l'orchestratore
// giusto), null se il job non esiste o è in corso.
export async function resetJobForRetry(id: string, byEmail?: string): Promise<JobRow | null> {
  const job = await getJob(id)
  if (!job || job.status === 'running' || job.status === 'queued') return null
  const logs = Array.isArray(job.logs) ? [...job.logs] : []

  // Skip no-op: job già completato e fingerprint (campi/prompt/modello/revisione
  // motore) identico a quello corrente → si conservano i risultati.
  if (job.status === 'done' && (job.rolling_state as any)?.__engine?.fingerprint) {
    try {
      const settings = await getSettings()
      const relMod = await importSharedService<{ extractFingerprint: (p: any) => string; ENGINE_REVISION: number }>('fieldReliability.js')
      const fp = relMod.extractFingerprint({
        fieldDefs: job.field_defs,
        promptExtra: job.prompt_extra,
        settingsOverride: {
          ollamaModel: settings.ollamaModel,
          polizzaWholeDossierModel: settings.polizzaWholeDossierModel,
          polizzaStagedCascade: settings.polizzaStagedCascade,
          polizzaPerField: settings.polizzaPerField,
          polizzaConstrainedJson: settings.polizzaConstrainedJson,
          ...(job.settings_override || {}),
        },
      })
      const engine = (job.rolling_state as any).__engine
      if (fp === engine.fingerprint && relMod.ENGINE_REVISION === engine.revision) {
        logs.push(`[${new Date().toTimeString().slice(0, 8)}] — Rielaborazione saltata: impostazioni e motore invariati${byEmail ? ` (da ${byEmail})` : ''} —`)
        await updateJob(id, { logs })
        return job
      }
    } catch { /* si procede col rilancio */ }
  }

  const verb = job.status === 'done' ? 'Rielaborazione' : 'Rilancio'
  logs.push(`[${new Date().toTimeString().slice(0, 8)}] — ${verb} manuale${byEmail ? ` da ${byEmail}` : ''} —`)
  await updateJob(id, {
    status: 'queued',
    error: null,
    cursor: {},
    progress: {},
    rolling_state: initRollingState(job.field_defs || []),
    sources: {},
    // Rielaborare = ricontrollare da zero: l'esito (e l'eventuale override) del
    // pre-check precedente non deve sopravvivere al rilancio.
    precheck: null,
    logs,
  })
  return { ...job, status: 'queued' as JobStatus }
}

// "PROCEDI COMUNQUE": l'utente conferma che il fascicolo va estratto col
// profilo scelto nonostante il pre-check di pertinenza lo abbia bloccato
// (falso allarme). L'override viene PERSISTITO nel precheck: al run successivo
// il worker salta il controllo. Solo da stato 'mismatch'.
export async function overridePrecheckAndRequeue(id: string, byEmail?: string): Promise<JobRow | null> {
  const job = await getJob(id)
  if (!job || job.status !== 'mismatch') return null
  const logs = Array.isArray(job.logs) ? [...job.logs] : []
  logs.push(`[${new Date().toTimeString().slice(0, 8)}] — Procedi comunque (pre-check di pertinenza ignorato)${byEmail ? ` da ${byEmail}` : ''} —`)
  await updateJob(id, {
    status: 'queued',
    error: null,
    precheck: { ...(job.precheck || {}), override: true },
    logs,
  })
  return { ...job, status: 'queued' as JobStatus }
}

// Job in errore di un batch (per il rilancio collettivo con esclusioni).
export async function listFailedBatchJobs(batchId: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM polizza_jobs WHERE batch_id = $1 AND status = 'error' ORDER BY created_at, id`,
    [batchId]
  )
  return rows.map((r) => r.id)
}

// ─── Manutenzione dati (pannello di controllo) ───────────────────────────────

// Statistiche del database polizze: conteggi + dimensioni approssimative dei
// PDF salvati e della cache OCR (per capire COSA occupa spazio prima di cancellare).
export async function dataStats(): Promise<{
  batches: number; jobs: number; jobsRunning: number; files: number; filesMb: number
  ocrEntries: number; ocrMb: number
}> {
  const { rows } = await pool.query<{
    batches: string; jobs: string; jobs_running: string; files: string; files_bytes: string
    ocr_entries: string; ocr_bytes: string
  }>(
    `SELECT
       (SELECT COUNT(*) FROM batch_jobs) AS batches,
       (SELECT COUNT(*) FROM polizza_jobs) AS jobs,
       (SELECT COUNT(*) FROM polizza_jobs WHERE status IN ('running','queued')) AS jobs_running,
       (SELECT COUNT(*) FROM polizza_job_files) AS files,
       (SELECT COALESCE(SUM(LENGTH(pdf_base64)), 0) FROM polizza_job_files) AS files_bytes,
       (SELECT COUNT(*) FROM ocr_cache) AS ocr_entries,
       (SELECT COALESCE(SUM(LENGTH(pages::text)), 0) FROM ocr_cache) AS ocr_bytes`
  )
  const r = rows[0]
  // base64 → byte reali ≈ ×0.75
  return {
    batches: parseInt(r.batches, 10), jobs: parseInt(r.jobs, 10), jobsRunning: parseInt(r.jobs_running, 10),
    files: parseInt(r.files, 10), filesMb: Math.round((parseInt(r.files_bytes, 10) * 0.75) / 1048576),
    ocrEntries: parseInt(r.ocr_entries, 10), ocrMb: Math.round(parseInt(r.ocr_bytes, 10) / 1048576),
  }
}

// Elimina un job e i suoi PDF (cascade su polizza_job_files). Rifiutato se in
// esecuzione/coda: prima si annulla, poi si elimina. Ritorna la riga eliminata
// (serve l'id per pulire anche i punti Qdrant del fascicolo).
export async function deleteJob(id: string): Promise<JobRow | null> {
  const job = await getJob(id)
  if (!job) return null
  if (job.status === 'running' || job.status === 'queued') return null
  await pool.query('DELETE FROM polizza_jobs WHERE id = $1', [id])
  return job
}

// Elimina un batch con TUTTI i suoi job e PDF (cascade). Rifiutato se ha job
// attivi. Ritorna gli id dei job eliminati (per la pulizia dei punti Qdrant).
export async function deleteBatch(id: string): Promise<string[] | null> {
  const { rows: active } = await pool.query(
    `SELECT 1 FROM polizza_jobs WHERE batch_id = $1 AND status IN ('running','queued') LIMIT 1`, [id]
  )
  if (active.length) return null
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM polizza_jobs WHERE batch_id = $1', [id])
  await pool.query('DELETE FROM batch_jobs WHERE id = $1', [id])
  return rows.map((r) => r.id)
}

// Svuota la cache OCR (i prossimi run rifanno l'OCR e la ripopolano da soli).
export async function clearOcrCache(): Promise<number> {
  const { rowCount } = await pool.query('DELETE FROM ocr_cache')
  return rowCount ?? 0
}

// Lavoro condiviso: qualunque utente autenticato può annullare un job (di chiunque).
export async function cancelJob(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE polizza_jobs SET status = 'canceled', updated_at = $1
     WHERE id = $2 AND status IN ('running','queued')`,
    [now(), id]
  )
  return (rowCount ?? 0) > 0
}
