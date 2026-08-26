#!/usr/bin/env node
// PROBE A/B ESTESO — 3 casi (A: CEDAM RC Prof V3, B: NEBULONI RC PROF MED V2, C: fabbricati).
// Pipeline FEDELE ai worker di produzione: render pdfjs@4400px + @napi-rs/canvas →
// OCR spaziale Tesseract ita → cache versionata out/ocr/ → extractPolizzaStaged
// (perField=false, cascade=false, constrained JSON schema, precheck secondo caso).
// Tipi espliciti dei campi: i `fields` sono ESATTAMENTE quelli del profilo (con
// field.type), non ripuliti.
// NON è parte del progetto: non committare.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

const here = dirname(fileURLToPath(import.meta.url))
const canvasMod = await import(pathToFileURL(join(here, 'web/node_modules/@napi-rs/canvas/index.js')).href)
const createCanvas = canvasMod.createCanvas

const svc = await import('./src/main/services/polizzaService.js')
const precheckSvc = await import('./src/main/services/polizzaPrecheckService.js')
const layout = await import('./src/main/services/ocrLayout.js')
const scan = await import('./src/main/services/polizzaNumericScan.js')
const { usefulLength } = layout

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const EMBED = 'bge-m3'
const OCR_CACHE = join(here, 'out/ocr')
const PROFILI = process.env.PROFILI_JSON || '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'

const RENDER_LONG_SIDE = 4400
const RENDER_MAX_SCALE = 6

const CASI = {
  A: {
    id: 'A',
    nome: 'CEDAM ITALIA SRL - RC Professionale',
    zipRoot: '/tmp/prep_casi/zip1/campione polizze x test 07 08 2026 1',
    fascicolo: 'in vigore',
    profilo: 'Rc Professionale V3',
    folderCacheKey: 'in_vigore',
    skipFiles: [],
  },
  B: {
    id: 'B',
    nome: 'NEBULONI MAURO CARLO - RC Professionale Medico (AmTrust)',
    zipRoot: '/tmp/prep_casi/zip2/campione polizze x test 07 08 2026 2',
    fascicolo: 'in vigore 3',
    profilo: 'RC PROF MED V2',
    folderCacheKey: 'in_vigore_3',
    skipFiles: ['Set_Informativo_AmTrust_Medico_Protetto_Ed062024_Agg072025.pdf'],
  },
  C: {
    id: 'C',
    nome: 'Cond Via della libertà 55 - Globale Fabbricati',
    zipRoot: '/tmp/prep_casi/zip1/campione polizze x test 07 08 2026 1',
    fascicolo: 'Cond Via della libertà 55',
    profilo: null, // testato contro i profili A e B
    folderCacheKey: 'cond_via_della_liberta_55',
    skipFiles: [],
  },
}

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.max(1, width), Math.max(1, height))
    return { canvas, context: canvas.getContext('2d') }
  }
  reset(cc, w, h) { cc.canvas.width = Math.max(1, w); cc.canvas.height = Math.max(1, h) }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; cc.canvas = null; cc.context = null }
}

async function renderPageToPng(doc, pageNum) {
  const page = await doc.getPage(pageNum)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(RENDER_MAX_SCALE, RENDER_LONG_SIDE / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })
  const canvasFactory = new NodeCanvasFactory()
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
    try { pages.push(await renderPageToPng(doc, i)) }
    catch (e) { console.log(`  ⚠ pagina ${i} non renderizzabile: ${e.message}`); pages.push(null) }
  }
  try { await doc.destroy() } catch {}
  return pages
}

async function buildDocsForFascicolo(c) {
  const folder = join(c.zipRoot, c.fascicolo)
  const pdfs = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf'))
    .filter((f) => !c.skipFiles.includes(f))
  if (!pdfs.length) throw new Error(`Nessun PDF in ${folder}`)
  const docs = []
  for (const f of pdfs) {
    const cacheFile = join(OCR_CACHE, `${c.folderCacheKey}__${f.replace(/[^a-z0-9.]+/gi, '_')}.json`)
    let pages = null
    try { pages = JSON.parse(readFileSync(cacheFile, 'utf8')) } catch {}
    if (Array.isArray(pages) && pages.length) {
      console.log(`— ${f}: OCR dalla cache ${OCR_CACHE}/${cacheFile.split('/').pop()} (${pages.filter((p) => p && p.trim()).length}/${pages.length} pagine con testo)`)
    } else {
      console.log(`— ${f}: CACHE MANCANTE → render pdfjs + OCR Tesseract ita spaziale …`)
      const pngs = await pdfToPngs(join(folder, f))
      pages = []
      for (let i = 0; i < pngs.length; i++) {
        if (!pngs[i]) { pages.push(''); continue }
        const t = await svc.ocrPageText(pngs[i], settingsForSvc())
        pages.push(t)
        process.stdout.write(`p${i + 1}=${(t || '').length}ch `)
      }
      console.log('\n— salvataggio cache OCR …')
      mkdirSync(OCR_CACHE, { recursive: true })
      writeFileSync(cacheFile, JSON.stringify(pages))
    }
    const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
    const valid = spatial.filter((p) => p && p.trim())
    const chars = spatial.reduce((s, p) => s + p.length, 0)
    const useful = spatial.reduce((s, p) => s + usefulLength(p), 0)
    console.log(`  → ${spatial.length} pagine, ${valid.length} con testo, ${chars} char (useful ${useful})`)
    if (valid.length) docs.push({ name: f, pages: spatial })
  }
  if (!docs.length) throw new Error(`Nessun documento utilizzabile per ${c.fascicolo}`)
  return docs
}

function settingsForSvc(over = {}) {
  return {
    ollamaUrl: OLLAMA_URL,
    ollamaModel: MODEL,
    embeddingModel: EMBED,
    ollamaNumCtx: 24576,
    llmProvider: 'ollama',
    polizzaOcrEnabled: true,
    ...over,
  }
}

const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))

function profiloByName(name) {
  const p = profili.find((x) => x.name === name)
  if (!p) throw new Error(`Profilo non trovato: ${name}`)
  return p
}

function makeSettings(c, profilo) {
  const fields = (profilo.fields || []).filter((f) => f.enabled !== false)
  return settingsForSvc({
    polizzaFields: fields,
    polizzaPromptExtra: profilo.promptExtra || '',
    polizzaPerField: false,
    polizzaStagedCascade: false,
    polizzaConstrainedJson: true,
    polizzaConstrainedFormat: 'schema',
    polizzaPrecheckMode: 'off',
    polizzaAutoVerify: false,
    polizzaArchivio: false,
  })
}

// ── normalizzazione del confronto valori ──────────────────────────────────────
function normVal(v) {
  return String(v == null ? '' : v)
    .toLowerCase()
    .replace(/[.,]/g, (m) => (m === ',' ? '.' : ''))
    .replace(/[\s.]+/g, ' ')
    .trim()
}

async function extractCase(c) {
  console.log(`\n══════════════════════════════════════════════════════════════════`)
  console.log(`CASO ${c.id} — ${c.nome}`)
  console.log(`══════════════════════════════════════════════════════════════════`)
  const profilo = c.profilo ? profiloByName(c.profilo) : null
  const docs = await buildDocsForFascicolo(c)
  const settings = makeSettings(c, profilo)
  const caseId = c.id || 'X'
  const outFile = `out/_ab_caso_${caseId}.json`
  const t0 = Date.now()
  let res
  try {
    res = await svc.extractPolizzaFromDocs(docs, null, settings, (p) => {
      const label = p.field != null ? `campo ${p.field}/${p.fieldTotal}` : `batch ${p.batch}/${p.batchTotal}`
      process.stdout.write(`\r· ${label}   `)
    })
  } catch (e) {
    console.error('\nERRORE estrazione:', e?.message || e)
    if (e?.diag) for (const l of e.diag) console.error('  diag:', l)
    process.exit(3)
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n\nFatto in ${secs}s. Campi estratti: ${Object.keys(res.data || {}).length}\n`)
  for (const [k, v] of Object.entries(res.data || {})) {
    const src = res.sources?.[k]
    console.log(`  ${k} = ${v}${src ? `  [${src.file} · pag.${src.page}]` : ''}`)
  }
  console.log('\n— DIAGNOSTICA —')
  for (const l of res.diag || []) console.log(l)
  mkdirSync('out', { recursive: true })
  writeFileSync(outFile, JSON.stringify({
    caso: caseId, nome: c.nome, profilo: profilo?.name || null,
    model: MODEL, secs,
    data: res.data, sources: res.sources, reliability: res.reliability, diag: res.diag,
    fields: (profilo?.fields || []).filter((f) => f.enabled !== false),
  }, null, 2))
  console.log(`\nSalvato in ${outFile}`)
  return res
}

const runCase = process.argv[2] || 'AB'
await svc.probeOcr({})

if (/A/.test(runCase)) await extractCase(CASI.A)
if (/B/.test(runCase)) await extractCase(CASI.B)