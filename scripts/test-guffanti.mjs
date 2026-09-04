#!/usr/bin/env node
/**
 * Test E2E locale del motore a stadi sul fascicolo GUFFANTI, profilo "Tutela Legale 3".
 *
 * Estrae le pagine SPAZIALI dei PDF (pdfjs, come il worker), costruisce i docs
 * e lancia extractPolizzaStaged con `polizzaFields` = campi del profilo.
 * Stampa i 23 campi con fonte + la diagnostica. Non tocca il DB.
 *
 * Uso: node scripts/test-guffanti.mjs
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const PDFS = [
  'Polizza GUFFANTI GROUP  PARTNERS S R L   quietanzata e firmata.pdf',
  'Polizza GUFFANTI GROUP  PARTNERS S R L   quietanzata.pdf',
  'Polizza GUFFANTI GROUP & PARTNERS S.R.L..pdf',
]
const DIR = '/Volumes/Dock/francesco/Downloads/guffanti'
const PROFILE_JSON = '/Volumes/Dock/francesco/Downloads/profili-polizza (3) CORRETTO.json'

// Il Set Informativo (DIP/condizioni) è documentazione di PRODOTTO: non contiene
// valori del fascicolo GUFFANTI ed è identico per ogni cliente DAS. La sua
// inclusione moltiplicava i batch (24 pagine × gruppi) senza contribuire valori.

async function extractPages(filePath) {
  // Produce le pagine SPAZIALI (griglia a colonne) come il worker in
  // produzione: pdfjs per l'estrazione del testo con coordinate → ricostruzione
  // a colonne con buildSpatialPage (la stessa trasformazione che applica l'OCR
  // tesseract, preservando l'allineamento "X → voce" dei Profili Cliente).
  const pdfjsMod = await import('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs = pdfjsMod.default || pdfjsMod
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(filePath)),
    useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true, disableFontFace: true,
  }).promise
  const pageTexts = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent({ includeMarkedContent: false })
    // Parole con bbox: spezza i run multi-parola in word level (come fa
    // tesseract) distribuendo la larghezza sui caratteri.
    const words = []
    for (const item of content.items) {
      if (!('str' in item)) continue
      const str = item.str
      if (!str) continue
      const x0 = item.transform[4], y0 = item.transform[5]
      const fs = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10
      const totW = (item.width !== undefined && item.width > 0) ? item.width : str.length * fs * 0.6
      const parts = str.match(/\S+/g) || []
      let pos = 0
      const cw = totW / str.length
      for (const p of parts) {
        const idx = str.indexOf(p, pos)
        pos = idx + p.length
        const wpx = cw * (p.length + 1.5)
        words.push({ text: p, x0: x0 + idx, x1: x0 + idx + wpx, y0, y1: y0 + fs, cy: y0 + fs / 2, h: fs, bbox: { x0: x0 + idx, x1: x0 + idx + wpx, y0, y1: y0 + fs } })
      }
    }
    if (!words.length) continue
    // Ordina per centro-y → righe visive; buildSpatialPage si aspetta blocks.
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
    if (spatial.trim()) pageTexts.push(spatial.trim())
  }
  return pageTexts
}

// importa i servizi condivisi
const svc = await import(join(root, 'src/services/polizzaService.js'))
const { buildSpatialPage, collapseSpatial } = await import(join(root, 'src/services/ocrLayout.js'))

const profiles = JSON.parse(readFileSync(PROFILE_JSON, 'utf8'))
const profile = profiles.find((p) => p.name === 'Tutela Legale 3')
if (!profile) { console.error('Profilo "Tutela Legale 3" non trovato'); process.exit(2) }
const fields = profile.fields.filter((f) => f.enabled !== false)
console.log(`Profilo: ${profile.name} — ${fields.length} campi attivi`)

const docs = []
for (const f of PDFS) {
  const pages = await extractPages(join(DIR, f))
  const flat = pages.map((p) => collapseSpatial(p)).join('\n')
  docs.push({ name: f, pages, text: flat })
  console.log(`  doc: ${f} — ${pages.length} pagine, ${flat.length} char`)
}

const settings = {
  ollamaUrl: 'http://192.168.37.10:11434',
  ollamaModel: 'qwen3:8b',
  polizzaFields: fields,
  polizzaConstrainedJson: true,
  polizzaPerField: false, // motore a stadi (come nel log GUFFANTI)
  polizzaStagedCascade: false,
  polizzaOcrEnabled: false,
  embeddingModel: 'bge-m3',
  // qwen3:8b entra in 8 GB VRAM a 6,4 GB con ctx <=8-16K. Il default
  // polizzaBatchContext (24576) portava le prime eval a bloccarsi: lo
  // riduciamo a 8192 per il test (veloce e sicuro).
  polizzaBatchContext: 8192,
}

const diag = []
const started = Date.now()
try {
  const res = await svc.extractPolizzaStaged(docs, settings, (p) => {})
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\n=== RISULTATO (${secs}s) — ${Object.keys(res.data).length}/${fields.length} campi ===`)
  for (const f of fields) {
    const v = res.data[f.id]
    const src = res.sources?.[f.id]
    const label = f.label || f.id
    console.log(`  ${v != null && v !== '' ? 'OK ' : '-- '} ${String(label).padEnd(42)} = ${v != null && v !== '' ? String(v).slice(0, 90) : '(vuoto)'}${src ? `  [${src.file}${src.page ? ` p${src.page}` : ''}]` : ''}`)
  }
  console.log('\n=== DIAGNOSTICA (ultime 40 righe) ===')
  for (const line of (res.diag || diag).slice(-40)) console.log(line)
} catch (err) {
  console.error('ERRORE:', err.message)
  console.error(err)
  process.exit(1)
}