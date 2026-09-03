import { resilientFetch, describeNetworkError, ollamaThinkOpts } from './netFetch.js'

// ─── Diagnostica connessione provider ────────────────────────────────────────

// Ollama è il solo provider: la diagnosi è connessione HTTP al server locale.
export async function testProviderConnection(settings) {
  const label = 'Ollama'
  const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
  try {
    const res = await resilientFetch(`${url}/api/tags`, { signal: AbortSignal.timeout(8000) })
    if (res.ok) return { ok: true, provider: label, stage: 'ok', status: res.status, message: 'Connessione riuscita.' }
    return { ok: false, provider: label, stage: 'http', status: res.status, message: `Ollama ha risposto con HTTP ${res.status}.` }
  } catch (err) {
    const d = describeNetworkError(err)
    return { ok: false, provider: label, stage: d.stage, status: null, message: d.message }
  }
}

// ─── Ollama ──────────────────────────────────────────────────────────────────

export async function getOllamaStatus(baseUrl) {
  try {
    const res = await resilientFetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { connected: false, models: [] }
    const data = await res.json()
    const models = (data.models || []).map(m => m.name)
    return { connected: true, models }
  } catch {
    return { connected: false, models: [] }
  }
}

export async function extractData(baseUrl, model, fields, contextChunks) {
  const fieldsList = fields
    .filter(f => f.enabled)
    .map(f => `  - "${f.label}": ${f.description}`)
    .join('\n')

  const contextText = contextChunks.map(c => c.text).join('\n\n---\n\n')

  const prompt = buildExtractionPrompt(fieldsList, contextText)

  const res = await resilientFetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, ...ollamaThinkOpts(model) }),
    // 3 min: i modelli locali possono impiegare oltre un minuto, specie al primo avvio
    signal: AbortSignal.timeout(180000)
  })

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)

  const data = await res.json()
  const raw = (data.response || '').trim()

  return parseJsonResponse(raw)
}

export async function* streamChat(baseUrl, model, messages) {
  const res = await resilientFetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, ...ollamaThinkOpts(model) }),
    signal: AbortSignal.timeout(120000)
  })

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (obj.message?.content) yield obj.message.content
        if (obj.done) return
      } catch {}
    }
  }
}

// ─── Dispatch unificato (SOLO Ollama: i provider cloud sono stati rimossi) ───

export async function extractDataWithProvider(settings, fields, chunks) {
  return extractData(settings.ollamaUrl || 'http://127.0.0.1:11434', settings.ollamaModel || 'llama3', fields, chunks)
}

export async function* streamChatWithProvider(settings, messages) {
  yield* streamChat(settings.ollamaUrl || 'http://127.0.0.1:11434', settings.ollamaModel || 'llama3', messages)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildExtractionPrompt(fieldsList, contextText) {
  return `Sei un assistente specializzato nell'estrazione di dati strutturati da documenti.

Estrai le seguenti informazioni dal testo del documento fornito.
Restituisci SOLO un oggetto JSON valido, senza testo aggiuntivo, markdown o spiegazioni.

Campi da estrarre:
${fieldsList}

Se un campo non è presente nel documento, usa null come valore.

Testo del documento:
---
${contextText}
---

Rispondi con un JSON del tipo:
{"Campo1": "valore1", "Campo2": null, ...}`
}

function parseJsonResponse(raw) {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Risposta non valida dal modello LLM')
  return JSON.parse(jsonMatch[0])
}
