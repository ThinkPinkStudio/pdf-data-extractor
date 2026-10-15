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
  applyReconcilePlan, markBatchReconciled, updateJob, getJob, getJobStatus, ocrCacheKey,
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
  // Numeri di polizza etichettati nelle PRIME 5 pagine (stessa lettura della
  // riconciliazione) e numeri del batch CITATI nel testo di un documento senza
  // numero proprio: servono al fallback visivo per capire chi è «illeggibile».
  extractPolicyNumbersFromPages: (pages: string[]) => string[]
  knownNumbersInPages: (pages: string[], known: string[]) => string[]
}

// Solo il minimo che serve al fallback visivo (stesse funzioni del worker).
interface VisionSvc {
  visionOcrEngine: (settings: any) => string | null
}
const visionSvc = () => importSharedService<VisionSvc>('polizzaService.js')

type ReconcileFile = { idx: number; name: string; pages: string[]; digital: boolean[] }
type ReconcileDossier = { id: string; path: string; files: ReconcileFile[] }

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

// Una riga di log sul job, con lo stesso formato del worker. Mai bloccante:
// se il DB non risponde il log si perde, la lettura continua.
async function appendReconcileLog(jobId: string, line: string): Promise<void> {
  try {
    const job = await getJob(jobId)
    if (!job) return
    const logs = Array.isArray(job.logs) ? [...job.logs] : []
    logs.push(`[${new Date().toTimeString().slice(0, 8)}] ${line}`)
    await updateJob(jobId, { logs })
  } catch { /* il log non deve mai interrompere la lettura preliminare */ }
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

/**
 * [B] FALLBACK VISIVO PER I SOLI ILLEGGIBILI. Dopo la lettura Tesseract di TUTTO
 * il batch, le scansioni da cui NON esce nessun numero di polizza (né etichettato
 * nelle prime pagine, né citato nel testo fra i numeri del batch) vengono rilette
 * col modello visivo — la SOLA prima pagina, che è ciò che costa (una pagina, non
 * il documento) — perché è lì che il numero sta quando Tesseract lo sbaglia o non
 * lo vede. Su una prima pagina DIGITALE non si tenta: il text layer è già la
 * verità e il visivo non aggiunge nulla. Il testo letto sostituisce la prima
 * pagina SOLO se da esso esce davvero un numero (altrimenti non si peggiora quel
 * che c'era). Doppio tetto per batch perché un batch patologico non torni a durare
 * ore: sul NUMERO di riletture (RECONCILE_VISION_RETRY_MAX, default 25) e sul
 * TEMPO speso (RECONCILE_VISION_RETRY_BUDGET_MS, default 15 min). «Annulla» resta
 * ascoltato: il flag chiude la connessione a Ollama, che cancella la generazione.
 * @returns true se il job è stato annullato (il batch NON va marcato riconciliato)
 */
async function retryIllegiblesWithVision(
  input: ReconcileDossier[],
  svc: ReconcileSvc,
  visionModel: string,
  settings: any,
  isCanceled: (jobId: string) => Promise<boolean>,
): Promise<boolean> {
  const NP = 5
  const labelled = (f: ReconcileFile) => svc.extractPolicyNumbersFromPages((f.pages || []).slice(0, NP))
  // Numeri del batch dalla PRIMA passata: chi ne cita uno non è illeggibile, è un documento di contorno.
  const known = [...new Set(input.flatMap((d) => d.files.flatMap((f) => labelled(f))))]
  const target = (f: ReconcileFile) => !labelled(f).length
    && !svc.knownNumbersInPages(f.pages || [], known).length
    && f.digital.length > 0 && f.digital[0] === false
  const rawCap = Number(process.env.RECONCILE_VISION_RETRY_MAX)
  const cap = Number.isFinite(rawCap) && rawCap >= 0 ? rawCap : 25
  // Secondo tetto, sul TEMPO: un modello visivo lento (una pagina può costare
  // minuti) non deve riportare il batch a durare ore. Superato il budget le
  // retries si fermano e il resto resta col solo Tesseract.
  const rawBudget = Number(process.env.RECONCILE_VISION_RETRY_BUDGET_MS)
  const budgetMs = Number.isFinite(rawBudget) && rawBudget >= 0 ? rawBudget : 900000
  let spentMs = 0
  const flag = { canceled: false }
  let curJob = ''
  // Stesso patto del worker: «Annulla» nel DB marca il flag, che lo stream Ollama
  // legge e chiude la connessione → il server cancella la generazione all'istante.
  const poll = setInterval(() => { const id = curJob; if (id) isCanceled(id).then((c) => { if (c) flag.canceled = true }).catch(() => {}) }, 3000)
  let retries = 0
  try {
    for (const d of input) {
      for (const f of d.files) {
        if (flag.canceled) return true
        if (!target(f)) continue
        if (retries >= cap) {
          if (cap > 0) await appendReconcileLog(d.id, `Lettura preliminare: ${cap} riletture col modello visivo raggiunte — le scansioni restanti restano col solo OCR Tesseract`)
          return false
        }
        if (spentMs >= budgetMs) {
          if (budgetMs > 0) await appendReconcileLog(d.id, `Lettura preliminare: ${Math.round(budgetMs / 60000)} minuti di riletture col modello visivo raggiunti — le scansioni restanti restano col solo OCR Tesseract`)
          return false
        }
        retries++
        curJob = d.id
        flag.canceled = false
        const b64 = await getJobFileBase64(d.id, f.idx).catch(() => null)
        const buf = b64 ? Buffer.from(b64, 'base64') : null
        if (!buf) continue
        await appendReconcileLog(d.id, `Lettura preliminare: nessun numero di polizza da "${f.name}" (scansione) → prima pagina riletta col modello visivo ${visionModel}`)
        const tRetry = Date.now()
        const r = await readPdfPagesWithOcr(buf, f.name, { ...settings, __cancelFlag: flag }, {
          log: (line) => appendReconcileLog(d.id, line),
          isCanceled: async () => flag.canceled || (await isCanceled(d.id)),
          onlyPages: [1],
        })
        spentMs += Date.now() - tRetry
        if (r?.canceled || flag.canceled) return true
        const text = r?.pages?.[0] || ''
        const found = text ? svc.extractPolicyNumbersFromPages([text]) : []
        if (found.length) {
          f.pages[0] = text
          await appendReconcileLog(d.id, `Lettura preliminare: "${f.name}" recuperato col modello visivo — numeri: ${found.join(', ')}`)
        } else {
          await appendReconcileLog(d.id, `Lettura preliminare: "${f.name}" illeggibile anche col modello visivo`)
        }
      }
    }
  } catch (err) {
    // Mai fatale: senza visivo i fascicoli restano come letti da Tesseract.
    console.error(`riconciliazione: fallback visivo non eseguito (non fatale):`, (err as Error)?.message)
  } finally { clearInterval(poll) }
  return false
}

export async function reconcileBatch(batchId: string): Promise<void> {
  const tag = `[batch:${batchId}] riconciliazione`
  try {
    const svc = await importSharedService<ReconcileSvc>('policyReconcile.js')
    const settings: any = await getSettings()
    const dossiers = await listQueuedBatchDossiers(batchId)
    if (dossiers.length < 2) { await markBatchReconciled(batchId); return }
    // 1. Lettura di TUTTI i file, ogni pagina (text layer + OCR delle scansioni).
    const input: ReconcileDossier[] = []
    for (const d of dossiers) {
      const files: ReconcileFile[] = []
      // [RICONCILIAZIONE = SOLO TESSERACT] La lettura preliminare ha UN solo
      // scopo: leggere NUMERI DI POLIZZA (anche sporchi) per unire/dividere i
      // fascicoli. Il matching è già tollerante all'OCR (ocrNorm, oneIndel,
      // knownNumbersInPages in policyReconcile.js), quindi NON serve il modello
      // visivo: coi fascicoli di sole scansioni `dossierOcrEngine` sceglieva
      // qwen3-vl:32b e la lettura passava da millisecondi a MINUTI per pagina
      // (batch fermo per ore, interfaccia congelata). La chiave di cache qui è
      // quella «tesseract» (hash nudo), mai la `:vis:<modello>` del worker,
      // quindi la cache dell'estrazione (che usa il motore configurato) non si
      // avvelena. Un mancato abbinamento NON è un errore: le regole della
      // riconciliazione sono una possibilità, i fascicoli restano com'erano.
      const dSettings = { ...settings, polizzaOcrEngine: 'tesseract' }
      const loaded: { b64: string | null; buf: Buffer | null; probeInfo: { pages: string[] | null; sandwich: number } }[] = []
      for (const f of d.files) {
        const b64 = await getJobFileBase64(d.id, f.idx)
        const buf = b64 ? Buffer.from(b64, 'base64') : null
        loaded.push({ b64, buf, probeInfo: buf ? await spatialPagesOf(buf, settings) : { pages: null, sandwich: 0 } })
      }
      let canceled = false
      for (let i = 0; i < d.files.length; i++) {
        const f = d.files[i]
        // Battito (receivedAt) e contatore PAGINE: senza, questa fase sembrava
        // ferma per minuti (l'OCR visivo tace mentre il modello macina le pagine).
        const prog = (pageIndex: number, pageTotal: number) => ({
          docIndex: i, docTotal: d.files.length, pageIndex, pageTotal,
          docName: `Lettura preliminare: ${f.file_name}`, totalPagesProcessed: 0, receivedAt: Date.now(),
        })
        await updateJob(d.id, { progress: prog(0, 0) })
        let pages: string[] | null = null
        const { b64, buf, probeInfo } = loaded[i]
        const hash = f.file_hash || (b64 ? hashPdfBase64(b64) : null)
        const probe = probeInfo.pages
        const key = hash ? cacheKeyOf(hash, probeInfo, dSettings) : null
        if (key) pages = await getOcrCache(key).catch(() => null)
        // Pagine digitali dal text layer di adesso (campi compilabili: «Polizza numero» di un modulo).
        if (pages && probe) pages = await freshDigitalPages(pages, probe)
        if (!pages && buf) {
          // OCR con VISIBILITÀ: log riga per riga, battito a ogni pagina, e
          // «Annulla» ascoltato (prima: nessun log, progresso congelato e cancel
          // ignorato → il job sembrava morto mentre Ollama lavorava).
          const r = await readPdfPagesWithOcr(buf, f.file_name, dSettings, {
            log: (line) => appendReconcileLog(d.id, line),
            isCanceled: async () => (await getJobStatus(d.id)) === 'canceled',
            onPage: async (p, total) => { await updateJob(d.id, { progress: prog(p, total) }) },
          })
          if (r?.canceled) { canceled = true; break }
          pages = r?.pages || null
          // Stesso contratto del worker: in cache solo se almeno una pagina ha testo.
          if (key && pages && pages.some((t) => t && t.trim())) await putOcrCache(key, f.file_name, pages).catch(() => {})
        }
        const list = pages || []
        files.push({ idx: f.idx, name: f.file_name, pages: list, digital: list.map((_, k) => !!(probe && probe[k] && probe[k].trim())) })
      }
      if (canceled) return // annullato dall'utente: non si marca il batch come riconciliato
      await updateJob(d.id, { progress: {} })
      input.push({ id: d.id, path: d.dossier_name || d.id, files })
    }
    // 1b. [B] Le scansioni da cui Tesseract non ha tratto ALCUN numero di polizza
    // si rileggono col modello visivo (solo la prima pagina): il resto del batch
    // resta veloce com'è. Senza motore visivo configurato non c'è nulla da tentare.
    const visionModel = await visionSvc().then((v) => v.visionOcrEngine(settings)).catch(() => null)
    if (visionModel) {
      const canceledByVision = await retryIllegiblesWithVision(input, svc, visionModel, settings, (id) => getJobStatus(id).then((s) => s === 'canceled').catch(() => false))
      if (canceledByVision) return // annullato durante il fallback: non si marca il batch come riconciliato
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
