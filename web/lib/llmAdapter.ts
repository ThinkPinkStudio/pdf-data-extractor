// Adapter that bridges web API calls to the shared Electron services.
// The Electron services are plain Node.js ESM modules — we import them directly.

import { getSettings } from './settingsStore'

const SERVICES_PATH = '../../src/main/services'

export async function testProviderConnection(settings: {
  llmProvider: string
  ollamaUrl?: string
  openaiApiKey?: string
  anthropicApiKey?: string
}) {
  const { testProviderConnection: test } = await import(`${SERVICES_PATH}/llmService.js`)
  return test(settings)
}

export async function extractFields(pdfPath: string, fieldList: string[]): Promise<Array<{ name: string; value: string }>> {
  const { loadPDF, searchChunks } = await import(`${SERVICES_PATH}/pdfService.js`)
  const stored = await getSettings()

  const { text, chunks } = await loadPDF(pdfPath)

  const fields = fieldList.map((name) => ({
    label: name,
    description: name,
    enabled: true,
  }))

  const contextChunks = searchChunks(fieldList.join(' '), chunks, 6)

  if (stored.llmProvider === 'openai') {
    const { extractDataOpenAI } = await import(`${SERVICES_PATH}/llmService.js`)
    const result = await extractDataOpenAI(
      stored.openaiApiKey,
      stored.llmModel || 'gpt-4o-mini',
      fields,
      contextChunks
    )
    return fieldList.map((name) => ({ name, value: result[name] ?? '' }))
  }

  if (stored.llmProvider === 'anthropic') {
    const { extractDataAnthropic } = await import(`${SERVICES_PATH}/llmService.js`)
    const result = await extractDataAnthropic(
      stored.anthropicApiKey,
      stored.llmModel || 'claude-haiku-4-5-20251001',
      fields,
      contextChunks
    )
    return fieldList.map((name) => ({ name, value: result[name] ?? '' }))
  }

  // Ollama default
  const { extractData } = await import(`${SERVICES_PATH}/llmService.js`)
  const result = await extractData(
    stored.ollamaUrl || 'http://localhost:11434',
    stored.llmModel || 'llama3',
    fields,
    contextChunks
  )
  return fieldList.map((name) => ({ name, value: result[name] ?? '' }))
}
