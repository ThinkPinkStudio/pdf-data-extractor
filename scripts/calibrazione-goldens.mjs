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
 *
 * --resolve-only: non chiama Ollama, mostra solo come le chiavi di ogni golden
 * si agganciano ai campi del profilo (controllo preliminare, istantaneo).
 *
 * Una run alla volta (REGOLE_AGENTI, Regola 3): i casi girano in SEQUENZA.
 */
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { CASES } from './golden-cases.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const { scoreExtraction, formatScoreReport, normLabel } = await import(join(root, 'src/services/polizzaEval.js'))

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
const PROFILES = arg('profile-json', join(root, 'polizze_test/profili-polizza-calibrato.json'))
const RESOLVE_ONLY = process.argv.includes('--resolve-only')
mkdirSync(OUT, { recursive: true })
const profiles = JSON.parse(readFileSync(PROFILES, 'utf8'))
const legacyMap = existsSync(join(root, 'polizze_test/uuid-mapping.json'))
  ? JSON.parse(readFileSync(join(root, 'polizze_test/uuid-mapping.json'), 'utf8')).fields || {}
  : {}

const summary = []
for (const c of CASES) {
  if (ONLY && !ONLY.has(c.id)) continue
  const dir = join(root, c.dir)
  const golden = join(root, c.golden)
  const files = (c.files || []).filter((f) => existsSync(join(dir, f)))
  if (!existsSync(dir) || !existsSync(golden) || (c.files && !files.length)) {
    console.log(`\n## ${c.id}: SALTATO (PDF o golden mancanti in ${c.dir})`)
    summary.push({ id: c.id, skipped: true })
    continue
  }
  const out = join(OUT, `${c.id}.json`)
  const profile = profiles.find((p) => p.name === c.profile)
  if (!profile) { console.log(`\n## ${c.id}: profilo "${c.profile}" non trovato in ${PROFILES}`); summary.push({ id: c.id, error: 'profilo mancante' }); continue }
  const { expected, unresolved } = resolveGoldenToProfile(JSON.parse(readFileSync(golden, 'utf8')), profile, legacyMap)
  if (RESOLVE_ONLY) {
    const n = Object.keys(expected.fields).length
    console.log(`  ${c.id.padEnd(14)} profilo "${c.profile}": ${n - unresolved.length}/${n} chiavi golden risolte ai campi del profilo${unresolved.length ? ` · NON risolte: ${unresolved.join(', ')}` : ''}`)
    continue
  }
  console.log(`\n## ${c.id} — profilo "${c.profile}" — modello ${MODEL}`)
  if (unresolved.length) console.log(`   (chiavi golden non risolte al profilo: ${unresolved.join(', ')})`)
  const runArgs = ['scripts/calibrazione-run.mjs', '--dir', dir, '--profile', c.profile, '--profile-json', PROFILES, '--ollama', OLLAMA, '--model', MODEL, '--out', out]
  if (files.length) runArgs.push('--files', files.join(','))
  const t0 = Date.now()
  const run = spawnSync(process.execPath, runArgs, { cwd: root, stdio: 'inherit', env: process.env })
  const secs = Math.round((Date.now() - t0) / 1000)
  if (run.status !== 0 || !existsSync(out)) { summary.push({ id: c.id, error: `calibrazione-run exit ${run.status}` }); continue }
  const actual = JSON.parse(readFileSync(out, 'utf8'))
  const score = scoreExtraction(actual, expected)
  const report = formatScoreReport(score)
  console.log(report)
  writeFileSync(join(OUT, `${c.id}-score.txt`), report)
  const extracted = Object.keys(actual.data || {}).length
  summary.push({ id: c.id, profile: c.profile, secs, extracted, line: report.split('\n')[1]?.trim() || '' })
}
if (RESOLVE_ONLY) process.exit(0)

console.log('\n=== RIEPILOGO ===')
for (const s of summary) {
  if (s.skipped) { console.log(`  ${s.id.padEnd(14)} saltato`); continue }
  if (s.error) { console.log(`  ${s.id.padEnd(14)} ERRORE: ${s.error}`); continue }
  console.log(`  ${s.id.padEnd(14)} ${String(s.secs).padStart(5)}s  campi estratti ${String(s.extracted).padStart(3)}  ${s.line}`)
}
console.log(`\nOutput per fascicolo in ${OUT} (<id>.json + <id>-diag.txt con la diagnostica completa).`)
