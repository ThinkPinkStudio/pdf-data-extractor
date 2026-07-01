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
import {
  getJob, getJobFiles, getJobStatus, updateJob, type JobRow,
} from './polizzaJobStore'

interface PolizzaSvc {
  updateStateWithVisionPage: (state: any, imageBase64: string, pageNum: number, totalPages: number, settings: any, source: any) => Promise<any>
  ocrPageText: (imageBase64: string, settings: any) => Promise<string>
  extractPolizzaFromFullText: (fullText: string, settings: any) => Promise<{ data: Record<string, string>; sources: Record<string, { file: string; page: number }> }>
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
  // Fire-and-forget: non blocca la response della route.
  void runJob(jobId).catch(async (e) => {
    try { await updateJob(jobId, { status: 'error', error: String(e?.message || e) }) } catch { /* noop */ }
  }).finally(() => running.delete(jobId))
}

async function runJob(jobId: string): Promise<void> {
  const job = await getJob(jobId)
  if (!job) return
  if (job.status === 'done' || job.status === 'canceled' || job.status === 'error') return

  const settings = await getSettings()
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
async function runWholeDossier(job: JobRow, files: { file_name: string; pdf_base64: string }[], settings: any, logs: string[]) {
  const m = await svc()

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
    const buf = Buffer.from(files[d].pdf_base64, 'base64')
    let doc
    try { doc = await loadPdfServer(buf) } catch (err: any) { await appendLog(job, `SKIP "${docName}": ${err.message}`, logs); continue }
    const totalPages = doc.numPages
    let docText = ''
    try {
      for (let p = 1; p <= totalPages; p++) {
        if (await isCanceled(job.id)) return
        totalPagesProcessed++
        await updateJob(job.id, { progress: { docIndex: d, docTotal: files.length, pageIndex: p, pageTotal: totalPages, docName, totalPagesProcessed, receivedAt: Date.now() } })
        let png: string
        try { png = await doc.renderPage(p) } catch (err: any) { await appendLog(job, `SKIP pagina ${p} di "${docName}": ${err.message}`, logs); continue }
        try {
          const text = await m.ocrPageText(png, settings)
          if (text) { docText += '\n' + text; pagesWithText++ }
        } catch (err: any) { await appendLog(job, `OCR pagina ${p} di "${docName}": ${err.message}`, logs) }
      }
    } finally {
      await doc.destroy()
    }
    parts.push(`\n===== DOCUMENTO: ${docName} =====\n${docText.trim()}`)
  }

  const fullText = parts.join('\n')
  if (pagesWithText === 0 || fullText.trim().length < 50) {
    await updateJob(job.id, { status: 'error', error: "L'OCR non ha prodotto testo leggibile (0 pagine utili)." })
    return
  }

  try {
    const { data, sources } = await m.extractPolizzaFromFullText(fullText, settings)
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
