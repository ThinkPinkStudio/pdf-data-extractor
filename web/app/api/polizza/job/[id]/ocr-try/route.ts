import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getJobFiles } from '@/lib/polizzaJobStore'
import { getSettings } from '@/lib/settingsStore'
import { loadPdfServer } from '@/lib/pdfRenderServer'

export const runtime = 'nodejs'
export const maxDuration = 900

// DIAGNOSTICA (08/10/2026): prova UN modello visivo con UN prompt su UNA pagina
// di un job e restituisce la risposta grezza. Serve a confrontare in minuti i
// modelli per documenti (tabelle con celle esplicite: GLM-OCR, PaddleOCR-VL,
// granite-docling, QwenVL HTML) sulle pagine scansionate vere, senza lanciare
// una copia completa del fascicolo. Non scrive nulla: niente cache OCR, niente
// job. Una prova alla volta (la GPU è condivisa con le estrazioni).
let busy = false

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { idx?: number; page?: number; model?: string; prompt?: string; longSide?: number; numPredict?: number; numCtx?: number; preprocess?: boolean; system?: string } = {}
  try { body = await req.json() } catch { /* corpo vuoto */ }
  const model = String(body.model || '').trim()
  if (!/^[\w.:\/@-]{2,120}$/.test(model)) return NextResponse.json({ error: 'model non valido' }, { status: 400 })
  if (busy) return NextResponse.json({ error: 'una prova è già in corso' }, { status: 409 })
  busy = true
  const t0 = Date.now()
  try {
    const files = await getJobFiles(params.id)
    const f = files.find((x) => x.idx === (Number.isInteger(body.idx) ? body.idx : files[0]?.idx))
    if (!f) return NextResponse.json({ error: 'file non trovato' }, { status: 404 })
    const doc = await loadPdfServer(Buffer.from(f.pdf_base64, 'base64'))
    let png = ''
    try {
      const page = Math.max(1, Math.min(doc.numPages, Number(body.page) || 1))
      png = await doc.renderPage(page, { longSide: Number(body.longSide) || 1800, preprocess: body.preprocess === true })
    } finally {
      await doc.destroy()
    }
    const settings: any = await getSettings().catch(() => ({}))
    const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
    const b64 = png.replace(/^data:image\/[a-z]+;base64,/i, '')
    const messages = [
      ...(body.system ? [{ role: 'system', content: body.system }] : []),
      { role: 'user', content: String(body.prompt ?? ''), images: [b64] },
    ]
    // stream:true: chiudere la connessione ferma la generazione (con stream:false
    // il timeout del client lascia generazioni-zombie sul server).
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 840000)
    let content = '', thinking = '', done: any = null
    try {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true, options: { temperature: 0, num_ctx: Number(body.numCtx) || 16384, num_predict: Number(body.numPredict) || 8192 } }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) return NextResponse.json({ error: `Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 400)}` }, { status: 502 })
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done: end } = await reader.read()
        if (end) break
        buf += dec.decode(value, { stream: true })
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
          if (!line) continue
          try {
            const j = JSON.parse(line)
            if (j.message?.content) content += j.message.content
            if (j.message?.thinking) thinking += j.message.thinking
            if (j.done) done = j
            if (j.error) return NextResponse.json({ error: String(j.error) }, { status: 502 })
          } catch { /* riga parziale */ }
        }
      }
    } finally {
      clearTimeout(timer)
    }
    return NextResponse.json({
      model, file: f.file_name, page: Number(body.page) || 1, seconds: Math.round((Date.now() - t0) / 100) / 10,
      evalCount: done?.eval_count ?? null, promptEvalCount: done?.prompt_eval_count ?? null, doneReason: done?.done_reason ?? null,
      content, thinking: thinking || undefined,
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  } finally {
    busy = false
  }
}
