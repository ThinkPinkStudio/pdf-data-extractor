import { pool } from './db'

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
  polizzaPromptExtra?: string
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

export async function getSettings(): Promise<WebSettings> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    'SELECT key, value FROM settings'
  )
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const bool = (k: string, def: boolean) => (map[k] === undefined ? def : map[k] === 'true')

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
    polizzaPromptExtra: map.polizzaPromptExtra ?? '',
    theme: map.theme,
    language: map.language,
    accentColor: map.accentColor,
  }
}

export async function saveSettings(s: Partial<WebSettings>) {
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) continue
    const value = BOOL_KEYS.has(k) ? String(!!v) : String(v)
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [k, value]
    )
  }
}
