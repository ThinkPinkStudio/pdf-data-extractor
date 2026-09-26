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
    // Stesso codice del worker: src/services/pdfTextLayer.js.
    const { spatialPagesFromPdf } = await import('../src/services/pdfTextLayer.js')
    const pages = await spatialPagesFromPdf(readFileSync(pdfArg))
    if (pages.some((p) => p.trim())) { spatialPages = pages; console.log(`[pdfjs] griglia spaziale ${pages.length} pagine (colonne reali)`) }
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