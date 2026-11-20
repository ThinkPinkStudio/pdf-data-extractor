import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'

export const runtime = 'nodejs'

// Scarica un modello sul server Ollama configurato (08/10/2026: modelli per
// documenti da provare sulle tabelle delle scansioni, GLM-OCR e PaddleOCR-VL).
// Il download può durare minuti: parte in background e lo stato si legge con
// GET (ultimo stato per modello, in memoria del processo). Solo utenti con
// sessione; nessuna impostazione cambia.
type PullState = { status: string; completed?: number; total?: number; error?: string; startedAt: number; endedAt?: number }
const pulls = new Map<string, PullState>()

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ pulls: Object.fromEntries(pulls) })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { model?: string } = {}
  try { body = await req.json() } catch { /* corpo vuoto */ }
  const model = String(body.model || '').trim()
  if (!/^[\w.:\/@-]{2,160}$/.test(model)) return NextResponse.json({ error: 'model non valido' }, { status: 400 })
  const cur = pulls.get(model)
  if (cur && !cur.endedAt) return NextResponse.json({ model, ...cur }, { status: 202 })
  const settings: any = await getSettings().catch(() => ({}))
  const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
  const state: PullState = { status: 'avviato', startedAt: Date.now() }
  pulls.set(model, state)
  void (async () => {
    try {
      const res = await fetch(`${url}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }) })
      if (!res.ok || !res.body) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
          if (!line) continue
          try {
            const j = JSON.parse(line)
            if (j.error) throw new Error(String(j.error))
            if (j.status) state.status = j.status
            if (typeof j.completed === 'number') state.completed = j.completed
            if (typeof j.total === 'number') state.total = j.total
          } catch (e: any) { if (e instanceof Error && !/JSON/.test(e.message)) throw e }
        }
      }
    } catch (e: any) {
      state.error = String(e?.message || e)
    } finally {
      state.endedAt = Date.now()
    }
  })()
  return NextResponse.json({ model, ...state }, { status: 202 })
}
