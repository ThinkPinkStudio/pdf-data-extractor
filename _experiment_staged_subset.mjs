#!/usr/bin/env node
// PROBE ESPERIMENTO: il motore STAGED "diluisce" l'attenzione su 28 campi?
// Fascicolo B (Nebuloni / AmTrust MedicoProtetto, profilo RC PROF MED V2 id 1785512148086).
// Sequenza (MAI parallela sulla GPU):
//   1. staged a tutti i campi del profilo (baseline) -> gap
//   2. staged a SOLO 3 campi critici/mancanti
//   3. staged a scatter dei mancanti (opzionale)
// NON modifica src/web/test. NON committa.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const svc = await import('./src/main/services/polizzaService.js')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const EMBED = 'bge-m3'
const OCR_CACHE = 'out/ocr'
const PREFIX = 'in_vigore_3__'
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'

const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profilo = profili.find((p) => String(p.id) === '1785512148086')
if (!profilo) { console.error('Profilo 1785512148086 (RC PROF MED V2) non trovato'); process.exit(2) }
const activeFields = (profilo.fields || []).filter((f) => f.enabled !== false)
console.log(`Profilo: "${profilo.name}" (id ${profilo.id}) — ${activeFields.length} campi attivi\n`)

// Carico i documenti dalla CACHE OCR col prefisso in_vigore_3__
const cacheFiles = readdirSync(OCR_CACHE).filter((f) => f.startsWith(PREFIX) && f.endsWith('.pdf.json'))
const docs = []
for (const cache of cacheFiles) {
  const pages = JSON.parse(readFileSync(join(OCR_CACHE, cache), 'utf8'))
  if (!Array.isArray(pages) || !pages.length) continue
  const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
  const name = cache.slice(PREFIX.length, -'.json'.length)
  docs.push({ name, pages: spatial })
  const useful = spatial.reduce((s, p) => s + (svc.usefulLength?.(p) ?? 0), 0)
  console.log(`— ${name} → ${spatial.length} pagine da cache OCR, useful ${useful}`)
}
if (!docs.length) { console.error('Nessun documento in cache OCR in_vigore_3__'); process.exit(2) }

const makeSettings = (fields) => ({
  ollamaUrl: OLLAMA_URL,
  ollamaModel: MODEL,
  embeddingModel: EMBED,
  ollamaNumCtx: 24576,
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

async function run(tag, fields) {
  console.log(`\n========== RUN ${tag} — ${fields.length} campi ==========`)
  console.log(`Campi: ${fields.map((f) => f.id).join(', ')}`)
  console.log(`Lancio extractPolizzaStaged su ${OLLAMA_URL}/${MODEL} numCtx 24576 …`)
  const t1 = Date.now()
  let result
  try {
    result = await svc.extractPolizzaFromDocs(docs, null, makeSettings(fields), (p) => {
      const label = p.field != null ? `campo ${p.field}/${p.fieldTotal}` : `batch ${p.batch}/${p.batchTotal}`
      process.stdout.write(`\r· ${label}   `)
    })
  } catch (e) {
    console.error('\nERRORE estrazione:', e?.message || e)
    if (e?.diag) for (const l of e.diag) console.error('  diag:', l)
    return null
  }
  const secs = ((Date.now() - t1) / 1000).toFixed(1)
  console.log(`\nFatto in ${secs}s.\n`)
  console.log('— DATA (campi richiesti) —')
  for (const f of fields) {
    const v = result.data?.[f.id]
    const src = result.sources?.[f.id]
    const val = (v == null || v === '') ? '(VUOTO)' : JSON.stringify(v)
    console.log(`  ${f.id} = ${val}${src && v ? `  [${src.file} · pag.${src.page}]` : ''}`)
  }
  console.log('\n— DIAG (righe utili) —')
  for (const l of result.diag || []) {
    const w = String(l).toLowerCase()
    if (/\[deterministico\]|seed|recens|arbitro|merge|batch|gruppo|stadi|p\.iva|c\.f|trovato|vuoto|mancant|priorita|evidenza|null/.test(w)) console.log(l)
  }
  console.log('\n')
  return { data: result.data, sources: result.sources, diag: result.diag, secs }
}

// Ground truth (report preparazione, caso B)
const GT = {
  compagnia: 'AmTrust Assicurazioni S.p.A.',
  contraente: 'MAURO CARLO NEBULONI',
  codice_fiscale_iva: 'NBLMCR58L23D033D', // report: NBLMCR58L23D0033D (corrotto); testo: NBLMCR58L23D033D
  indirizzo: 'VIA AMENDOLA 8 - ABBIATEGRASSO (MI) 20081',
  decorrenza: '14/10/2025',
  scadenza: '14/10/2025',
}

// Priorità per il subset critico (anagrafici che tipicamente restano vuoti)
const CRIT = ['compagnia', 'contraente', 'codice_fiscale_iva', 'indirizzo', 'decorrenza', 'scadenza']

function missing(fields, data) {
  return fields.filter((f) => {
    const v = data?.[f.id]
    return v == null || v === ''
  })
}
function present(fields, data) {
  return fields.filter((f) => {
    const v = data?.[f.id]
    return v != null && v !== ''
  })
}
function fieldById(id) { return activeFields.find((f) => f.id === id) }

const out = { profilo: profilo.name, profiloId: profilo.id, caso: 'B', modello: MODEL, runs: {} }

// ---- RUN 1: baseline tutti i campi
const r1 = await run('1-28', activeFields)
out.runs.r28 = r1 && { data: r1.data, sources: r1.sources, secs: r1.secs }
if (!r1) process.exit(3)

const missAll = missing(activeFields, r1.data)
const okAll = present(activeFields, r1.data)
console.log(`\n——— RUN 1 VERDETTO: ${okAll.length} OK, ${missAll.length} VUOTI ————`)
console.log('OK:', okAll.map((f) => f.id).join(', '))
console.log('VUOTI:', missAll.map((f) => f.id).join(', '))

// ---- RUN 2: SOLO i 3 critici anagrafici (compagnia, contraente, codice_fiscale_iva)
const set2 = ['compagnia', 'contraente', 'codice_fiscale_iva'].map(compareById)
if (!set2.every(Boolean)) { console.error('Campo critico non definito nel profilo'); process.exit(2) }
const r2 = await run('2-solo3', set2)
out.runs.r3 = r2 && { data: r2.data, sources: r2.sources, secs: r2.secs }
const r2miss = r2 ? missing(set2, r2.data) : set2

// ---- RUN 3: scatter di altri 3 mancanti (se il run 2 non ha chiuso i numerosi anagrafici)
const set3Cand = ['indirizzo', 'decorrenza', 'scadenza']
let r3 = null
if (r2miss.length > 0 || missAll.some((f) => ['indirizzo', 'decorrenza', 'scadenza'].includes(f.id))) {
  const set3 = set3Cand.map(compareById)
  if (set3.every(Boolean)) {
    const r3raw = await run('3-solo3b', set3)
    r3 = r3raw
    out.runs.r3b = r3 && { data: r3.data, sources: r3.sources, secs: r3.secs }
  }
}

function compareById(id) { return activeFields.find((f) => f.id === id) }

mkdirSync('out', { recursive: true })
writeFileSync('out/experiment_staged_subset.json', JSON.stringify(out, null, 2))
console.log('\nSalvato in out/experiment_staged_subset.json')