export async function getOllamaStatus(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
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

  const prompt = `Sei un assistente specializzato nell'estrazione di dati strutturati da documenti.

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

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
    signal: AbortSignal.timeout(60000)
  })

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)

  const data = await res.json()
  const raw = (data.response || '').trim()

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Risposta non valida dal modello LLM')

  return JSON.parse(jsonMatch[0])
}

export async function* streamChat(baseUrl, model, messages) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
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
