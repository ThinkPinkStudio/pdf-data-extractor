/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'
import { importSharedService } from '@/lib/sharedServices'
import { logAction } from '@/lib/logger'
import { searchCorpus, type CorpusFilters } from '@/lib/corpusSearch'
import {
  getConversation, getMessages, appendMessage, maybeSetTitle, updateFilters, type Citation,
} from '@/lib/chatStore'

export const runtime = 'nodejs'

// Un turno della chat sul corpus: retrieval ibrido (full-text + vettoriale) sui
// documenti dell'utente, prompt multi-documento con fonti numerate, risposta in
// streaming (stesso pattern di /api/extract/chat) e persistenza di messaggi e
// citazioni a fine stream.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const conversation = await getConversation(params.id, session.email)
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { message?: string; filters?: CorpusFilters }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const message = (body.message || '').trim()
  if (!message) return NextResponse.json({ error: 'Messaggio vuoto' }, { status: 400 })

  const filters: CorpusFilters = body.filters ?? conversation.filters ?? {}
  if (body.filters) await updateFilters(params.id, session.email, body.filters)

  const settings = await getSettings()
  const chunks = await searchCorpus(session.email, message, filters, settings, 12)

  // Fonti numerate per le citazioni [n] nella risposta.
  const citations: Citation[] = chunks.map((c, i) => ({
    n: i + 1,
    documentId: c.documentId,
    fileName: c.fileName,
    gruppo: c.gruppo,
    societa: c.societa,
    ramo: c.ramo,
    pageFrom: c.pageFrom,
    pageTo: c.pageTo,
  }))
  const context = chunks.map((c, i) => {
    const loc = [c.gruppo, c.societa, c.ramo].filter(Boolean).join(' / ')
    const pages = c.pageFrom ? ` pagg. ${c.pageFrom}${c.pageTo && c.pageTo !== c.pageFrom ? `-${c.pageTo}` : ''}` : ''
    return `[${i + 1}] ${c.fileName}${loc ? ` — ${loc}` : ''}${pages}\n${c.text}`
  }).join('\n\n---\n\n')

  const systemPrompt = `Sei l'assistente dell'archivio polizze dello studio. Rispondi alle domande basandoti ESCLUSIVAMENTE sugli estratti dei documenti forniti sotto, numerati [1], [2], …
Cita sempre le fonti con il loro numero tra parentesi quadre (es. "il premio è 1.200 € [2]").
Se l'informazione non è negli estratti, dillo chiaramente e suggerisci come restringere la ricerca (gruppo, società, ramo, anno).
Rispondi in italiano, in modo preciso e conciso.

ESTRATTI DEI DOCUMENTI:
---
${context || '(nessun documento trovato per questa ricerca)'}
---`

  const history = (await getMessages(params.id, 20))
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }))

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message },
  ]

  await appendMessage(params.id, 'user', message)
  await maybeSetTitle(params.id, message)
  await logAction({ email: session.email, action: 'chat.corpus', resource: message.slice(0, 120) })

  const { streamChatWithProvider } = await importSharedService<any>('llmService.js')
  const encoder = new TextEncoder()
  let answer = ''
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Prima riga: le citazioni disponibili (JSON), separate dal testo con \n\n.
        controller.enqueue(encoder.encode(JSON.stringify({ citations }) + '\n\n'))
        for await (const chunk of streamChatWithProvider(settings, messages)) {
          answer += chunk
          controller.enqueue(encoder.encode(chunk))
        }
      } catch (err) {
        const msg = `\n[errore: ${(err as Error).message}]`
        answer += msg
        controller.enqueue(encoder.encode(msg))
      } finally {
        // Persiste solo le fonti effettivamente citate nella risposta.
        try {
          const used = citations.filter((c) => answer.includes(`[${c.n}]`))
          await appendMessage(params.id, 'assistant', answer, used.length > 0 ? used : citations.slice(0, 3))
        } catch { /* la risposta è comunque arrivata al client */ }
        controller.close()
      }
    },
  })
  return new NextResponse(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' } })
}
