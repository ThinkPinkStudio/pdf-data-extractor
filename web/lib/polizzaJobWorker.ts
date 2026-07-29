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
  getJob, getJobFiles, getJobStatus, updateJob, getOcrCache, putOcrCache, hashPdfBase64, type JobRow,
} from './polizzaJobStore'

interface PolizzaSvc {
  updateStateWithVisionPage: (state: any, imageBase64: string, pageNum: number, totalPages: number, settings: any, source: any) => Promise<any>
  ocrPageText: (imageBase64: string, settings: any) => Promise<string>
  extractPolizzaFromFullText: (fullText: string, settings: any, onProgress?: (p: { batch: number; batchTotal: number }) => void) => Promise<{ data: Record<string, string>; sources: Record<string, { file: string; page: number }>; diag?: string[] }>
  extractPolizzaFromDocs: (docs: { name: string; pages: string[] }[], fullText: string, settings: any, onProgress?: (p: { batch?: number; batchTotal?: number; field?: number; fieldTotal?: number }) => void) => Promise<{ data: Record<string, string>; sources: Record<string, { file: string; page: number }>; diag?: string[] }>
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
  if (job.status === 'done' || job.status === 'canceled' || job.status === 'error') return

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
  const files = await getJobFiles(jobId)
  const logs = Array.isArray(job.logs) ? [...job.logs] : []
  await updateJob(jobId, { status: 'running' })

  if (job.whole_dossier) {
    await runWholeDossier(job, files, settings, logs)
  } else {
    await runVisionRolling(job, files, settings, logs)
  }
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
  const docsForIndex: { name: string; pages: string[]; hash?: string }[] = []
  let totalPagesProcessed = 0
  let pagesWithText = 0
  let ocrCacheHits = 0
  for (let d = 0; d < files.length; d++) {
    if (await isCanceled(job.id)) return
    const docName = files[d].file_name
    // Identità del contenuto: dalle righe migrate arriva già dal DB; per i job
    // precedenti alla migrazione si calcola al volo (stesso SHA-256).
    const fileHash = files[d].file_hash || hashPdfBase64(files[d].pdf_base64)

    // Cache OCR: lo stesso identico PDF (doppioni tra cartelle, fascicoli
    // ricaricati, retry) riusa i testi pagina senza rifare render+tesseract.
    let cachedPages: string[] | null = null
    try { cachedPages = await getOcrCache(fileHash) } catch { /* cache mai bloccante */ }
    if (cachedPages && cachedPages.length) {
      const docText = cachedPages.filter(Boolean).join('\n')
      totalPagesProcessed += cachedPages.length
      pagesWithText += cachedPages.filter((t) => t && t.trim()).length
      ocrCacheHits++
      await appendLog(job, `OCR riusato dalla CACHE per "${docName}" (${cachedPages.length} pagine, contenuto già visto)`, logs)
      await updateJob(job.id, { progress: { docIndex: d, docTotal: files.length, pageIndex: cachedPages.length, pageTotal: cachedPages.length, docName, totalPagesProcessed, receivedAt: Date.now() } })
      parts.push(`\n===== DOCUMENTO: ${docName} =====\n${docText.trim()}`)
      docsForIndex.push({ name: docName, pages: cachedPages, hash: fileHash })
      continue
    }

    const buf = Buffer.from(files[d].pdf_base64, 'base64')
    let doc
    try { doc = await loadPdfServer(buf) } catch (err: any) { await appendLog(job, `SKIP "${docName}": ${err.message}`, logs); continue }
    const totalPages = doc.numPages
    let docText = ''
    const docPages: string[] = []
    try {
      for (let p = 1; p <= totalPages; p++) {
        if (await isCanceled(job.id)) return
        totalPagesProcessed++
        await updateJob(job.id, { progress: { docIndex: d, docTotal: files.length, pageIndex: p, pageTotal: totalPages, docName, totalPagesProcessed, receivedAt: Date.now() } })
        let png: string
        try { png = await doc.renderPage(p) } catch (err: any) { await appendLog(job, `SKIP pagina ${p} di "${docName}": ${err.message}`, logs); docPages.push(''); continue }
        try {
          const text = await m.ocrPageText(png, settings)
          docPages.push(text || '')
          if (text) { docText += '\n' + text; pagesWithText++ }
        } catch (err: any) { await appendLog(job, `OCR pagina ${p} di "${docName}": ${err.message}`, logs); docPages.push('') }
      }
    } finally {
      await doc.destroy()
    }
    // In cache solo se il documento ha prodotto ALMENO una pagina di testo: un
    // fallimento transitorio (render/OCR) non deve restare congelato per sempre.
    if (docPages.some((t) => t && t.trim())) {
      try { await putOcrCache(fileHash, docName, docPages) } catch { /* non fatale */ }
    }
    parts.push(`\n===== DOCUMENTO: ${docName} =====\n${docText.trim()}`)
    docsForIndex.push({ name: docName, pages: docPages, hash: fileHash })
  }
  if (ocrCacheHits) await appendLog(job, `Cache OCR: ${ocrCacheHits}/${files.length} documenti riusati (contenuto identico già elaborato)`, logs)

  const fullText = parts.join('\n')
  if (pagesWithText === 0 || fullText.trim().length < 50) {
    await updateJob(job.id, { status: 'error', error: "L'OCR non ha prodotto testo leggibile (0 pagine utili)." })
    return
  }

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
    const { data, sources, diag } = await m.extractPolizzaFromDocs(docsForIndex, fullText, settings, onProgress)
    extractedData = data || {}
    // Diagnostica della chiamata LLM (modello, num_ctx, token letti, risposta grezza
    // se 0 campi): nel log del job, come su desktop.
    for (const line of diag || []) await appendLog(job, line, logs)
    const n = Object.keys(data || {}).length
    // Converte il risultato piatto in stato rolling per lo snapshot (flatten lo riappiattisce).
    const state: Record<string, any> = {}
    for (const [k, v] of Object.entries(data || {})) if (v != null && v !== '') state[k] = { valore: v, fonte: (sources as any)?.[k] }
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
    if (vec.isVectorIndexEnabled(settings)) {
      await appendLog(job, 'Indice vettoriale: indicizzazione in corso…', logs)
      // scopeId = job.id: l'identità dei punti è il JOB, non il nome cartella.
      // Due fascicoli con cartelle/nomi file uguali non si sovrascrivono mai, e la
      // ricerca "nella polizza X" filtra per job_id, ermetica per costruzione.
      const { chunks, collection } = await vec.indexDossierPages(
        {
          dossierName: job.dossier_name || job.id,
          files: docsForIndex,
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
