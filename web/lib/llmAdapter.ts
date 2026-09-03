// Adapter that bridges web API calls to the shared Electron services.
// The Electron services are plain Node.js ESM modules — we import them directly.

import { getSettings } from './settingsStore'
import { importSharedService } from './sharedServices'

export interface ProviderTestResult {
  ok: boolean
  provider?: string
  stage?: string
  status?: number | null
  message?: string
}

export async function testProviderConnection(settings: {
  llmProvider?: string
  ollamaUrl?: string
}): Promise<ProviderTestResult> {
  const { testProviderConnection: test } = await importSharedService<{
    testProviderConnection: (s: unknown) => Promise<ProviderTestResult>
  }>('llmService.js')
  return test(settings)
}

export async function ollamaStatus(baseUrl: string): Promise<{ connected: boolean; models: string[] }> {
  const { getOllamaStatus } = await importSharedService<{
    getOllamaStatus: (u: string) => Promise<{ connected: boolean; models: string[] }>
  }>('llmService.js')
  return getOllamaStatus(baseUrl)
}

export async function extractFields(pdfPath: string, fieldList: string[]): Promise<Array<{ name: string; value: string }>> {
  const llm = await importSharedService<Record<string, (...a: unknown[]) => unknown>>('llmService.js')
  const { loadPDF, searchChunks } = await importSharedService<{ loadPDF: (p: string) => Promise<{ text: string; chunks: unknown[] }>; searchChunks: (q: string, c: unknown[], k: number) => unknown[] }>('pdfService.js')
  const stored = await getSettings()

  const { text, chunks } = await loadPDF(pdfPath)

  const fields = fieldList.map((name) => ({
    label: name,
    description: name,
    enabled: true,
  }))

  const contextChunks = searchChunks(fieldList.join(' '), chunks, 6)

  // Solo Ollama (OpenAI/Anthropic rimossi dal prodotto).
  const result = (await llm.extractData(
    stored.ollamaUrl || 'http://localhost:11434',
    stored.ollamaModel || 'llama3',
    fields,
    contextChunks
  )) as Record<string, string>
  return fieldList.map((name) => ({ name, value: result[name] ?? '' }))
}
