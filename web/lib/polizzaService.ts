import { getSettings } from './settingsStore'
import { importSharedService } from './sharedServices'

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

/**
 * Estrae i dati da uno o più PDF di polizza (polizza, appendici, condizioni…).
 * Usa la stessa logica dell'app desktop: testo via pdfjs/pdf-parse, regex per i
 * campi strutturati e LLM per i restanti, con merge per documento più recente.
 */
export async function extractPolizza(pdfPaths: string[]): Promise<PolizzaResult> {
  const stored = await getSettings()
  const { extractPolizzaFromPDFs, ALL_POLIZZA_FIELDS } = await importSharedService<{
    extractPolizzaFromPDFs: (paths: string[], settings: unknown) => Promise<{ data: Record<string, string>; scannedFiles: { path: string }[]; sources: Record<string, PolizzaSource> }>
    ALL_POLIZZA_FIELDS: PolizzaFieldDef[]
  }>('polizzaService.js')

  const log: string[] = []
  log.push(`Inizio estrazione · ${pdfPaths.length} documento/i`)

  const { data, scannedFiles, sources } = await extractPolizzaFromPDFs(pdfPaths, stored)

  // Il web non personalizza i campi: usa l'elenco completo definito nei servizi
  // condivisi (gli stessi dell'app desktop). polizzaFields resta opzionale.
  const customFields = (stored as { polizzaFields?: PolizzaFieldDef[] }).polizzaFields
  const configured: PolizzaFieldDef[] = (customFields && customFields.length > 0 ? customFields : ALL_POLIZZA_FIELDS)
    .filter((f) => f.enabled !== false)
    .map((f) => ({ id: f.id, label: f.label, description: f.description, sheet: f.sheet }))

  const valueCount = Object.values(data || {}).filter((v) => v !== null && v !== undefined && v !== '').length
  log.push(`Campi valorizzati: ${valueCount}/${configured.length}`)
  if (scannedFiles?.length) {
    log.push(
      `${scannedFiles.length} documento/i risultano scansionati (solo immagine): nessun testo estraibile lato server.`
    )
  }

  return {
    values: (data || {}) as Record<string, string>,
    sources: (sources || {}) as Record<string, PolizzaSource>,
    scannedFiles: (scannedFiles || []).map((f: { path: string }) => f.path.split(/[\\/]/).pop() || f.path),
    fieldDefs: configured,
    log,
  }
}
