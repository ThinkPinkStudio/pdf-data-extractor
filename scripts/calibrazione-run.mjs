#!/usr/bin/env node
/**
 * Runner E2E per calibrazione: estrae i dati di un profilo da una cartella di PDF
 * e salva il risultato in un JSON { data: { campo: valore } }.
 *
 * Modellato su test-guffanti.mjs (pdfjs spaziale + extractPolizzaStaged).
 *
 * Uso:
 *   node scripts/calibrazione-run.mjs --dir <cartella> --profile "<Nome profilo>" --out <out.json> [--files "a.pdf,b.pdf"] [--ollama <url>]
 *
 * Se --files è omesso usa TUTTI i PDF della cartella (esclude .txt/.json).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}

const dir = arg('dir')
const profileName = arg('profile')
const out = arg('out')
const filesArg = arg('files')
const ollamaUrl = arg('ollama', 'http://192.168.37.10:11434')
const profileJson = arg('profile-json', join(root, 'polizze_test/profili-polizza (5).json'))
const onlyFields = arg('only-fields') // lista id separati da virgola
const ctx = arg('ctx') ? Number(arg('ctx')) : 8192
if (!dir || !profileName || !out) {
  console.error('Uso: node scripts/calibrazione-run.mjs --dir <cartella> --profile "<Nome>" --out <out.json> [--files "a,b"] [--ollama <url>] [--profile-json <file>] [--only-fields "id1,id2"]')
  process.exit(2)
}

const PROFILE_JSON = profileJson
const profiles = JSON.parse(readFileSync(PROFILE_JSON, 'utf8'))
const profile = profiles.find((p) => p.name === profileName)
if (!profile) { console.error(`Profilo "${profileName}" non trovato`); process.exit(2) }
let fields = profile.fields.filter((f) => f.enabled !== false)
if (onlyFields) {
  const keep = new Set(onlyFields.split(',').map((s) => s.trim()).filter(Boolean))
  fields = fields.filter((f) => keep.has(f.id))
}
console.log(`Profilo: ${profile.name} — ${fields.length} campi attivi${onlyFields ? ' (solo --only-fields)' : ''}`)

const svc = await import(join(root, 'src/services/polizzaService.js'))
const { buildSpatialPage, collapseSpatial } = await import(join(root, 'src/services/ocrLayout.js'))

async function extractPages(filePath) {
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

let files
if (filesArg) {
  files = filesArg.split(',').map((s) => s.trim()).filter(Boolean)
} else {
  files = readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort()
}
console.log(`File da elaborare (${files.length}):`)
for (const f of files) console.log(`  - ${f}`)

const docs = []
for (const f of files) {
  const p = join(dir, f)
  if (!existsSync(p)) { console.warn(`  !! manca: ${f}`); continue }
  let pages = await extractPages(p)
  const flat = pages.map((pg) => collapseSpatial(pg)).join('\n')
  docs.push({ name: f, pages, text: flat })
  console.log(`  doc: ${f} — ${pages.length} pagine, ${flat.length} char`)
}
if (!docs.length) { console.error('Nessun documento utilizzabile.'); process.exit(2) }

// OCR attivo solo se servono pagine (scan senza text layer): per i PDF con
// testo leggibile l'OCR è uno spreco. I docs hanno `pages` (piatta) già
// popolate; una pagina vuota = potrebbe essere scan → attiviamo Tesseract.
const hasEmptyPage = docs.some((d) => (d.pages || []).some((p) => !String(p || '').trim()))

const settings = {
  ollamaUrl,
  ollamaModel: 'qwen3:8b',
  polizzaFields: fields,
  polizzaConstrainedJson: true,
  polizzaPerField: false,
  polizzaStagedCascade: false,
  polizzaOcrEnabled: hasEmptyPage,
  embeddingModel: 'bge-m3',
  polizzaBatchContext: ctx,
}

const started = Date.now()
try {
  const res = await svc.extractPolizzaStaged(docs, settings, () => {})
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  const dataOut = {}
  for (const f of fields) {
    const v = res.data[f.id]
    if (v != null && v !== '') dataOut[f.id] = v
  }
  writeFileSync(out, JSON.stringify({ data: dataOut }, null, 2))
  console.log(`\n=== RISULTATO (${secs}s) — ${Object.keys(dataOut).length}/${fields.length} campi ===`)
  for (const f of fields) {
    const v = res.data[f.id]
    const src = res.sources?.[f.id]
    const label = f.label || f.id
    console.log(`  ${v != null && v !== '' ? 'OK ' : '-- '} ${String(label).padEnd(42)} = ${v != null && v !== '' ? String(v).slice(0, 80) : '(vuoto)'}${src ? `  [${src.file}${src.page ? ` p${src.page}` : ''}]` : ''}`)
  }
  console.log(`\nSalvato in ${out}`)
  const diagPath = out.replace(/\.json$/, '-diag.txt')
  writeFileSync(diagPath, (res.diag || []).join('\n'))
  console.log(`Diagnostica in ${diagPath}`)
} catch (err) {
  console.error('ERRORE:', err.message)
  console.error(err)
  process.exit(1)
}
