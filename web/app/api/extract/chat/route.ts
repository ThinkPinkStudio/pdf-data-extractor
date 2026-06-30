import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'
import { importSharedService } from '@/lib/sharedServices'
import { logAction } from '@/lib/logger'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Chat in streaming su un documento PDF (come pdf:chat del desktop, single-doc):
// carica il PDF, cerca i chunk rilevanti, costruisce il prompt e fa streaming
// della risposta del provider AI via streamChatWithProvider.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const message = (form?.get('message') as string) || ''
  const history = JSON.parse((form?.get('history') as string) || '[]')
  const pdf = form?.get('pdf')
  if (!message || !(pdf instanceof File)) {
    return NextResponse.json({ error: 'message/pdf mancanti' }, { status: 400 })
  }

  const stored = await getSettings()
  const tmp = join(tmpdir(), `chat-${randomUUID()}.pdf`)
  await writeFile(tmp, Buffer.from(await pdf.arrayBuffer()))

  try {
    const { loadPDF, searchChunks } = await importSharedService<any>('pdfService.js')
    const { streamChatWithProvider } = await importSharedService<any>('llmService.js')
    const { numPages, chunks } = await loadPDF(tmp)
    const relevant = searchChunks(message, chunks, 5)
    const context = (relevant.length > 0 ? relevant : chunks.slice(0, 3)).map((c: any) => c.text).join('\n\n---\n\n')
    const systemPrompt = `Sei un assistente che risponde a domande su un documento PDF.
Il documento si chiama "${pdf.name}" e ha ${numPages} pagine.
Rispondi in modo preciso e conciso, basandoti esclusivamente sul testo fornito.
Se l'informazione non è presente nel documento, dillo chiaramente.

Parti rilevanti del documento:
---
${context}
---`
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10),
      { role: 'user', content: message },
    ]

    await logAction({ email: session.email, action: 'extract.chat', resource: pdf.name })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamChatWithProvider(stored, messages)) {
            controller.enqueue(encoder.encode(chunk))
          }
        } catch (err) {
          controller.enqueue(encoder.encode(`\n[errore: ${(err as Error).message}]`))
        } finally {
          await unlink(tmp).catch(() => {})
          controller.close()
        }
      },
    })
    return new NextResponse(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' } })
  } catch (err) {
    await unlink(tmp).catch(() => {})
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
