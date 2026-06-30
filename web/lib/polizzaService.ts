import { getSettings } from './settingsStore'
import { importSharedService } from './sharedServices'
import { writeFile, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

export interface PolizzaFieldDef {
  id: string
  label: string
  description?: string
  sheet?: string
  enabled?: boolean
}

export interface PolizzaSource {
  file: string
  page: number
}

export interface PolizzaResult {
  values: Record<string, string>
  sources: Record<string, PolizzaSource>
  scannedFiles: string[]
  fieldDefs: PolizzaFieldDef[]
  log: string[]
}

// Tipo del namespace dei servizi condivisi che usiamo qui.
interface PolizzaServiceModule {
  extractPolizzaFromPDFs: (paths: string[], settings: unknown) => Promise<{
    data: Record<string, string>
    scannedFiles: { path: string }[]
    sources: Record<string, PolizzaSource>
  }>
  ALL_POLIZZA_FIELDS: PolizzaFieldDef[]
  CSA_MAPPING: Record<string, unknown>
  buildMappingFromFields: (fields: PolizzaFieldDef[]) => Record<string, unknown>
  probeOcr: (settings: unknown) => Promise<{ available: boolean; reason?: string }>
  ocrPageText: (imageBase64: string, settings: unknown) => Promise<string>
  updateStateWithVisionPage: (
    state: unknown, imageBase64: string, pageNum: number, totalPages: number, settings: unknown, source: unknown
  ) => Promise<unknown>
  extractPolizzaFromFullText: (fullText: string, settings: unknown) => Promise<{ data: Record<string, string>; sources: Record<string, PolizzaSource> }>
  exportToNewExcel: (filePath: string, data: Record<string, string>, fieldsConfig: unknown) => Promise<void>
  readExcelStructure: (templatePath: string) => Promise<unknown>
  previewTemplateChanges: (templatePath: string, data: Record<string, string>, mapping: unknown, fieldsConfig: unknown) => Promise<unknown[]>
  exportApprovedChanges: (templatePath: string, outputPath: string, approvedChanges: unknown) => Promise<void>
}

const svc = () => importSharedService<PolizzaServiceModule>('polizzaService.js')

function llmFlags(err: unknown) {
  const e = err as { isLlmConnectionError?: boolean; isLlmTimeout?: boolean }
  return { connectionError: !!e?.isLlmConnectionError, timeoutError: !!e?.isLlmTimeout }
}

// ─── Definizioni campi + mappatura predefinita ───────────────────────────────
export async function getFieldsAndMapping() {
  const stored = await getSettings()
  const m = await svc()
  const custom = (stored as { polizzaFields?: PolizzaFieldDef[] }).polizzaFields
  const fields = custom && custom.length > 0 ? custom : m.ALL_POLIZZA_FIELDS
  const defaultMapping = custom && custom.length > 0 ? m.buildMappingFromFields(custom) : m.CSA_MAPPING
  return {
    fields: fields.filter((f) => f.enabled !== false),
    defaultMapping,
    wholeDossier: !!stored.polizzaWholeDossier,
  }
}

// ─── Estrazione testo (multi-PDF) ────────────────────────────────────────────
export async function extractPolizza(pdfPaths: string[]): Promise<PolizzaResult> {
  const stored = await getSettings()
  const m = await svc()

  const log: string[] = []
  log.push(`Inizio estrazione · ${pdfPaths.length} documento/i`)

  const { data, scannedFiles, sources } = await m.extractPolizzaFromPDFs(pdfPaths, stored)

  const custom = (stored as { polizzaFields?: PolizzaFieldDef[] }).polizzaFields
  const configured: PolizzaFieldDef[] = (custom && custom.length > 0 ? custom : m.ALL_POLIZZA_FIELDS)
    .filter((f) => f.enabled !== false)
    .map((f) => ({ id: f.id, label: f.label, description: f.description, sheet: f.sheet }))

  const valueCount = Object.values(data || {}).filter((v) => v !== null && v !== undefined && v !== '').length
  log.push(`Campi valorizzati: ${valueCount}/${configured.length}`)
  if (scannedFiles?.length) {
    log.push(`${scannedFiles.length} documento/i scansionati (solo immagine): verranno elaborati via OCR/AI vision.`)
  }

  return {
    values: (data || {}) as Record<string, string>,
    sources: (sources || {}) as Record<string, PolizzaSource>,
    scannedFiles: (scannedFiles || []).map((f) => f.path.split(/[\\/]/).pop() || f.path),
    fieldDefs: configured,
    log,
  }
}

// ─── OCR / Vision (PDF scansionati): il browser invia l'immagine della pagina ──
export async function ocrStatus() {
  const stored = await getSettings()
  try {
    return await (await svc()).probeOcr(stored)
  } catch (err) {
    return { available: false, reason: (err as Error).message }
  }
}

export async function ocrPage(imageBase64: string) {
  const stored = await getSettings()
  try {
    const text = await (await svc()).ocrPageText(imageBase64, stored)
    return { success: true, text }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export async function visionUpdate(params: {
  state: unknown; imageBase64: string; pageNum: number; totalPages: number; docName?: string
}) {
  const stored = await getSettings()
  try {
    const source = params.docName ? { file: params.docName, page: params.pageNum } : null
    const state = await (await svc()).updateStateWithVisionPage(
      params.state, params.imageBase64, params.pageNum, params.totalPages, stored, source
    )
    return { success: true, state }
  } catch (err) {
    return { success: false, error: (err as Error).message, ...llmFlags(err) }
  }
}

export async function wholeDossier(fullText: string) {
  const stored = await getSettings()
  try {
    const { data, sources } = await (await svc()).extractPolizzaFromFullText(fullText, stored)
    return { success: true, data, sources }
  } catch (err) {
    return { success: false, error: (err as Error).message, ...llmFlags(err) }
  }
}

// ─── Excel: nuovo file ───────────────────────────────────────────────────────
export async function exportNewExcel(data: Record<string, string>): Promise<Buffer> {
  const stored = await getSettings()
  const m = await svc()
  const fieldsConfig = (stored as { polizzaFields?: PolizzaFieldDef[] }).polizzaFields || null
  const out = join(tmpdir(), `polizza-new-${randomUUID()}.xlsx`)
  try {
    await m.exportToNewExcel(out, data, fieldsConfig)
    return await readFile(out)
  } finally {
    await unlink(out).catch(() => {})
  }
}

// ─── Template (gestionale): struttura, anteprima, scrittura approvata ─────────
async function withTempTemplate<T>(templateBytes: Buffer, fn: (path: string) => Promise<T>): Promise<T> {
  const tpl = join(tmpdir(), `polizza-tpl-${randomUUID()}.xlsx`)
  await writeFile(tpl, templateBytes)
  try {
    return await fn(tpl)
  } finally {
    await unlink(tpl).catch(() => {})
  }
}

export async function templateStructure(templateBytes: Buffer) {
  const m = await svc()
  try {
    const structure = await withTempTemplate(templateBytes, (p) => m.readExcelStructure(p))
    return { success: true, structure }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export async function templatePreview(templateBytes: Buffer, data: Record<string, string>, mapping: unknown) {
  const stored = await getSettings()
  const m = await svc()
  const fieldsConfig = (stored as { polizzaFields?: PolizzaFieldDef[] }).polizzaFields || null
  try {
    const changes = await withTempTemplate(templateBytes, (p) => m.previewTemplateChanges(p, data, mapping, fieldsConfig))
    return { success: true, changes }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export async function templateExportApproved(templateBytes: Buffer, approvedChanges: unknown): Promise<Buffer> {
  const m = await svc()
  return withTempTemplate(templateBytes, async (p) => {
    const out = join(tmpdir(), `polizza-tpl-out-${randomUUID()}.xlsx`)
    try {
      await m.exportApprovedChanges(p, out, approvedChanges)
      return await readFile(out)
    } finally {
      await unlink(out).catch(() => {})
    }
  })
}
