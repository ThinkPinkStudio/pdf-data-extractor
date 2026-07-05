/* eslint-disable @typescript-eslint/no-explicit-any */
// Ricerca sul corpus documentale per la chat: full-text italiano (sempre
// disponibile) + similarità vettoriale pgvector (se attiva), fuse con
// Reciprocal Rank Fusion. Qualsiasi problema sul ramo vettoriale degrada
// silenziosamente a solo full-text: la chat non si rompe mai.

import { pool, isVectorEnabled } from './db'
import { importSharedService } from './sharedServices'

export interface CorpusFilters {
  gruppo?: string
  societa?: string
  ramo?: string
  docType?: string
  statoVigore?: string
  anno?: number
}

export interface RetrievedChunk {
  chunkId: string
  documentId: string
  fileName: string
  gruppo: string | null
  societa: string | null
  ramo: string | null
  docType: string | null
  anno: number | null
  pageFrom: number | null
  pageTo: number | null
  text: string
  score: number
}

interface EmbeddingsSvc {
  embedTexts: (settings: any, texts: string[]) => Promise<{ vectors: number[][] }>
  embeddingsConfigured: (settings: any) => boolean
}

const SELECT_COLS = `c.id AS chunk_id, c.document_id, c.page_from, c.page_to, c.text,
  d.file_name, d.gruppo, d.societa, d.ramo, d.doc_type, d.anno`

function buildFilterSql(email: string, filters: CorpusFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [email]
  const conds = ['d.email = $1']
  const add = (col: string, val: unknown) => { params.push(val); conds.push(`${col} = $${params.length}`) }
  if (filters.gruppo) add('d.gruppo', filters.gruppo)
  if (filters.societa) add('d.societa', filters.societa)
  if (filters.ramo) add('d.ramo', filters.ramo)
  if (filters.docType) add('d.doc_type', filters.docType)
  if (filters.statoVigore) add('d.stato_vigore', filters.statoVigore)
  if (filters.anno) add('d.anno', filters.anno)
  return { where: conds.join(' AND '), params }
}

function rowToChunk(r: any, score: number): RetrievedChunk {
  return {
    chunkId: String(r.chunk_id),
    documentId: r.document_id,
    fileName: r.file_name,
    gruppo: r.gruppo,
    societa: r.societa,
    ramo: r.ramo,
    docType: r.doc_type,
    anno: r.anno,
    pageFrom: r.page_from,
    pageTo: r.page_to,
    text: r.text,
    score,
  }
}

async function ftsSearch(email: string, query: string, filters: CorpusFilters, limit: number): Promise<RetrievedChunk[]> {
  const { where, params } = buildFilterSql(email, filters)
  params.push(query)
  const q = `$${params.length}`
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS}, ts_rank(c.tsv, websearch_to_tsquery('italian', ${q})) AS rank
     FROM document_chunks c JOIN documents d ON d.id = c.document_id
     WHERE ${where} AND c.tsv @@ websearch_to_tsquery('italian', ${q})
     ORDER BY rank DESC LIMIT ${limit}`,
    params
  )
  return rows.map((r: any, i: number) => rowToChunk(r, 1 / (60 + i)))
}

async function vectorSearch(email: string, queryVec: number[], filters: CorpusFilters, limit: number): Promise<RetrievedChunk[]> {
  const { where, params } = buildFilterSql(email, filters)
  params.push(`[${queryVec.join(',')}]`)
  const v = `$${params.length}`
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS}
     FROM document_chunks c JOIN documents d ON d.id = c.document_id
     WHERE ${where} AND c.embedding IS NOT NULL
     ORDER BY c.embedding <=> ${v}::vector LIMIT ${limit}`,
    params
  )
  return rows.map((r: any, i: number) => rowToChunk(r, 1 / (60 + i)))
}

// Ricerca ibrida con fusione RRF. `settings` serve solo per l'embedding della
// query (provider configurato dall'utente).
export async function searchCorpus(
  email: string,
  query: string,
  filters: CorpusFilters,
  settings: any,
  limit = 12
): Promise<RetrievedChunk[]> {
  const candidates = Math.max(limit * 2, 20)

  let fts: RetrievedChunk[] = []
  try { fts = await ftsSearch(email, query, filters, candidates) } catch { fts = [] }

  let vec: RetrievedChunk[] = []
  if (isVectorEnabled()) {
    try {
      const svc = await importSharedService<EmbeddingsSvc>('embeddingsService.js')
      if (svc.embeddingsConfigured(settings)) {
        const { vectors } = await svc.embedTexts(settings, [query])
        if (vectors[0]?.length) vec = await vectorSearch(email, vectors[0], filters, candidates)
      }
    } catch { vec = [] /* degradazione a solo full-text */ }
  }

  // Reciprocal Rank Fusion sui due elenchi.
  const merged = new Map<string, RetrievedChunk>()
  for (const list of [fts, vec]) {
    for (const c of list) {
      const prev = merged.get(c.chunkId)
      if (prev) prev.score += c.score
      else merged.set(c.chunkId, { ...c })
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}

// Valori distinti per i filtri della chat (solo documenti dell'utente).
export async function corpusFacets(email: string): Promise<{
  gruppi: string[]; societa: string[]; rami: string[]; docTypes: string[]; anni: number[]
}> {
  const distinct = async (col: string) => {
    const { rows } = await pool.query(
      `SELECT DISTINCT ${col} AS v FROM documents WHERE email = $1 AND ${col} IS NOT NULL ORDER BY 1`,
      [email]
    )
    return rows.map((r: any) => r.v)
  }
  const [gruppi, societa, rami, docTypes, anni] = await Promise.all([
    distinct('gruppo'), distinct('societa'), distinct('ramo'), distinct('doc_type'), distinct('anno'),
  ])
  return { gruppi, societa, rami, docTypes, anni }
}
