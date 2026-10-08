// TABELLE DELLE PAGINE SCANSIONATE (flag del motore `tabelleocr`, 08/10/2026).
//
// Il modello visivo che trascrive le scansioni (qwen3-vl) separa le celle con
// spazi ma non le incolonna e salta le celle vuote: gli importi di una scheda
// premi non dicono a quale colonna appartengono. Qui, per le sole pagine
// SCANSIONATE di un documento:
//   1. il servizio Docling (`/layout`, PP-DocLayoutV2) trova i riquadri delle tabelle;
//   2. la pagina si rende come per l'OCR visivo (1800 px) e ogni riquadro si ritaglia;
//   3. un modello per tabelle (GLM-OCR, «Table Recognition:») restituisce il
//      ritaglio in HTML con le celle esplicite, anche vuote o unite;
//   4. l'HTML diventa una griglia incolonnata (`htmlTableToGrid`) aggiunta in
//      fondo al testo della pagina.
// Il testo dell'OCR resta com'è (cache di sempre); le pagine con le tabelle
// hanno una voce di cache a parte (`<chiave>:tab1:<modello>`). Mai bloccante:
// un guasto lascia le pagine invariate.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { loadPdfServer } from './pdfRenderServer'
import { getOcrCache, putOcrCache } from './polizzaJobStore'
import { importSharedService } from './sharedServices'

type Box = { l: number; t: number; r: number; b: number; score: number }

async function tableHtml(url: string, model: string, pngB64: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 180000)
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // stream:true: chiudere la connessione ferma la generazione sul server
      body: JSON.stringify({ model, prompt: 'Table Recognition:', images: [pngB64], stream: true, options: { temperature: 0, num_ctx: 16384, num_predict: 4096 } }),
      signal: ctrl.signal,
    })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = '', out = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        if (!line) continue
        try { const j = JSON.parse(line); if (j.response) out += j.response; if (j.error) throw new Error(String(j.error)) } catch (e: any) { if (!(e instanceof SyntaxError)) throw e }
      }
      // la prima tabella basta (il modello a volte la ripete)
      if (out.includes('</table>')) { ctrl.abort(); break }
    }
    return out
  } catch (e: any) {
    if (e?.name === 'AbortError') return ''
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Pagine con le tabelle delle scansioni aggiunte in fondo. `scanned`: indici
 * (0-based) delle pagine lette con l'OCR. Restituisce le pagine invariate se il
 * flag è spento, mancano gli indirizzi o qualcosa non va.
 */
export async function withScanTables(opts: {
  buf: Buffer; docName: string; pages: string[]; scanned: number[]; baseKey: string; settings: any; log: (line: string) => Promise<void> | void
}): Promise<string[]> {
  const { buf, docName, pages, scanned, baseKey, settings, log } = opts
  try {
    const flags = await importSharedService<{ engineFlag: (s: any, n: string) => boolean }>('engineFlags.js')
    if (!flags.engineFlag(settings, 'tabelleocr') || !scanned.length) return pages
    const url = String(settings?.polizzaTableOcrUrl || '').trim()
    const model = String(settings?.polizzaTableOcrModel || 'glm-ocr').trim()
    const layoutUrl = String(settings?.polizzaLayoutUrl || settings?.doclingUrl || '').trim().replace(/\/+$/, '')
    if (!url || !layoutUrl) return pages
    const key = `${baseKey}:tab1:${model}`
    const cached = await getOcrCache(key).catch(() => null)
    if (cached && cached.length === pages.length) {
      await log(`Tabelle delle scansioni dalla CACHE per "${docName}"`)
      return cached
    }
    const lay = await fetch(`${layoutUrl}/layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_base64: buf.toString('base64'), pages: scanned.map((i) => i + 1), long_side: 1800 }),
      signal: AbortSignal.timeout(300000),
    })
    if (!lay.ok) throw new Error(`layout HTTP ${lay.status}`)
    const layout = (await lay.json()) as { pages: { page: number; boxes: Box[] }[] }
    const tab = await importSharedService<{ htmlTableToGrid: (html: string) => string }>('tableHtml.js')
    const out = pages.slice()
    let nTables = 0, nPages = 0
    const doc = await loadPdfServer(buf)
    try {
      for (const p of layout.pages || []) {
        if (!p.boxes?.length || p.page < 1 || p.page > pages.length) continue
        const png = await doc.renderPage(p.page, { longSide: 1800, preprocess: false })
        const img = await loadImage(Buffer.from(png.replace(/^data:image\/[a-z]+;base64,/i, ''), 'base64'))
        const grids: string[] = []
        // dall'alto in basso, come si legge la pagina
        for (const b of [...p.boxes].sort((x, y) => x.t - y.t)) {
          const pad = 6
          const x0 = Math.max(0, Math.floor(b.l * img.width) - pad), y0 = Math.max(0, Math.floor(b.t * img.height) - pad)
          const x1 = Math.min(img.width, Math.ceil(b.r * img.width) + pad), y1 = Math.min(img.height, Math.ceil(b.b * img.height) + pad)
          if (x1 - x0 < 40 || y1 - y0 < 20) continue
          const c = createCanvas(x1 - x0, y1 - y0)
          c.getContext('2d').drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0)
          const html = await tableHtml(url, model, c.toBuffer('image/png').toString('base64'))
          const grid = tab.htmlTableToGrid(html)
          if (grid) grids.push(grid)
        }
        if (grids.length) {
          out[p.page - 1] = `${pages[p.page - 1] || ''}\n\n${grids.join('\n\n')}`
          nTables += grids.length
          nPages++
        }
      }
    } finally {
      await doc.destroy()
    }
    await log(`Tabelle delle scansioni (${model}): ${nTables} tabelle su ${nPages} pagine di "${docName}" (${scanned.length} pagine scansionate)`)
    try { await putOcrCache(key, docName, out) } catch { /* non fatale */ }
    return out
  } catch (e: any) {
    await log(`Tabelle delle scansioni per "${docName}" non lette (${String(e?.message || e).slice(0, 160)}): testo dell'OCR invariato`)
    return pages
  }
}
