import { pool } from './db'

export interface PolizzaField {
  id: string
  label: string
  description: string
  type?: string
  sheet?: string
  enabled?: boolean
  cells?: { sheet: string; cell: string }[]
}

export interface PolizzaProfile {
  id: string
  name: string
  fields: PolizzaField[]
  promptExtra?: string
  ocrEnabled?: boolean
  wholeDossier?: boolean
  wholeDossierModel?: string
  verificaCampi?: string
  verificaModel?: string
  consensusPasses?: number
}

// Campi/profili di estrazione generici (pagina Estrattore), come nel desktop.
export interface GenericField {
  id: string
  label: string
  description?: string
  type?: string
  enabled?: boolean
}
export interface GenericProfile {
  id: string
  name: string
  fields: GenericField[]
}

export interface WebSettings {
  llmProvider: string
  llmModel: string
  ollamaUrl: string
  openaiApiKey: string
  anthropicApiKey: string
  // Modelli per-provider (Impostazioni avanzate). Se non impostati, derivano da llmModel.
  openaiModel?: string
  anthropicModel?: string
  ollamaModel?: string
  ollamaVisionModel?: string
  anthropicVisionModel?: string
  // Configurazione Polizze
  polizzaOcrEnabled?: boolean
  polizzaWholeDossier?: boolean
  polizzaWholeDossierModel?: string
  polizzaPromptExtra?: string
  polizzaFields?: PolizzaField[]
  polizzaProfiles?: PolizzaProfile[]
  // Verifica/qualità polizza (usati dal servizio condiviso, polizzaService.js)
  polizzaVerificaCampi?: string
  polizzaVerificaModel?: string
  polizzaConsensusPasses?: number
  // Estrazione generica (pagina Estrattore)
  extractions?: GenericField[]
  profiles?: GenericProfile[]
  // Bulk (cartella intera di polizze): nomi di cartelle aggiuntivi da escludere
  // sempre dall'enumerazione, oltre alla baseline hardcoded (vedi bulkExclusions.ts).
  bulkExcludedFolderNames?: string
  // Aspetto
  theme?: string
  language?: string
  accentColor?: string
}

const DEFAULTS: WebSettings = {
  llmProvider: 'ollama',
  llmModel: '',
  ollamaUrl: 'http://localhost:11434',
  openaiApiKey: '',
  anthropicApiKey: '',
}

// Riconoscimento (euristico) dei nomi di modello cloud: serve a impedire che il
// legacy llmModel — campo unico condiviso tra i provider — contamini i campi
// per-provider (es. un modello Claude usato come modello Ollama → 404).
const isClaudeModel = (m?: string) => /^claude-/i.test(m || '')
const isGptModel = (m?: string) => /^(gpt-|o\d)/i.test(m || '')
const isCloudModel = (m?: string) => isClaudeModel(m) || isGptModel(m)

const BOOL_KEYS = new Set(['polizzaOcrEnabled', 'polizzaWholeDossier'])
// Chiavi memorizzate come JSON (array/oggetti) nella tabella settings (value TEXT).
const JSON_KEYS = new Set(['polizzaFields', 'polizzaProfiles', 'extractions', 'profiles'])

export async function getSettings(): Promise<WebSettings> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    'SELECT key, value FROM settings'
  )
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const bool = (k: string, def: boolean) => (map[k] === undefined ? def : map[k] === 'true')
  const json = <T>(k: string): T | undefined => {
    if (map[k] === undefined) return undefined
    try { return JSON.parse(map[k]) as T } catch { return undefined }
  }

  return {
    llmProvider: map.llmProvider ?? DEFAULTS.llmProvider,
    llmModel: map.llmModel ?? DEFAULTS.llmModel,
    ollamaUrl: map.ollamaUrl ?? DEFAULTS.ollamaUrl,
    openaiApiKey: map.openaiApiKey ?? DEFAULTS.openaiApiKey,
    anthropicApiKey: map.anthropicApiKey ?? DEFAULTS.anthropicApiKey,
    // Fallback dal legacy llmModel SOLO se il nome è compatibile col provider:
    // llmModel è condiviso tra i provider nella UI, quindi può contenere un nome
    // Claude/GPT che, passato a Ollama, produce 404 "model not found" (e viceversa).
    openaiModel: map.openaiModel || (isGptModel(map.llmModel) ? map.llmModel : '') || '',
    anthropicModel: map.anthropicModel || (isClaudeModel(map.llmModel) ? map.llmModel : '') || '',
    ollamaModel: map.ollamaModel || (isCloudModel(map.llmModel) ? '' : map.llmModel) || '',
    ollamaVisionModel: map.ollamaVisionModel || (isCloudModel(map.llmModel) ? '' : map.llmModel) || '',
    anthropicVisionModel: map.anthropicVisionModel || map.anthropicModel || (isClaudeModel(map.llmModel) ? map.llmModel : '') || '',
    polizzaOcrEnabled: bool('polizzaOcrEnabled', true),
    polizzaWholeDossier: bool('polizzaWholeDossier', false),
    polizzaWholeDossierModel: map.polizzaWholeDossierModel || '',
    polizzaPromptExtra: map.polizzaPromptExtra ?? '',
    polizzaFields: json<PolizzaField[]>('polizzaFields'),
    polizzaProfiles: json<PolizzaProfile[]>('polizzaProfiles'),
    polizzaVerificaCampi: map.polizzaVerificaCampi ?? '',
    polizzaVerificaModel: map.polizzaVerificaModel ?? '',
    polizzaConsensusPasses: map.polizzaConsensusPasses ? parseInt(map.polizzaConsensusPasses, 10) || 3 : 3,
    extractions: json<GenericField[]>('extractions'),
    profiles: json<GenericProfile[]>('profiles'),
    bulkExcludedFolderNames: map.bulkExcludedFolderNames ?? '',
    theme: map.theme,
    language: map.language,
    accentColor: map.accentColor,
  }
}

export async function saveSettings(s: Partial<WebSettings>) {
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) continue
    let value: string
    if (JSON_KEYS.has(k)) value = JSON.stringify(v)
    else if (BOOL_KEYS.has(k)) value = String(!!v)
    else value = String(v)
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [k, value]
    )
  }
}
