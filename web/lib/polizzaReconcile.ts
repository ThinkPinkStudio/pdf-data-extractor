/* eslint-disable @typescript-eslint/no-explicit-any */
// RICONCILIAZIONE DEL BATCH per numero di polizza (25/09/2026). Prima di
// elaborare un batch NUOVO si leggono TUTTI i suoi file, OGNI pagina (text
// layer + OCR delle scansioni, lo stesso testo del worker: readPdfPagesWithOcr)
// e si uniscono i documenti che sono la stessa polizza. Decide SOLO il
// contenuto (04/10/2026, decisione dell'utente: «il documento conta, e solo il
// suo contenuto»): il numero di polizza stampato nei documenti, anche senza
// etichetta o letto storto dall'OCR in qualunque pagina (numeri noti del
// batch), mai la struttura delle cartelle né il tipo di documento. Un PDF con
// più polizze si divide per pagine; i pezzi della stessa polizza sparsi in
// cartelle che ne hanno anche altre diventano un dossier nuovo. La regola è PURA
// e sta in src/services/policyReconcile.js (reconcileFromPages). Il testo letto
// finisce nella cache OCR per hash: l'estrazione dopo non rifà l'OCR.
// Mai bloccante: un guasto qui lascia il batch com'era e l'elaborazione parte.

import { PDFDocument } from 'pdf-lib'
import { getSettings } from './settingsStore'
import { importSharedService } from './sharedServices'
import { readPdfPagesWithOcr } from './polizzaJobWorker'
import {
  listQueuedBatchDossiers, getJobFileBase64, getOcrCache, putOcrCache, hashPdfBase64,
  applyReconcilePlan, markBatchReconciled, updateJob, getJob, ocrCacheKey,
  type ReconcileMerge, type ReconcileSplit,
} from './polizzaJobStore'

type Segment = { from: number; to: number; numbers: string[] }
interface ReconcileSvc {
  reconcileFromPages: (
    d: { id: string; path: string; files: { idx: number; name?: string; pages: string[]; digital?: boolean[] }[] }[],
    opts?: { noSplit?: Set<string> },
  ) => {
    plan: ReconcileMerge[]
    splits: { dossier: string; idx: number; name: string; groups: { merge: number | null; segs: Segment[] }[] }[]
    read: { id: string; numbers: string[]; notes: string[] }[]
  }
  pageRanges: (segs: Segment[]) => string
}

async function spatialPagesOf(buf: Buffer, settings?: any): Promise<{ pages: string[] | null; sandwich: number }> {
  try {
    const { spatialPagesFromPdf, hasTextLayer } = await importSharedService<{ spatialPagesFromPdf: (b: Buffer, opts?: { settings?: any }) => Promise<string[]>; hasTextLayer: (p: string[]) => boolean }>('pdfTextLayer.js')
    const pages = await spatialPagesFromPdf(buf, { settings })
    return { pages: hasTextLayer(pages) ? pages : null, sandwich: Number((pages as any)?.sandwichPages) || 0 }
  } catch { return { pages: null, sandwich: 0 } }
}

async function freshDigitalPages(cached: string[], layer: string[]): Promise<string[]> {
  try {
    const { withFreshTextLayer } = await importSharedService<{ withFreshTextLayer: (c: string[], l: string[] | null) => string[] }>('pdfTextLayer.js')
    return withFreshTextLayer(cached, layer)
  } catch { return cached }
}

// Chiave della cache OCR di un PDF, la stessa del worker: per motore OCR solo se ci sono pagine scansionate.
function cacheKeyOf(hash: string, probe: { pages: string[] | null; sandwich: number }, settings: any): string {
  return (!probe.pages || probe.pages.some((t) => !t || !t.trim())) ? ocrCacheKey(hash, settings, probe.sandwich > 0) : hash
}

/** Le pagine indicate di un PDF in un PDF nuovo (base64), o null se il PDF non si lascia dividere. */
async function pdfWithPages(buf: Buffer, segs: Segment[]): Promise<string | null> {
  try {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true })
    const out = await PDFDocument.create()
    const idxs = segs.flatMap((s) => Array.from({ length: s.to - s.from + 1 }, (_, k) => s.from + k))
    const copied = await out.copyPages(src, idxs)
    for (const p of copied) out.addPage(p)
    return Buffer.from(await out.save()).toString('base64')
  } catch { return null }
}

export async function reconcileBatch(batchId: string): Promise<void> {
  const tag = `[batch:${batchId}] riconciliazione`
  try {
    const svc = await importSharedService<ReconcileSvc>('policyReconcile.js')
    const settings: any = await getSettings()
    const dossiers = await listQueuedBatchDossiers(batchId)
    if (dossiers.length < 2) { await markBatchReconciled(batchId); return }
    // 1. Lettura di TUTTI i file, ogni pagina (text layer + OCR delle scansioni).
    const input: { id: string; path: string; files: { idx: number; name: string; pages: string[]; digital: boolean[] }[] }[] = []
    for (const d of dossiers) {
      const files: { idx: number; name: string; pages: string[]; digital: boolean[] }[] = []
      for (let i = 0; i < d.files.length; i++) {
        const f = d.files[i]
        await updateJob(d.id, { progress: { docIndex: i, docTotal: d.files.length, pageIndex: 0, pageTotal: 0, docName: `Lettura preliminare: ${f.file_name}`, totalPagesProcessed: 0, receivedAt: Date.now() } })
        let pages: string[] | null = null
        const b64 = await getJobFileBase64(d.id, f.idx)
        const hash = f.file_hash || (b64 ? hashPdfBase64(b64) : null)
        const buf = b64 ? Buffer.from(b64, 'base64') : null
        const probeInfo = buf ? await spatialPagesOf(buf, settings) : { pages: null, sandwich: 0 }
        const probe = probeInfo.pages
        const key = hash ? cacheKeyOf(hash, probeInfo, settings) : null
        if (key) pages = await getOcrCache(key).catch(() => null)
        // Pagine digitali dal text layer di adesso (campi compilabili: «Polizza numero» di un modulo).
        if (pages && probe) pages = await freshDigitalPages(pages, probe)
        if (!pages && buf) {
          const r = await readPdfPagesWithOcr(buf, f.file_name, settings)
          pages = r?.pages || null
          // Stesso contratto del worker: in cache solo se almeno una pagina ha testo.
          if (key && pages && pages.some((t) => t && t.trim())) await putOcrCache(key, f.file_name, pages).catch(() => {})
        }
        const list = pages || []
        files.push({ idx: f.idx, name: f.file_name, pages: list, digital: list.map((_, k) => !!(probe && probe[k] && probe[k].trim())) })
      }
      await updateJob(d.id, { progress: {} })
      input.push({ id: d.id, path: d.dossier_name || d.id, files })
    }
    const pathOf: Record<string, string> = Object.fromEntries(input.map((d) => [d.id, d.path]))
    // 2. Piano dal contenuto (numeri in tutto il documento, PDF con più polizze divisi
    // per pagine); un PDF che non si lascia dividere resta intero dov'è e si ripianifica.
    const noSplit = new Set<string>()
    let res = svc.reconcileFromPages(input, { noSplit })
    let splits: ReconcileSplit[] = []
    for (let round = 0; round < 5; round++) {
      splits = []
      let failed = false
      for (const sp of res.splits) {
        const b64 = await getJobFileBase64(sp.dossier, sp.idx)
        const buf = b64 ? Buffer.from(b64, 'base64') : null
        const src = input.find((d) => d.id === sp.dossier)?.files.find((f) => f.idx === sp.idx)
        const parts: ReconcileSplit['parts'] = []
        for (const g of sp.groups) {
          const pdf = buf ? await pdfWithPages(buf, g.segs) : null
          if (!pdf) break
          const pages = svc.pageRanges(g.segs)
          const name = `${sp.name.replace(/\.pdf$/i, '')} (pag. ${pages}).pdf`
          parts.push({ merge: g.merge, file_name: name, pdf_base64: pdf, pages })
          // Testo già letto: in cache per l'hash della parte, l'estrazione non rifà l'OCR.
          const partPages = g.segs.flatMap((s) => (src?.pages || []).slice(s.from, s.to + 1))
          const key = cacheKeyOf(hashPdfBase64(pdf), await spatialPagesOf(Buffer.from(pdf, 'base64'), settings), settings)
          if (partPages.some((t) => t && t.trim())) await putOcrCache(key, name, partPages).catch(() => {})
        }
        if (parts.length !== sp.groups.length) { noSplit.add(`${sp.dossier}#${sp.idx}`); failed = true; continue }
        splits.push({ job: sp.dossier, idx: sp.idx, fileName: sp.name, parts })
      }
      if (!failed) break
      res = svc.reconcileFromPages(input, { noSplit })
    }
    // Il perché resta nel log anche quando non si unisce nulla.
    for (const r of res.read) {
      const job = await getJob(r.id)
      if (!job) continue
      const logs = Array.isArray(job.logs) ? [...job.logs] : []
      logs.push(`[${new Date().toTimeString().slice(0, 8)}] Lettura preliminare (tutte le pagine): ${input.find((d) => d.id === r.id)?.files.length ?? 0} file, numeri di polizza trovati: ${r.numbers.length ? r.numbers.join(', ') : 'nessuno'}${r.notes.length ? ` — ${r.notes.join('; ')}` : ''}`)
      await updateJob(r.id, { logs })
    }
    const applied = await applyReconcilePlan(res.plan, pathOf, splits)
    console.log(`${tag}: ${dossiers.length} dossier letti, ${applied} unioni/divisioni`)
  } catch (err) {
    console.error(`${tag} non eseguita (non fatale):`, (err as Error)?.message)
  }
  // Una volta sola, riuscita o no: un guasto non deve ripetere la lettura a ogni ripartenza.
  try { await markBatchReconciled(batchId) } catch { /* noop */ }
}
