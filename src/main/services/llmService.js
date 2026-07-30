import { resilientFetch, describeNetworkError, ollamaThinkOpts } from './netFetch.js'

// ─── Diagnostica connessione provider ────────────────────────────────────────

// Aver ricevuto QUALSIASI risposta HTTP significa che rete/proxy/TLS funzionano:
// distinguiamo quindi i problemi di RETE (eccezione) da quelli di CREDENZIALI/
// CONFIGURAZIONE (status HTTP).
function interpretHttp(label, status) {
  if (status === 200) return { ok: true,  provider: label, stage: 'ok',    status, message: 'Connessione e credenziali OK.' }
  if (status === 400) return { ok: true,  provider: label, stage: 'ok',    status, message: `Rete e TLS OK (HTTP ${status}, endpoint raggiungibile).` }
  if (status === 401 || status === 403)
    return { ok: false, provider: label, stage: 'auth',  status, message: `Rete OK, ma la API key è stata rifiutata (HTTP ${status}). Controlla la chiave.` }
  if (status === 404) return { ok: false, provider: label, stage: 'model', status, message: `Rete OK, ma modello/endpoint non trovato (HTTP ${status}).` }
  if (status === 429) return { ok: false, provider: label, stage: 'rate',  status, message: 'Rete OK, ma limite di richieste raggiunto (HTTP 429).' }
  return { ok: status < 500, provider: label, stage: 'http', status, message: `Il provider ha risposto con HTTP ${status}.` }
}

// Esegue una richiesta reale al provider configurato e riporta un esito
// diagnostico leggibile (rete/proxy/TLS vs credenziali). Usata dal pulsante
// "Test connessione" nella sezione Sicurezza delle Impostazioni.
export async function testProviderConnection(settings) {
  const provider = settings.llmProvider || 'ollama'
  const label = provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Anthropic' : 'Ollama'
  try {
    if (provider === 'openai') {
      const res = await resilientFetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${settings.openaiApiKey || ''}` },
        signal: AbortSignal.timeout(8000)
      })
      return interpretHttp(label, res.status)
    }
    if (provider === 'anthropic') {
      const res = await resilientFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.anthropicApiKey || '',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: settings.anthropicModel || 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        }),
        signal: AbortSignal.timeout(8000)
      })
      return interpretHttp(label, res.status)
    }
    // ollama (locale)
    const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
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

// ─── OpenAI ──────────────────────────────────────────────────────────────────

async function extractDataOpenAI(apiKey, model, fields, contextChunks) {
  const fieldsList = fields
    .filter(f => f.enabled)
    .map(f => `  - "${f.label}": ${f.description}`)
    .join('\n')
  const contextText = contextChunks.map(c => c.text).join('\n\n---\n\n')
  const prompt = buildExtractionPrompt(fieldsList, contextText)

  const res = await resilientFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    }),
    signal: AbortSignal.timeout(60000)
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`OpenAI error: ${res.status} ${err?.error?.message || ''}`)
  }

  const data = await res.json()
  const raw = (data.choices?.[0]?.message?.content || '').trim()
  return parseJsonResponse(raw)
}

async function* streamChatOpenAI(apiKey, model, messages) {
  const res = await resilientFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: AbortSignal.timeout(120000)
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`OpenAI error: ${res.status} ${err?.error?.message || ''}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') return
      try {
        const obj = JSON.parse(payload)
        const content = obj.choices?.[0]?.delta?.content
        if (content) yield content
      } catch {}
    }
  }
}

export async function testOpenAI(apiKey, model) {
  try {
    const res = await resilientFetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000)
    })
    return { connected: res.ok }
  } catch {
    return { connected: false }
  }
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

async function extractDataAnthropic(apiKey, model, fields, contextChunks) {
  const fieldsList = fields
    .filter(f => f.enabled)
    .map(f => `  - "${f.label}": ${f.description}`)
    .join('\n')
  const contextText = contextChunks.map(c => c.text).join('\n\n---\n\n')
  const prompt = buildExtractionPrompt(fieldsList, contextText)

  const res = await resilientFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(60000)
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Anthropic error: ${res.status} ${err?.error?.message || ''}`)
  }

  const data = await res.json()
  const raw = (data.content?.[0]?.text || '').trim()
  return parseJsonResponse(raw)
}

async function* streamChatAnthropic(apiKey, model, messages) {
  // Separate system message from user/assistant messages
  const systemMsg = messages.find(m => m.role === 'system')
  const chatMsgs = messages.filter(m => m.role !== 'system')

  const body = {
    model,
    max_tokens: 2048,
    stream: true,
    messages: chatMsgs
  }
  if (systemMsg) body.system = systemMsg.content

  const res = await resilientFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Anthropic error: ${res.status} ${err?.error?.message || ''}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      try {
        const obj = JSON.parse(payload)
        if (obj.type === 'content_block_delta' && obj.delta?.text) {
          yield obj.delta.text
        }
        if (obj.type === 'message_stop') return
      } catch {}
    }
  }
}

export async function testAnthropic(apiKey, model) {
  try {
    const res = await resilientFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      signal: AbortSignal.timeout(5000)
    })
    return { connected: res.ok || res.status === 400 } // 400 is "invalid request" but API key is valid
  } catch {
    return { connected: false }
  }
}

// ─── Unified provider dispatch ────────────────────────────────────────────────

export async function extractDataWithProvider(settings, fields, chunks) {
  const provider = settings.llmProvider || 'ollama'
  switch (provider) {
    case 'openai':
      return extractDataOpenAI(settings.openaiApiKey, settings.openaiModel || 'gpt-4o-mini', fields, chunks)
    case 'anthropic':
      return extractDataAnthropic(settings.anthropicApiKey, settings.anthropicModel || 'claude-haiku-4-5-20251001', fields, chunks)
    default:
      return extractData(settings.ollamaUrl, settings.ollamaModel, fields, chunks)
  }
}

export async function* streamChatWithProvider(settings, messages) {
  const provider = settings.llmProvider || 'ollama'
  switch (provider) {
    case 'openai':
      yield* streamChatOpenAI(settings.openaiApiKey, settings.openaiModel || 'gpt-4o-mini', messages)
      break
    case 'anthropic':
      yield* streamChatAnthropic(settings.anthropicApiKey, settings.anthropicModel || 'claude-haiku-4-5-20251001', messages)
      break
    default:
      yield* streamChat(settings.ollamaUrl, settings.ollamaModel, messages)
  }
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
