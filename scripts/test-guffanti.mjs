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
const PROFILE_JSON = '/tmp/profili-tutela3-corretto.json'

// Il Set Informativo (DIP/condizioni) è documentazione di PRODOTTO: non contiene
// valori del fascicolo GUFFANTI ed è identico per ogni cliente DAS. La sua
// inclusione moltiplicava i batch (24 pagine × gruppi) senza contribuire valori.

async function extractPages(filePath) {
  // Stessa logica di extractTextWithPdfjsSpatial (polizzaService.js).
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
    let pageText = ''
    let prevX = null, prevY = null
    for (const item of content.items) {
      if (!('str' in item)) continue
      const x = item.transform[4], y = item.transform[5]
      if (prevY !== null) {
        const dy = Math.abs(y - prevY)
        const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10
        if (item.hasEOL || dy > fontSize * 0.4) {
          pageText += '\n'
          prevX = null
        } else if (prevX !== null) {
          const gap = x - prevX
          const charW = (item.width > 0 && item.str.length > 0) ? item.width / item.str.length : fontSize * 0.5
          if (gap > charW * 0.3) pageText += ' '
        }
      }
      pageText += item.str
      prevX = x + (item.width || item.str.length * ((Math.abs(item.transform[0]) || 10) * 0.5))
      prevY = y
    }
    if (pageText.trim()) pageTexts.push(pageText.trim())
  }
  return pageTexts
}

// importa i servizi condivisi
const svc = await import(join(root, 'src/services/polizzaService.js'))
const { collapseSpatial } = await import(join(root, 'src/services/ocrLayout.js'))

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