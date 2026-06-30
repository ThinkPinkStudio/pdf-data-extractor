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

const BOOL_KEYS = new Set(['polizzaOcrEnabled', 'polizzaWholeDossier'])
// Chiavi memorizzate come JSON (array/oggetti) nella tabella settings (value TEXT).
const JSON_KEYS = new Set(['polizzaFields', 'polizzaProfiles'])

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
    openaiModel: map.openaiModel || map.llmModel || '',
    anthropicModel: map.anthropicModel || map.llmModel || '',
    ollamaModel: map.ollamaModel || map.llmModel || '',
    ollamaVisionModel: map.ollamaVisionModel || map.llmModel || '',
    anthropicVisionModel: map.anthropicVisionModel || map.anthropicModel || map.llmModel || '',
    polizzaOcrEnabled: bool('polizzaOcrEnabled', true),
    polizzaWholeDossier: bool('polizzaWholeDossier', false),
    polizzaWholeDossierModel: map.polizzaWholeDossierModel || '',
    polizzaPromptExtra: map.polizzaPromptExtra ?? '',
    polizzaFields: json<PolizzaField[]>('polizzaFields'),
    polizzaProfiles: json<PolizzaProfile[]>('polizzaProfiles'),
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
