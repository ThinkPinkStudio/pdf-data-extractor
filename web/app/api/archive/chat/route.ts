import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'
import { importSharedService } from '@/lib/sharedServices'
import { listJobsForChat } from '@/lib/polizzaJobStore'
import { withGlobalLock } from '@/lib/llmSemaphore'

export const runtime = 'nodejs'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface VectorSvc {
  isVectorIndexEnabled: (s: unknown) => boolean
  searchVector: (args: {
    query: string; jobId?: string | null; polizzaNumero?: string | null; file?: string | null; limit?: number
  }, s: unknown) => Promise<{ score: number; dossier?: string; file?: string; page?: number; text?: string }[]>
}

// GET: scope disponibili per la chat (fascicoli completati con i loro file)
// + stato dell'indice. La chat interroga SOLO l'archivio Qdrant: l'isolamento
// per fascicolo è il filtro job_id (ermetico per costruzione).
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const settings = await getSettings()
  const vec = await importSharedService<VectorSvc>('vectorIndexService.js')
  const jobs = await listJobsForChat()
  return NextResponse.json({ enabled: vec.isVectorIndexEnabled(settings), jobs })
}

// POST { question, jobId?, polizzaNumero?, file? }: RAG sull'archivio.
// Recupero semantico (top-K chunk nello scope) → risposta di Ollama ancorata ai
// soli estratti, con fonti. Passa dal semaforo globale LLM: mai in parallelo
// alle estrazioni (stessa VRAM).
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const question = String(body.question || '').trim()
  if (!question) return NextResponse.json({ success: false, error: 'Domanda mancante' }, { status: 400 })

  const settings: any = await getSettings()
  const vec = await importSharedService<VectorSvc>('vectorIndexService.js')
  if (!vec.isVectorIndexEnabled(settings)) {
    return NextResponse.json({ success: false, error: 'Indice vettoriale non configurato (URL Qdrant vuoto).' }, { status: 400 })
  }

  try {
    const hits = await vec.searchVector({
      query: question,
      jobId: body.jobId || null,
      polizzaNumero: body.polizzaNumero || null,
      file: body.file || null,
      limit: 12,
    }, settings)

    if (!hits.length) return NextResponse.json({ success: true, answer: null, sources: [] })

    // Contesto: chunk numerati con la fonte, così il modello può citarle.
    const blocks = hits.map((h, i) =>
      `[${i + 1}] (${h.dossier ? `${h.dossier} · ` : ''}${h.file || '?'} · pag. ${h.page ?? '?'})\n${(h.text || '').trim()}`)
    const context = blocks.join('\n---\n')

    const system =
      'Sei un assistente che risponde a domande su documenti assicurativi italiani.\n' +
      'REGOLE TASSATIVE:\n' +
      '1. Rispondi SOLO con informazioni presenti negli ESTRATTI forniti. Se la risposta non c\'è, dillo chiaramente.\n' +
      '2. Cita le fonti con i numeri tra parentesi quadre, es. [1], [3].\n' +
      '3. Se gli estratti si contraddicono (documenti di anni diversi), riporta ENTRAMBI i valori con le date/fonti.\n' +
      '4. Rispondi in italiano, conciso e concreto. Importi e date nel formato del documento.'
    const prompt = `ESTRATTI DEI DOCUMENTI:\n${context}\n\nDOMANDA: ${question}\n\nRisposta (con citazioni [n]):`

    const ollamaUrl = (settings.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')
    const model = settings.ollamaModel || settings.llmModel
    if (!model) return NextResponse.json({ success: false, error: 'Nessun modello Ollama configurato in Impostazioni.' }, { status: 400 })

    // Semaforo globale: la chat non gira mai in parallelo a un'estrazione.
    const answer = await withGlobalLock(async () => {
      const res = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, system, prompt, stream: false,
          options: { temperature: 0.1, num_ctx: 8192, num_predict: 1024 },
        }),
        signal: AbortSignal.timeout(180000),
      })
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
      const data = await res.json()
      return String(data.response || '').trim()
    })

    return NextResponse.json({
      success: true,
      answer: answer || null,
      sources: hits.map((h, i) => ({ n: i + 1, dossier: h.dossier, file: h.file, page: h.page, score: h.score })),
    })
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 })
  }
}
