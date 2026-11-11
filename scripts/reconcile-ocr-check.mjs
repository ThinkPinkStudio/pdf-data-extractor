/**
 * VERIFICA della lettura preliminare di riconciliazione (approccio B: Tesseract).
 *
 * Esegue il PERCORSO REALE `readPdfPagesWithOcr` (web/lib/polizzaJobWorker.ts) su
 * un PDF SCANSIONATO vero, con le impostazioni che la riconciliazione usa adesso
 * (`polizzaOcrEngine: 'tesseract'`) e cronometra. Poi verifica le due invarianti
 * della modifica a web/lib/polizzaReconcile.ts:
 *   1. `visionOcrEngine({ polizzaOcrEngine: 'tesseract' })` → null, quindi
 *      `readPdfPagesWithOcr` chiama Tesseract (`ocrPageText`), NON il modello visivo;
 *   2. la chiave di cache è l'HASH NUDO (mai `:vis:<modello>`): la riconciliazione
 *      non avvelena la cache dell'estrazione, che usa il motore configurato.
 *
 * Esegui:  node scripts/reconcile-ocr-check.mjs [percorso.pdf ...]
 * (senza argomenti cerca un PDF scansionato in polizze_test/)
 */
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const webRoot = pathToFileURL(join(root, 'web') + '/').href
register(pathToFileURL(join(root, 'test', 'helpers', 'tsResolveHook.mjs')).href, { data: { webRoot } })
register(pathToFileURL(join(here, 'helpers', 'pdfjsInteropHook.mjs')).href)

const load = (rel) => import(pathToFileURL(join(root, rel)).href)

// Candidati: gli argomenti, altrimenti un PDF scansionato cercato in polizze_test/.
function findCandidates() {
  const args = process.argv.slice(2)
  if (args.length) return args.map((p) => (p.startsWith('/') ? p : join(root, p)))
  const out = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (/\.pdf$/i.test(e.name)) out.push(p)
    }
  }
  if (existsSync(join(root, 'polizze_test'))) walk(join(root, 'polizze_test'), 0)
  return out
}

const { readPdfPagesWithOcr } = await load('web/lib/polizzaJobWorker.ts')
const { spatialPagesFromPdf, hasTextLayer } = await load('src/services/pdfTextLayer.js')
const { extractPolicyNumbers, extractPolicyNumbersFromPages } = await load('src/services/policyReconcile.js')
const { visionOcrEngine, closeOcrWorker } = await load('src/services/polizzaService.js')
const { ocrCacheKey } = await load('web/lib/polizzaJobStore.ts')

console.log(`\n=== Verifica riconciliazione = Tesseract (approccio B) ===\n`)
console.log(`visionOcrEngine({ polizzaOcrEngine: 'tesseract' }) = ${JSON.stringify(visionOcrEngine({ polizzaOcrEngine: 'tesseract' }))}  (atteso null → Tesseract)`)
console.log(`visionOcrEngine({ polizzaOcrEngine: 'qwen3-vl:32b' }) = ${JSON.stringify(visionOcrEngine({ polizzaOcrEngine: 'qwen3-vl:32b' }))}  (worker → modello visivo)`)
const H = 'ABC123'
console.log(`ocrCacheKey(${H}, tesseract) = ${ocrCacheKey(H, { polizzaOcrEngine: 'tesseract' })}  (atteso ${H}: cache dell'estrazione intatta)`)
console.log(`ocrCacheKey(${H}, qwen3-vl:32b) = ${ocrCacheKey(H, { polizzaOcrEngine: 'qwen3-vl:32b' })}  (worker)`)

// Impostazioni della RICONCILIAZIONE (come in polizzaReconcile.ts).
const reconcileSettings = { polizzaOcrEngine: 'tesseract', ollamaUrl: 'http://127.0.0.1:11434' }

let tested = 0
for (const pdf of findCandidates()) {
  let buf
  try { buf = readFileSync(pdf) } catch { continue }
  const layer = await spatialPagesFromPdf(buf, { settings: {} }).catch(() => null)
  const digital = hasTextLayer(layer)
  if (digital) continue // cerchiamo uno SCANSIONATO: è il caso che prima usava il modello visivo
  const pages = layer ? layer.length : '?'
  const len = statSync(pdf).size
  console.log(`\n--- ${pdf.replace(root + '/', '')} (${(len / 1024 / 1024).toFixed(1)} MB, text layer: ${pages} pag.) ---`)
  const t0 = Date.now()
  const perPage = []
  const r = await readPdfPagesWithOcr(buf, pdf.split('/').pop(), reconcileSettings, {
    log: async (line) => console.log(`    log: ${line}`),
    onPage: async (p, total) => { perPage.push(p); const s = (Date.now() - t0) / 1000; console.log(`    pagina ${p}/${total}  (${s.toFixed(1)}s)`) },
  })
  const secs = (Date.now() - t0) / 1000
  const texts = (r?.pages || []).filter((t) => t && t.trim())
  const chars = texts.reduce((a, t) => a + t.length, 0)
  const joined = texts.join('\n')
  const inline = extractPolicyNumbers(joined)
  const grid = extractPolicyNumbersFromPages(texts)
  console.log(`    → ${r?.pages?.length || 0} pagine, ${texts.length} con testo, ${chars} char in ${secs.toFixed(1)}s (${(secs / Math.max(1, r?.pages?.length || 1)).toFixed(2)}s/pagina)`)
  console.log(`    → numeri (regex inline): ${inline.length ? inline.join(', ') : 'NESSUNO'}`)
  console.log(`    → numeri (griglia/celle, come la riconciliazione): ${grid.length ? grid.join(', ') : 'NESSUNO'}`)
  if (process.env.RECONCILE_CHECK_DUMP) {
    for (let k = 0; k < (r?.pages || []).length; k++) {
      console.log(`\n        [pagina ${k + 1}]\n` + String(r.pages[k] || '').split('\n').slice(0, 40).map((l) => '        ' + l).join('\n'))
    }
  }
  // [B] FALLBACK ILLEGGIBILI: rilettura della SOLA prima pagina col modello
  // visivo (onlyPages). Qui il motore è Tesseract come nella riconciliazione,
  // quindi la prova è sul CONTRATTO dell'hook: stessa lunghezza, solo la pagina
  // richiesta passa per l'OCR, le altre restano il text layer (o vuote), e il
  // costo è quello di UNA pagina, non di tutto il documento.
  const t1 = Date.now()
  const one = await readPdfPagesWithOcr(buf, pdf.split('/').pop(), reconcileSettings, {
    log: async (line) => console.log(`    log(onlyPages): ${line}`),
    onlyPages: [1],
  })
  const secs1 = (Date.now() - t1) / 1000
  const lenOk = (one?.pages?.length || 0) === (r?.pages?.length || 0)
  const onlyFirst = (one?.pages || []).every((t, k) => (k === 0 ? true : !t || !t.trim()))
  const firstSame = (one?.pages?.[0] || '') === (r?.pages?.[0] || '')
  console.log(`    [onlyPages=[1]] ${one?.pages?.length || 0} pagine in ${secs1.toFixed(1)}s — lunghezza ${lenOk ? 'OK' : 'ERRATA'}, solo pag.1 con testo ${onlyFirst ? 'OK' : 'NO'}, pag.1 identica alla lettura intera ${firstSame ? 'OK' : 'NO'} (confronto: ${secs.toFixed(1)}s per intero vs ${secs1.toFixed(1)}s per 1 pagina)`)
  tested++
  // [B] FALLBACK ILLEGGIBILI — percorso REALE col modello visivo (solo prima
  // pagina), lo stesso che esegue `retryIllegiblesWithVision`. Opt-in: serve un
  // modello visivo raggiungibile.
  //   RECONCILE_CHECK_VISION_MODEL=qwen2.5vl:7b  [OLLAMA_URL=http://host:11434]
  if (process.env.RECONCILE_CHECK_VISION_MODEL) {
    const vSettings = { polizzaOcrEngine: process.env.RECONCILE_CHECK_VISION_MODEL, ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434' }
    console.log(`    [fallback illeggibili] modello visivo ${vSettings.polizzaOcrEngine} @ ${vSettings.ollamaUrl} — solo la prima pagina...`)
    const t2 = Date.now()
    const v = await readPdfPagesWithOcr(buf, pdf.split('/').pop(), vSettings, {
      onlyPages: [1],
      log: async (line) => console.log(`    log(vision): ${line}`),
    })
    const secs2 = (Date.now() - t2) / 1000
    const vtext = v?.pages?.[0] || ''
    const vnum = vtext ? extractPolicyNumbersFromPages([vtext]) : []
    console.log(`    → ${vtext.length} char in ${secs2.toFixed(1)}s; numeri di polizza: ${vnum.length ? vnum.join(', ') : 'NESSUNO'}`)
    if (process.env.RECONCILE_CHECK_DUMP && vtext) console.log(vtext.split('\n').slice(0, 40).map((l) => '        ' + l).join('\n'))
  }
  if (tested >= (process.argv[2] ? 99 : Number(process.env.RECONCILE_CHECK_MAX || 1))) break
}

if (!tested) console.log('\nNessun PDF scansionato trovato nei candidati.')
await closeOcrWorker()
console.log('')
