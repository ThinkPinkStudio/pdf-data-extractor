import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const defaultSettings = {
  theme: 'dark',
  language: 'it',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: '',
  extractions: [
    {
      id: '1',
      label: 'Nome',
      description: 'Estrai il nome completo del cliente o della persona',
      enabled: true
    },
    {
      id: '2',
      label: 'Tel',
      description: 'Estrai il numero di telefono del cliente',
      enabled: true
    },
    {
      id: '3',
      label: 'Email',
      description: "Estrai l'indirizzo email del cliente",
      enabled: true
    },
    {
      id: '4',
      label: 'Indirizzo',
      description: "Estrai l'indirizzo completo",
      enabled: true
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
    return { ...defaultSettings, ...saved }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(settings) {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
  return settings
}
