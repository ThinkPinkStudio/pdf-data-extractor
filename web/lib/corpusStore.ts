// Store del corpus documentale: testo per pagina + metadati dal percorso di
// upload + chunk per il retrieval. Alimentato dai worker polizza (vedi
// polizzaJobWorker.ts) a costo zero: l'OCR gira già su ogni pagina, qui viene
// solo persistito invece che scartato.

import { pool } from './db'
import { randomUUID } from 'crypto'

export type TextStatus = 'pending' | 'partial' | 'complete' | 'failed'

export interface DocumentMeta {
  agenzia?: string | null
  gruppo?: string | null
  societa?: string | null
  statoVigore?: string | null
  uso?: string | null
  ramo?: string | null
  docType?: string | null
  anno?: number | null
  raw?: Record<string, unknown>
}

export interface DocumentRow {
  id: string
  email: string
  sha256: string
  file_name: string
  num_pages: number | null
  text_status: TextStatus
  agenzia: string | null
  gruppo: string | null
  societa: string | null
  stato_vigore: string | null
  uso: string | null
  ramo: string | null
  doc_type: string | null
  anno: number | null
  meta: Record<string, unknown>
  created_at: number
  updated_at: number
}

const now = () => Math.floor(Date.now() / 1000)

// Upsert per (email, sha256): un file già visto non ricrea il documento; i
// metadati già presenti non vengono sovrascritti con NULL (il percorso di un
// upload successivo può essere meno informativo, es. caricamento singolo).
export async function upsertDocumentBySha(params: {
  email: string
  sha256: string
  fileName: string
  meta: DocumentMeta
}): Promise<{ id: string; textStatus: TextStatus }> {
  const m = params.meta || {}
  const { rows } = await pool.query<{ id: string; text_status: TextStatus }>(
    `INSERT INTO documents (id, email, sha256, file_name, agenzia, gruppo, societa, stato_vigore, uso, ramo, doc_type, anno, meta, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$14)
     ON CONFLICT (email, sha256) DO UPDATE SET
       file_name    = EXCLUDED.file_name,
       agenzia      = COALESCE(documents.agenzia, EXCLUDED.agenzia),
       gruppo       = COALESCE(documents.gruppo, EXCLUDED.gruppo),
       societa      = COALESCE(documents.societa, EXCLUDED.societa),
       stato_vigore = COALESCE(documents.stato_vigore, EXCLUDED.stato_vigore),
       uso          = COALESCE(documents.uso, EXCLUDED.uso),
       ramo         = COALESCE(documents.ramo, EXCLUDED.ramo),
       doc_type     = COALESCE(documents.doc_type, EXCLUDED.doc_type),
       anno         = COALESCE(documents.anno, EXCLUDED.anno),
       updated_at   = EXCLUDED.updated_at
     RETURNING id, text_status`,
    [randomUUID(), params.email, params.sha256, params.fileName,
      m.agenzia ?? null, m.gruppo ?? null, m.societa ?? null, m.statoVigore ?? null,
      m.uso ?? null, m.ramo ?? null, m.docType ?? null, m.anno ?? null,
      JSON.stringify(m.raw ?? {}), now()]
  )
  return { id: rows[0].id, textStatus: rows[0].text_status }
}

export async function linkDocumentToJob(params: {
  documentId: string
  jobId: string
  batchId?: string | null
  relPath?: string | null
  fileIdx?: number | null
}): Promise<void> {
  await pool.query(
    `INSERT INTO document_links (document_id, job_id, batch_id, rel_path, file_idx)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (document_id, job_id) DO NOTHING`,
    [params.documentId, params.jobId, params.batchId ?? null, params.relPath ?? null, params.fileIdx ?? null]
  )
}

export async function getDocument(id: string): Promise<DocumentRow | null> {
  const { rows } = await pool.query<DocumentRow>('SELECT * FROM documents WHERE id = $1', [id])
  return rows[0] ?? null
}

// Documenti collegati a un job, nell'ordine dei file di input.
export async function getJobDocuments(jobId: string): Promise<(DocumentRow & { rel_path: string | null; file_idx: number | null })[]> {
  const { rows } = await pool.query(
    `SELECT d.*, l.rel_path, l.file_idx FROM document_links l
     JOIN documents d ON d.id = l.document_id
     WHERE l.job_id = $1
     ORDER BY l.file_idx NULLS LAST, d.file_name`,
    [jobId]
  )
  return rows
}

export async function savePageText(documentId: string, page: number, text: string, source = 'tesseract'): Promise<void> {
  await pool.query(
    `INSERT INTO document_pages (document_id, page, text, text_source)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (document_id, page) DO UPDATE SET text = EXCLUDED.text, text_source = EXCLUDED.text_source`,
    [documentId, page, text, source]
  )
  await pool.query(`UPDATE documents SET text_status = 'partial', updated_at = $2 WHERE id = $1 AND text_status = 'pending'`, [documentId, now()])
}

// Pagine già persistite (per saltare l'OCR alla ripresa di un job).
export async function getStoredPageNumbers(documentId: string): Promise<Set<number>> {
  const { rows } = await pool.query<{ page: number }>('SELECT page FROM document_pages WHERE document_id = $1', [documentId])
  return new Set(rows.map((r) => r.page))
}

export async function getStoredPageText(documentId: string, page: number): Promise<string | null> {
  const { rows } = await pool.query<{ text: string }>(
    'SELECT text FROM document_pages WHERE document_id = $1 AND page = $2', [documentId, page]
  )
  return rows[0]?.text ?? null
}

export async function getDocumentPages(documentId: string): Promise<{ page: number; text: string }[]> {
  const { rows } = await pool.query<{ page: number; text: string }>(
    'SELECT page, text FROM document_pages WHERE document_id = $1 ORDER BY page', [documentId]
  )
  return rows
}

export async function setDocumentNumPages(documentId: string, numPages: number): Promise<void> {
  await pool.query('UPDATE documents SET num_pages = $2, updated_at = $3 WHERE id = $1', [documentId, numPages, now()])
}

export async function setDocumentTextStatus(documentId: string, status: TextStatus): Promise<void> {
  await pool.query('UPDATE documents SET text_status = $2, updated_at = $3 WHERE id = $1', [documentId, status, now()])
}

// ─── Chunking per il retrieval ───────────────────────────────────────────────
// Chunk page-aware (~1200 caratteri, overlap di coda ~150) che conservano
// l'intervallo di pagine per le citazioni in chat.
const CHUNK_SIZE = 1200
const CHUNK_TAIL_OVERLAP = 150

export interface Chunk { text: string; pageFrom: number; pageTo: number }

export function chunkPages(pages: { page: number; text: string }[]): Chunk[] {
  const chunks: Chunk[] = []
  let buf = ''
  let pageFrom = 0
  let pageTo = 0

  const flush = () => {
    const text = buf.trim()
    if (text.length > 0) chunks.push({ text, pageFrom, pageTo })
    // L'overlap di coda mantiene continuità tra chunk consecutivi.
    buf = buf.slice(-CHUNK_TAIL_OVERLAP)
    pageFrom = pageTo
  }

  for (const p of pages) {
    const text = (p.text || '').trim()
    if (!text) continue
    if (!pageFrom) pageFrom = p.page
    pageTo = p.page
    // Spezza il testo della pagina in segmenti che non superino CHUNK_SIZE.
    let rest = text
    while (rest.length > 0) {
      const room = CHUNK_SIZE - buf.length
      if (room <= 0) { flush(); continue }
      const take = rest.slice(0, room)
      buf += (buf && !buf.endsWith('\n') ? '\n' : '') + take
      rest = rest.slice(take.length)
      if (buf.length >= CHUNK_SIZE) flush()
    }
  }
  const tail = buf.trim()
  if (tail.length > CHUNK_TAIL_OVERLAP || (chunks.length === 0 && tail.length > 0)) {
    chunks.push({ text: tail, pageFrom, pageTo })
  }
  return chunks
}

// Ricostruisce i chunk di un documento dalle pagine persistite e marca il testo
// completo. Idempotente: i vecchi chunk vengono sostituiti (gli embedding si
// rigenerano via backfill, colonna NULL).
export async function finalizeDocumentText(documentId: string): Promise<number> {
  const pages = await getDocumentPages(documentId)
  const chunks = chunkPages(pages)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId])
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO document_chunks (document_id, chunk_index, page_from, page_to, text)
         VALUES ($1,$2,$3,$4,$5)`,
        [documentId, i, chunks[i].pageFrom, chunks[i].pageTo, chunks[i].text]
      )
    }
    await client.query(
      `UPDATE documents SET text_status = $2, updated_at = $3 WHERE id = $1`,
      [documentId, pages.length > 0 ? 'complete' : 'failed', now()]
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return chunks.length
}
