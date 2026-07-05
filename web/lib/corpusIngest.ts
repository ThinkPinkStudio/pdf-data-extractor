// Ingestione nel corpus al momento dell'upload: dedup per sha256, metadati dal
// percorso relativo (pathMetadata.js condiviso) e link documento↔job. Usato
// dalle route /api/polizza/job (caricamento singolo) e
// /api/polizza/batch/[id]/dossier (bulk).

import { createHash } from 'crypto'
import { importSharedService } from './sharedServices'
import { upsertDocumentBySha, linkDocumentToJob, type DocumentMeta } from './corpusStore'
import type { JobInputFile } from './polizzaJobStore'

interface PathMetadataSvc {
  parseDocumentPath: (relPath: string) => {
    agenzia: string | null
    gruppo: string | null
    societa: string | null
    statoVigore: string | null
    uso: string | null
    ramo: string | null
    docType: string
    anno: number | null
    raw: Record<string, unknown>
  }
}

// Crea/riusa i documenti del corpus per i file caricati e restituisce i
// JobInputFile arricchiti (rel_path + document_id). L'ingestione non deve mai
// bloccare l'estrazione: in caso di errore il file prosegue senza documento.
export async function prepareCorpusFiles(
  email: string,
  files: { name: string; buffer: Buffer; relPath?: string | null }[]
): Promise<JobInputFile[]> {
  let parse: PathMetadataSvc['parseDocumentPath'] | null = null
  try {
    parse = (await importSharedService<PathMetadataSvc>('pathMetadata.js')).parseDocumentPath
  } catch { /* parser non disponibile: si procede con soli metadati file */ }

  const out: JobInputFile[] = []
  for (const f of files) {
    const base: JobInputFile = {
      file_name: f.name,
      pdf_base64: f.buffer.toString('base64'),
      rel_path: f.relPath ?? null,
    }
    try {
      const sha256 = createHash('sha256').update(f.buffer).digest('hex')
      const parsed = parse ? parse(f.relPath || f.name) : null
      const meta: DocumentMeta = parsed ? {
        agenzia: parsed.agenzia,
        gruppo: parsed.gruppo,
        societa: parsed.societa,
        statoVigore: parsed.statoVigore,
        uso: parsed.uso,
        ramo: parsed.ramo,
        docType: parsed.docType,
        anno: parsed.anno,
        raw: parsed.raw,
      } : {}
      const { id } = await upsertDocumentBySha({ email, sha256, fileName: f.name, meta })
      base.document_id = id
    } catch { /* il corpus è best-effort: l'estrazione non dipende da questo */ }
    out.push(base)
  }
  return out
}

// Collega i documenti (già creati da prepareCorpusFiles) al job appena creato.
export async function linkCorpusFilesToJob(
  jobId: string,
  batchId: string | null,
  files: JobInputFile[]
): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    if (!f.document_id) continue
    try {
      await linkDocumentToJob({ documentId: f.document_id, jobId, batchId, relPath: f.rel_path ?? null, fileIdx: i })
    } catch { /* best-effort */ }
  }
}
