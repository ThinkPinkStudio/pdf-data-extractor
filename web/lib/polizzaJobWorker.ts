/* eslint-disable @typescript-eslint/no-explicit-any */
// Worker in-process per i job di estrazione polizza. Gira nel processo Node del
// server Next standalone: avviato (fire-and-forget) dalla route POST /api/polizza/job,
// continua anche se il client chiude la tab. Persiste stato/progresso su Postgres
// dopo OGNI pagina, così è recuperabile alla riapertura e riprendibile dopo un
// restart del container (resumer in instrumentation.ts).

import { getSettings } from './settingsStore'
import { importSharedService } from './sharedServices'
import { loadPdfServer } from './pdfRenderServer'
import { buildSources, initRollingState } from './polizzaRolling'
import { detectProfile } from './profileDetection'
import {
  getJob, getJobFiles, getJobStatus, updateJob, type JobRow,
} from './polizzaJobStore'

interface PolizzaSvc {
  updateStateWithVisionPage: (state: any, imageBase64: string, pageNum: number, totalPages: number, settings: any, source: any, opts?: { fields?: any[]; precomputedOcr?: string }) => Promise<any>
  ocrPageText: (imageBase64: string, settings: any) => Promise<string>
  extractPolizzaFromFullText: (fullText: string, settings: any, opts?: { fields?: any[] }) => Promise<{ data: Record<string, string>; sources: Record<string, { file: string; page: number }> }>
  probeOcr: (settings: any) => Promise<{ available: boolean; reason?: string }>
}
const svc = () => importSharedService<PolizzaSvc>('polizzaService.js')

type JobFile = { file_name: string; pdf_base64: string; rel_path?: string | null; document_id?: string | null }

// Persistenza del testo nel corpus: sempre best-effort, un errore qui non deve
// mai interrompere l'estrazione.
async function corpus() {
  return import('./corpusStore')
}

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
  // Fire-and-forget: non blocca la response della route.
  void runJob(jobId).catch(async (e) => {
    try { await updateJob(jobId, { status: 'error', error: String(e?.message || e) }) } catch { /* noop */ }
  }).finally(() => running.delete(jobId))
}

// Variante awaitable di startJob, usata dall'orchestratore batch per elaborare i
// job figli in sequenza (attende il completamento di uno prima di avviare il
// successivo). Se il job è già in esecuzione altrove nello stesso processo, attende
// che finisca invece di duplicarne l'esecuzione.
export async function runJobAndWait(jobId: string): Promise<void> {
  if (running.has(jobId)) {
    while (running.has(jobId)) await new Promise((r) => setTimeout(r, 500))
    return
  }
  running.add(jobId)
  try {
    await runJob(jobId)
  } catch (e: any) {
    try { await updateJob(jobId, { status: 'error', error: String(e?.message || e) }) } catch { /* noop */ }
  } finally {
    running.delete(jobId)
  }
}

async function runJob(jobId: string): Promise<void> {
  let job = await getJob(jobId)
  if (!job) return
  if (job.status === 'done' || job.status === 'canceled' || job.status === 'error') return

  const settings = await getSettings()
  const files = await getJobFiles(jobId)
  const logs = Array.isArray(job.logs) ? [...job.logs] : []
  await updateJob(jobId, { status: 'running' })

  // Rilevamento profilo: solo alla prima esecuzione (nessuna pagina elaborata,
  // nessun candidato già salvato) e mai dopo un override esplicito dell'utente.
  job = await maybeDetectProfile(job, files, settings, logs)

  // Ri-estrazione richiesta dall'utente con testo già nel corpus: niente
  // render/OCR, una sola chiamata LLM sul testo persistito (secondi, non minuti).
  if (job.rerun_from_text) {
    await updateJob(jobId, { rerun_from_text: false }) // istruzione one-shot
    const done = await runFromStoredText(job, files, settings, logs)
    if (done) return
    await appendLog(job, 'Testo persistito insufficiente: ri-estrazione completa dai PDF', logs)
  }

  if (job.whole_dossier) {
    await runWholeDossier(job, files, settings, logs)
  } else {
    await runVisionRolling(job, files, settings, logs)
  }
}

// ─── Pre-fase: rilevamento del profilo di estrazione ─────────────────────────
// Sceglie SOLO tra i profili salvati dall'utente (mai inventare campi). Se il
// profilo vincente esiste, sostituisce i field_defs del job PRIMA che inizi
// l'estrazione; altrimenti il ramo rilevato resta come informazione a video.
async function maybeDetectProfile(job: JobRow, files: JobFile[], settings: any, logs: string[]): Promise<JobRow> {
  try {
    if (job.profile_locked) return job
    if (Array.isArray(job.profile_candidates) && job.profile_candidates.length > 0) return job
    const cursor = job.cursor || {}
    if ((cursor.totalPagesProcessed ?? 0) > 0) return job // job già a metà: non toccare i campi
    const savedProfiles = Array.isArray(settings.polizzaProfiles) ? settings.polizzaProfiles : []

    // Ramo dal percorso: il più frequente tra i documenti collegati al job.
    const c = await corpus()
    let ramoFromPath: string | null = null
    try {
      const docs = await c.getJobDocuments(job.id)
      const counts = new Map<string, number>()
      for (const d of docs) if (d.ramo) counts.set(d.ramo, (counts.get(d.ramo) || 0) + 1)
      ramoFromPath = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    } catch { /* solo segnale LLM */ }

    if (!ramoFromPath && savedProfiles.length === 0) return job

    // Testo campione: prime 2 pagine del primo file (persistite nel corpus,
    // quindi lavoro comunque non sprecato). Solo se serve al classificatore LLM.
    let sampleText = ''
    if (savedProfiles.length > 0 && settings.polizzaOcrEnabled !== false && files.length > 0) {
      try {
        const m = await svc()
        const f = files[0]
        const documentId = f.document_id || null
        const doc = await loadPdfServer(Buffer.from(f.pdf_base64, 'base64'))
        try {
          const pages = Math.min(2, doc.numPages)
          for (let p = 1; p <= pages; p++) {
            let text: string | null = documentId ? await c.getStoredPageText(documentId, p) : null
            if (text == null) {
              const png = await doc.renderPage(p)
              text = await m.ocrPageText(png, settings)
              if (documentId && typeof text === 'string') { try { await c.savePageText(documentId, p, text, 'tesseract') } catch { /* best-effort */ } }
            }
            if (text) sampleText += '\n' + text
          }
        } finally {
          await doc.destroy()
        }
      } catch { /* il classificatore userà solo il segnale path */ }
    }

    const candidates = await detectProfile({ ramoFromPath, sampleText, savedProfiles, settings })
    if (candidates.length === 0) return job

    const winner = candidates.find((x) => x.profileId) || null
    const patch: Record<string, unknown> = { profile_candidates: candidates }

    if (winner?.profileId) {
      const profile = savedProfiles.find((p: any) => p.id === winner.profileId)
      const profileFields = (profile?.fields || []).filter((f: any) => f.enabled !== false)
      if (profile && profileFields.length > 0) {
        const fieldDefs = profileFields.map((f: any) => ({ id: f.id, label: f.label, description: f.description, sheet: f.sheet }))
        patch.profile_id = profile.id
        patch.field_defs = fieldDefs
        patch.rolling_state = initRollingState(fieldDefs)
        await appendLog(job, `Profilo rilevato: "${profile.name}" (${Math.round(winner.confidence * 100)}%, ${winner.source === 'path' ? 'dal percorso' : 'dal contenuto'}) — campi del profilo applicati`, logs)
      }
    } else if (ramoFromPath) {
      await appendLog(job, `Ramo rilevato: "${ramoFromPath}" — nessun profilo salvato corrispondente, estrazione con i campi correnti`, logs)
    }

    await updateJob(job.id, patch)
    const updated = await getJob(job.id)
    return updated ?? job
  } catch {
    return job // il rilevamento non deve mai bloccare l'estrazione
  }
}

// ─── Ri-estrazione dal testo persistito (fast path del rerun) ────────────────
async function runFromStoredText(job: JobRow, files: JobFile[], settings: any, logs: string[]): Promise<boolean> {
  const m = await svc()
  const c = await corpus()
  const parts: string[] = []
  let pagesWithText = 0
  for (const f of files) {
    if (!f.document_id) continue
    try {
      const pages = await c.getDocumentPages(f.document_id)
      const docText = pages.map((p) => p.text).filter(Boolean).join('\n')
      if (docText.trim()) pagesWithText += pages.length
      parts.push(`\n===== DOCUMENTO: ${f.file_name} =====\n${docText.trim()}`)
    } catch { /* documento senza testo: si valuta sotto */ }
  }
  const fullText = parts.join('\n')
  if (pagesWithText === 0 || fullText.trim().length < 50) return false

  await appendLog(job, 'Ri-estrazione dal testo già acquisito (nessun nuovo OCR)', logs)
  try {
    const { data, sources } = await m.extractPolizzaFromFullText(fullText, settings, { fields: job.field_defs })
    const n = Object.keys(data || {}).length
    const state: Record<string, any> = {}
    for (const [k, v] of Object.entries(data || {})) if (v != null && v !== '') state[k] = { valore: v, fonte: (sources as any)?.[k] }
    await updateJob(job.id, { rolling_state: state, sources: sources || {}, progress: {} })
    if (n === 0) await updateJob(job.id, { status: 'error', error: 'Il modello non ha estratto alcun campo dal testo persistito.' })
    else { await appendLog(job, `Ri-estrazione completata: ${n} campi`, logs); await updateJob(job.id, { status: 'done' }) }
  } catch (err: any) {
    await updateJob(job.id, { status: 'error', error: err.message || 'Ri-estrazione fallita' })
  }
  return true
}

async function isCanceled(id: string): Promise<boolean> {
  return (await getJobStatus(id)) === 'canceled'
}

// ─── Modalità normale: vision rolling pagina per pagina ──────────────────────
async function runVisionRolling(job: JobRow, files: JobFile[], settings: any, logs: string[]) {
  const m = await svc()
  const c = await corpus()
  let state = job.rolling_state || {}
  const cursor = job.cursor || {}
  const startDoc = cursor.docIndex ?? 0
  const startPageDone = cursor.pageIndex ?? 0 // ultima pagina completata nel doc startDoc
  let totalPagesProcessed = cursor.totalPagesProcessed ?? 0
  let consecutiveFailures = 0
  const ocrEnabled = settings.polizzaOcrEnabled !== false

  await appendLog(job, `OCR visivo: ripresa da doc ${startDoc + 1}, pagina ${startPageDone + 1}`, logs)

  for (let d = startDoc; d < files.length; d++) {
    if (await isCanceled(job.id)) return
    const docName = files[d].file_name
    const documentId = files[d].document_id || null
    const buf = Buffer.from(files[d].pdf_base64, 'base64')
    let doc
    try {
      doc = await loadPdfServer(buf)
    } catch (err: any) {
      await appendLog(job, `SKIP "${docName}": apertura PDF fallita (${err.message})`, logs)
      continue
    }
    const totalPages = doc.numPages
    if (documentId) { try { await c.setDocumentNumPages(documentId, totalPages) } catch { /* best-effort */ } }
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

        // L'OCR (che il servizio farebbe comunque internamente) viene calcolato
        // qui per essere ANCHE persistito nel corpus; alla ripresa di un job le
        // pagine già salvate non vengono ri-OCRizzate.
        let ocrText: string | undefined
        if (ocrEnabled) {
          try {
            const stored = documentId ? await c.getStoredPageText(documentId, p) : null
            if (stored != null) {
              ocrText = stored
            } else {
              ocrText = await m.ocrPageText(png, settings)
              if (documentId && typeof ocrText === 'string') await c.savePageText(documentId, p, ocrText, 'tesseract')
            }
          } catch { ocrText = undefined /* il servizio riproverà internamente */ }
        }

        try {
          state = await m.updateStateWithVisionPage(state, png, p, totalPages, settings, { file: docName, page: p },
            { fields: job.field_defs, precomputedOcr: ocrText })
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
    // Documento completato: ricostruisce i chunk per la ricerca (in modalità
    // solo-immagine non c'è testo da indicizzare, lo stato resta pending/partial).
    if (documentId && ocrEnabled) {
      try { await c.finalizeDocumentText(documentId) } catch { /* best-effort */ }
    }
  }

  await appendLog(job, `OCR visivo completato (${totalPagesProcessed} pagine)`, logs)
  await updateJob(job.id, { status: 'done', progress: {} })
}

// ─── Modalità fascicolo intero: OCR di tutte le pagine → 1 chiamata ──────────
async function runWholeDossier(job: JobRow, files: JobFile[], settings: any, logs: string[]) {
  const m = await svc()
  const c = await corpus()

  let ocr = { available: true } as { available: boolean; reason?: string }
  try { ocr = await m.probeOcr(settings) } catch (e: any) { ocr = { available: false, reason: e.message } }
  if (!ocr.available) {
    await updateJob(job.id, { status: 'error', error: `OCR non disponibile (${ocr.reason || 'motivo sconosciuto'}). La modalità "fascicolo intero" richiede Tesseract.` })
    return
  }

  const parts: string[] = []
  let totalPagesProcessed = 0
  let pagesWithText = 0
  for (let d = 0; d < files.length; d++) {
    if (await isCanceled(job.id)) return
    const docName = files[d].file_name
    const documentId = files[d].document_id || null
    const buf = Buffer.from(files[d].pdf_base64, 'base64')
    let doc
    try { doc = await loadPdfServer(buf) } catch (err: any) { await appendLog(job, `SKIP "${docName}": ${err.message}`, logs); continue }
    const totalPages = doc.numPages
    if (documentId) { try { await c.setDocumentNumPages(documentId, totalPages) } catch { /* best-effort */ } }
    let docText = ''
    try {
      for (let p = 1; p <= totalPages; p++) {
        if (await isCanceled(job.id)) return
        totalPagesProcessed++
        await updateJob(job.id, { progress: { docIndex: d, docTotal: files.length, pageIndex: p, pageTotal: totalPages, docName, totalPagesProcessed, receivedAt: Date.now() } })
        // Pagina già nel corpus (stesso file già elaborato o job ripreso):
        // riusa il testo e salta render + OCR.
        let text: string | null = null
        if (documentId) { try { text = await c.getStoredPageText(documentId, p) } catch { text = null } }
        if (text == null) {
          let png: string
          try { png = await doc.renderPage(p) } catch (err: any) { await appendLog(job, `SKIP pagina ${p} di "${docName}": ${err.message}`, logs); continue }
          try {
            text = await m.ocrPageText(png, settings)
            if (documentId && typeof text === 'string') { try { await c.savePageText(documentId, p, text, 'tesseract') } catch { /* best-effort */ } }
          } catch (err: any) { await appendLog(job, `OCR pagina ${p} di "${docName}": ${err.message}`, logs); continue }
        }
        if (text) { docText += '\n' + text; pagesWithText++ }
      }
    } finally {
      await doc.destroy()
    }
    parts.push(`\n===== DOCUMENTO: ${docName} =====\n${docText.trim()}`)
    if (documentId) { try { await c.finalizeDocumentText(documentId) } catch { /* best-effort */ } }
  }

  const fullText = parts.join('\n')
  if (pagesWithText === 0 || fullText.trim().length < 50) {
    await updateJob(job.id, { status: 'error', error: "L'OCR non ha prodotto testo leggibile (0 pagine utili)." })
    return
  }

  try {
    const { data, sources } = await m.extractPolizzaFromFullText(fullText, settings, { fields: job.field_defs })
    const n = Object.keys(data || {}).length
    // Converte il risultato piatto in stato rolling per lo snapshot (flatten lo riappiattisce).
    const state: Record<string, any> = {}
    for (const [k, v] of Object.entries(data || {})) if (v != null && v !== '') state[k] = { valore: v, fonte: (sources as any)?.[k] }
    await updateJob(job.id, { rolling_state: state, sources: sources || {}, progress: {} })
    if (n === 0) await updateJob(job.id, { status: 'error', error: 'Il modello non ha estratto alcun campo dal testo OCR.' })
    else { await appendLog(job, `Fascicolo intero: estratti ${n} campi`, logs); await updateJob(job.id, { status: 'done' }) }
  } catch (err: any) {
    await updateJob(job.id, { status: 'error', error: err.message || 'Estrazione fascicolo fallita' })
  }
}
