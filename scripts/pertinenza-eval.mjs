#!/usr/bin/env node
/**
 * MISURA DELLA PERTINENZA (solo pre-controllo, niente estrazione) contro
 * l'Ollama VERO: per ogni posizione di test/fixtures/pertinenza-expected.json
 * (cartella diretta = dossier, come nel bulk) legge i PDF con lo STESSO testo
 * del worker (griglia pdfjs, OCR Tesseract sulle pagine senza text layer),
 * esegue runPrecheck col profilo indicato e confronta il verdetto con la
 * verità del verificatore: 'operante' deve dare ok, 'non operante' deve
 * FERMARE (mismatch o review). Risultato: giusti/N, con esito, ragione e
 * prova citata per riga.
 *
 * Da lanciare dal LOCALE (la macchina che raggiunge 192.168.37.10), una run
 * alla volta (REGOLE_AGENTI, Regola 3):
 *   cd pdf-data-extractor && (cd web && npm ci) && ln -sfn web/node_modules node_modules
 *   node scripts/pertinenza-eval.mjs [--only lucchese-arag,pizzamiglio-boiardo]
 *        [--model qwen2.5:7b-instruct] [--ollama http://192.168.37.10:11434]
 *        [--profile-json polizze_test/profili-polizza-riconoscimento.json]
 *        [--mode semantic|keywords|llm|off] [--no-recognition] [--no-ocr]
 *        [--cache .pertinenza-cache] [--json out.json] [--ctx 32768]
 *
 * --no-recognition: azzera «Come riconoscerla» in tutti i profili → misura il
 *   percorso STORICO (parole / semantico / llm) per il confronto prima/dopo.
 * Il testo dei PDF è in cache per hash del file: i rilanci non ripagano l'OCR.
 *
 * Fixture (--cases): `profile` di testa = profilo di tutti i casi; un caso può
 * avere il SUO `profile` (fixture dei golden, test/fixtures/pertinenza-golden-
 * expected.json: RC, RC medica e tutela legale insieme; lì la testa è null e
 * ogni caso ha il suo). `files` = solo quei PDF (percorsi relativi a `dir`),
 * `recursive` (del caso o di testa) = anche le sottocartelle, come
 * golden-prod/calibrazione-goldens (la polizza di bolchini-tl sta in
 * «…/POLIZZA»); altrimenti i soli PDF in cima a `dir` (cartella = dossier, come
 * nel bulk). Un caso con un profilo che non c'è nei profili = saltato; un caso
 * con un file di `files` che non esiste = saltato (mai misurato con meno PDF).
 * Fixture nel formato di scripts/bulk-prod.mjs (`root` di testa + `match` per
 * caso = ULTIMA cartella del dossier: test/fixtures/pertinenza-pizzamiglio-
 * expected.json, pertinenza-besa-expected.json): il dossier è la cartella
 * sotto `root` con quel nome (una sola, altrimenti saltato), letta con le sue
 * sottocartelle come fa la riconciliazione per numero di polizza del bulk
 * («cartella + /POLIZZA» = una posizione), TRANNE le sottocartelle che sono il
 * `match` di un altro caso (dossier a sé: «CAMPESTRE RINNOVO…/RATE ANNUALI»).
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { createRequire } from 'module'
import { dirname, join, relative } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
// I pacchetti del rendering (canvas nativo, pdfjs) stanno in web/node_modules:
// si risolvono da lì, non dalla node_modules di radice (che può essere un'altra).
const webRequire = createRequire(join(root, 'web', 'package.json'))

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}
const ONLY = arg('only') ? new Set(arg('only').split(',').map((s) => s.trim())) : null
const MODEL = arg('model', process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct')
const OLLAMA = arg('ollama', process.env.OLLAMA_URL || 'http://192.168.37.10:11434')
const MODE = arg('mode', 'semantic')
const CASES_FILE = arg('cases', join(root, 'test/fixtures/pertinenza-expected.json'))
const DEFAULT_PROFILES = existsSync(join(root, 'polizze_test/profili-polizza-riconoscimento.json'))
  ? join(root, 'polizze_test/profili-polizza-riconoscimento.json')
  : join(root, 'polizze_test/profili-polizza-calibrato-v2.json')
const PROFILES = arg('profile-json', DEFAULT_PROFILES)
const CACHE = arg('cache', join(root, '.pertinenza-cache'))
const JSON_OUT = arg('json')
const NO_RECOG = process.argv.includes('--no-recognition')
const NO_OCR = process.argv.includes('--no-ocr')
const CTX = arg('ctx') ? Number(arg('ctx')) : null
mkdirSync(CACHE, { recursive: true })

const { spatialPagesFromPdf } = await import(join(root, 'src/services/pdfTextLayer.js'))
const { collapseSpatial } = await import(join(root, 'src/services/ocrLayout.js'))
const { runPrecheck } = await import(join(root, 'src/services/polizzaPrecheckService.js'))
const svc = await import(join(root, 'src/services/polizzaService.js'))

const spec = JSON.parse(readFileSync(CASES_FILE, 'utf8'))
const rawProfiles = JSON.parse(readFileSync(PROFILES, 'utf8'))
const profilesAll = (Array.isArray(rawProfiles) ? rawProfiles : Object.values(rawProfiles)).filter((p) => p && p.name && Array.isArray(p.fields))
// Un profilo per nome (i file storici hanno duplicati): il primo vince.
const byName = new Map()
for (const p of profilesAll) if (!byName.has(p.name)) byName.set(p.name, NO_RECOG ? { ...p, recognition: '' } : p)
const profiles = [...byName.values()].filter((p) => p.enabled !== false)
// Profilo di TESTA (vale per i casi senza il loro `profile`). Se la testa non
// ne ha, ogni caso deve portare il suo: altrimenti ci si ferma (mai misurare un
// caso col profilo sbagliato).
const headProfile = spec.profile ? byName.get(spec.profile) : null
if (spec.profile && !headProfile) { console.error(`Profilo "${spec.profile}" non trovato in ${PROFILES}`); process.exit(2) }
if (!spec.profile && (spec.cases || []).some((c) => !c.profile)) { console.error(`Fixture ${CASES_FILE}: nessun profilo di testa e casi senza \`profile\``); process.exit(2) }
const describe = (p) => `${p.name} — «Come riconoscerla»: ${p.recognition ? `${p.recognition.length} char` : 'VUOTO (percorso storico)'}`
const caseProfileNames = [...new Set((spec.cases || []).map((c) => c.profile || spec.profile))]
console.log(`Profil${caseProfileNames.length > 1 ? 'i' : 'o'}: ${caseProfileNames.map((n) => (byName.get(n) ? describe(byName.get(n)) : `${n} (NON TROVATO: casi saltati)`)).join(' · ')} — modo ${MODE} — modello ${MODEL} — profili in gara: ${profiles.map((p) => p.name).join(', ')}`)
const walkPdfs = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walkPdfs(p) : (/\.pdf$/i.test(f) ? [p] : []) })
/** PDF del caso (percorsi assoluti, ordinati): `files`, oppure la cartella (ricorsiva se richiesto). */
function caseFiles(c, dir) {
  if (Array.isArray(c.files) && c.files.length) return c.files.map((f) => join(dir, f)).sort()
  if (c.match) return walkPdfsExcept(dir, otherMatches(c)).sort()
  if (c.recursive ?? spec.recursive) return walkPdfs(dir).sort()
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.pdf$/i.test(e.name)).map((e) => join(dir, e.name)).sort()
}
// Formato bulk-prod (`root` + `match`): cartelle col nome del caso sotto `root`.
const sameName = (a, b) => String(a || '').trim() === String(b || '').trim()
const walkDirs = (d) => [d, ...readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => walkDirs(join(d, e.name)))]
const otherMatches = (c) => (spec.cases || []).filter((x) => x !== c && x.match).map((x) => x.match)
const walkPdfsExcept = (d, skip) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = join(d, e.name)
  if (e.isDirectory()) return skip.some((m) => sameName(e.name, m)) ? [] : walkPdfsExcept(p, skip)
  return /\.pdf$/i.test(e.name) ? [p] : []
})
/** Cartella del caso: `dir` (relativa alla radice del repo) o l'unica cartella `match` sotto `root`. */
function caseDir(c) {
  if (c.dir) return { dir: join(root, c.dir) }
  if (!c.match || !spec.root) return { error: 'né `dir` né `root`+`match`' }
  const base = join(root, spec.root)
  if (!existsSync(base)) return { error: `radice mancante: ${spec.root}` }
  const found = walkDirs(base).filter((d) => sameName(d.split('/').pop(), c.match))
  if (found.length !== 1) return { error: `${found.length} cartelle «${c.match}» sotto ${spec.root}` }
  return { dir: found[0] }
}

const settings = {
  ollamaUrl: OLLAMA, ollamaModel: MODEL, embeddingModel: 'bge-m3',
  ...(CTX ? { polizzaBatchContext: CTX } : {}),
  polizzaPrecheckMode: MODE, polizzaConstrainedJson: true,
}

// ── Rendering per l'OCR delle pagine senza text layer (stesso pdfjs+canvas del
// worker: web/lib/pdfRenderServer.ts). Se @napi-rs/canvas manca, niente OCR.
async function renderPngs(buf, pageNums) {
  const { createCanvas } = webRequire('@napi-rs/canvas')
  const pdfjsMod = await import(pathToFileURL(webRequire.resolve('pdfjs-dist/legacy/build/pdf.js')).href)
  const pdfjs = typeof pdfjsMod.getDocument === 'function' ? pdfjsMod : pdfjsMod.default
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''
  const canvasFactory = {
    create(w, h) { const canvas = createCanvas(Math.max(1, w), Math.max(1, h)); return { canvas, context: canvas.getContext('2d') } },
    reset(cc, w, h) { cc.canvas.width = Math.max(1, w); cc.canvas.height = Math.max(1, h) },
    destroy(cc) { if (cc.canvas) { cc.canvas.width = 0; cc.canvas.height = 0 } cc.canvas = null; cc.context = null },
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, canvasFactory, useWorkerFetch: false, disableFontFace: true }).promise
  const out = new Map()
  try {
    for (const n of pageNums) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      // Stessa risoluzione del worker (web/lib/pdfRenderServer.ts: lato lungo 4400 px, scala max 6).
      const scale = Math.min(6, 4400 / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const cc = canvasFactory.create(viewport.width, viewport.height)
      await page.render({ canvasContext: cc.context, viewport, canvasFactory }).promise
      out.set(n, cc.canvas.toDataURL('image/png'))
      canvasFactory.destroy(cc)
    }
  } finally { await doc.destroy() }
  return out
}

/** Pagine (griglia) di un PDF: cache per hash; OCR solo sulle pagine vuote. */
async function pagesOf(filePath) {
  const buf = readFileSync(filePath)
  const hash = createHash('sha256').update(buf).digest('hex')
  const cachePath = join(CACHE, `${hash}.json`)
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8')).pages
  let pages = []
  try { pages = await spatialPagesFromPdf(buf) } catch (err) { console.warn(`   pdfjs fallito su ${filePath}: ${err.message}`) }
  const empty = pages.map((t, i) => (t && t.trim() ? -1 : i + 1)).filter((n) => n > 0)
  // In cache SOLO un testo completo: pagine vuote per OCR fallito/disattivato
  // NON si salvano (prima restavano in cache per sempre e i rilanci non le
  // rifacevano più).
  let complete = true
  if (empty.length && !NO_OCR) {
    try {
      const pngs = await renderPngs(buf, empty)
      for (const [n, png] of pngs) pages[n - 1] = await svc.ocrPageText(png, settings)
      // Una pagina vuota DOPO l'OCR è una pagina bianca (o un'immagine senza
      // testo): è un risultato, si mette in cache. Non in cache solo se l'OCR
      // non è stato eseguito (eccezione o disattivato).
      const still = empty.filter((n) => !(pages[n - 1] || '').trim()).length
      console.log(`   OCR: ${empty.length} pagine senza text layer${still ? ` (${still} senza testo anche dopo l'OCR)` : ''}`)
    } catch (err) {
      complete = false
      console.warn(`   OCR non eseguito (${err.message}): ${empty.length} pagine restano vuote — testo NON messo in cache`)
    }
  } else if (empty.length) { complete = false; console.warn(`   ${empty.length} pagine senza text layer (OCR disattivato) — testo NON messo in cache`) }
  if (complete && pages.some((t) => t && t.trim())) writeFileSync(cachePath, JSON.stringify({ file: filePath, pages }))
  return pages
}

const results = []
for (const c of spec.cases || []) {
  if (ONLY && !ONLY.has(c.id)) continue
  const profile = byName.get(c.profile || spec.profile)
  if (!profile) { console.log(`\n## ${c.id}: SALTATO (profilo «${c.profile || spec.profile}» non trovato in ${PROFILES})`); results.push({ id: c.id, skipped: true, expected: c.expected, profile: c.profile || spec.profile }); continue }
  const { dir, error: dirError } = caseDir(c)
  const where = c.dir || c.match
  if (dirError) { console.log(`\n## ${c.id}: SALTATO (${dirError})`); results.push({ id: c.id, skipped: true, expected: c.expected, profile: profile.name }); continue }
  if (!existsSync(dir)) { console.log(`\n## ${c.id}: SALTATO (cartella mancante: ${where})`); results.push({ id: c.id, skipped: true, expected: c.expected, profile: profile.name }); continue }
  const files = caseFiles(c, dir)
  // Un file dichiarato che manca: il caso NON si misura con meno PDF.
  const missing = files.filter((f) => !existsSync(f))
  if (missing.length) { console.log(`\n## ${c.id}: SALTATO (file mancanti: ${missing.map((f) => relative(dir, f)).join(', ')})`); results.push({ id: c.id, skipped: true, expected: c.expected, profile: profile.name }); continue }
  if (!files.length) { console.log(`\n## ${c.id}: SALTATO (nessun PDF in ${where}${c.files ? ` tra ${c.files.join(', ')}` : ''})`); results.push({ id: c.id, skipped: true, expected: c.expected, profile: profile.name }); continue }
  console.log(`\n## ${c.id} — profilo «${profile.name}» — atteso: ${c.expected} — ${files.length} PDF`)
  const docs = [], spatialDocs = []
  for (const f of files) {
    // Nome = percorso relativo alla cartella del caso (mai nei prompt: marcatori [Documento N · pag. P]).
    const name = relative(dir, f)
    const pages = await pagesOf(f)
    docs.push({ name, pages: pages.map(collapseSpatial) })
    spatialDocs.push({ name, pages })
    console.log(`   ${name}: ${pages.length} pagine, ${pages.filter((t) => t && t.trim()).length} con testo`)
  }
  const diag = []
  const t0 = Date.now()
  let pre
  try {
    pre = await runPrecheck({ docs, spatialDocs, fieldDefs: profile.fields, profile, profileName: profile.name, mode: MODE, settings, allProfiles: profiles, diag })
  } catch (err) {
    pre = { verdict: 'error', mode: MODE, reason: err.message }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  for (const line of diag) console.log(`   · ${line}`)
  // «Da verificare» conta come risposta giusta per un «non operante» SOLO se è
  // un verdetto (prova assente/generica/contraddittoria), non un guasto:
  // altrimenti un Ollama spento darebbe punti pieni sui negativi.
  const infra = /non eseguibile|non leggibile|nessuna pagina|nessun batch/i.test(pre.reason || '')
  const blocked = pre.verdict === 'mismatch' || (pre.verdict === 'review' && !infra)
  // «non valido» (nessuna polizza, regola dell'utente del 26/09/2026): giusto
  // solo se il pre-controllo lo dice (notValid). Le fixture vecchie con
  // 'accantonata' valgono come 'non valido'. Una polizza vera detta «non
  // valida» è SBAGLIATA anche quando l'atteso è «non operante»: non si forza.
  const expected = c.expected === 'accantonata' ? 'non valido' : c.expected
  const notValid = pre.verdict === 'mismatch' && !!pre.notValid
  const correct = expected === 'operante' ? pre.verdict === 'ok'
    : expected === 'non valido' ? notValid
      : blocked && !notValid
  const op = pre.operativita
  const pol = pre.polizza
  const polCalls = (diag || []).filter((l) => /^Polizza batch \d/.test(l)).length
  console.log(`   → ${correct ? 'GIUSTO' : 'SBAGLIATO'}: verdetto ${pre.verdict}${notValid ? ' (NON VALIDO)' : ''} [${pre.mode}] in ${secs}s — ${pre.reason}`)
  if (pol?.esito) console.log(`     polizza: ${pol.esito}${pol.documento ? ` — Documento ${pol.documento}${pol.pagina ? ` pag. ${pol.pagina}` : ''}` : ''}${pol.motivo ? `: ${String(pol.motivo).slice(0, 160)}` : ''} (${polCalls} domande sul contratto)`)
  if (op?.evidenza) console.log(`     prova: Documento ${op.documento ?? '?'} pag. ${op.pagina ?? '?'} «${String(op.evidenza).slice(0, 160)}»${op.docName ? ` (${op.docName})` : ''}`)
  if (pre.suggestion) console.log(`     profilo suggerito: «${pre.suggestion.name}»${pre.suggestion.signal ? ` (${pre.suggestion.signal})` : ''}`)
  results.push({ id: c.id, profile: profile.name, expected, verdict: notValid ? 'non valido' : pre.verdict, mode: pre.mode, correct, secs: Number(secs), reason: pre.reason, polizza: pol || null, contractCalls: polCalls, evidenza: op?.evidenza || null, documento: op?.docName || null, pagina: op?.pagina || null, suggestion: pre.suggestion?.name || null })
}

const done = results.filter((r) => !r.skipped)
const right = done.filter((r) => r.correct).length
console.log('\n=== RIEPILOGO ===')
for (const r of results) {
  if (r.skipped) { console.log(`  ${r.id.padEnd(30)} saltato`); continue }
  console.log(`  ${r.id.padEnd(30)} ${r.correct ? 'GIUSTO  ' : 'SBAGLIATO'} atteso ${r.expected.padEnd(13)} → ${String(r.verdict).padEnd(8)} ${String(r.secs).padStart(6)}s  ${r.reason.slice(0, 90)}`)
}
const usedProfiles = [...new Set(done.map((r) => r.profile))]
console.log(`\nPertinenza: ${right}/${done.length} posizioni giuste${results.length > done.length ? ` (${results.length - done.length} saltate: cartelle, file o profili mancanti)` : ''} — ${usedProfiles.length > 1 ? 'profili' : 'profilo'} ${usedProfiles.map((n) => `«${n}»`).join(', ')}, modo ${MODE}${NO_RECOG ? ' (senza «Come riconoscerla»)' : ''}, modello ${MODEL}`)
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify({ profile: usedProfiles.length === 1 ? usedProfiles[0] : null, profiles: usedProfiles, mode: MODE, model: MODEL, noRecognition: NO_RECOG, right, total: done.length, results }, null, 2)); console.log(`Salvato in ${JSON_OUT}`) }
// Il worker Tesseract terrebbe vivo il processo per sempre: chiudere ed uscire.
await svc.closeOcrWorker()
process.exit(0)
