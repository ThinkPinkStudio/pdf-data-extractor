#!/usr/bin/env node
// Esegue il motore staged usando il markdown prodotto dal container Docling
// (salvato in /tmp/parse-docling-docker3.json come {markdown}).
import { readFileSync } from 'fs'
const parsePath = process.argv[2] || '/tmp/parse-docling-docker3.json'
const profileName = process.argv[3] || 'Tutela Legale 3'

const parse = JSON.parse(readFileSync(parsePath))
const md = parse.markdown || ''
console.log(`[docling] markdown ${md.length} char`)

const profiles = JSON.parse(readFileSync('../polizze_test/profili-polizza-calibrato.json', 'utf8'))
const profile = profiles.find((p) => p.name === profileName)
if (!profile) { console.error('profilo mancante', profileName); process.exit(2) }
const fields = profile.fields.filter((f) => f.enabled !== false)

const svc = await import('../src/services/polizzaService.js')
// ── Setup di produzione: spatialPages = griglia SPAZIALE pdfjs (colonne reali
//    allineate per coordinate), pages = markdown Docling. Se --pdf= è dato,
//    estrae la griglia dal PDF sorgente; altrimenti ripiega sul markdown.
let spatialPages = [md]
let pdfArg = process.argv.find(a => a.startsWith('--pdf='))?.split('=')[1]
if (pdfArg) {
  try {
    const { buildSpatialPage, collapseSpatial } = await import('../src/services/ocrLayout.js')
    const pdfjsMod = await import('pdfjs-dist/legacy/build/pdf.js')
    const pdfjs = pdfjsMod.default || pdfjsMod
    if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''
    const docpdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfArg)), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true, disableFontFace: true }).promise
    const pages = []
    for (let p = 1; p <= docpdf.numPages; p++) {
      const page = await docpdf.getPage(p)
      const content = await page.getTextContent({ includeMarkedContent: false })
      const words = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue
        const x0 = item.transform[4], y0 = item.transform[5]
        const fs = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10
        const totW = item.width && item.width > 0 ? item.width : item.str.length * fs * 0.6
        const parts = item.str.match(/\S+/g) || []
        let pos = 0
        const cw = totW / item.str.length
        for (const w of parts) {
          const idx = item.str.indexOf(w, pos)
          pos = idx + w.length
          const wpx = cw * (w.length + 1.5)
          words.push({ text: w, x0: x0 + idx, x1: x0 + idx + wpx, y0, y1: y0 + fs, cy: y0 + fs / 2, h: fs, bbox: { x0: x0 + idx, x1: x0 + idx + wpx, y0, y1: y0 + fs } })
        }
      }
      if (!words.length) continue
      words.sort((a, b) => a.cy - b.cy || a.x0 - b.x0)
      const rows = []
      let cur = null
      const rowTol = Math.max(1, Math.abs(words[0].h) / 2 || 5)
      for (const w of words) {
        if (cur && Math.abs(w.cy - cur.cy) <= rowTol) { cur.words.push(w); cur.cy = (cur.cy + w.cy) / 2 }
        else { cur = { cy: w.cy, h: w.h, words: [w] }; rows.push(cur) }
      }
      const lines = rows.map((r) => {
        r.words.sort((a, b) => a.x0 - b.x0)
        return { words: r.words.map((w) => ({ text: w.text, bbox: { x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1 } })), rowAttributes: { rowHeight: r.h } }
      })
      const blocks = [{ paragraphs: [{ lines }] }]
      const spatial = buildSpatialPage(blocks)
      if (spatial.trim()) pages.push(spatial.trim())
    }
    if (pages.length) { spatialPages = pages; console.log(`[pdfjs] griglia spaziale ${pages.length} pagine (colonne reali)`) }
  } catch (err) { console.log('[pdfjs] fallback al markdown:', err.message) }
}
const doc = { name: 'lambrate.pdf', pages: [md], spatialPages, text: spatialPages.join('\n') }
const settings = {
  ollamaUrl: 'http://192.168.37.10:11434',
  ollamaModel: process.argv.find(a => a.startsWith('--model='))?.split('=')[1] || 'qwen3:8b',
  polizzaFields: fields,
  polizzaConstrainedJson: true,
  polizzaPerField: false,
  polizzaStagedCascade: false,
  polizzaOcrEnabled: false,
  embeddingModel: process.argv.find(a => a.startsWith('--embed='))?.split('=')[1] || '', // vuoto = disattiva bge-m3 (una sola VRAM per qwen3)
  polizzaBatchContext: 8192,
  polizzaPromptExtra: '',
}
const started = Date.now()
const res = await svc.extractPolizzaStaged([doc], settings, () => {})
const secs = ((Date.now() - started) / 1000).toFixed(1)
console.log(`\n=== RISULTATO (${secs}s) — ${Object.keys(res.data).length}/${fields.length} ===`)
for (const f of fields) {
  const v = res.data[f.id]
  const src = res.sources?.[f.id]
  console.log(`  ${v != null && v !== '' ? 'OK ' : '-- '} ${String(f.label).padEnd(38)} = ${v != null && v !== '' ? String(v).slice(0, 60) : '(vuoto)'}${src ? `  [${src.file}${src.page ? ` p${src.page}` : ''}]` : ''}`)
}
console.log('\n--- DIAG (TUTTO) ---')
for (const l of (res.diag || [])) console.log(' ', String(l).slice(0, 220))