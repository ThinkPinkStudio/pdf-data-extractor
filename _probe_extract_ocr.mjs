#!/usr/bin/env node
// PROBE TEMPORANEA — estrazione headless FEDELE alla pipeline di produzione:
//   render PNG @4400px (pdfjs + @napi-rs/canvas) → ocrPageText (Tesseract ita,
//   testo spaziale a colonne) → extractPolizzaFromDocs con profilo RC PROF MED V2.
// NON è parte del progetto: da cancellare dopo l'uso.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pathToFileURL } from 'url'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

const here = dirname(fileURLToPath(import.meta.url))
const canvasMod = await import(pathToFileURL(join(here, 'web/node_modules/@napi-rs/canvas/index.js')).href)
const createCanvas = canvasMod.createCanvas
const svc = await import('./src/main/services/polizzaService.js')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const FASCICOLO = process.argv[2] || 'in vigore'
const ROOT = '/tmp/campione_polizze/campione polizze x test 07 08 2026 1'
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'
const OUT = `out/probe_${FASCICOLO.replace(/[^a-z0-9]+/gi, '_')}.json`

const RENDER_LONG_SIDE = 4400
const RENDER_MAX_SCALE = 6

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.max(1, width), Math.max(1, height))
    return { canvas, context: canvas.getContext('2d') }
  }
  reset(cc, w, h) { cc.canvas.width = Math.max(1, w); cc.canvas.height = Math.max(1, h) }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; cc.canvas = null; cc.context = null }
}

async function renderPageToPng(doc, pageNum, canvasFactory) {
  const page = await doc.getPage(pageNum)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(RENDER_MAX_SCALE, RENDER_LONG_SIDE / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })
  const cc = canvasFactory.create(viewport.width, viewport.height)
  await page.render({ canvasContext: cc.context, viewport, canvasFactory }).promise
  try {
    const imgData = cc.context.getImageData(0, 0, cc.canvas.width, cc.canvas.height)
    const d = imgData.data
    const contrast = 1.35
    const intercept = 128 * (1 - contrast)
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      g = g * contrast + intercept
      d[i] = d[i + 1] = d[i + 2] = g < 0 ? 0 : g > 255 ? 255 : g
    }
    cc.context.putImageData(imgData, 0, 0)
  } catch {}
  const png = cc.canvas.toDataURL('image/png')
  page.cleanup()
  canvasFactory.destroy(cc)
  return png
}

async function pdfToPngs(file) {
  const data = new Uint8Array(readFileSync(file))
  pdfjs.GlobalWorkerOptions.workerSrc = ''
  let doc
  try {
    doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useWorkerFetch: false,
      disableFontFace: true,
      canvasFactory: new NodeCanvasFactory(),
    }).promise
  } catch (e) {
    console.log(`  ⚠ ${file.split('/').pop()}: PDF illeggibile (${e.message})`)
    return []
  }
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      pages.push(await renderPageToPng(doc, i, new NodeCanvasFactory()))
    } catch (e) {
      console.log(`  ⚠ pagina ${i} non renderizzabile: ${e.message}`)
      pages.push(null) // segnale per mantenerla vuota in OCR
    }
  }
  try { await doc.destroy() } catch {}
  return pages
}

const profile = JSON.parse(readFileSync(PROFILI, 'utf8')).find((p) => p.name === 'RC PROF MED V2')
if (!profile) { console.error('Profilo RC PROF MED V2 non trovato'); process.exit(2) }
const fields = (profile.fields || []).filter((f) => f.enabled !== false)
console.log(`Profilo "${profile.name}" — ${fields.length} campi attivi`)

const settings = {
  ollamaUrl: OLLAMA_URL,
  ollamaModel: MODEL,
  embeddingModel: 'bge-m3',
  ollamaNumCtx: 16384,
  polizzaFields: fields,
  polizzaPromptExtra: profile.promptExtra || '',
  polizzaPerField: true,
  polizzaConstrainedJson: true,
  polizzaConstrainedFormat: 'schema',
}

const folder = join(ROOT, FASCICOLO)
const files = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf'))
const t0 = Date.now()
mkdirSync('out/ocr', { recursive: true })
console.log(`Rendering + OCR (Tesseract ita) su ${files.length} file …`)
const docs = []
for (const f of files) {
  const cacheFile = join('out/ocr', `${FASCICOLO.replace(/[^a-z0-9]+/gi, '_')}__${f.replace(/[^a-z0-9.]+/gi, '_')}.json`)
  let pages = null
  try { pages = JSON.parse(readFileSync(cacheFile, 'utf8')) } catch {}
  if (Array.isArray(pages) && pages.length) {
    console.log(`— ${f}: OCR riusato dalla cache locale (${pages.length} pagine)`)
    docs.push({ name: f, pages })
    continue
  }
  const pngs = await pdfToPngs(join(folder, f))
  pages = []
  for (let i = 0; i < pngs.length; i++) {
    if (!pngs[i]) { pages.push(''); continue }
    const txt = await svc.ocrPageText(pngs[i], settings)
    pages.push(txt)
    process.stdout.write(`p${i + 1}=${(txt || '').length}ch `)
  }
  console.log(`— ${f} → ${pages.length} pagine (${pages.filter((p) => p && p.trim()).length} col testo)`)
  writeFileSync(cacheFile, JSON.stringify(pages))
  docs.push({ name: f, pages })
}
const fullText = docs.map((d) => `===== DOCUMENTO: ${d.name} =====\n${d.pages.join('\n')}`).join('\n')
const useful = docs.filter((d) => d.pages.some((p) => p && p.trim()))
console.log(`\nLeggibili: ${useful.length}/${docs.length} documenti. Lancio estrazione…`)

const t1 = Date.now()
const result = await svc.extractPolizzaFromDocs(useful, fullText, settings, (p) => {
  const label = p.field != null ? `campo ${p.field}/${p.fieldTotal}` : `batch ${p.batch}/${p.batchTotal}`
  process.stdout.write(`\r· ${label}   `)
})
const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n\nFatto in ${secs}s (di cui OCR ${((t1 - t0) / 1000).toFixed(1)}s). Campi: ${Object.keys(result.data || {}).length}\n`)
for (const [k, v] of Object.entries(result.data || {})) {
  const src = result.sources?.[k]
  console.log(`  ${k} = ${v}${src ? `  [${src.file} · pag.${src.page}]` : ''}`)
}
console.log('\n— DIAGNOSTICA —')
for (const l of result.diag || []) console.log(l)

mkdirSync('out', { recursive: true })
const out = {
  profilo: profile.name, fascicolo: FASCICOLO, modello: MODEL, secs,
  data: result.data, sources: result.sources, diag: result.diag,
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`\nSalvato in ${OUT}`)