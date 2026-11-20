#!/usr/bin/env node
/**
 * TUTTI i fascicoli golden in un colpo, contro l'Ollama VERO (di produzione):
 * per ogni caso lancia calibrazione-run.mjs (motore a stadi, stesso testo
 * pdfjs del worker) e poi eval-polizza.mjs contro il golden. Alla fine stampa
 * la tabella riassuntiva (match / allucinazioni per fascicolo).
 *
 * Da lanciare dal LOCALE (la macchina che raggiunge 192.168.37.10):
 *   cd pdf-data-extractor && (cd web && npm ci) && ln -sfn web/node_modules node_modules
 *   node scripts/calibrazione-goldens.mjs [--only guffanti,rcp-pilato] [--model qwen3:8b]
 *        [--ollama http://192.168.37.10:11434] [--out /tmp/goldens] [--resolve-only]
 *        [--ctx 32768]  (tetto di contesto, passato a calibrazione-run; default 8192)
 *        [--full]       golden a VERITÀ PIENA (test/fixtures/full-*.json, FULL_CASES):
 *                       punteggio giusti/N su TUTTI i campi del profilo (Regola 4),
 *                       profili in uso, cartelle lette ricorsivamente; riepilogo
 *                       anche in <out>/summary.json (per confrontare modelli)
 *
 * --resolve-only: non chiama Ollama, mostra solo come le chiavi di ogni golden
 * si agganciano ai campi del profilo (controllo preliminare, istantaneo).
 *
 * Una run alla volta (REGOLE_AGENTI, Regola 3): i casi girano in SEQUENZA.
 */
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'
import { CASES, FULL_CASES, FULL_PROFILES } from './golden-cases.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const { scoreExtraction, formatScoreReport, normLabel, scoreFullTruth, formatFullTruthReport } = await import(join(root, 'src/services/polizzaEval.js'))

/**
 * Le chiavi dei golden sono di tre tipi: UUID del campo, id legacy
 * ("polizza_numero", tradotti da polizze_test/uuid-mapping.json) o LABEL
 * ("N° Polizza"). L'estrazione usa gli UUID del profilo: qui ogni chiave viene
 * risolta all'UUID del campo del profilo, così il punteggio confronta le cose
 * giuste. Le chiavi non risolvibili restano com'erano (e risultano mancanti:
 * meglio vederle che nasconderle).
 */
export function resolveGoldenToProfile(golden, profile, legacyMap) {
  const ids = new Set((profile?.fields || []).map((f) => f.id))
  const byLabel = new Map((profile?.fields || []).map((f) => [normLabel(f.label), f.id]))
  const fields = {}
  const unresolved = []
  for (const [key, spec] of Object.entries(golden.fields || {})) {
    let id = null
    if (ids.has(key)) id = key
    else if (legacyMap?.[key] && ids.has(legacyMap[key])) id = legacyMap[key]
    else if (byLabel.has(normLabel(key))) id = byLabel.get(normLabel(key))
    if (!id) unresolved.push(key)
    fields[id || key] = spec
  }
  return { expected: { ...golden, fields }, unresolved }
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}
const ONLY = arg('only') ? new Set(arg('only').split(',').map((s) => s.trim())) : null
const MODEL = arg('model', process.env.OLLAMA_MODEL || 'qwen3:8b')
const OLLAMA = arg('ollama', process.env.OLLAMA_URL || 'http://192.168.37.10:11434')
const OUT = arg('out', join(root, '.goldens-out'))
const FULL = process.argv.includes('--full')
const PROFILES = arg('profile-json', join(root, FULL ? FULL_PROFILES : 'polizze_test/profili-polizza-calibrato.json'))
const RESOLVE_ONLY = process.argv.includes('--resolve-only')
const CTX = arg('ctx')
mkdirSync(OUT, { recursive: true })
const loadProfiles = (f) => { const d = JSON.parse(readFileSync(f, 'utf8')); return Array.isArray(d) ? d : Object.values(d) }
const profiles = loadProfiles(PROFILES)
// PDF di una cartella, RICORSIVO (percorsi relativi alla cartella): i pezzi in
// sottocartella («…/POLIZZA») fanno parte del fascicolo.
const walkPdfs = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walkPdfs(p) : (/\.pdf$/i.test(f) ? [p] : []) })
const legacyMap = existsSync(join(root, 'polizze_test/uuid-mapping.json'))
  ? JSON.parse(readFileSync(join(root, 'polizze_test/uuid-mapping.json'), 'utf8')).fields || {}
  : {}

const summary = []
const t00 = Date.now()
for (const c of (FULL ? FULL_CASES : CASES)) {
  if (ONLY && !ONLY.has(c.id)) continue
  const dir = join(root, c.dir)
  const golden = join(root, c.golden)
  const files = c.files
    ? c.files.filter((f) => existsSync(join(dir, f)))
    : (FULL && existsSync(dir) ? walkPdfs(dir).map((p) => relative(dir, p)).sort() : [])
  if (!existsSync(dir) || !existsSync(golden) || (c.files && !files.length)) {
    console.log(`\n## ${c.id}: SALTATO (PDF o golden mancanti in ${c.dir})`)
    summary.push({ id: c.id, skipped: true })
    continue
  }
  const out = join(OUT, `${c.id}.json`)
  const caseProfilesPath = FULL && c.profileJson && !process.argv.includes('--profile-json') ? join(root, c.profileJson) : PROFILES
  const profile = (caseProfilesPath === PROFILES ? profiles : loadProfiles(caseProfilesPath)).find((p) => p.name === c.profile)
  if (!profile) { console.log(`\n## ${c.id}: profilo "${c.profile}" non trovato in ${PROFILES}`); summary.push({ id: c.id, error: 'profilo mancante' }); continue }
  const goldenJson = JSON.parse(readFileSync(golden, 'utf8'))
  const fieldDefs = (profile.fields || []).filter((f) => f.enabled !== false)
  const { expected, unresolved } = FULL
    ? { expected: goldenJson, unresolved: fieldDefs.filter((f, i) => !Object.keys(goldenJson.fields || {}).some((k) => normLabel(k) === normLabel(f.label) || k.endsWith(`#${i}`))).map((f) => f.label) }
    : resolveGoldenToProfile(goldenJson, profile, legacyMap)
  if (RESOLVE_ONLY) {
    const n = Object.keys(expected.fields).length
    console.log(FULL
      ? `  ${c.id.padEnd(16)} profilo "${c.profile}": ${fieldDefs.length - unresolved.length}/${fieldDefs.length} campi del profilo con verità${unresolved.length ? ` · SENZA verità (contano sbagliati): ${unresolved.join(', ')}` : ''} · ${files.length} PDF`
      : `  ${c.id.padEnd(14)} profilo "${c.profile}": ${n - unresolved.length}/${n} chiavi golden risolte ai campi del profilo${unresolved.length ? ` · NON risolte: ${unresolved.join(', ')}` : ''}`)
    continue
  }
  console.log(`\n## ${c.id} — profilo "${c.profile}" — modello ${MODEL}`)
  if (unresolved.length) console.log(`   (chiavi golden non risolte al profilo: ${unresolved.join(', ')})`)
  const runArgs = ['scripts/calibrazione-run.mjs', '--dir', dir, '--profile', c.profile, '--profile-json', caseProfilesPath, '--ollama', OLLAMA, '--model', MODEL, '--out', out]
  if (files.length) runArgs.push('--files', files.join(','))
  if (CTX) runArgs.push('--ctx', CTX)
  const t0 = Date.now()
  const run = spawnSync(process.execPath, runArgs, { cwd: root, stdio: 'inherit', env: process.env })
  const secs = Math.round((Date.now() - t0) / 1000)
  if (run.status !== 0 || !existsSync(out)) { summary.push({ id: c.id, error: `calibrazione-run exit ${run.status}` }); continue }
  const actual = JSON.parse(readFileSync(out, 'utf8'))
  const extracted = Object.keys(actual.data || {}).length
  if (FULL) {
    const score = scoreFullTruth(actual, expected, fieldDefs)
    const report = formatFullTruthReport(score)
    console.log(report)
    writeFileSync(join(OUT, `${c.id}-score.txt`), report)
    summary.push({ id: c.id, profile: c.profile, secs, extracted, right: score.right, total: score.total, noTruth: score.noTruth.length, line: report.split('\n')[1]?.trim() || '' })
    // Riepilogo aggiornato a ogni caso: una coda interrotta lascia i numeri già misurati.
    writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ model: MODEL, ctx: CTX ? Number(CTX) : 8192, ollama: OLLAMA, profiles: PROFILES, cases: summary }, null, 2))
    continue
  }
  const score = scoreExtraction(actual, expected)
  const report = formatScoreReport(score)
  console.log(report)
  writeFileSync(join(OUT, `${c.id}-score.txt`), report)
  summary.push({ id: c.id, profile: c.profile, secs, extracted, line: report.split('\n')[1]?.trim() || '' })
}
if (RESOLVE_ONLY) process.exit(0)

console.log(`\n=== RIEPILOGO — modello ${MODEL}${CTX ? ` · ctx ${CTX}` : ''} — ${Math.round((Date.now() - t00) / 60000)} min ===`)
if (FULL) {
  const done = summary.filter((s) => s.total)
  const R = done.reduce((a, s) => a + s.right, 0), N = done.reduce((a, s) => a + s.total, 0)
  console.log(`  TOTALE giusti ${R}/${N} (${N ? Math.round((R / N) * 1000) / 10 : 0}%) su ${done.length} fascicoli`)
}
for (const s of summary) {
  if (s.skipped) { console.log(`  ${s.id.padEnd(14)} saltato`); continue }
  if (s.error) { console.log(`  ${s.id.padEnd(14)} ERRORE: ${s.error}`); continue }
  console.log(`  ${s.id.padEnd(14)} ${String(s.secs).padStart(5)}s  campi estratti ${String(s.extracted).padStart(3)}  ${s.line}`)
}
console.log(`\nOutput per fascicolo in ${OUT} (<id>.json + <id>-diag.txt con la diagnostica completa).`)
