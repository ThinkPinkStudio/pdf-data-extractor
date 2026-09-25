/* eslint-disable @typescript-eslint/no-explicit-any */
// RICONCILIAZIONE DEL BATCH per numero di polizza (25/09/2026). Prima di
// elaborare un batch NUOVO si leggono TUTTI i suoi file (text layer + OCR delle
// scansioni, lo stesso testo del worker: readPdfPagesWithOcr) e si uniscono i
// dossier che sono la stessa polizza: pezzi in sottocartelle («…/POLIZZA»,
// «…/COPIE FIRMATE»), cartelle doppie. La regola è PURA e sta in
// src/services/policyReconcile.js (planReconcile): decide la prova, cioè lo
// stesso numero di polizza stampato nei documenti, mai la struttura delle
// cartelle né il tipo di documento. Il testo letto finisce nella cache OCR per
// hash: l'estrazione dopo non rifà l'OCR.
// Mai bloccante: un guasto qui lascia il batch com'era e l'elaborazione parte.

import { getSettings } from './settingsStore'
import { importSharedService } from './sharedServices'
import { readPdfPagesWithOcr } from './polizzaJobWorker'
import {
  listQueuedBatchDossiers, getJobFileBase64, getOcrCache, putOcrCache, hashPdfBase64,
  applyReconcilePlan, markBatchReconciled, updateJob, getJob, ocrCacheKey,
} from './polizzaJobStore'

interface ReconcileSvc {
  extractPolicyNumbersFromPages: (pages: string[]) => string[]
  planReconcile: (d: { id: string; path: string; files: { idx: number; numbers: string[] }[] }[]) => { target: string; name: string; numbers: string[]; moves: { from: string; all: boolean; idxs: number[] }[] }[]
}

// Pagine lette per cercare il numero: frontespizio, quietanza, appendice lo
// portano in testa; oltre ci sono condizioni che citano ALTRE polizze.
const NUMBER_PAGES = 5

export async function reconcileBatch(batchId: string): Promise<void> {
  const tag = `[batch:${batchId}] riconciliazione`
  try {
    const svc = await importSharedService<ReconcileSvc>('policyReconcile.js')
    const settings: any = await getSettings()
    const dossiers = await listQueuedBatchDossiers(batchId)
    if (dossiers.length < 2) { await markBatchReconciled(batchId); return }
    const input: { id: string; path: string; files: { idx: number; numbers: string[] }[] }[] = []
    for (const d of dossiers) {
      const files: { idx: number; numbers: string[] }[] = []
      for (let i = 0; i < d.files.length; i++) {
        const f = d.files[i]
        await updateJob(d.id, { progress: { docIndex: i, docTotal: d.files.length, pageIndex: 0, pageTotal: 0, docName: `Lettura preliminare: ${f.file_name}`, totalPagesProcessed: 0, receivedAt: Date.now() } })
        let pages: string[] | null = null
        const b64 = await getJobFileBase64(d.id, f.idx)
        const hash = f.file_hash || (b64 ? hashPdfBase64(b64) : null)
        if (hash) pages = await getOcrCache(ocrCacheKey(hash, settings)).catch(() => null)
        if (!pages && b64) {
          const read = await readPdfPagesWithOcr(Buffer.from(b64, 'base64'), f.file_name, settings)
          pages = read?.pages || null
          // Stesso contratto del worker: in cache solo se almeno una pagina ha testo.
          if (hash && pages && pages.some((t) => t && t.trim())) await putOcrCache(ocrCacheKey(hash, settings), f.file_name, pages).catch(() => {})
        }
        files.push({ idx: f.idx, numbers: pages ? svc.extractPolicyNumbersFromPages(pages.slice(0, NUMBER_PAGES)) : [] })
      }
      await updateJob(d.id, { progress: {} })
      input.push({ id: d.id, path: d.dossier_name || d.id, files })
      // Il perché resta nel log anche quando non si unisce nulla.
      const nums = [...new Set(files.flatMap((f) => f.numbers))]
      const job = await getJob(d.id)
      if (job) {
        const logs = Array.isArray(job.logs) ? [...job.logs] : []
        logs.push(`[${new Date().toTimeString().slice(0, 8)}] Lettura preliminare: ${files.length} file, numeri di polizza trovati: ${nums.length ? nums.join(', ') : 'nessuno'}`)
        await updateJob(d.id, { logs })
      }
    }
    const plan = svc.planReconcile(input)
    const pathOf = Object.fromEntries(input.map((d) => [d.id, d.path]))
    const applied = await applyReconcilePlan(plan, pathOf)
    console.log(`${tag}: ${dossiers.length} dossier letti, ${applied} unioni`)
  } catch (err) {
    console.error(`${tag} non eseguita (non fatale):`, (err as Error)?.message)
  }
  // Una volta sola, riuscita o no: un guasto non deve ripetere la lettura a ogni ripartenza.
  try { await markBatchReconciled(batchId) } catch { /* noop */ }
}
