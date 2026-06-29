import { pool } from './db'

export interface WebSettings {
  llmProvider: string
  llmModel: string
  ollamaUrl: string
  openaiApiKey: string
  anthropicApiKey: string
}

const DEFAULTS: WebSettings = {
  llmProvider: 'ollama',
  llmModel: '',
  ollamaUrl: 'http://localhost:11434',
  openaiApiKey: '',
  anthropicApiKey: '',
}

export async function getSettings(): Promise<WebSettings> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    'SELECT key, value FROM settings'
  )
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    llmProvider: map.llmProvider ?? DEFAULTS.llmProvider,
    llmModel: map.llmModel ?? DEFAULTS.llmModel,
    ollamaUrl: map.ollamaUrl ?? DEFAULTS.ollamaUrl,
    openaiApiKey: map.openaiApiKey ?? DEFAULTS.openaiApiKey,
    anthropicApiKey: map.anthropicApiKey ?? DEFAULTS.anthropicApiKey,
  }
}

export async function saveSettings(s: Partial<WebSettings>) {
  for (const [k, v] of Object.entries(s)) {
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [k, v]
    )
  }
}
