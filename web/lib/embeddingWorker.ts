/* eslint-disable @typescript-eslint/no-explicit-any */
// Worker in-process che riempie gli embeddings mancanti dei chunk del corpus
// (colonna NULL = lavoro da fare, quindi riprende da solo dopo un restart).
// Avviato da instrumentation.ts; se pgvector non è attivo o il provider
// embeddings non è configurato resta in attesa senza disturbare: la ricerca
// funziona comunque in modalità full-text.

import { pool, isVectorEnabled, ensureEmbeddingColumn } from './db'
import { getSettings } from './settingsStore'
import { importSharedService } from './sharedServices'

interface EmbeddingsSvc {
  embedTexts: (settings: any, texts: string[]) => Promise<{ vectors: number[][]; model: string; dim: number; provider: string }>
  embeddingConfig: (settings: any) => { provider: string; model: string; dim: number }
  embeddingsConfigured: (settings: any) => boolean
}

const BATCH = 32
const IDLE_MS = 30_000
const ERROR_MS = 60_000

let running = false

export function startEmbeddingWorker(): void {
  if (running) return
  running = true
  void loop().finally(() => { running = false })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}

async function loop(): Promise<void> {
  // Piccolo ritardo iniziale: lascia completare il boot (initDb, resumer).
  await sleep(5_000)
  for (;;) {
    try {
      if (!isVectorEnabled()) { await sleep(ERROR_MS); continue }

      const settings = await getSettings()
      const svc = await importSharedService<EmbeddingsSvc>('embeddingsService.js')
      if (!svc.embeddingsConfigured(settings)) { await sleep(ERROR_MS); continue }

      const cfg = svc.embeddingConfig(settings)
      if (!(await ensureEmbeddingColumn(cfg.dim))) { await sleep(ERROR_MS); continue }

      // Chunk senza embedding, o con embedding di un modello diverso da quello
      // configurato (cambio modello a parità di dimensione).
      const { rows } = await pool.query<{ id: string; text: string }>(
        `SELECT id, text FROM document_chunks
         WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM $1
         ORDER BY id LIMIT ${BATCH}`,
        [cfg.model]
      )
      if (rows.length === 0) { await sleep(IDLE_MS); continue }

      const { vectors, model, dim } = await svc.embedTexts(settings, rows.map((r) => r.text))
      // Il provider può restituire una dimensione diversa da quella configurata:
      // la colonna si adegua (gli embeddings già presenti si rigenerano, dato derivato).
      if (dim !== cfg.dim) {
        if (!(await ensureEmbeddingColumn(dim))) { await sleep(ERROR_MS); continue }
      }
      for (let i = 0; i < rows.length; i++) {
        await pool.query(
          `UPDATE document_chunks SET embedding = $1::vector, embedding_model = $2 WHERE id = $3`,
          [toVectorLiteral(vectors[i]), model, rows[i].id]
        )
      }
    } catch (err) {
      // Errore del provider o del DB: si riprova più tardi, mai crash del processo.
      try { console.error('[embeddingWorker]', (err as any)?.message || err) } catch { /* noop */ }
      await sleep(ERROR_MS)
    }
  }
}
