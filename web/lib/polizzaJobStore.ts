import { pool } from './db'
import { createHash, randomUUID } from 'crypto'
import { flattenRollingState, initRollingState } from './polizzaRolling'
import { forcedWithoutPolicy, isNotValidJob } from './jobValidity'
import { importSharedService } from './sharedServices'

// Identità del contenuto: SHA-256 dei byte del PDF. Stesso file = stesso hash,
// in qualunque cartella e con qualunque nome (cache OCR, dedup, riconoscimento
// fascicoli già elaborati).
export function hashPdfBase64(pdfBase64: string): string {
  return createHash('sha256').update(Buffer.from(pdfBase64, 'base64')).digest('hex')
}

// 'mismatch': BLOCCATO dal pre-check di pertinenza (contenuto ≠ profilo scelto),
// in attesa del "Procedi comunque" dell'utente o di una rielaborazione.
// Comprende i «Non valido» (nessuna polizza tra i documenti letti secondo il
// modello: testo errore «Non valido — …», precheck.notValid), bloccati e NON
// forzabili: niente Procedi comunque, niente ▶, niente riuso; solo Riabbina,
// che rifà il controllo (jobValidity.ts, regola del 26/09/2026). I vecchi
// «Accantonato — …» restano forzabili: la guardia del worker chiede al modello.
// 'review': DA VERIFICARE — il controllo di operatività non ha una prova
// sufficiente (dubbio, prova non trovata, elementi contraddittori, guasto):
// nessun campo estratto finché l'utente non preme "Procedi comunque" o
// "Riabbina" con un altro profilo.
// 'matched': ABBINATO — job nato in «Solo abbinamento» (precheck.matchOnly):
// OCR e pertinenza fatti, estrazione in attesa del ▶ dell'utente.
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled' | 'mismatch' | 'matched' | 'review'

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
  field_defs: { id: string; label: string; description?: string; type?: string; sheet?: string }[]
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

// rel_path: percorso relativo di origine (webkitRelativePath, radice inclusa)
// quando il file arriva dal caricamento di una CARTELLA — serve a ricostruire
// l'albero nello ZIP dei PDF del batch. Assente per i singoli file.
export interface JobInputFile { file_name: string; pdf_base64: string; rel_path?: string | null }

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
  // Stato iniziale del pre-check: { matchOnly: true } per «Solo abbinamento»
  // (il worker si ferma in 'matched' dopo la pertinenza, senza estrarre).
  precheck?: Record<string, unknown> | null
}): Promise<string> {
  const id = randomUUID()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO polizza_jobs (id, email, batch_id, dossier_name, status, whole_dossier, scanned_files, field_defs, prompt_extra, profile_id, profile_name, rolling_state, created_at, updated_at, precheck)
       VALUES ($1,$2,$3,$4,'queued',$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11::jsonb,$12,$12,$13::jsonb)`,
      [id, params.email, params.batchId ?? null, params.dossierName ?? null, params.wholeDossier,
        JSON.stringify(params.scannedFiles), JSON.stringify(params.fieldDefs),
        params.promptExtra ?? null, params.profileId ?? null, params.profileName ?? null,
        JSON.stringify(params.rollingState || {}), now(), params.precheck ? JSON.stringify(params.precheck) : null]
    )
    for (let i = 0; i < params.files.length; i++) {
      const f = params.files[i]
      await client.query(
        `INSERT INTO polizza_job_files (job_id, idx, file_name, pdf_base64, file_hash, rel_path) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, i, f.file_name, f.pdf_base64, hashPdfBase64(f.pdf_base64), f.rel_path ?? null]
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
// OCR_FORMAT versiona il FORMATO del testo: al bump le voci vecchie diventano
// miss e si rigenerano al primo rilancio — senza, i fascicoli in cache non
// vedrebbero MAI il testo nuovo.
// 2 = griglia spaziale a colonne preservate — MA una versione provvisoria del
//     worker (428fa06) scriveva qui anche il MARKDOWN Docling (blob unico, mai
//     una griglia) col format 2: le voci in produzione sono AVVELENATE, e il
//     ramo mdDoc che legge getOcrCache come spatial le riusa, zittendo per
//     sempre la griglia pdfjs reale (→ in produzione il modello riceve 1 pagina
//     da 26k char: A/B locale 09/09/26 = 16/23 col blob, la griglia sale).
// 3 = invalida tutto: al primo rilancio spatialPages viene rigenerata vera
//     (pdfjs/tesseract) e solo quella entra in cache.
// 4 = la griglia pdfjs era CAPOVOLTA (pdf.js ha l'asse y verso l'alto: il
//     piè di pagina usciva per primo e ogni riga di valori precedeva la riga
//     delle sue etichette). Le voci scritte col formato 3 sono griglie
//     rovesciate: si rigenerano con l'orientamento corretto.
export const OCR_FORMAT = 4

// Chiave della cache OCR per MOTORE di lettura: Tesseract usa l'hash del file
// (voci esistenti), un modello visivo `<hash>:vis:<modello>`. Senza, un A/B
// Tesseract ↔ modello visivo avrebbe riletto il testo dell'altro motore.
export function ocrCacheKey(fileHash: string, settings: { polizzaOcrEngine?: string } | null | undefined): string {
  const e = String(settings?.polizzaOcrEngine || '').trim()
  return e && e.toLowerCase() !== 'tesseract' ? `${fileHash}:vis:${e}` : fileHash
}

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
  // Un fascicolo NON VALIDO (nessuna polizza) non riceve valori copiati da un
  // altro job: sarebbe un'estrazione forzata senza alcun controllo.
  if (isNotValidJob(job)) return null
  const sourceId = job.duplicate_of
  if (!sourceId) return null
  const src = await getJob(sourceId)
  if (!src || src.status !== 'done') return null
  // Né valori estratti FORZANDO un fascicolo senza polizza vista dal modello
  // (Procedi comunque senza «presente», come l'ALZAIA 101 estratta prima del
  // 26/09): la forzatura vale per quel job, non si copia su un altro.
  if (forcedWithoutPolicy(src)) return null
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
    `INSERT INTO batch_jobs (id, email, label, upload_complete, needs_reconcile, created_at, updated_at) VALUES ($1,$2,$3,FALSE,TRUE,$4,$4)`,
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
  matchOnly?: boolean
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
    precheck: params.matchOnly ? { matchOnly: true } : null,
  })
}

// Reclamo ATOMICO della notifica di fine batch: imposta notified_at solo se ancora
// NULL, così un solo chiamante "vince" e invia l'email una volta sola (anche se
// l'orchestratore riparte dopo un restart). Ritorna proprietario, etichetta e
// conteggi dei job; null se già notificato (o batch inesistente).
export async function claimBatchNotification(batchId: string): Promise<
  { email: string; label: string; total: number; done: number; error: number; canceled: number; mismatch: number; matched: number; review: number } | null
> {
  const { rows } = await pool.query<{ email: string; label: string }>(
    `UPDATE batch_jobs SET notified_at = $1 WHERE id = $2 AND notified_at IS NULL RETURNING email, label`,
    [now(), batchId]
  )
  if (!rows.length) return null
  const { rows: counts } = await pool.query<{ total: number; done: number; error: number; canceled: number; mismatch: number; matched: number; review: number }>(
    `SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'done')::int AS done,
       COUNT(*) FILTER (WHERE status = 'error')::int AS error,
       COUNT(*) FILTER (WHERE status = 'canceled')::int AS canceled,
       COUNT(*) FILTER (WHERE status = 'mismatch')::int AS mismatch,
       COUNT(*) FILTER (WHERE status = 'matched')::int AS matched,
       COUNT(*) FILTER (WHERE status = 'review')::int AS review
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
  matched: number
  review: number
  // Quanti dei 'mismatch' sono NON VALIDI (nessuna polizza secondo il modello):
  // non aspettano una decisione, non si forzano. Stessa regola di isNotValidJob.
  notValid: number
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
       COUNT(j.id) FILTER (WHERE j.status = 'mismatch')::int AS mismatch,
       COUNT(j.id) FILTER (WHERE j.status = 'matched')::int AS matched,
       COUNT(j.id) FILTER (WHERE j.status = 'review')::int AS review,
       COUNT(j.id) FILTER (WHERE j.status = 'mismatch' AND (j.error LIKE 'Non valido%' OR (j.precheck->>'notValid') = 'true' OR (j.precheck->'polizza'->>'esito') = 'assente'))::int AS "notValid"
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

// ─── ZIP dei PDF di un batch ──────────────────────────────────────────────────
// Due passaggi apposta: prima i METADATI di tutti i file (senza i byte), poi un
// PDF alla volta durante lo streaming dell'archivio. Caricare insieme i base64
// di un intero batch farebbe esplodere la memoria dello stesso processo che fa
// girare OCR e worker.

export interface BatchPdfEntry {
  jobId: string
  filesJobId: string // job che possiede davvero le righe (le run di test le hanno sul sorgente)
  dossierName: string | null
  idx: number
  fileName: string
  relPath: string | null
  createdAt: number
}

export async function listBatchPdfEntries(batchId: string): Promise<BatchPdfEntry[]> {
  const { rows: jobs } = await pool.query<{ id: string; dossier_name: string | null; source_job_id: string | null; created_at: number }>(
    'SELECT id, dossier_name, source_job_id, created_at FROM polizza_jobs WHERE batch_id = $1 ORDER BY created_at, id',
    [batchId]
  )
  const out: BatchPdfEntry[] = []
  const q = 'SELECT idx, file_name, rel_path FROM polizza_job_files WHERE job_id = $1 ORDER BY idx'
  for (const j of jobs) {
    let filesJobId = j.id
    let { rows } = await pool.query<{ idx: number; file_name: string; rel_path: string | null }>(q, [j.id])
    if (!rows.length && j.source_job_id) {
      filesJobId = j.source_job_id
      rows = (await pool.query<{ idx: number; file_name: string; rel_path: string | null }>(q, [j.source_job_id])).rows
    }
    for (const r of rows) {
      out.push({
        jobId: j.id,
        filesJobId,
        dossierName: j.dossier_name,
        idx: r.idx,
        fileName: r.file_name,
        relPath: r.rel_path,
        createdAt: j.created_at,
      })
    }
  }
  return out
}

// Byte di UN pdf (base64 → Buffer) per lo streaming: il chiamante lo scrive e lo
// lascia andare prima di chiedere il successivo.
export async function getJobFilePdfBytes(jobId: string, idx: number): Promise<Buffer | null> {
  const { rows } = await pool.query<{ pdf_base64: string }>(
    'SELECT pdf_base64 FROM polizza_job_files WHERE job_id = $1 AND idx = $2', [jobId, idx]
  )
  if (!rows[0]?.pdf_base64) return null
  return Buffer.from(rows[0].pdf_base64, 'base64')
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
  // Esito raggiunto → fotografia nello STORICO. Mai bloccante: un errore qui
  // non deve far fallire il job.
  if (typeof patch.status === 'string' && RUN_END_STATUSES.has(patch.status)) {
    try { await recordJobRun(id) } catch (err) { console.warn('[polizza] storico run non salvato:', (err as Error)?.message) }
  }
}

// ── STORICO DELLE RUN ────────────────────────────────────────────────────────
// Stati che chiudono una run (canceled no: una run annullata non ha esito).
const RUN_END_STATUSES = new Set(['done', 'error', 'mismatch', 'review', 'matched'])

export interface JobRunRow {
  id: number
  job_id: string
  batch_id: string | null
  finished_at: number
  status: string
  profile_id: string | null
  profile_name: string | null
  model: string | null
  ctx: number | null
  verdict: string | null
  summary: string | null
  error: string | null
  fields: { id: string; label: string }[]
  field_values: Record<string, string>
  filled: number
  total: number
}

async function recordJobRun(id: string): Promise<void> {
  const job = await getJob(id)
  if (!job) return
  const { getSettings } = await import('./settingsStore')
  const settings: any = await getSettings().catch(() => ({}))
  const ov: any = job.settings_override || {}
  const model = ov.ollamaModel || settings.ollamaModel || null
  const ctxRaw = parseInt(ov.polizzaBatchContext ?? settings.polizzaBatchContext, 10)
  const pc: any = job.precheck || {}
  const fieldDefs = (job.field_defs || []) as { id: string; label?: string }[]
  const flat = flattenRollingState(job.rolling_state) as Record<string, unknown>
  const values: Record<string, string> = {}
  for (const f of fieldDefs) {
    const v = flat[f.id]
    if (v !== undefined && v !== null && String(v).trim() !== '') values[f.id] = String(v)
  }
  await pool.query(
    `INSERT INTO polizza_job_runs (job_id, batch_id, finished_at, status, profile_id, profile_name, model, ctx, verdict, summary, error, fields, field_values, filled, total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15)`,
    [job.id, job.batch_id || null, now(), job.status, job.profile_id || null, job.profile_name || null, model,
      Number.isFinite(ctxRaw) ? ctxRaw : 8192, pc.verdict || null, pc.summary || pc.reason || null, job.error || null,
      JSON.stringify(fieldDefs.map((f) => ({ id: f.id, label: f.label || f.id }))), JSON.stringify(values),
      Object.keys(values).length, fieldDefs.length],
  )
}

/** Storico delle run di un job, dalla più recente. */
export async function getJobRuns(jobId: string, limit = 50): Promise<JobRunRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM polizza_job_runs WHERE job_id = $1 ORDER BY finished_at DESC, id DESC LIMIT $2`,
    [jobId, limit],
  )
  return rows.map((r: any) => ({ ...r, finished_at: Number(r.finished_at) }))
}

// ── LETTURE PER I RIEPILOGHI (26/09/2026) ────────────────────────────────────
// Solo quel che serve a un riepilogo (niente logs, cursor, sources, prompt):
// un riepilogo può avere 2000 polizze e il dettaglio si rilegge a ogni cambio
// di filtro. Per questo i valori arrivano già PIATTI dal database (senza
// «fonte» e affidabilità dello stato rolling), del precheck solo i segnali di
// «Non valido» / «Procedi comunque», e i field_defs (con le descrizioni lunghe)
// una volta sola per ogni insieme di campi distinto.

/** Job con le sole colonne dei riepiloghi, più l'etichetta del batch. */
export interface JobLightRow {
  id: string
  batch_id: string | null
  dossier_name: string | null
  scanned_files: string[]
  status: JobStatus
  field_defs: JobRow['field_defs']
  /** Valori piatti {id campo: valore} (stessa regola di flattenRollingState). */
  values?: Record<string, string>
  /** Stato rolling completo: solo nei test (il modulo puro accetta l'uno o l'altro). */
  rolling_state?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  profile_id: string | null
  profile_name: string | null
  /** Solo notValid, override e polizza.esito (jobValidity). */
  precheck: Record<string, unknown> | null
  error: string | null
  source_job_id: string | null
  duplicate_of: string | null
  updated_at: number
  batch_label: string | null
}

export async function getJobsLight(ids: string[]): Promise<JobLightRow[]> {
  if (!ids.length) return []
  // flat_values: {id: valore} dallo stato rolling, come flattenRollingState
  // (voce {valore} non vuota, o stringa/numero non vuoti). field_defs solo
  // sulla PRIMA riga di ogni insieme distinto (md5): le altre lo riprendono in JS.
  const { rows } = await pool.query(
    `SELECT j.id, j.batch_id, j.dossier_name, j.scanned_files, j.status,
            j.profile_id, j.profile_name, left(j.error, 200) AS error, j.source_job_id, j.duplicate_of, j.updated_at,
            b.label AS batch_label,
            CASE WHEN j.precheck IS NULL OR jsonb_typeof(j.precheck) <> 'object' THEN NULL
                 ELSE jsonb_build_object('notValid', j.precheck->'notValid', 'override', j.precheck->'override',
                                         'polizza', jsonb_build_object('esito', j.precheck->'polizza'->'esito')) END AS precheck,
            COALESCE((
              SELECT jsonb_object_agg(e.key, CASE WHEN jsonb_typeof(e.value) = 'object' THEN e.value->>'valore' ELSE e.value #>> '{}' END)
              FROM jsonb_each(CASE WHEN jsonb_typeof(j.rolling_state) = 'object' THEN j.rolling_state ELSE '{}'::jsonb END) e
              WHERE CASE
                WHEN jsonb_typeof(e.value) = 'object' THEN e.value ? 'valore' AND jsonb_typeof(e.value->'valore') <> 'null' AND COALESCE(e.value->>'valore', '') <> ''
                WHEN jsonb_typeof(e.value) IN ('string', 'number') THEN COALESCE(e.value #>> '{}', '') <> ''
                ELSE false END
            ), '{}'::jsonb) AS flat_values,
            md5(j.field_defs::text) AS fd_hash,
            CASE WHEN row_number() OVER (PARTITION BY md5(j.field_defs::text) ORDER BY j.id) = 1 THEN j.field_defs END AS field_defs
     FROM polizza_jobs j LEFT JOIN batch_jobs b ON b.id = j.batch_id
     WHERE j.id = ANY($1::text[])`,
    [ids],
  )
  const defsByHash = new Map<string, JobRow['field_defs']>()
  for (const r of rows as any[]) if (r.field_defs) defsByHash.set(r.fd_hash, r.field_defs)
  return rows.map((r: any) => {
    const { flat_values, fd_hash, field_defs, ...rest } = r // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, values: flat_values || {}, field_defs: defsByHash.get(fd_hash) || [], updated_at: Number(r.updated_at) }
  })
}

/** Nome e file dei job (per i nomi dei membri di un riepilogo, senza i valori). */
export async function getJobLabels(ids: string[]): Promise<Map<string, { dossier_name: string | null; scanned_files: string[]; batch_label: string | null }>> {
  const out = new Map<string, { dossier_name: string | null; scanned_files: string[]; batch_label: string | null }>()
  if (!ids.length) return out
  const { rows } = await pool.query(
    `SELECT j.id, j.dossier_name, j.scanned_files, b.label AS batch_label
     FROM polizza_jobs j LEFT JOIN batch_jobs b ON b.id = j.batch_id
     WHERE j.id = ANY($1::text[])`,
    [ids],
  )
  for (const r of rows as any[]) out.set(r.id, { dossier_name: r.dossier_name, scanned_files: r.scanned_files || [], batch_label: r.batch_label })
  return out
}

/** Ultima run 'done' di ciascun job: i valori da usare mentre il job è in ri-estrazione. */
export async function getLastDoneRuns(ids: string[]): Promise<Map<string, JobRunRow>> {
  const out = new Map<string, JobRunRow>()
  if (!ids.length) return out
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (job_id) * FROM polizza_job_runs
     WHERE job_id = ANY($1::text[]) AND status = 'done'
     ORDER BY job_id, finished_at DESC, id DESC`,
    [ids],
  )
  for (const r of rows as any[]) out.set(r.job_id, { ...r, finished_at: Number(r.finished_at) })
  return out
}

/**
 * Hash dei file per job (identità del contenuto): due job con lo stesso insieme
 * di hash sono lo stesso fascicolo. NULL sulle righe precedenti alla migrazione
 * (il confronto allora non si fa). I job di test non hanno righe proprie.
 */
export async function getFileHashesByJob(ids: string[]): Promise<Record<string, (string | null)[]>> {
  const out: Record<string, (string | null)[]> = {}
  if (!ids.length) return out
  const { rows } = await pool.query<{ job_id: string; file_hash: string | null }>(
    `SELECT job_id, file_hash FROM polizza_job_files WHERE job_id = ANY($1::text[])`,
    [ids],
  )
  for (const r of rows) (out[r.job_id] = out[r.job_id] || []).push(r.file_hash)
  return out
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
    basReliability: (job.rolling_state as any)?._reliability || null,
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
  // Identità del PROFILO della run di test: senza, il pre-controllo della copia
  // usava il profilo ATTIVO delle Impostazioni (un altro profilo, senza «Come
  // riconoscerla») e la sua pertinenza non valeva (A/B del 25/09/2026).
  profileId?: string | null
  profileName?: string | null
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
        rolling_state, source_job_id, settings_override, logs, created_at, updated_at, profile_id, profile_name)
     VALUES ($1,$2,NULL,$3,'queued',$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12,$12,$13,$14)`,
    [id, params.email, params.label, src.whole_dossier,
      JSON.stringify(src.scanned_files || []), JSON.stringify(params.fieldDefs),
      params.promptExtra, JSON.stringify(initRollingState(params.fieldDefs)),
      rootId, JSON.stringify(params.settingsOverride || {}),
      JSON.stringify([`[${new Date().toTimeString().slice(0, 8)}] — Run di TEST creata da "${src.dossier_name || src.id}" da ${params.email} —`]),
      now(),
      params.profileId !== undefined ? params.profileId : (src.profile_id || null),
      params.profileName !== undefined ? params.profileName : (src.profile_name || null)]
  )
  return getJob(id)
}

// Rilancio di un job: riporta il job in coda azzerando errore, cursore,
// progresso e stato rolling (ri-inizializzato dai field_defs congelati
// all'upload). Vale per i FALLITI/ANNULLATI (riprova) ma anche per i COMPLETATI
// (rielaborazione: i PDF sono già in polizza_job_files, un motore migliorato può
// dare risultati migliori sugli stessi file — è il senso di avere il database).
// Con `opts` (rielaborazione CON PROFILO) si sostituiscono anche field_defs,
// prompt, profile e settings_override: i field_defs congelati all'upload vengono
// rimpiazzati da quelli del profilo scelto e il pre-check riparte da zero.
// Ritorna la riga aggiornata (serve il batch_id per riavviare l'orchestratore
// giusto), null se il job non esiste o è in corso.
export async function resetJobForRetry(
  id: string,
  byEmail?: string,
  opts: {
    fieldDefs?: JobRow['field_defs']
    promptExtra?: string | null
    profileId?: string | null
    profileName?: string | null
    settingsOverride?: Record<string, unknown> | null
    // RIABBINA: rifà OCR (dalla cache) e pertinenza e si ferma in 'matched'
    // (o 'review'/'mismatch'), senza estrarre: l'estrazione parte col ▶.
    matchOnly?: boolean
    // RIABBINA + ESTRAI: pertinenza da zero e, se passa, estrazione subito
    // (matchOnly false). Cambia solo la riga di log.
    andExtract?: boolean
  } = {}
): Promise<JobRow | null> {
  const job = await getJob(id)
  if (!job || job.status === 'running' || job.status === 'queued') return null
  const logs = Array.isArray(job.logs) ? [...job.logs] : []
  const verb = opts.andExtract ? 'Riabbinamento ed estrazione' : opts.matchOnly ? 'Riabbinamento' : job.status === 'done' ? 'Rielaborazione' : 'Rilancio'
  const withProfile = opts.fieldDefs !== undefined && opts.profileId !== undefined
  logs.push(
    `[${new Date().toTimeString().slice(0, 8)}] — ${verb} manuale${byEmail ? ` da ${byEmail}` : ''}`
    + (withProfile ? ` con profilo "${opts.profileName || opts.profileId}"` : '') + ' —'
  )
  await updateJob(id, {
    status: 'queued',
    error: null,
    cursor: {},
    progress: {},
    rolling_state: initRollingState(opts.fieldDefs !== undefined ? opts.fieldDefs : (job.field_defs || [])),
    sources: {},
    // Rielaborare = ricontrollare da zero: l'esito (e l'eventuale override) del
    // pre-check precedente non deve sopravvivere al rilancio. Il solo
    // abbinamento riparte con la sola bandiera matchOnly.
    precheck: opts.matchOnly ? { matchOnly: true } : null,
    ...(opts.fieldDefs !== undefined ? { field_defs: opts.fieldDefs } : {}),
    ...(opts.promptExtra !== undefined ? { prompt_extra: opts.promptExtra } : {}),
    ...(opts.profileId !== undefined ? { profile_id: opts.profileId } : {}),
    ...(opts.profileName !== undefined ? { profile_name: opts.profileName } : {}),
    ...(opts.settingsOverride !== undefined ? { settings_override: opts.settingsOverride } : {}),
    logs,
  })
  // Il batch riparte: la mail di fine batch si riarma (era una tantum).
  if (job.batch_id) await pool.query(`UPDATE batch_jobs SET notified_at = NULL WHERE id = $1`, [job.batch_id])
  return { ...job, status: 'queued' as JobStatus }
}

// "PROCEDI COMUNQUE": l'utente conferma che il fascicolo va estratto col
// profilo scelto nonostante il pre-check di pertinenza lo abbia bloccato
// (falso allarme) o lasciato in dubbio. L'override viene PERSISTITO nel
// precheck: al run successivo il worker salta il controllo di pertinenza ed
// ESTRAE (anche se il job era nato in «Solo abbinamento»), dopo la sola
// verifica della polizza se non è già stata fatta. Da 'mismatch' o 'review',
// MAI da un Non valido (nessuna polizza: regola dell'utente del 26/09/2026):
// qui il rifiuto è la difesa di ultima istanza, le route lo spiegano prima.
export async function overridePrecheckAndRequeue(id: string, byEmail?: string): Promise<JobRow | null> {
  const job = await getJob(id)
  if (!job || (job.status !== 'mismatch' && job.status !== 'review')) return null
  if (isNotValidJob(job)) return null
  const logs = Array.isArray(job.logs) ? [...job.logs] : []
  logs.push(`[${new Date().toTimeString().slice(0, 8)}] — Procedi comunque (pre-check di pertinenza ignorato)${byEmail ? ` da ${byEmail}` : ''} —`)
  await updateJob(id, {
    status: 'queued',
    error: null,
    precheck: { ...(job.precheck || {}), override: true, matchOnly: false },
    logs,
  })
  return { ...job, status: 'queued' as JobStatus }
}

// ▶ ESTRAI: un job ABBINATO (solo abbinamento riuscito) torna in coda per
// l'estrazione vera. Il pre-check non si rifà (precheck.confirmed): la
// motivazione dell'abbinamento resta nel job. Solo da stato 'matched'.
export async function confirmMatchAndRequeue(id: string, byEmail?: string): Promise<JobRow | null> {
  const job = await getJob(id)
  if (!job || job.status !== 'matched') return null
  // Un Non valido non è mai 'matched'; il controllo resta per chi arriva qui
  // con uno stato scritto a mano o da una versione vecchia.
  if (isNotValidJob(job)) return null
  const logs = Array.isArray(job.logs) ? [...job.logs] : []
  logs.push(`[${new Date().toTimeString().slice(0, 8)}] — Estrazione avviata sull'abbinamento confermato${byEmail ? ` da ${byEmail}` : ''} —`)
  await updateJob(id, {
    status: 'queued',
    error: null,
    precheck: { ...(job.precheck || {}), confirmed: true, matchOnly: false },
    logs,
  })
  // Seconda fase del batch (estrazione dopo il solo abbinamento): la mail di
  // fine batch è reclamata una volta sola (notified_at) — si riarma qui, così
  // l'estrazione avvisa a sua volta quando finisce.
  if (job.batch_id) await pool.query(`UPDATE batch_jobs SET notified_at = NULL WHERE id = $1`, [job.batch_id])
  return { ...job, status: 'queued' as JobStatus }
}

// Job ABBINATI di un batch (per «Avvia estrazione» su tutti).
export async function listMatchedBatchJobs(batchId: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM polizza_jobs WHERE batch_id = $1 AND status = 'matched' ORDER BY created_at, id`,
    [batchId]
  )
  return rows.map((r) => r.id)
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

// ── RICERCA GLOBALE ──────────────────────────────────────────────────────────
export interface JobSearchHit {
  jobId: string
  batchId: string | null
  batchLabel: string | null
  dossierName: string | null
  status: string
  error: string | null
  verdict: string | null
  profileName: string | null
  updatedAt: number
  // Dove è stata trovata la ricerca: nel nome della cartella/batch, in un file, in un valore estratto.
  matchedIn: { kind: 'folder' | 'file' | 'field'; label?: string; value: string }[]
}

/** Polizze di tutti i batch che contengono TUTTE le parole di `q` (cartella, batch, file, valori). */
export async function searchJobs(q: string, limit = 60): Promise<JobSearchHit[]> {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
  if (!terms.length) return []
  const esc = (t: string) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const hay = `(COALESCE(j.dossier_name,'') || ' ' || COALESCE(b.label,'') || ' ' || j.scanned_files::text || ' ' || j.rolling_state::text)`
  const where = terms.map((_, i) => `${hay} ILIKE $${i + 1}`).join(' AND ')
  const { rows } = await pool.query(
    `SELECT j.id, j.batch_id, b.label AS batch_label, j.dossier_name, j.status, j.error, j.precheck, j.profile_name,
            j.updated_at, j.scanned_files, j.rolling_state, j.field_defs
       FROM polizza_jobs j LEFT JOIN batch_jobs b ON b.id = j.batch_id
      WHERE ${where}
      ORDER BY j.updated_at DESC
      LIMIT ${Math.max(1, Math.min(limit, 200))}`,
    terms.map(esc),
  )
  return rows.map((r: any) => {
    const matchedIn: JobSearchHit['matchedIn'] = []
    const has = (text: string) => terms.some((t) => text.toLowerCase().includes(t))
    if (has(`${r.dossier_name || ''} ${r.batch_label || ''}`)) matchedIn.push({ kind: 'folder', value: r.dossier_name || r.batch_label || '' })
    for (const f of (r.scanned_files || []) as string[]) if (has(String(f))) { matchedIn.push({ kind: 'file', value: String(f) }); if (matchedIn.length > 3) break }
    const flat = flattenRollingState(r.rolling_state) as Record<string, string>
    const defs = (r.field_defs || []) as { id: string; label?: string }[]
    for (const [id, v] of Object.entries(flat)) {
      if (has(String(v))) matchedIn.push({ kind: 'field', label: defs.find((d) => d.id === id)?.label || id, value: String(v).slice(0, 80) })
      if (matchedIn.length > 5) break
    }
    return {
      jobId: r.id, batchId: r.batch_id || null, batchLabel: r.batch_label || null, dossierName: r.dossier_name || null,
      status: r.status, error: r.error || null, verdict: r.precheck?.verdict || null, profileName: r.profile_name || null,
      updatedAt: Number(r.updated_at), matchedIn,
    }
  })
}

// ── RICONCILIAZIONE DEL BATCH (numero di polizza) ────────────────────────────
export async function batchNeedsReconcile(batchId: string): Promise<boolean> {
  const { rows } = await pool.query<{ needs_reconcile: boolean }>('SELECT needs_reconcile FROM batch_jobs WHERE id = $1', [batchId])
  return !!rows[0]?.needs_reconcile
}

export async function markBatchReconciled(batchId: string): Promise<void> {
  await pool.query('UPDATE batch_jobs SET needs_reconcile = FALSE, updated_at = $1 WHERE id = $2', [now(), batchId])
}

/**
 * Batch GIÀ CARICATO (anteriore alla riconciliazione, o da rifare): la riaccende.
 * Vale per il prossimo giro dell'orchestratore, che la esegue sui dossier in
 * coda prima di elaborarli — il Riabbina li rimette in coda subito dopo.
 */
export async function markBatchNeedsReconcile(batchId: string): Promise<void> {
  await pool.query('UPDATE batch_jobs SET needs_reconcile = TRUE, updated_at = $1 WHERE id = $2', [now(), batchId])
}

/** Dossier IN CODA del batch con i loro file (senza i PDF): la riconciliazione tocca solo quelli mai elaborati. */
export async function listQueuedBatchDossiers(batchId: string): Promise<{ id: string; dossier_name: string | null; files: { idx: number; file_name: string; file_hash: string | null }[] }[]> {
  const { rows: jobs } = await pool.query<{ id: string; dossier_name: string | null }>(
    `SELECT id, dossier_name FROM polizza_jobs WHERE batch_id = $1 AND status = 'queued' AND source_job_id IS NULL ORDER BY created_at, id`, [batchId]
  )
  if (!jobs.length) return []
  const { rows: files } = await pool.query<{ job_id: string; idx: number; file_name: string; file_hash: string | null }>(
    `SELECT job_id, idx, file_name, file_hash FROM polizza_job_files WHERE job_id = ANY($1) ORDER BY job_id, idx`, [jobs.map((j) => j.id)]
  )
  return jobs.map((j) => ({ ...j, files: files.filter((f) => f.job_id === j.id).map(({ idx, file_name, file_hash }) => ({ idx, file_name, file_hash })) }))
}

/** Un solo PDF (byte) per la lettura della riconciliazione, senza caricare l'intero dossier. */
export async function getJobFileBase64(jobId: string, idx: number): Promise<string | null> {
  const { rows } = await pool.query<{ pdf_base64: string }>('SELECT pdf_base64 FROM polizza_job_files WHERE job_id = $1 AND idx = $2', [jobId, idx])
  return rows[0]?.pdf_base64 ?? null
}

/**
 * Applica il PIANO di riconciliazione (policyReconcile.planReconcile) in UNA
 * transazione: sposta i file nei dossier di destinazione (in coda ai loro),
 * rinomina ogni destinazione col percorso più corto tra quelli uniti, elimina i
 * dossier rimasti vuoti, ricalcola alla FINE gli indici contigui (0..n-1, come
 * scanned_files: la pagina apre i file per posizione) e scrive il perché nel
 * log. Gli indici del piano sono quelli originali: un contenitore può cedere
 * file a più destinazioni. Se un dossier coinvolto non è più in coda, nulla.
 * @returns numero di unioni applicate
 */
export async function applyReconcilePlan(
  plan: { target: string; name: string; numbers: string[]; moves: { from: string; all: boolean; idxs: number[] }[] }[],
  pathOf: Record<string, string>,
): Promise<number> {
  if (!plan.length) return 0
  const involved = [...new Set(plan.flatMap((m) => [m.target, ...m.moves.map((x) => x.from)]))]
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: st } = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM polizza_jobs WHERE id = ANY($1) FOR UPDATE', [involved]
    )
    if (st.length !== involved.length || st.some((r) => r.status !== 'queued')) { await client.query('ROLLBACK'); return 0 }
    const stamp = `[${new Date().toTimeString().slice(0, 8)}]`
    for (const merge of plan) {
      const { rows: maxRow } = await client.query<{ n: number }>('SELECT COALESCE(MAX(idx), -1)::int AS n FROM polizza_job_files WHERE job_id = $1', [merge.target])
      let next = Math.max((maxRow[0]?.n ?? -1) + 1, 2000000) // fuori dagli indici originali di chiunque
      const lines: string[] = []
      for (const m of merge.moves) {
        for (const idx of m.idxs) {
          await client.query('UPDATE polizza_job_files SET job_id = $1, idx = $2 WHERE job_id = $3 AND idx = $4', [merge.target, next++, m.from, idx])
        }
        lines.push(`${m.all ? 'unita la cartella' : `${m.idxs.length} file spostati da`} "${pathOf[m.from] || m.from}"`)
      }
      await client.query(
        'UPDATE polizza_jobs SET dossier_name = $1, logs = logs || $2::jsonb WHERE id = $3',
        [merge.name, JSON.stringify([`${stamp} Riconciliazione per numero di polizza (${merge.numbers.join(', ')}): ${lines.join('; ')} — stessa polizza, un solo dossier.`]), merge.target],
      )
    }
    for (const id of involved) {
      const { rows: fs } = await client.query<{ idx: number; file_name: string }>('SELECT idx, file_name FROM polizza_job_files WHERE job_id = $1 ORDER BY idx', [id])
      if (!fs.length) { await client.query('DELETE FROM polizza_jobs WHERE id = $1', [id]); continue }
      await client.query('UPDATE polizza_job_files SET idx = -idx - 1 WHERE job_id = $1', [id])
      for (let i = 0; i < fs.length; i++) await client.query('UPDATE polizza_job_files SET idx = $1 WHERE job_id = $2 AND idx = $3', [i, id, -fs[i].idx - 1])
      await client.query('UPDATE polizza_jobs SET scanned_files = $1::jsonb, updated_at = $2 WHERE id = $3', [JSON.stringify(fs.map((f) => f.file_name)), now(), id])
    }
    await client.query('COMMIT')
    return plan.length
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

type SplitSvc = { planSplitByOrigin: (name: string, files: { idx: number; rel_path?: string | null }[]) => { home: string; keep: number[]; groups: { folder: string; idxs: number[] }[] } }

/**
 * SEPARA un dossier nelle cartelle d'origine dei suoi file (l'INVERSO della
 * riconciliazione: `planSplitByOrigin`, sul `rel_path` che l'unione non tocca).
 * I gruppi separati diventano dossier nuovi dello stesso batch, con lo stesso
 * profilo; il dossier e i nuovi restano FERMI in 'canceled' (i risultati di
 * prima valevano per l'unione) col perché nel log, pronti per un Riabbina.
 * UNA transazione; mai su un dossier in coda o in corso.
 * @returns il dossier rimasto e i nuovi, o null se non c'è niente da separare
 */
export async function splitJobByOrigin(jobId: string, byEmail?: string): Promise<{ kept: string; created: { id: string; folder: string; files: number }[] } | null> {
  const svc = await importSharedService<SplitSvc>('policyReconcile.js')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: jr } = await client.query('SELECT * FROM polizza_jobs WHERE id = $1 FOR UPDATE', [jobId])
    const job = jr[0]
    if (!job || job.status === 'running' || job.status === 'queued') { await client.query('ROLLBACK'); return null }
    const { rows: files } = await client.query<{ idx: number; file_name: string; rel_path: string | null }>(
      'SELECT idx, file_name, rel_path FROM polizza_job_files WHERE job_id = $1 ORDER BY idx', [jobId]
    )
    const plan = svc.planSplitByOrigin(job.dossier_name || '', files)
    if (!plan.groups.length) { await client.query('ROLLBACK'); return null }
    const stamp = `[${new Date().toTimeString().slice(0, 8)}]`
    const who = byEmail ? ` da ${byEmail}` : ''
    const fieldDefs = Array.isArray(job.field_defs) ? job.field_defs : []
    const created: { id: string; folder: string; files: number }[] = []
    for (const g of plan.groups) {
      const id = randomUUID()
      await client.query(
        `INSERT INTO polizza_jobs (id, email, batch_id, dossier_name, status, whole_dossier, scanned_files, field_defs, prompt_extra, profile_id, profile_name, rolling_state, settings_override, created_at, updated_at, logs)
         VALUES ($1,$2,$3,$4,'canceled',$5,'[]'::jsonb,$6::jsonb,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$12,$13::jsonb)`,
        [id, job.email, job.batch_id, g.folder, job.whole_dossier, JSON.stringify(fieldDefs), job.prompt_extra ?? null,
          job.profile_id ?? null, job.profile_name ?? null, JSON.stringify(initRollingState(fieldDefs)),
          job.settings_override ? JSON.stringify(job.settings_override) : null, now(),
          JSON.stringify([`${stamp} Separato${who} da "${job.dossier_name || jobId}": i ${g.idxs.length} file caricati dalla cartella "${g.folder}" tornano in un dossier a parte (unione annullata). Da riabbinare.`])]
      )
      let next = 3000000 // fuori dagli indici di chiunque, ricalcolati sotto
      for (const idx of g.idxs) {
        await client.query('UPDATE polizza_job_files SET job_id = $1, idx = $2 WHERE job_id = $3 AND idx = $4', [id, next++, jobId, idx])
      }
      created.push({ id, folder: g.folder, files: g.idxs.length })
    }
    for (const id of [jobId, ...created.map((c) => c.id)]) {
      const { rows: fs } = await client.query<{ idx: number; file_name: string }>('SELECT idx, file_name FROM polizza_job_files WHERE job_id = $1 ORDER BY idx', [id])
      await client.query('UPDATE polizza_job_files SET idx = -idx - 1 WHERE job_id = $1', [id])
      for (let i = 0; i < fs.length; i++) await client.query('UPDATE polizza_job_files SET idx = $1 WHERE job_id = $2 AND idx = $3', [i, id, -fs[i].idx - 1])
      await client.query('UPDATE polizza_jobs SET scanned_files = $1::jsonb, updated_at = $2 WHERE id = $3', [JSON.stringify(fs.map((f) => f.file_name)), now(), id])
    }
    const line = `${stamp} Separazione per cartella d'origine${who}: ${created.map((c) => `${c.files} file → "${c.folder}"`).join('; ')}; qui restano i file di "${plan.home}". Risultati precedenti azzerati (valevano per l'unione): da riabbinare.`
    await client.query(
      `UPDATE polizza_jobs SET status = 'canceled', dossier_name = $1, error = NULL, precheck = NULL, cursor = '{}'::jsonb, progress = '{}'::jsonb,
         sources = '{}'::jsonb, rolling_state = $2::jsonb, logs = logs || $3::jsonb, updated_at = $4 WHERE id = $5`,
      [plan.home || job.dossier_name, JSON.stringify(initRollingState(fieldDefs)), JSON.stringify([line]), now(), jobId]
    )
    await client.query('COMMIT')
    return { kept: jobId, created }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
