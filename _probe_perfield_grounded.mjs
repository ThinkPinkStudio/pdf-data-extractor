#!/usr/bin/env node
// PROBE MOTORE PER-CAMPO + GROUNDING — casi A (CEDAM RC Prof V3) e B (NEBULONI RC PROF MED V2).
// Controparte di _ab_esteso.mjs ma con:
//   polizzaPerField = true (RAG una domanda per campo)
//   polizzaGrounding = true (finestre deterministiche + verifica di supporto riga-citata)
// Riusa la cache OCR versionata in out/ocr (stesso suffisso _ab_esteso.mjs).
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const svc = await import('./src/main/services/polizzaService.js')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const EMBED = 'bge-m3'
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'
const OCR_CACHE = join(here, 'out/ocr')

const CASI = {
  A: {
    id: 'A', nome: 'CEDAM ITALIA SRL - RC Professionale', profilo: 'Rc Professionale V3',
    zipRoot: '/tmp/prep_casi/zip1/campione polizze x test 07 08 2026 1', fascicolo: 'in vigore',
    folderCacheKey: 'in_vigore', skipFiles: [],
  },
  B: {
    id: 'B', nome: 'NEBULONI MAURO CARLO - RC Professionale Medico (AmTrust)', profilo: 'RC PROF MED V2',
    zipRoot: '/tmp/prep_casi/zip2/campione polizze x test 07 08 2026 2', fascicolo: 'in vigore 3',
    folderCacheKey: 'in_vigore_3', skipFiles: ['Set_Informativo_AmTrust_Medico_Protetto_Ed062024_Agg072025.pdf'],
  },
}

const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profiloByName = (n) => profili.find((x) => x.name === n)
if (!profiloByName) throw new Error('Profilo non trovato')

function settingsForSvc(over = {}) {
  return {
    ollamaUrl: OLLAMA_URL, ollamaModel: MODEL, embeddingModel: EMBED, ollamaNumCtx: 24576,
    llmProvider: 'ollama', polizzaOcrEnabled: true,
    ...over,
  }
}
function makeSettings(c, profilo) {
  const fields = (profilo.fields || []).filter((f) => f.enabled !== false)
  return settingsForSvc({
    polizzaFields: fields,
    polizzaPromptExtra: profilo.promptExtra || '',
    polizzaPerField: true,          // ✳ MODALITÀ PER-CAMPO
    polizzaGrounding: true,         // ✳ GROUNDING ATTIVO
    polizzaStagedCascade: false,
    polizzaConstrainedJson: true,
    polizzaConstrainedFormat: 'schema',
    polizzaPrecheckMode: 'off',
    polizzaAutoVerify: false,
    polizzaArchivio: false,
  })
}

function buildDocsForFascicolo(c) {
  const folder = join(c.zipRoot, c.fascicolo)
  const pdfs = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf')).filter((f) => !c.skipFiles.includes(f))
  const docs = []
  for (const f of pdfs) {
    const cacheFile = join(OCR_CACHE, `${c.folderCacheKey}__${f.replace(/[^a-z0-9.]+/gi, '_')}.json`)
    let pages = null
    try { pages = JSON.parse(readFileSync(cacheFile, 'utf8')) } catch {}
    if (!Array.isArray(pages) || !pages.length) { console.log(`  ⚠ cache mancante ${f}`); continue }
    const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
    if (spatial.some((p) => p && p.trim())) docs.push({ name: f, pages: spatial })
  }
  return docs
}

async function extractCase(c) {
  console.log(`\n════ ${c.id} — ${c.nome} ════`)
  const profilo = profiloByName(c.profilo)
  const docs = buildDocsForFascicolo(c)
  if (!docs.length) { console.error('Nessun doc'); process.exit(2) }
  console.log(`${docs.length} documenti da cache OCR`)
  const settings = makeSettings(c, profilo)
  const t0 = Date.now()
  let res
  try {
    res = await svc.extractPolizzaFromDocs(docs, null, settings, (p) => {
      const label = p.field != null ? `campo ${p.field}/${p.fieldTotal}` : `batch ${p.batch}/${p.batchTotal}`
      process.stdout.write(`\r· ${label}   `)
    })
  } catch (e) {
    console.error('\nERRORE:', e?.message || e)
    if (e?.diag) for (const l of e.diag) console.error('  diag:', l)
    process.exit(3)
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n→ ${secs}s, ${Object.keys(res.data || {}).length} campi\n`)
  for (const [k, v] of Object.entries(res.data || {})) {
    const src = res.sources?.[k]
    console.log(`  ${k} = ${JSON.stringify(v)}${src ? `  [${String(src.file).split('/').pop()} · pag.${src.page}${src.line ? ` r${src.line}` : ''}]` : ''}`)
  }
  console.log('\n— DIAGNOSTICA —')
  for (const l of res.diag || []) console.log(l)
  writeFileSync(`out/_probe_${c.id}_perfield.json`, JSON.stringify({
    caso: c.id, nome: c.nome, profilo: profilo.name, model: MODEL, secs,
    perField: true, grounding: true,
    data: res.data, sources: res.sources, reliability: res.reliability, diag: res.diag,
    fields: (profilo.fields || []).filter((f) => f.enabled !== false),
  }, null, 2))
  return res
}

await svc.probeOcr?.({})
const runCase = process.argv[2] || 'AB'
if (/A/.test(runCase)) await extractCase(CASI.A)
if (/B/.test(runCase)) await extractCase(CASI.B)