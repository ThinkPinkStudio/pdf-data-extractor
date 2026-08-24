#!/usr/bin/env node
// PROBE TEMPORANEA — estrazione headless del fascicolo col profilo RC PROF MED V2.
// NON è parte del progetto: va cancellata dopo l'uso.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

const here = dirname(fileURLToPath(import.meta.url))
const m = await import('./src/main/services/polizzaService.js')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const EMBED = 'bge-m3'
const FASCICOLO = process.argv[2] || 'in vigore'
const ROOT = '/tmp/campione_polizze/campione polizze x test 07 08 2026 1'
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'

// ── testo per pagina con pdfjs (piatto) ────────────────────────────────────
async function pdfToPages(file) {
  const buf = readFileSync(file)
  const data = new Uint8Array(buf)
  pdfjs.GlobalWorkerOptions.workerSrc = ''
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, disableFontFace: true }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    const text = tc.items.map((t) => ('str' in t ? t.str : '')).join(' ')
    pages.push(text)
  }
  await doc.destroy()
  return pages
}

// ── profilo RC PROF MED V2 dal JSON ────────────────────────────────────────
const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profilo = profili.find((p) => p.name === 'RC PROF MED V2')
if (!profilo) { console.error('Profilo RC PROF MED V2 non trovato'); process.exit(2) }
const fields = (profilo.fields || []).filter((f) => f.enabled !== false)
console.log(`Profilo: "${profilo.name}" — ${fields.length} campi attivi`)

// ── fascicolo ──────────────────────────────────────────────────────────────
const folder = join(ROOT, FASCICOLO)
const files = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf'))
const docs = []
for (const f of files) {
  const pages = await pdfToPages(join(folder, f))
  docs.push({ name: f, pages })
  const chars = pages.reduce((s, p) => s + (p || '').length, 0)
  console.log(`— ${f} → ${pages.length} pagine, ${chars} char`)
}
const fullText = docs.map((d) => `===== DOCUMENTO: ${d.name} =====\n${d.pages.join('\n')}`).join('\n')

const settings = {
  ollamaUrl: OLLAMA_URL,
  ollamaModel: MODEL,
  embeddingModel: EMBED,
  ollamaNumCtx: 16384,
  polizzaFields: fields,
  polizzaPromptExtra: profilo.promptExtra || '',
  polizzaPerField: true,
  polizzaConstrainedJson: true,
  polizzaConstrainedFormat: 'schema',
}

mkdirSync('out', { recursive: true })
const t0 = Date.now()
console.log(`\nLancio estrazione su ${OLLAMA_URL} / ${MODEL} … (dossier ${FASCICOLO}, ${docs.length} file, ${fields.length} campi)\n`)
let result
try {
  result = await m.extractPolizzaFromDocs(docs, fullText, settings, (p) => {
    const label = p.field != null ? `campo ${p.field}/${p.fieldTotal}` : `batch ${p.batch}/${p.batchTotal}`
    process.stdout.write(`\r· ${label}   `)
  })
} catch (e) {
  console.error('\nERRORE estrazione:', e?.message || e)
  if (e?.diag) for (const l of e.diag) console.error('  diag:', l)
  process.exit(3)
}
const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n\nFatto in ${secs}s. Campi: ${Object.keys(result.data || {}).length}\n`)
for (const [k, v] of Object.entries(result.data || {})) {
  const src = result.sources?.[k]
  console.log(`  ${k} = ${v}${src ? `  [${src.file} · pag.${src.page}]` : ''}`)
}
console.log('\n— DIAGNOSTICA —')
for (const l of result.diag || []) console.log(l)

const out = {
  profilo: profilo.name,
  fascicolo: FASCICOLO,
  modello: MODEL,
  secs,
  data: result.data,
  sources: result.sources,
  diag: result.diag,
}
writeFileSync('out/probe_cedam.json', JSON.stringify(out, null, 2))
console.log('\nSalvato in out/probe_cedam.json')