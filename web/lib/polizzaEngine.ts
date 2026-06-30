import { readFile } from 'fs/promises'
import { basename } from 'path'
import { renderPdfPages } from './pdfRaster'
import { buildAlgoSettings, type AlgoSettings } from './polizzaSettings'
import type { ExtractProgress } from './extractJobs'

// ─── Motore Polizze lato server — porta ESATTA del flusso dell'app Electron ──
// Riusa le funzioni esatte del meccanismo (src/main/services/polizzaService.js).
// L'unica differenza col desktop è la rasterizzazione headless (pdfRaster), che
// rimpiazza il canvas del browser; l'algoritmo NON è toccato.

interface MechApi {
  extractPolizzaRolling: (
    files: string[] | Array<{ path: string }>,
    settings: unknown
  ) => Promise<{ scannedFiles?: Array<{ path: string }>; rollingState?: unknown; data?: Record<string, string> }>
  probeOcr: (settings: unknown) => Promise<{ available: boolean; reason?: string }>
  ocrPageText: (imageBase64: string, settings: unknown) => Promise<string>
  extractPolizzaFromFullText: (fullText: string, settings: unknown) => Promise<{ data: Record<string, string> }>
  updateStateWithVisionPage: (
    state: unknown, imageBase64: string, pageNum: number, totalPages: number, settings: unknown, source?: unknown
  ) => Promise<unknown>
  flattenRollingState: (state: unknown) => Record<string, string>
}

async function loadMechanism(): Promise<MechApi> {
  // @ts-ignore — modulo JS del processo main, caricato via externalDir (no types)
  const mod = await import('../../src/main/services/polizzaService.js')
  return mod as unknown as MechApi
}

export interface EngineResult {
  data: Record<string, string>
}

export async function extractPolizza(
  pdfPaths: string[],
  onProgress?: (p: ExtractProgress) => void
): Promise<EngineResult> {
  const settings = await buildAlgoSettings()
  const mech = await loadMechanism()

  // Identico al renderer: la rolling restituisce i file da elaborare a immagine.
  const rolling = await mech.extractPolizzaRolling(pdfPaths, settings)
  const files: Array<{ path: string }> =
    rolling.scannedFiles && rolling.scannedFiles.length > 0
      ? rolling.scannedFiles
      : pdfPaths.map((p) => ({ path: p }))

  if (settings.polizzaWholeDossier) {
    return wholeDossier(files, settings, mech, onProgress)
  }
  return visionRolling(files, rolling.rollingState || {}, settings, mech, onProgress)
}

// ─── "Fascicolo intero": OCR Tesseract di TUTTE le pagine → testo → 1 chiamata ─
async function wholeDossier(
  files: Array<{ path: string }>,
  settings: AlgoSettings,
  mech: MechApi,
  onProgress?: (p: ExtractProgress) => void
): Promise<EngineResult> {
  const probe = await mech.probeOcr(settings)
  if (!probe.available) {
    throw fatal(`OCR non disponibile: ${probe.reason || 'motivo sconosciuto'}`)
  }

  const parts: string[] = []
  let totalPagesProcessed = 0
  let pagesWithText = 0

  for (let docIndex = 0; docIndex < files.length; docIndex++) {
    const filePath = files[docIndex].path
    const docName = basename(filePath)
    const buffer = await readFile(filePath)
    let docText = ''

    for await (const pg of renderPdfPages(buffer)) {
      totalPagesProcessed++
      onProgress?.({
        docIndex, docTotal: files.length, pageIndex: pg.pageNum, pageTotal: pg.totalPages,
        docName, totalPagesProcessed,
      })
      const text = await mech.ocrPageText(pg.dataUrl, settings)
      if (text) {
        docText += '\n' + text
        pagesWithText++
      }
    }
    parts.push(`\n===== DOCUMENTO: ${docName} =====\n${docText.trim()}`)
  }

  const fullText = parts.join('\n')
  if (pagesWithText === 0 || fullText.trim().length < 50) {
    throw fatal("L'OCR non ha prodotto testo leggibile dai documenti (0 pagine utili).")
  }

  const { data } = await mech.extractPolizzaFromFullText(fullText, settings)
  return { data: data || {} }
}

// ─── Vision rolling: pagina per pagina, stato accumulato date-aware ────────────
async function visionRolling(
  files: Array<{ path: string }>,
  initialState: unknown,
  settings: AlgoSettings,
  mech: MechApi,
  onProgress?: (p: ExtractProgress) => void
): Promise<EngineResult> {
  let state: unknown = { ...((initialState as object) || {}) }
  let totalPagesProcessed = 0

  for (let docIndex = 0; docIndex < files.length; docIndex++) {
    const filePath = files[docIndex].path
    const docName = basename(filePath)
    const buffer = await readFile(filePath)

    for await (const pg of renderPdfPages(buffer)) {
      totalPagesProcessed++
      onProgress?.({
        docIndex, docTotal: files.length, pageIndex: pg.pageNum, pageTotal: pg.totalPages,
        docName, totalPagesProcessed,
      })
      state = await mech.updateStateWithVisionPage(state, pg.dataUrl, pg.pageNum, pg.totalPages, settings, { file: docName })
    }
  }
  return { data: mech.flattenRollingState(state) }
}

function fatal(message: string): Error {
  const e = new Error(message) as Error & { isLlmFatal?: boolean }
  e.isLlmFatal = true // deterministico: l'orchestratore non ritenta
  return e
}
