/* eslint-disable @typescript-eslint/no-explicit-any */
// Worker in-process per i job di estrazione polizza. Gira nel processo Node del
// server Next standalone: avviato (fire-and-forget) dalla route POST /api/polizza/job,
// continua anche se il client chiude la tab. Persiste stato/progresso su Postgres
// dopo OGNI pagina, così è recuperabile alla riapertura e riprendibile dopo un
// restart del container (resumer in instrumentation.ts).

import { getSettings } from './settingsStore'
import { importSharedService } from './sharedServices'
import { loadPdfServer } from './pdfRenderServer'
import { buildSources } from './polizzaRolling'
import { withGlobalLock } from './llmSemaphore'
import {
  getJob, getJobFiles, getJobStatus, updateJob, getOcrCache, putOcrCache, hasStaleOcrCache, hashPdfBase64, ocrCacheKey, type JobRow,
} from './polizzaJobStore'

interface PolizzaSvc {
  updateStateWithVisionPage: (state: any, imageBase64: string, pageNum: number, totalPages: number, settings: any, source: any) => Promise<any>
  ocrPageText: (imageBase64: string, settings: any) => Promise<string>
  visionOcrPageText: (imageDataUrl: string, settings: any) => Promise<string>
  visionOcrEngine: (settings: any) => string | null
  extractPolizzaFromFullText: (fullText: string, settings: any, onProgress?: (p: { batch: number; batchTotal: number }) => void) => Promise<{ data: Record<string, string>; sources: Record<string, { file: string; page: number }>; diag?: string[]; reliability?: Record<string, { reliable: number; tipoDiVerifica: string[] }> }>
  extractPolizzaFromDocs: (docs: { name: string; pages: string[] }[], fullText: string, settings: any, onProgress?: (p: { batch?: number; batchTotal?: number; field?: number; fieldTotal?: number }) => void) => Promise<{ data: Record<string, string>; sources: Record<string, { file: string; page: number }>; diag?: string[]; reliability?: Record<string, { reliable: number; tipoDiVerifica: string[] }> }>
  probeOcr: (settings: any) => Promise<{ available: boolean; reason?: string }>
}
const svc = () => importSharedService<PolizzaSvc>('polizzaService.js')

// Evita doppia esecuzione dello stesso job nello stesso processo.
const running = new Set<string>()

function llmFatal(err: any, consecutiveFailures: number): boolean {
  return !!err?.isLlmConnectionError || (!!err?.isLlmTimeout && consecutiveFailures >= 2) || consecutiveFailures >= 3
}

async function appendLog(job: JobRow, line: string, logs: string[]) {
  logs.push(`[${new Date().toTimeString().slice(0, 8)}] ${line}`)
  await updateJob(job.id, { logs })
}

// Chiama il microservizio Docling (POST /parse) e ritorna il markdown estratto
// dal PDF. Lancia se Docling non risponde o non produce testo.
// Testo REALE del markdown: tolte immagini-marcatori (<!-- image -->), sintassi
// markdown (#, |, ---), spazi. Un PDF SCANSIONATO con Docling do_ocr=False
// produce solo marcatori: "length > 50" lo scambiava per testo (con do_ocr=False
// e PDF scansionati è il caso normale) → OCR saltato → precheck che vede vuoto e
// blocca ("rilevato: image" / "cartella senza polizza valida" su scansionati).
// Richiede una quantità minima di testo vero; sotto quella, si degrada a OCR.
function usableMarkdown(md: string): string {
  const clean = String(md || '')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/[#>*|_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length >= 150 ? String(md).trim() : ''
}

// Ritorna il markdown intero e, se il servizio lo produce, il markdown PER
// PAGINA (allineato alle pagine del PDF): il motore lo affianca alla griglia
// spaziale pagina per pagina. Un servizio vecchio (pages = [blob]) resta valido.
async function markdownFromDocling(doclingUrl: string, pdfBuf: Buffer): Promise<{ markdown: string; pages: string[] }> {
  const base = String(doclingUrl).replace(/\/+$/, '')
  const res = await fetch(`${base}/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'documento.pdf', content_base64: pdfBuf.toString('base64') }),
    signal: AbortSignal.timeout(300000), // PDF lunghi: Docling può impiegare minuti
  })
  if (!res.ok) throw new Error(`Docling HTTP ${res.status}`)
  const j = (await res.json()) as { markdown?: string; pages?: string[] }
  const md = String(j.markdown || '').trim()
  if (md.length <= 50) throw new Error('Docling: markdown vuoto o troppo corto')
  const pages = Array.isArray(j.pages) && j.pages.length > 1 ? j.pages.map((p) => String(p || '')) : [md]
  return { markdown: md, pages }
}

// Griglia SPAZIALE per pagina dal text layer (pdfjs → buildSpatialPage): le
// colonne/tabelle restano allineate per coordinate REALI. Il motore staged le
// spezza in batch che entrano nel contesto (8192): il markdown Docling da solo
// è UN blob unico (decine di KB) che NON ci sta e i dati restano fuori
// contesto (visto in produzione: recupero che risponde null, 2/23).
// La funzione vive in src/services/pdfTextLayer.js: STESSO codice per worker,
// script di calibrazione e test (prima era copiato in quattro posti).
// Ritorna null se il PDF non si apre o nessuna pagina ha text layer (scansione):
// in quel caso il chiamante NON deve passare spatialPages vuote al motore
// (pagine vuote = niente prompt), ma usare il markdown o l'OCR.
async function spatialPagesFromPdf(pdfBuf: Buffer): Promise<string[] | null> {
  try {
    const { spatialPagesFromPdf: fromPdf, hasTextLayer } = await importSharedService<{
      spatialPagesFromPdf: (b: Buffer) => Promise<string[]>
      hasTextLayer: (p: string[]) => boolean
    }>('pdfTextLayer.js')
    const pages = await fromPdf(pdfBuf)
    return hasTextLayer(pages) ? pages : null
  } catch {
    return null // pdfjs non disponibile/fallito → il worker usa solo il markdown
  }
}

// Numeri spezzati dal kerning ricomposti anche nelle griglie LETTE DALLA CACHE
// OCR. joinSplitNumbers (14/09) è arrivato dopo l'ultimo bump di OCR_FORMAT
// (11/09): le griglie in cache scritte prima restavano "54 . 383 ,00" e il
// fatturato del questionario cadeva senza evidenza con la citazione giusta
// (BOLCHINI RC 2026, fascicolo già elaborato → griglia dalla cache). La
// funzione è idempotente: si applica in lettura invece di invalidare la cache
// (niente OCR rifatto per ogni scansione). `textLayer`: se noto, solo le
// pagine con testo digitale (le pagine OCR restano come un OCR rifatto da
// zero); null = tutte. Mai bloccante: in errore le pagine restano com'erano.
// Con il text layer noto, le pagine DIGITALI si prendono da quello (letto
// adesso, col percorso testo di adesso: campi compilabili compresi) e non dalla
// cache; le scansioni restano l'OCR in cache (withFreshTextLayer).
async function rejoinCachedGrid(pages: string[], textLayer: string[] | null): Promise<string[]> {
  try {
    const { joinSplitNumbersInPages, withFreshTextLayer } = await importSharedService<{
      joinSplitNumbersInPages: (p: string[], layer?: string[] | null) => string[]
      withFreshTextLayer: (cached: string[], layer: string[] | null) => string[]
    }>('pdfTextLayer.js')
    const fresh = textLayer && textLayer.length ? withFreshTextLayer(pages, textLayer) : pages
    return joinSplitNumbersInPages(fresh, textLayer)
  } catch {
    return pages
  }
}

// LETTURA «senza markdown» di UN PDF: text layer pdfjs (griglia spaziale) e
// OCR Tesseract SOLO sulle pagine senza testo (scansioni). UNICO codice per il
// worker e per la riconciliazione del batch (policyReconcile): stesso testo,
// stessa cache OCR (la scrive il chiamante). null = PDF illeggibile.
const totalPagesForLog = (layer: string[] | null, doc: { numPages?: number } | null) => (layer ? layer.length : (doc?.numPages || 0))

export async function readPdfPagesWithOcr(buf: Buffer, docName: string, settings: any, hooks: {
  log?: (line: string) => Promise<void>
  isCanceled?: () => Promise<boolean>
  onPage?: (page: number, total: number) => Promise<void>
} = {}): Promise<{ pages: string[]; canceled?: boolean; ocrPages?: number } | null> {
  const log = hooks.log || (async () => {})
  const textLayer = await spatialPagesFromPdf(buf)
  const needOcr = textLayer ? textLayer.map((t, i) => (t && t.trim() ? -1 : i + 1)).filter((p) => p > 0) : null
  let doc: Awaited<ReturnType<typeof loadPdfServer>> | null = null
  if (!textLayer || needOcr!.length) {
    try { doc = await loadPdfServer(buf) } catch (err: any) {
      if (!textLayer) { await log(`SKIP "${docName}": ${err.message}`); return null }
      await log(`"${docName}": ${needOcr!.length} pagine senza testo restano vuote (apertura per OCR fallita: ${err.message})`)
    }
  }
  const totalPages = textLayer ? textLayer.length : (doc?.numPages || 0)
  const pages: string[] = []
  if (textLayer) {
    const nText = textLayer.filter((t) => t && t.trim()).length
    await log(`Text layer pdfjs per "${docName}": ${nText}/${textLayer.length} pagine con testo${needOcr!.length ? `, ${needOcr!.length} in OCR` : ''}`)
  }
  const m = doc ? await svc() : null
  // Motore di lettura delle scansioni: Tesseract o un modello visivo (polizzaOcrEngine).
  const vision = m ? m.visionOcrEngine(settings) : null
  // needOcr è null per una scansione INTERA (nessun text layer): allora tutte le pagine.
  const toOcr = needOcr ? needOcr.length : totalPagesForLog(textLayer, doc)
  if (vision && toOcr) await log(`OCR con modello visivo ${vision} per "${docName}" (${toOcr} pagine)`)
  let ocrPages = 0
  try {
    for (let p = 1; p <= totalPages; p++) {
      if (hooks.isCanceled && await hooks.isCanceled()) return { pages, canceled: true, ocrPages }
      if (hooks.onPage) await hooks.onPage(p, totalPages)
      const layer = textLayer ? textLayer[p - 1] : ''
      if (layer && layer.trim()) { pages.push(layer); continue }
      if (!doc || !m) { pages.push(''); continue }
      let png: string
      try { png = vision ? await doc.renderPage(p, { longSide: 1800, preprocess: false }) : await doc.renderPage(p) } catch (err: any) { await log(`SKIP pagina ${p} di "${docName}": ${err.message}`); pages.push(''); continue }
      try {
        const text = (vision ? await m.visionOcrPageText(png, settings) : await m.ocrPageText(png, settings)) || ''
        pages.push(text)
        if (text.trim()) ocrPages++
      } catch (err: any) { await log(`OCR pagina ${p} di "${docName}": ${err.message}`); pages.push('') }
    }
  } finally {
    if (doc) await doc.destroy()
  }
  return { pages, ocrPages }
}

export function startJob(jobId: string): void {
  if (running.has(jobId)) return
  running.add(jobId)
  // Fire-and-forget: non blocca la response della route. Passa dal semaforo globale
  // così un'estrazione singola non gira mai in parallelo a un batch (protezione VRAM).
  void withGlobalLock(() => runJob(jobId)).catch(async (e) => {
    try { await updateJob(jobId, { status: 'error', error: String(e?.message || e) }) } catch { /* noop */ }
  }).finally(() => running.delete(jobId))
}

// Variante awaitable di startJob, usata dall'orchestratore batch per elaborare i
// job figli in sequenza (attende il completamento di uno prima di avviare il
// successivo). Se il job è già in esecuzione altrove nello stesso processo, attende
// che finisca invece di duplicarne l'esecuzione. Acquisisce lo STESSO semaforo
// globale di startJob: batch e job singoli condividono un'unica coda di esecuzione.
export async function runJobAndWait(jobId: string): Promise<void> {
  if (running.has(jobId)) {
    while (running.has(jobId)) await new Promise((r) => setTimeout(r, 500))
    return
  }
  running.add(jobId)
  try {
    await withGlobalLock(() => runJob(jobId))
  } catch (e: any) {
    try { await updateJob(jobId, { status: 'error', error: String(e?.message || e) }) } catch { /* noop */ }
  } finally {
    running.delete(jobId)
  }
}

async function runJob(jobId: string): Promise<void> {
  const job = await getJob(jobId)
  if (!job) return
  if (job.status === 'done' || job.status === 'canceled' || job.status === 'error' || job.status === 'matched' || job.status === 'review') return

  const settings = await getSettings()
  // Profilo per-dossier: lo snapshot di campi/prompt congelato all'upload vince sul
  // globale. Tutti i path del servizio condiviso leggono settings.polizzaFields /
  // polizzaPromptExtra, quindi override qui li propaga senza toccare polizzaService.js.
  // (Vale anche per i job singoli: field_defs prima era salvato ma ignorato.)
  if (Array.isArray(job.field_defs) && job.field_defs.length > 0) {
    settings.polizzaFields = job.field_defs.map((f) => ({ ...f, description: f.description ?? '' }))
  }
  if (job.prompt_extra != null) {
    settings.polizzaPromptExtra = job.prompt_extra
  }
  // Run di TEST: override puntuale dei settings scelto nel dialog, applicato
  // DOPO i globali con WHITELIST rigida (mai far entrare chiavi arbitrarie dal
  // DB nei settings in memoria) — stesso pattern di field_defs qui sopra.
  if (job.settings_override && typeof job.settings_override === 'object') {
    const ALLOWED = ['ollamaModel', 'polizzaWholeDossierModel', 'polizzaStagedCascade', 'polizzaPerField', 'polizzaConstrainedJson', 'polizzaThink', 'polizzaBatchContext', 'polizzaOcrEngine'] as const
    for (const k of ALLOWED) {
      if (job.settings_override[k] !== undefined) (settings as any)[k] = job.settings_override[k]
    }
  }
  const files = await getJobFiles(jobId)
  const logs = Array.isArray(job.logs) ? [...job.logs] : []
  await updateJob(jobId, { status: 'running' })

  // SEMPRE percorso testo (OCR Tesseract + modello di testo). Il vecchio ramo
  // vision-rolling (immagini pagina per pagina al modello vision) è stato
  // eliminato su richiesta: coi modelli testuali configurati produceva solo
  // errori 400 "Multimodal data provided" e job a 0 campi. I PDF scansionati
  // passano comunque: ci pensa l'OCR Tesseract dentro il percorso testo.
  if (!job.whole_dossier) logs.push('Nota: modalità vision dismessa — il job usa il percorso testo (OCR) come tutti.')
  await runWholeDossier(job, files, settings, logs)
}

async function isCanceled(id: string): Promise<boolean> {
  return (await getJobStatus(id)) === 'canceled'
}

// ─── Modalità normale: vision rolling pagina per pagina ──────────────────────
async function runVisionRolling(job: JobRow, files: { file_name: string; pdf_base64: string }[], settings: any, logs: string[]) {
  const m = await svc()
  let state = job.rolling_state || {}
  const cursor = job.cursor || {}
  const startDoc = cursor.docIndex ?? 0
  const startPageDone = cursor.pageIndex ?? 0 // ultima pagina completata nel doc startDoc
  let totalPagesProcessed = cursor.totalPagesProcessed ?? 0
  let consecutiveFailures = 0

  await appendLog(job, `OCR visivo: ripresa da doc ${startDoc + 1}, pagina ${startPageDone + 1}`, logs)

  for (let d = startDoc; d < files.length; d++) {
    if (await isCanceled(job.id)) return
    const docName = files[d].file_name
    const buf = Buffer.from(files[d].pdf_base64, 'base64')
    let doc
    try {
      doc = await loadPdfServer(buf)
    } catch (err: any) {
      await appendLog(job, `SKIP "${docName}": apertura PDF fallita (${err.message})`, logs)
      continue
    }
    const totalPages = doc.numPages
    const firstPage = d === startDoc ? startPageDone + 1 : 1
    try {
      for (let p = firstPage; p <= totalPages; p++) {
        if (await isCanceled(job.id)) return
        totalPagesProcessed++
        const progress = { docIndex: d, docTotal: files.length, pageIndex: p, pageTotal: totalPages, docName, totalPagesProcessed, receivedAt: Date.now() }
        await updateJob(job.id, { progress })

        let png: string
        try {
          png = await doc.renderPage(p)
        } catch (err: any) {
          await appendLog(job, `SKIP pagina ${p} di "${docName}": render fallito (${err.message})`, logs)
          continue
        }

        try {
          state = await m.updateStateWithVisionPage(state, png, p, totalPages, settings, { file: docName, page: p })
          consecutiveFailures = 0
          await updateJob(job.id, {
            rolling_state: state,
            sources: buildSources(state),
            cursor: { docIndex: d, pageIndex: p, totalPagesProcessed },
            progress,
          })
        } catch (err: any) {
          consecutiveFailures++
          await appendLog(job, `OCR vision pag. ${p}/${totalPages} di "${docName}": ${err.message}`, logs)
          if (llmFatal(err, consecutiveFailures)) {
            await updateJob(job.id, { status: 'error', error: err.message })
            return
          }
        }
      }
    } finally {
      await doc.destroy()
    }
  }

  await appendLog(job, `OCR visivo completato (${totalPagesProcessed} pagine)`, logs)
  await updateJob(job.id, { status: 'done', progress: {} })
}

// ─── Modalità fascicolo intero: OCR di tutte le pagine → 1 chiamata ──────────
async function runWholeDossier(job: JobRow, files: { file_name: string; pdf_base64: string; file_hash?: string | null }[], settings: any, logs: string[]) {
  const m = await svc()

  let ocr = { available: true } as { available: boolean; reason?: string }
  try { ocr = await m.probeOcr(settings) } catch (e: any) { ocr = { available: false, reason: e.message } }
  if (!ocr.available) {
    await updateJob(job.id, { status: 'error', error: `OCR non disponibile (${ocr.reason || 'motivo sconosciuto'}). La modalità "fascicolo intero" richiede Tesseract.` })
    return
  }

  const parts: string[] = []
  // Pagine per documento (testo OCR): servono all'indice vettoriale, che salva
  // ogni chunk con file+pagina come metadati.
  // ocr: il testo viene (anche) dall'OCR di una scansione → a pari data vale meno (motore).
  const docsForIndex: { name: string; pages: string[]; hash?: string; ocr?: boolean }[] = []
  // Testo PIATTO per il pre-check (filtro parole chiave): SEPARATO da
  // docsForIndex. L'estrazione usa il markdown Docling (struttura), il filtro
  // deve vedere il testo PIANO (senza "<!-- image -->", "#", "|"): com'era
  // prima dell'introduzione del markdown nel worker.
  const docsFlat: { name: string; pages: string[] }[] = []
  const toFlat = (pg: string) => String(pg || '')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/^\s{0,4}#{1,6}\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  let totalPagesProcessed = 0
  let pagesWithText = 0
  let ocrCacheHits = 0
  for (let d = 0; d < files.length; d++) {
    if (await isCanceled(job.id)) return
    const docName = files[d].file_name
    // Identità del contenuto: dalle righe migrate arriva già dal DB; per i job
    // precedenti alla migrazione si calcola al volo (stesso SHA-256).
    const fileHash = files[d].file_hash || hashPdfBase64(files[d].pdf_base64)

    // ── LETTURA LAYOUT-AWARE (Docling → markdown) PRIMA dell'OCR ───────────
    // Il servizio Docling (impostazione doclingUrl) produce il markdown del PDF
    // (tabelle strutturate, colonne/righe) che il modello legge come struttura.
    // GIRA SEMPRE se configurato; se non c'è o fallisce, si ripiega su
    // @firecrawl/pdf-inspector e infine sulla cache OCR / OCR storico.
    const buf = Buffer.from(files[d].pdf_base64, 'base64')
    let mdDoc = ''
    let mdPages: string[] = [] // markdown per pagina (Docling), se disponibile
    const doclingUrl = String(settings.doclingUrl || '').trim()
    if (doclingUrl) {
      try {
        const { markdown: rawMd, pages: rawPages } = await markdownFromDocling(doclingUrl, buf)
        mdDoc = usableMarkdown(rawMd)
        if (mdDoc) {
          mdPages = rawPages.length > 1 ? rawPages : []
          await appendLog(job, `Markdown Docling per "${docName}" (${mdDoc.length} char${mdPages.length ? `, ${mdPages.length} pagine` : ''})`, logs)
        } else if (rawMd) await appendLog(job, `Docling su "${docName}": solo marcatori/nessun testo reale (PDF scansionato?) → fallback OCR`, logs)
      } catch (err: any) {
        mdDoc = ''
        await appendLog(job, `Docling fallito per "${docName}": ${err.message || err}`, logs)
      }
    } else {
      await appendLog(job, `Docling NON configurato (doclingUrl vuoto) — fallback OCR per "${docName}"`, logs)
    }
    if (!mdDoc) {
      try {
        const { processPdf } = await import('@firecrawl/pdf-inspector')
        const pdfRes = await processPdf(buf)
        const md = usableMarkdown(pdfRes?.markdown || '')
        if (md) mdDoc = md
      } catch { /* pdf-inspector non disponibile: fallback OCR */ }
    }

    // Cache OCR: SOLO se il markdown Docling/pdf-inspector non è disponibile.
    // (PRIMA la cache vinceva su Docling e i PDF già visti non lo usavano mai.)
    let cachedPages: string[] | null = null
    // Chiave della cache: dipende dal MOTORE OCR solo se il documento ha pagine
    // SCANSIONATE. Un PDF tutto digitale dà lo stesso testo con qualunque motore:
    // con la chiave per motore una prova «OCR visivo» rileggeva da zero anche i
    // digitali (griglia ricalcolata) e il confronto con la base non era pulito
    // (GUFFANTI RC 33 → 29 senza una sola pagina letta dal modello visivo).
    const layerProbe = mdDoc ? null : await spatialPagesFromPdf(buf)
    const hasScanPages = !layerProbe || layerProbe.some((t) => !t || !t.trim())
    const docCacheKey = mdDoc || !hasScanPages ? fileHash : ocrCacheKey(fileHash, settings)
    if (!mdDoc) {
      try { cachedPages = await getOcrCache(docCacheKey) } catch { /* cache mai bloccante */ }
      if (!cachedPages) {
        try {
          if (await hasStaleOcrCache(docCacheKey)) {
            await appendLog(job, `OCR rifatto per "${docName}": formato del testo aggiornato (colonne preservate)`, logs)
          }
        } catch { /* solo log, mai bloccante */ }
      }
      if (cachedPages && cachedPages.length) {
        // Cache senza markdown: text layer o OCR? Lo dice il PDF (pagine senza testo = scansione).
        const layerOfCached = layerProbe
        // Numeri spezzati ricomposti sulle sole pagine digitali ([] = nessuna: scansione intera).
        cachedPages = await rejoinCachedGrid(cachedPages, layerOfCached || [])
        const docText = cachedPages.filter(Boolean).join('\n')
        totalPagesProcessed += cachedPages.length
        pagesWithText += cachedPages.filter((t) => t && t.trim()).length
        ocrCacheHits++
        await appendLog(job, `OCR riusato dalla CACHE per "${docName}" (${cachedPages.length} pagine, contenuto già visto)`, logs)
        await updateJob(job.id, { progress: { docIndex: d, docTotal: files.length, pageIndex: cachedPages.length, pageTotal: cachedPages.length, docName, totalPagesProcessed, receivedAt: Date.now() } })
        parts.push(`\n===== DOCUMENTO: ${docName} =====\n${docText.trim()}`)
        docsForIndex.push({ name: docName, pages: cachedPages, hash: fileHash, ocr: !layerOfCached || layerOfCached.some((t) => !t || !t.trim()) })
        docsFlat.push({ name: docName, pages: cachedPages.map(toFlat) })
        continue
      }
    }

    // Se il markdown (Docling/pdf-inspector) c'è, usalo come struttura. Come nei
    // test di calibrazione: pages = markdown Docling, spatialPages = griglia
    // spaziale pdfjs per pagina (le colonne/tabelle allineate per coordinate).
    // Il motore staged spezza la griglia in batch che entrano nel contesto
    // (8192) — il markdown da solo (decine di KB in una pagina) NON ci sta e i
    // dati restano fuori contesto (recupero null, 2/23 in produzione).
    if (mdDoc) {
      const docText = mdDoc
      // Pagine markdown: per pagina se Docling le dà, altrimenti il blocco unico.
      // In entrambi i casi il MOTORE (normalizeStagedDocInput) le allinea alla
      // griglia spaziale per contenuto quando il conteggio non coincide: il
      // blocco unico viene spezzato su confini strutturali (tabelle intere) e
      // ogni unità va alla pagina della griglia che la contiene. Prima il blob
      // restava UNA pagina: gate semantico sui primi 2000 char, tutte le tabelle
      // incollate alla pagina 1 del prompt.
      const docPages = mdPages.length ? mdPages : [mdDoc]
      // Griglia spaziale: reperita dalla cache OCR se disponibile, altrimenti
      // estratta dal PDF (pdfjs). MAI fatale: se non c'è, si usa solo il markdown
      // (peggio, ma il flusso non si ferma).
      // Guardia anti-avvelenamento: una versione provvisoria del worker aveva
      // scritto in cache il MARKDOWN (blob unico) spacciandolo per griglia. Se la
      // cache è un solo blob e coincide col markdown, NON è una griglia: si
      // rigenera da pdfjs. (OCR_FORMAT=3 ha già invalidato le voci marce; questa
      // è difesa in profondità per chi ha una cache scritta da build difettose.)
      let spatial: string[] | null = null
      // Ramo markdown: la griglia è il text layer (niente OCR) → chiave del solo file.
      const cachedRaw = await getOcrCache(fileHash).catch(() => null)
      const cacheIsGrid = !!(cachedRaw && cachedRaw.length && !(cachedRaw.length === 1 && String(cachedRaw[0]).trim() === mdDoc.trim()))
      // Griglia = text layer di ADESSO quando c'è (stesso percorso testo di
      // tutto il resto, campi compilabili compresi); la cache solo se il PDF
      // non ha text layer (numeri spezzati ricomposti, vedi rejoinCachedGrid).
      spatial = await spatialPagesFromPdf(buf)
      if (spatial) {
        if (!cacheIsGrid) {
          try { await putOcrCache(fileHash, docName, spatial) } catch { /* non fatale */ }
        }
      } else if (cacheIsGrid) spatial = await rejoinCachedGrid(cachedRaw!, null)
      totalPagesProcessed += (spatial?.length || docPages.length)
      pagesWithText++
      parts.push(`\n===== DOCUMENTO: ${docName} =====\n${mdDoc}`)
      docsForIndex.push({ name: docName, pages: docPages, hash: fileHash, ...(spatial ? { spatialPages: spatial } : {}) })
      // PRE-CONTROLLO sullo STESSO testo della misura locale (griglia pdf.js
      // collassata), non sul markdown Docling: col markdown il regex «polizza
      // vera» accantonava la quietanza DAS («nessuna voce di polizza») che in
      // locale passava, e pagine/embedding non coincidevano con quanto
      // misurato (22/09/2026: «i risultati in produzione sono diversi»). Il
      // markdown resta il testo dell'ESTRAZIONE (docsForIndex).
      docsFlat.push({ name: docName, pages: spatial ? spatial.map(toFlat) : docPages.map(toFlat) })
      continue
    }
    // ── Senza markdown: STESSO percorso testo dei test (pdfjs → griglia) ──────
    // Il text layer del PDF, quando c'è, è il testo migliore: esatto, con le
    // colonne allineate per coordinate, e costa millisecondi. L'OCR Tesseract
    // (minuti, cifre storpiate) si fa SOLO sulle pagine che non hanno testo
    // (scansioni). Prima, senza Docling, il worker mandava a Tesseract anche i
    // PDF digitali: in locale i test leggevano il text layer, online no.
    const read = await readPdfPagesWithOcr(buf, docName, settings, {
      log: (line) => appendLog(job, line, logs),
      isCanceled: () => isCanceled(job.id),
      onPage: async (p, total) => {
        totalPagesProcessed++
        await updateJob(job.id, { progress: { docIndex: d, docTotal: files.length, pageIndex: p, pageTotal: total, docName, totalPagesProcessed, receivedAt: Date.now() } })
      },
    })
    if (!read) continue
    if (read.canceled) return
    const docPages = read.pages
    const docText = docPages.filter((t) => t && t.trim()).map((t) => '\n' + t).join('')
    pagesWithText += docPages.filter((t) => t && t.trim()).length
    // In cache solo se il documento ha prodotto ALMENO una pagina di testo: un
    // fallimento transitorio (render/OCR) non deve restare congelato per sempre.
    if (docPages.some((t) => t && t.trim())) {
      try { await putOcrCache((read.ocrPages || 0) > 0 ? ocrCacheKey(fileHash, settings) : fileHash, docName, docPages) } catch { /* non fatale */ }
    }
    parts.push(`\n===== DOCUMENTO: ${docName} =====\n${docText.trim()}`)
    docsForIndex.push({ name: docName, pages: docPages, hash: fileHash, ocr: (read.ocrPages || 0) > 0 })
    docsFlat.push({ name: docName, pages: docPages.map(toFlat) })
  }
  if (ocrCacheHits) await appendLog(job, `Cache OCR: ${ocrCacheHits}/${files.length} documenti riusati (contenuto identico già elaborato)`, logs)

  const fullText = parts.join('\n')
  if (pagesWithText === 0 || fullText.trim().length < 50) {
    await updateJob(job.id, { status: 'error', error: "L'OCR non ha prodotto testo leggibile (0 pagine utili)." })
    return
  }

  // ── PRE-CHECK DI PERTINENZA profilo↔contenuto (post-OCR, PRIMA di ogni
  // chiamata LLM di estrazione). Solo per i job con un profilo scelto; salta
  // se l'utente ha già premuto "Procedi comunque" (precheck.override) o ▶ su
  // un abbinamento riuscito (precheck.confirmed).
  // Regola ferrea: un guasto del pre-check NON ferma mai il job.
  const precheckMode = settings.polizzaPrecheckMode || 'llm'
  // «Solo abbinamento» (pagina Bulk / Riabbina): dopo la pertinenza il job si
  // ferma in 'matched' e l'estrazione aspetta il ▶ dell'utente.
  const precheckBase: Record<string, any> = { ...((job.precheck as any) || {}) }
  const matchOnly = !!precheckBase.matchOnly
  // GRIGLIA SPAZIALE per il controllo di operatività: caselle barrate e colonne
  // premio restano incolonnate (il testo piatto le scioglie); stessa vista del
  // motore di estrazione (normalizeStagedDocInput).
  const spatialDocs = docsForIndex.map((d) => ({ name: d.name, pages: ((d as any).spatialPages as string[] | undefined) || d.pages }))
  const activeProfiles = (settings.polizzaProfiles || []).filter((p: any) => p && p.enabled !== false)
  // Profilo LIVE (per contentKeywords/nome): se è stato cancellato si degrada al
  // semantico sui field_defs congelati — mai un errore.
// Profilo per il pre-check: quello esplicito del job, altrimenti il profilo
// ATTIVO globale (i campi congelati nei job senza profile_id derivano da
// quello). Senza questo fallback i job lanciati dalla pagina bulk senza profilo
// esplicito (GUFFANTI: fideiussioni/infortuni con i campi globali di TL3)
// saltavano IL FILTRO e venivano estratti lo stesso.
// ── PROFILO AUTOMATICO (semantico + operatività) ───────────────────────────
// Il job è nato col tipo «Automatico»: si classificano i profili ATTIVI per
// affinità col testo (rankProfilesForDocs: «Come riconoscerla» se tutti ce
// l'hanno, altrimenti le descrizioni dei campi) e poi, sui primi 3 con «Come
// riconoscerla», il controllo di OPERATIVITÀ: si adotta il primo la cui
// copertura è OPERANTE con prova. Nessuno operante → si adotta il più affine e
// il job finisce «da verificare» con i verdetti provati. Senza classifica
// (embeddings giù, nessun profilo) si prosegue coi campi globali, mai un errore.
let autoOperativita: any = null
// Profili già provati dall'operatività del percorso Automatico: il pre-check
// non li rifà (fino a ~24 chiamate per fascicolo, prima).
let autoTried: { id: string; name: string; verdict: string; reason: string }[] = []
// ANNULLA anche durante il pre-check: il flag chiude lo stream Ollama e, prima
// di scrivere uno stato, si ricontrolla il DB (prima 'canceled' veniva
// sovrascritto da matched/review/mismatch).
const preCancel = { canceled: false }
settings.__cancelFlag = preCancel
const preCancelPoll = setInterval(() => {
  isCanceled(job.id).then((c) => { if (c) preCancel.canceled = true }).catch(() => {})
}, 3000)
try {
if (job.profile_id === 'auto') {
  try {
    const pcSvc = await importSharedService<{
      rankProfilesForDocs: (p: any) => Promise<{ id: string; name: string; score: number | null; signal?: string }[]>
      runOperativita: (p: any) => Promise<any>
      recognitionOf: (p: any) => string
      contentExcludeMatched: (profile: any, docs: any) => string[]
    }>('polizzaPrecheckService.js')
    // Solo i profili ATTIVI (enabled !== false; assente = attivo, import retrocompatibile).
    const ranking = await pcSvc.rankProfilesForDocs({ docs: docsFlat, profiles: activeProfiles, settings })
    const rankStr = ranking.filter((r) => typeof r.score === 'number').map((r) => `${r.name} ${(r.score as number).toFixed(2)}`).join(' · ')
    const ranked = ranking.filter((r) => typeof r.score === 'number').map((r) => activeProfiles.find((p: any) => p.id === r.id)).filter(Boolean) as any[]
    let chosen: any = ranked[0] || null
    const tried: string[] = []
    if (precheckMode !== 'off') {
      const opDiag: string[] = []
      for (const cand of ranked.filter((p) => pcSvc.recognitionOf(p)).slice(0, 3)) {
        if (preCancel.canceled) break
        // Stesse regole del profilo scelto a mano: le parole «da evitare» del
        // candidato entrano nella decisione (operante + parola = contraddizione).
        const r = await pcSvc.runOperativita({ docs: docsFlat, spatialDocs, profile: cand, profiles: activeProfiles, settings, diag: opDiag, excludeMatched: pcSvc.contentExcludeMatched(cand, docsFlat) })
        tried.push(`«${cand.name}»: ${r?.verdict === 'ok' ? 'operante' : r?.verdict === 'mismatch' ? 'non operante' : 'da verificare'}`)
        autoTried.push({ id: cand.id, name: cand.name, verdict: r?.verdict || 'review', reason: r?.reason || '' })
        if (!autoOperativita) autoOperativita = r
        if (r && r.verdict === 'ok') { chosen = cand; autoOperativita = r; break }
      }
      for (const line of opDiag) await appendLog(job, line, logs)
    }
    if (chosen) {
      const fieldDefs = (chosen.fields || []).filter((f: any) => f.enabled !== false)
        .map((f: any) => ({ id: f.id, label: f.label, description: f.description, type: f.type, sheet: f.sheet }))
      job.profile_id = chosen.id
      job.profile_name = chosen.name
      job.field_defs = fieldDefs as any
      job.prompt_extra = chosen.promptExtra || ''
      settings.polizzaFields = fieldDefs.map((f: any) => ({ ...f, description: f.description ?? '' }))
      settings.polizzaPromptExtra = chosen.promptExtra || ''
      precheckBase.auto = true
      precheckBase.autoRanking = ranking
      if (tried.length) precheckBase.autoTried = tried
      await updateJob(job.id, {
        profile_id: chosen.id, profile_name: chosen.name, field_defs: fieldDefs, prompt_extra: chosen.promptExtra || '',
        precheck: { ...precheckBase, verdict: 'ok', mode: 'semantic', score: null, threshold: null, reason: `profilo scelto automaticamente (${rankStr})`, ranking, at: Math.floor(Date.now() / 1000) },
      })
      await appendLog(job, `Profilo automatico (${(ranking[0] as any)?.signal || 'descrizioni dei campi'}): adottato «${chosen.name}» — classifica: ${rankStr}${tried.length ? ` — operatività: ${tried.join(', ')}` : ''}`, logs)
    } else {
      await appendLog(job, `Profilo automatico: nessuna classifica disponibile (${ranking.length ? 'punteggi assenti' : 'nessun profilo o embeddings non disponibili'}) — si procede coi campi globali`, logs)
    }
  } catch (err: any) {
    await appendLog(job, `Profilo automatico non eseguibile (${err.message}) — si procede coi campi globali`, logs)
  }
}
const profile = (settings.polizzaProfiles || []).find((p: any) => p.id === (job.profile_id || settings.polizzaActiveProfileId)) || null
// Attiva il pre-check di pertinenza quando:
//  - c'è un profilo (esplicito o attivo) e lo switch globale è su un metodo
//    (keywords/semantic/llm), OPPURE
//  - il profilo definisce parole del CONTENUTO (da cercare o da evitare):
//    in questo caso il blocco "da evitare" deve agire SEMPRE, anche a switch 'off';
//  - oppure è stata ATTIVATA (opt-in) la regola di validità "polizza vera":
//    anche a pre-check off va invocato il pre-check (per il solo blocco validità).
const hasContentWords = !!profile?.contentKeywords || !!profile?.contentExcludeKeywords
// Default ATTIVO (12/09/2026): senza polizza principale la cartella si accantona con la ragione.
const requireValidPolicy = settings.polizzaRequireValidPolicy !== false
const shouldPrecheck = !!profile && !precheckBase.override && !precheckBase.confirmed && (precheckMode !== 'off' || hasContentWords || requireValidPolicy)
  // Nomi dei documenti letti (per i messaggi all'utente; MAI nei prompt).
  const docNames = docsFlat.map((d) => d.name.replace(/^.*[\\/]/, '')).slice(0, 8).join(', ') + (docsFlat.length > 8 ? ` (+${docsFlat.length - 8})` : '')
  if (shouldPrecheck) {
    try {
      const pcSvc = await importSharedService<{
        runPrecheck: (p: any) => Promise<{ verdict: string; mode: string; score: number | null; reason: string; setAside?: boolean; matched?: string[]; missing?: string[]; excludeMatched?: string[]; suggestion?: { id: string; name: string; score: number | null; signal?: string | null } | null; ranking?: { id: string; name: string; score: number | null }[]; operativita?: any; operativitaTried?: { name: string; verdict: string }[]; detected: { type: string | null; keywords: string[] } }>
      }>('polizzaPrecheckService.js')
      const opDiag: string[] = []
      const pre = await pcSvc.runPrecheck({
        // FILTRO ed ESTRAZIONE SEPARATI: il filtro parole chiave vede il TESTO
        // PIATTO (docsFlat), l'estrazione il markdown Docling (docsForIndex).
        // Il markdown inizia con "<!-- image -->" e metadati → il classificatore
        // rispondeva "image" e bloccava tutto.
        docs: docsFlat,
        spatialDocs,
        fieldDefs: job.field_defs || [], profile,
        profileName: job.profile_name || profile?.name || '',
        mode: precheckMode,
        settings,
        // Il verdetto semantico è un CONFRONTO tra tutti i profili salvati.
        allProfiles: activeProfiles,
        // Operatività già calcolata dal profilo Automatico: nessuna seconda chiamata,
        // e i profili già provati non si riprovano per il suggerimento.
        operativita: autoOperativita && autoOperativita.profileId === profile?.id ? autoOperativita : null,
        operativitaTried: autoTried.filter((t) => t.id !== profile?.id),
        diag: opDiag,
      })
      for (const line of opDiag) await appendLog(job, line, logs)
      // Annullato mentre il controllo girava: nessuno stato sovrascrive 'canceled'.
      if (await isCanceled(job.id)) return
      const detStr = [pre.detected?.type, (pre.detected?.keywords || []).join(', ')].filter(Boolean).join(' — ')
      const kwsStr = pre.matched?.length ? ` · parole chiave trovate: ${pre.matched.join(', ')}` : ''
      // MOTIVAZIONE SEMPRE, anche quando il fascicolo è accettato: il perché
      // (prova citata, parole trovate, classifica dei profili) resta nel job
      // (precheck.summary), nella pagina Elaborazioni e nell'export, così un
      // falso positivo si vede e si corregge. Niente «punteggio»: i numeri
      // della classifica (affinità, non correttezza) restano nel log.
      const rankNames = (pre.ranking || []).filter((r) => typeof r.score === 'number').slice(0, 3).map((r) => r.name).join(' > ')
      const rankNums = (pre.ranking || []).filter((r) => typeof r.score === 'number').slice(0, 3).map((r) => `${r.name} ${(r.score as number).toFixed(2)}`).join(' · ')
      const op = pre.operativita
      const proof = op?.evidenza ? ` · Documento ${op.documento ?? '?'}${op.pagina ? ` pag. ${op.pagina}` : ''}: «${String(op.evidenza).slice(0, 200)}»` : ''
      const sugg = pre.suggestion ? ` · profilo suggerito: «${pre.suggestion.name}»${pre.suggestion.signal === 'operatività' ? ' (copertura operante con prova)' : ''}` : ''
      const triedStr = pre.operativitaTried?.length ? ` · altri profili provati: ${pre.operativitaTried.map((x) => `${x.name} ${x.verdict === 'ok' ? 'operante' : x.verdict === 'mismatch' ? 'non operante' : 'dubbio'}`).join(', ')}` : ''
      const verdictIt = pre.verdict === 'ok' ? 'abbinato' : pre.verdict === 'mismatch' ? 'non pertinente' : pre.verdict === 'review' ? 'da verificare' : 'accettato senza controllo'
      const summary = pre.mode === 'operativita'
        ? `Pertinenza [operatività]: ${verdictIt} — ${pre.reason}${proof}${sugg}${triedStr}${rankNames ? ` · classifica profili: ${rankNames}` : ''}`
        : `Pertinenza [${pre.mode}]: ${verdictIt} — ${pre.reason}${kwsStr}${detStr ? ` · rilevato: ${detStr}` : ''}${sugg}${rankNames ? ` · classifica profili: ${rankNames}` : ''}`
      await updateJob(job.id, { precheck: { ...precheckBase, ...pre, summary, at: Math.floor(Date.now() / 1000) } })
      await appendLog(job, summary + (rankNums ? ` · affinità: ${rankNums}` : ''), logs)
      if (pre.verdict === 'review') {
        // DA VERIFICARE: nessun campo estratto. L'utente sblocca con "Procedi
        // comunque" (estrae lo stesso) o "Riabbina" con un altro profilo.
        const suggTxt = pre.suggestion ? ` Profilo suggerito: «${pre.suggestion.name}».` : ''
        await updateJob(job.id, {
          status: 'review', progress: {},
          error: `Da verificare — ${pre.reason}.${proof ? ` Prova: ${proof.slice(3)}.` : ''}${suggTxt} Documenti letti: ${docNames}. Premi "Procedi comunque" per estrarre lo stesso o "Riabbina" con un altro profilo.`,
        })
        return
      }
      if (pre.verdict === 'mismatch') {
        // Il PERCHÉ, sempre: quali documenti c'erano, cosa manca o quali parole
        // mancano, e — se esiste — il profilo attivo più affine da usare.
        const suggTxt = pre.suggestion ? ` Profilo suggerito: «${pre.suggestion.name}»${pre.suggestion.signal === 'operatività' ? ' (copertura operante con prova)' : ''}.` : ''
        const missingKw = pre.missing?.length ? ` Parole del profilo non trovate: ${pre.missing.slice(0, 6).join(', ')}.` : ''
        const scarto = pre.excludeMatched?.length && pre.mode !== 'operativita'
          ? `Scartato — ${pre.reason}. Documenti letti: ${docNames}.`
          : pre.setAside
            ? `Accantonato — ${pre.reason}. Documenti letti: ${docNames}.${suggTxt} Se la polizza c'è ma non è stata riconosciuta, premi "Procedi comunque".`
            : `Non pertinente al profilo "${job.profile_name || job.profile_id}" — ${pre.reason}.${proof ? ` Prova: ${proof.slice(3)}.` : ''}${missingKw}${detStr && pre.mode !== 'operativita' ? ` Rilevato nel testo: ${detStr}.` : ''}${suggTxt} Documenti letti: ${docNames}. Cambia profilo o premi "Procedi comunque".`
        await updateJob(job.id, {
          status: 'mismatch', progress: {},
          error: scarto,
        })
        return // stesso stop pulito del probe OCR: il batch prosegue coi dossier successivi
      }
      if (matchOnly) {
        // SOLO ABBINAMENTO riuscito: qui ci si ferma, l'estrazione aspetta il ▶.
        await updateJob(job.id, { status: 'matched', progress: {}, error: null })
        await appendLog(job, `Abbinato: estrazione in attesa del ▶ (solo abbinamento)`, logs)
        return
      }
    } catch (err: any) {
      if (matchOnly) {
        // Solo abbinamento: un guasto del controllo NON può diventare un'estrazione
        // silenziosa. Il dossier si ferma in «Da verificare» con l'errore.
        const summary = `Pertinenza: controllo non eseguibile (${err.message})`
        await updateJob(job.id, { status: 'review', progress: {}, error: `Da verificare — ${summary}. Documenti letti: ${docNames}. Premi "Riabbina" per riprovare o "Procedi comunque" per estrarre lo stesso.`, precheck: { ...precheckBase, verdict: 'review', mode: precheckMode, reason: summary, summary, at: Math.floor(Date.now() / 1000) } })
        await appendLog(job, summary, logs)
        return
      }
      await appendLog(job, `Pre-check pertinenza non eseguibile (${err.message}) — si procede con l'estrazione`, logs)
    }
  } else if (matchOnly && !precheckBase.override && !precheckBase.confirmed) {
    // Solo abbinamento senza controllo possibile (nessun profilo o pre-check
    // spento): nulla da verificare, ma non si estrae senza il ▶.
    const summary = `Pertinenza: abbinamento senza controllo (${!profile ? 'nessun profilo sul job' : 'pre-controllo spento'})`
    await updateJob(job.id, { status: 'matched', progress: {}, error: null, precheck: { ...precheckBase, verdict: 'skipped', mode: precheckMode, summary, at: Math.floor(Date.now() / 1000) } })
    await appendLog(job, summary, logs)
    return
  }
  } finally {
    clearInterval(preCancelPoll)
    if (settings.__cancelFlag === preCancel) delete settings.__cancelFlag
  }
  if (await isCanceled(job.id)) return

  // polizza_numero estratto: finisce nei metadati dell'indice vettoriale (chiave di
  // business per ritrovare la stessa polizza attraverso caricamenti diversi).
  let extractedData: Record<string, string> = {}
  try {
    // Progresso nel job (fire-and-forget): "campo b/x" (motore per-campo) o
    // "batch b/x" (fascicolo intero).
    const onProgress = (p: { batch?: number; batchTotal?: number; field?: number; fieldTotal?: number }) => {
      const cur = p.field ?? p.batch ?? 0, tot = p.fieldTotal ?? p.batchTotal ?? 0
      const label = p.field != null ? `Campo ${cur}/${tot}` : `Analisi AI · batch ${cur}/${tot}`
      void updateJob(job.id, {
        progress: { docIndex: cur - 1, docTotal: tot, pageIndex: 0, pageTotal: 0, docName: label, receivedAt: Date.now() },
      }).catch(() => {})
    }
    // Dispatcher: con Ollama + motore per-campo attivo usa il RAG per-campo
    // (indice in memoria), altrimenti la chiamata unica/batch storica.
    // Propagazione dell'ANNULLA fino a Ollama: un poller marca il flag e lo
    // stream del motore CHIUDE la connessione → il server cancella la
    // generazione all'istante (senza, il runner restava occupato per minuti e
    // perfino 'ollama stop' rimaneva appeso su "Stopping…").
    const cancelFlag = { canceled: false }
    settings.__cancelFlag = cancelFlag
    const cancelPoll = setInterval(() => {
      isCanceled(job.id).then((c) => { if (c) cancelFlag.canceled = true }).catch(() => {})
    }, 3000)
    let extractResult
    try {
      extractResult = await m.extractPolizzaFromDocs(docsForIndex, fullText, settings, onProgress)
    } finally {
      clearInterval(cancelPoll)
    }
    const { data, sources, diag, reliability } = extractResult
    extractedData = data || {}
    // Diagnostica della chiamata LLM (modello, num_ctx, token letti, risposta grezza
    // se 0 campi): nel log del job, come su desktop.
    for (const line of diag || []) await appendLog(job, line, logs)
    const n = Object.keys(data || {}).length
    // Converte il risultato piatto in stato rolling per lo snapshot (flatten lo riappiattisce).
    const state: Record<string, any> = {}
    for (const [k, v] of Object.entries(data || {})) if (v != null && v !== '') state[k] = { valore: v, fonte: (sources as any)?.[k] }
    // Affidabilità (credenza) per campo, quando prodotta dal motore a stadi:
    // salvata in un marker _reliability della rolling_state. Gli helper di
    // flatten/buildSources la saltano perché non è una entry con `valore`/`fonte`,
    // e jobSnapshot la espone come `basReliability` senza toccare i valori.
    if (reliability && typeof reliability === 'object' && Object.keys(reliability).length) {
      state._reliability = reliability
    }
    await updateJob(job.id, { rolling_state: state, sources: sources || {}, progress: {} })
    if (n === 0) {
      const hint = (diag || []).find((l) => l.startsWith('ATTENZIONE'))
        || (diag || []).find((l) => l.startsWith('Nessun campo valido'))
        || (diag || []).find((l) => l.startsWith('Analisi risposta'))
      await updateJob(job.id, {
        status: 'error',
        error: 'Il modello ha risposto ma senza campi utilizzabili.'
          + (hint ? ` ${hint}` : '')
          + ' Suggerimento: i modelli locali piccoli (1B-3B) faticano sui fascicoli grandi — usa llama3.1:8b o superiore. Dettagli nel log del job.',
      })
    } else { await appendLog(job, `Fascicolo intero: estratti ${n} campi`, logs); await updateJob(job.id, { status: 'done' }) }
  } catch (err: any) {
    for (const line of ((err?.diag as string[]) || [])) await appendLog(job, line, logs)
    await updateJob(job.id, { status: 'error', error: err.message || 'Estrazione fascicolo fallita' })
  }

  // Indicizzazione vettoriale (Qdrant): ADDITIVA e mai fatale — l'estrazione è già
  // conclusa; un errore qui va solo a log. Attiva solo con qdrantUrl configurato.
  try {
    const vec = await importSharedService<{
      isVectorIndexEnabled: (s: any) => boolean
      indexDossierPages: (args: any, s: any, log?: (m: string) => void) => Promise<{ chunks: number; collection: string }>
    }>('vectorIndexService.js')
    if (job.source_job_id) {
      // Run di TEST: l'indice vettoriale NON si tocca — N run sperimentali
      // sullo stesso fascicolo inquinerebbero la ricerca con chunk duplicati.
      await appendLog(job, 'Indice vettoriale: SALTATO (run di test)', logs)
    } else if (vec.isVectorIndexEnabled(settings)) {
      await appendLog(job, 'Indice vettoriale: indicizzazione in corso…', logs)
      // scopeId = job.id: l'identità dei punti è il JOB, non il nome cartella.
      // Due fascicoli con cartelle/nomi file uguali non si sovrascrivono mai, e la
      // ricerca "nella polizza X" filtra per job_id, ermetica per costruzione.
      // All'indice vanno le pagine COLLASSATE (stessa derivazione di
      // collapseSpatial in ocrLayout.js): il padding della griglia spaziale
      // gonfierebbe i chunk (1200 char fissi) diluendo gli embeddings.
      const collapse = (p: string) => p.split('\n').map((l) => l.replace(/\s{2,}/g, ' ').trim()).join('\n')
      const { chunks, collection } = await vec.indexDossierPages(
        {
          dossierName: job.dossier_name || job.id,
          files: docsForIndex.map((f) => ({ ...f, pages: f.pages.map(collapse) })),
          scopeId: job.id,
          extraPayload: {
            job_id: job.id,
            ...(job.batch_id ? { batch_id: job.batch_id } : {}),
            ...(extractedData.polizza_numero ? { polizza_numero: String(extractedData.polizza_numero) } : {}),
          },
        },
        settings
      )
      await appendLog(job, `Indice vettoriale: ${chunks} chunk salvati nella collezione "${collection}" (scope job ${job.id.slice(0, 8)}…${extractedData.polizza_numero ? `, polizza ${extractedData.polizza_numero}` : ''})`, logs)
    }
  } catch (err: any) {
    await appendLog(job, `Indice vettoriale NON aggiornato (non fatale): ${err.message}`, logs)
  }
}
