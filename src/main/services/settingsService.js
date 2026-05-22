import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const defaultSettings = {
  theme: 'dark',
  language: 'it',
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: '',
  // Cloud LLM providers
  llmProvider: 'ollama',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  anthropicApiKey: '',
  anthropicModel: 'claude-haiku-4-5-20251001',
  // Extraction profiles
  profiles: [],
  // Accent color
  accentColor: '',
  // Webhook
  webhookEnabled: false,
  webhookPort: 3847,
  // Notifications
  notificationsEnabled: true,
  extractions: [
    {
      id: '1',
      label: 'Nome',
      description: 'Estrai il nome completo del cliente o della persona',
      enabled: true,
      type: 'text'
    },
    {
      id: '2',
      label: 'Tel',
      description: 'Estrai il numero di telefono del cliente',
      enabled: true,
      type: 'phone'
    },
    {
      id: '3',
      label: 'Email',
      description: "Estrai l'indirizzo email del cliente",
      enabled: true,
      type: 'email'
    },
    {
      id: '4',
      label: 'Indirizzo',
      description: "Estrai l'indirizzo completo",
      enabled: true,
      type: 'text'
    }
  ]
}

function getSettingsPath() {
  const userDataPath = app.getPath('userData')
  mkdirSync(userDataPath, { recursive: true })
  return join(userDataPath, 'settings.json')
}

export function getSettings() {
  try {
    const raw = readFileSync(getSettingsPath(), 'utf-8')
    const saved = JSON.parse(raw)
    const merged = { ...defaultSettings, ...saved }
    // Migrate legacy localhost URLs to 127.0.0.1 to avoid IPv6 resolution failures
    if (merged.ollamaUrl === 'http://localhost:11434') {
      merged.ollamaUrl = 'http://127.0.0.1:11434'
    }
    // Ensure extractions have type field
    if (Array.isArray(merged.extractions)) {
      merged.extractions = merged.extractions.map(f => ({ type: 'text', ...f }))
    }
    return merged
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(settings) {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
  return settings
}
