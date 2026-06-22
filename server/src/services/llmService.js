// Adattato da src/main/services/llmService.js (versione Electron)

function buildPrompt(fieldsList, contextText) {
  return `Sei un assistente specializzato nell'estrazione di dati strutturati da documenti.

Estrai le seguenti informazioni dal testo del documento.
Restituisci SOLO un oggetto JSON valido, senza testo aggiuntivo, markdown o spiegazioni.

Campi da estrarre:
${fieldsList}

Se un campo non è presente, usa null come valore.

Testo:
---
${contextText}
---

Risposta JSON:`;
}

function parseJson(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Risposta LLM non contiene JSON valido');
  return JSON.parse(m[0]);
}

export async function extractDataWithProvider(cfg, fields, chunks) {
  const enabled = fields.filter(f => f.enabled !== false);
  const fieldsList = enabled.map(f => `  - "${f.label}": ${f.description ?? f.label}`).join('\n');
  const contextText = chunks.map(c => c.text).join('\n\n---\n\n');
  const prompt = buildPrompt(fieldsList, contextText);

  switch (cfg.llmProvider) {
    case 'openai': {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.openaiApiKey}` },
        body: JSON.stringify({ model: cfg.openaiModel ?? 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0 }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
      const data = await res.json();
      return parseJson(data.choices[0].message.content);
    }
    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropicApiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.anthropicModel ?? 'claude-haiku-4-5-20251001', max_tokens: 2048, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Anthropic error ${res.status}`);
      const data = await res.json();
      return parseJson(data.content[0].text);
    }
    default: {
      const res = await fetch(`${cfg.ollamaUrl ?? 'http://localhost:11434'}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.ollamaModel ?? 'llama3.2', prompt, stream: false }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`Ollama error ${res.status}`);
      const data = await res.json();
      return parseJson(data.response ?? '');
    }
  }
}
