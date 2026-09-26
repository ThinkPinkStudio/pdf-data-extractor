#!/usr/bin/env node
/**
 * COPERTURA DEL TESTO: i valori attesi dai golden sono PRESENTI nel testo che
 * il modello riceve? (Se il valore non è nel testo, nessun modello può
 * estrarlo: questa è la metà "input" del problema, misurabile senza Ollama.)
 *
 * Per ogni fascicolo golden estrae il testo dei PDF con le sorgenti scelte:
 *   pdfjs    griglia spaziale dal text layer (src/services/pdfTextLayer.js —
 *            lo stesso codice del worker in produzione)
 *   pymupdf  markdown per pagina di PyMuPDF4LLM (scripts/pdf-md-pymupdf.py)
 *   docling  markdown del microservizio Docling (POST /parse, come il worker)
 * e per ogni campo del golden cerca il valore (importi/date/P.IVA in tutte le
 * grafie ragionevoli; testi con la normalizzazione di polizzaEval).
 *
 * Uso:
 *   node scripts/coverage-check.mjs [--sources pdfjs,pymupdf,docling]
 *        [--docling http://127.0.0.1:8101] [--python /path/venv/bin/python]
 *        [--cache /tmp/textcache] [--only guffanti,rcp-pilato] [--json out.json]
 *
 * I testi estratti sono messi in cache per hash del file (Docling su CPU costa
 * minuti a PDF): i rilanci non li ripagano.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const { spatialPagesFromPdf } = await import(join(root, 'src/services/pdfTextLayer.js'))
const { collapseSpatial } = await import(join(root, 'src/services/ocrLayout.js'))
const { normForMatch, parsePureAmount } = await import(join(root, 'src/services/polizzaValidation.js'))
const { normalizeDateValue } = await import(join(root, 'src/services/polizzaDates.js'))

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}
const SOURCES = arg('sources', 'pdfjs,pymupdf').split(',').map((s) => s.trim()).filter(Boolean)
const DOCLING = arg('docling', process.env.DOCLING_URL || 'http://127.0.0.1:8101')
const PYTHON = arg('python', process.env.PYTHON || 'python3')
const CACHE = arg('cache', join(root, '.coverage-cache'))
const ONLY = arg('only') ? new Set(arg('only').split(',').map((s) => s.trim())) : null
const JSON_OUT = arg('json')
mkdirSync(CACHE, { recursive: true })

import { CASES } from './golden-cases.mjs'

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Grafie con cui un valore atteso può comparire nel testo. */
export function candidatesFor(spec) {
  const v = spec?.value
  if (v == null || v === '') return null
  const mode = spec.mode || 'text'
  if (mode === 'amount') {
    const n = parsePureAmount(v)
    if (n != null) {
      // Raggruppamento migliaia FATTO A MANO: `toLocaleString('it-IT')` in Node
      // NON mette il punto sui numeri a 4 cifre (CLDR: minimumGroupingDigits=2
      // per l'italiano → "1270,10"), e "1.270,10" nel PDF non veniva trovato.
      const [intPart, decPart] = n.toFixed(2).split('.')
      const grouped = (sep) => intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
      const list = [String(v).trim(), `${grouped('.')},${decPart}`, `${grouped(',')}.${decPart}`, `${intPart},${decPart}`, `${intPart}.${decPart}`]
      if (Number.isInteger(n)) list.push(grouped('.'), intPart)
      return { kind: 'regex', list: [...new Set(list.filter(Boolean))] }
    }
  }
  if (mode === 'date') {
    const d = normalizeDateValue(v)
    if (d) {
      const [dd, mm, yyyy] = d.split('/')
      const mon = MONTHS[+mm - 1]
      return { kind: 'regex', list: [`${dd}/${mm}/${yyyy}`, `${dd}.${mm}.${yyyy}`, `${dd}-${mm}-${yyyy}`, `${+dd}/${+mm}/${yyyy}`, `${yyyy}-${mm}-${dd}`, `${dd} ${mon} ${yyyy}`, `${+dd} ${mon} ${yyyy}`] }
    }
  }
  if (mode === 'vat') return { kind: 'regex', list: [String(v).replace(/\s+/g, '')], squash: true }
  return { kind: 'norm', list: [normForMatch(v)] }
}

/** Prima pagina (1-based) in cui il valore compare, 0 se assente. */
export function findIn(pages, cand) {
  if (!cand) return 0
  for (let i = 0; i < pages.length; i++) {
    const raw = String(pages[i] || '')
    if (!raw) continue
    if (cand.kind === 'norm') {
      if (cand.list[0] && normForMatch(raw).includes(cand.list[0])) return i + 1
      continue
    }
    // squash: via gli spazi DENTRO la riga (P.IVA "0313 1670 345"), MAI gli
    // a-capo: unendo le righe la cifra successiva incollata faceva fallire
    // il confine numerico e la P.IVA risultava "assente" pur essendoci.
    const hay = cand.squash ? raw.replace(/[ \t\u00a0]+/g, '') : raw
    for (const c of cand.list) {
      const re = new RegExp(`(?<![\\d])${esc(c)}(?![\\d])`, 'i')
      if (re.test(hay)) return i + 1
    }
  }
  return 0
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 24)
function cached(source, hash, produce) {
  const f = join(CACHE, `${source}-${hash}.json`)
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'))
  const out = produce()
  return Promise.resolve(out).then((val) => { writeFileSync(f, JSON.stringify(val)); return val })
}

async function textFor(source, file, buf) {
  const hash = sha(buf)
  if (source === 'pdfjs') {
    return cached(source, hash, async () => {
      const t0 = Date.now()
      const pages = await spatialPagesFromPdf(buf)
      return { pages, flat: pages.map(collapseSpatial), seconds: (Date.now() - t0) / 1000 }
    })
  }
  if (source === 'pymupdf') {
    return cached(source, hash, () => {
      const t0 = Date.now()
      const out = execFileSync(PYTHON, [join(root, 'scripts/pdf-md-pymupdf.py'), file], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
      const j = JSON.parse(String(out))
      return { pages: j.pages, flat: j.pages, seconds: (Date.now() - t0) / 1000 }
    })
  }
  if (source === 'docling') {
    return cached(source, hash, async () => {
      const t0 = Date.now()
      const res = await fetch(`${DOCLING.replace(/\/+$/, '')}/parse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'documento.pdf', content_base64: buf.toString('base64') }),
        signal: AbortSignal.timeout(20 * 60 * 1000),
      })
      if (!res.ok) throw new Error(`Docling HTTP ${res.status}`)
      const j = await res.json()
      const pages = Array.isArray(j.pages) && j.pages.length ? j.pages : [j.markdown || '']
      return { pages, flat: pages, seconds: (Date.now() - t0) / 1000 }
    })
  }
  throw new Error(`sorgente sconosciuta: ${source}`)
}

const report = { sources: SOURCES, cases: [] }
for (const c of CASES) {
  if (ONLY && !ONLY.has(c.id)) continue
  const goldenPath = join(root, c.golden)
  if (!existsSync(goldenPath)) { console.log(`\n## ${c.id}: golden mancante (${c.golden})`); continue }
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
  const dir = join(root, c.dir)
  const files = (c.files || (existsSync(dir) ? readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort() : []))
    .map((f) => join(dir, f)).filter((p) => existsSync(p))
  console.log(`\n## ${c.id} — ${golden.label || ''} — profilo "${c.profile}"`)
  if (!files.length) { console.log(`   SALTATO: nessun PDF in ${c.dir}${c.files ? ` (${c.files.join(', ')})` : ''}`); report.cases.push({ id: c.id, skipped: true }); continue }

  // testo per sorgente → [{file, pages, flat}]
  const texts = {}
  for (const src of SOURCES) {
    texts[src] = []
    for (const f of files) {
      const buf = readFileSync(f)
      try {
        const t = await textFor(src, f, buf)
        texts[src].push({ file: f.split('/').pop(), ...t })
      } catch (err) {
        texts[src].push({ file: f.split('/').pop(), pages: [], flat: [], error: err.message })
      }
    }
    const tot = texts[src].reduce((a, t) => a + t.flat.reduce((b, p) => b + String(p || '').replace(/\s+/g, ' ').length, 0), 0)
    const secs = texts[src].reduce((a, t) => a + (t.seconds || 0), 0)
    const errs = texts[src].filter((t) => t.error).map((t) => `${t.file}: ${t.error}`)
    const empty = texts[src].flatMap((t) => t.flat.map((p, i) => (!String(p || '').trim() ? `${t.file} p${i + 1}` : null)).filter(Boolean))
    console.log(`   [${src}] ${texts[src].length} file, ${tot} char utili, ${secs.toFixed(1)}s${empty.length ? ` · pagine SENZA testo: ${empty.length}` : ''}${errs.length ? ` · ERRORI: ${errs.join('; ')}` : ''}`)
  }

  const rows = []
  const totals = Object.fromEntries(SOURCES.map((s) => [s, 0]))
  let expectedN = 0
  for (const [label, spec] of Object.entries(golden.fields || {})) {
    const cand = candidatesFor(spec)
    if (!cand) continue
    expectedN++
    const row = { field: label, expected: spec.value, mode: spec.mode || 'text', found: {} }
    for (const src of SOURCES) {
      let hit = null
      for (const t of texts[src]) {
        const p = findIn(t.flat, cand)
        if (p) { hit = { file: t.file, page: p }; break }
      }
      row.found[src] = hit
      if (hit) totals[src]++
    }
    rows.push(row)
  }
  const w = Math.max(12, ...rows.map((r) => r.field.length))
  console.log(`   ${'campo'.padEnd(w)}  ${'atteso'.padEnd(28)}  ${SOURCES.map((s) => s.padEnd(14)).join('')}`)
  for (const r of rows) {
    const cells = SOURCES.map((s) => (r.found[s] ? `OK p${r.found[s].page}`.padEnd(14) : '-- ASSENTE'.padEnd(14)))
    console.log(`   ${r.field.slice(0, w).padEnd(w)}  ${String(r.expected).slice(0, 28).padEnd(28)}  ${cells.join('')}`)
  }
  console.log(`   TOTALE: ${SOURCES.map((s) => `${s} ${totals[s]}/${expectedN}`).join(' · ')}`)
  report.cases.push({ id: c.id, profile: c.profile, files: files.map((f) => f.split('/').pop()), expected: expectedN, totals, rows })
}
if (JSON_OUT) writeFileSync(resolve(JSON_OUT), JSON.stringify(report, null, 2))
