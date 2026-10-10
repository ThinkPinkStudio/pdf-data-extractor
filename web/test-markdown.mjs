#!/usr/bin/env node
// Prova: usa il markdown di pdf-inspector come input per il motore staged,
// per vedere se la tabella premi (etc.) viene letta correttamente.
import { readFileSync } from 'fs'
import { processPdf } from '@firecrawl/pdf-inspector'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const pdfPath = process.argv[2]
const profileName = process.argv[3] || 'Tutela Legale 3'
const MODEL = process.argv.find(a => a.startsWith('--model='))?.split('=')[1] || 'qwen3:8b'
if (!pdfPath) { console.error('Uso: node test-markdown.mjs <file.pdf> [profile]'); process.exit(2) }

// 1) markdown
const buf = readFileSync(pdfPath)
const res = await processPdf(buf)
const md = res.markdown || ''
console.log(`[pdf-inspector] md: ${md.length} char`)

// 2) carica motore (da ../src)
const svc = await import('../src/services/polizzaService.js')
const collapseSpatial = (p) => String(p || '').split('\n').map((l) => l.replace(/\s{2,}/g, ' ').trim()).join('\n')

// docs: un documento con pages=[markdown] (e text=markdown piatto)
const doc = {
  name: pdfPath.split('/').pop(),
  pages: [md],      // un solo blocco col markdown completo (come il worker)
  spatialPages: [md],
  text: md,
}
const docs = [doc]

// 3) profilo
const profiles = JSON.parse(readFileSync('../polizze_test/profili-polizza-calibrato.json', 'utf8'))
const profile = profiles.find((p) => p.name === profileName)
if (!profile) { console.error('profilo mancante', profileName); process.exit(2) }
const fields = profile.fields.filter((f) => f.enabled !== false)

const settings = {
  ollamaUrl: 'http://192.168.37.10:11434',
  ollamaModel: MODEL,
  polizzaFields: fields,
  polizzaConstrainedJson: true,
  polizzaPerField: false,
  polizzaStagedCascade: false,
  polizzaOcrEnabled: false,
  embeddingModel: 'bge-m3',
  polizzaBatchContext: 8192,
  polizzaPromptExtra: '',
}

// 4) estrazione staged
const started = Date.now()
const res2 = await svc.extractPolizzaStaged([doc], settings, () => {})
const secs = ((Date.now() - started) / 1000).toFixed(1)
console.log(`\n=== RISULTATO (${secs}s) — ${Object.keys(res2.data).length}/${fields.length} ===`)
for (const f of fields) {
  const v = res2.data[f.id]
  const src = res2.sources?.[f.id]
  console.log(`  ${v != null && v !== '' ? 'OK ' : '-- '} ${String(f.label).padEnd(40)} = ${v != null && v !== '' ? String(v).slice(0, 70) : '(vuoto)'}${src ? `  [${src.file}]` : ''}`)
}
console.log('\n--- DIAG (ultime 12) ---')
for (const l of (res2.diag || []).slice(-12)) console.log(' ', String(l).slice(0, 180))