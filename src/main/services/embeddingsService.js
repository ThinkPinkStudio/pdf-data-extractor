// Servizio embeddings condiviso (web + desktop), stesso pattern di llmService:
// provider intercambiabili via impostazioni, chiamate raw fetch resilienti.
//
// Provider supportati:
//   - ollama : POST {ollamaUrl}/api/embed            (default: nomic-embed-text)
//   - voyage : POST https://api.voyageai.com/v1/embeddings (voyage-3.5-lite)
//   - openai : POST https://api.openai.com/v1/embeddings   (text-embedding-3-small)
//
// Nota: Anthropic non offre un'API di embeddings (il partner consigliato è
// Voyage AI); se il provider embeddings non è configurato si usa Ollama.

import { resilientFetch } from './netFetch.js'

export const EMBEDDING_DEFAULTS = {
  ollama: { model: 'nomic-embed-text', dim: 768 },
  voyage: { model: 'voyage-3.5-lite', dim: 1024 },
  openai: { model: 'text-embedding-3-small', dim: 1536 },
}

export function embeddingConfig(settings = {}) {
  const provider = (settings.embeddingProvider || 'ollama').toLowerCase()
  const def = EMBEDDING_DEFAULTS[provider] || EMBEDDING_DEFAULTS.ollama
  const model = settings.embeddingModel || def.model
  const dim = parseInt(settings.embeddingDim, 10) || def.dim
  return { provider, model, dim }
}

// true se il provider configurato ha ciò che serve per funzionare (endpoint/chiave).
export function embeddingsConfigured(settings = {}) {
  const { provider } = embeddingConfig(settings)
  if (provider === 'voyage') return !!settings.voyageApiKey
  if (provider === 'openai') return !!settings.openaiApiKey
  return !!settings.ollamaUrl
}

async function embedOllama(settings, model, texts) {
  const base = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '')
  const res = await resilientFetch(`${base}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(`Ollama embeddings: ${res.status} ${e?.error || ''}`)
  }
  const data = await res.json()
  const vectors = data.embeddings
  if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error('Ollama embeddings: risposta malformata')
  return vectors
}

async function embedVoyage(settings, model, texts) {
  const res = await resilientFetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.voyageApiKey}` },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(`Voyage embeddings: ${res.status} ${e?.detail || e?.error?.message || ''}`)
  }
  const data = await res.json()
  const rows = (data.data || []).slice().sort((a, b) => a.index - b.index)
  if (rows.length !== texts.length) throw new Error('Voyage embeddings: risposta malformata')
  return rows.map((r) => r.embedding)
}

async function embedOpenAI(settings, model, texts) {
  const res = await resilientFetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.openaiApiKey}` },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(`OpenAI embeddings: ${res.status} ${e?.error?.message || ''}`)
  }
  const data = await res.json()
  const rows = (data.data || []).slice().sort((a, b) => a.index - b.index)
  if (rows.length !== texts.length) throw new Error('OpenAI embeddings: risposta malformata')
  return rows.map((r) => r.embedding)
}

const MAX_BATCH = 64
const MAX_CHARS = 6000 // taglio prudenziale per singolo input

/**
 * Calcola gli embeddings dei testi col provider configurato.
 * @returns {Promise<{ vectors: number[][], model: string, dim: number, provider: string }>}
 */
export async function embedTexts(settings, texts) {
  const { provider, model, dim } = embeddingConfig(settings)
  const clean = texts.map((t) => String(t || '').slice(0, MAX_CHARS))
  const vectors = []
  for (let i = 0; i < clean.length; i += MAX_BATCH) {
    const batch = clean.slice(i, i + MAX_BATCH)
    let out
    if (provider === 'voyage') out = await embedVoyage(settings, model, batch)
    else if (provider === 'openai') out = await embedOpenAI(settings, model, batch)
    else out = await embedOllama(settings, model, batch)
    vectors.push(...out)
  }
  const actualDim = vectors[0]?.length || dim
  return { vectors, model, dim: actualDim, provider }
}
