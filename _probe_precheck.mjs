#!/usr/bin/env node
// PROBE TEMPORANEA — verifica abbinamento profilo RC PROF MED V2 sui 3 fascicoli del campione,
// usando il pre-check di pertinenza REALE (runPrecheck in polizzaPrecheckService).
// NON è parte del progetto: va cancellata dopo l'uso.

import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

const here = dirname(fileURLToPath(import.meta.url))
const precheck = await import('./src/main/services/polizzaPrecheckService.js')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const ROOT = '/tmp/campione_polizze/campione polizze x test 07 08 2026 1'
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'

async function pdfToPages(file) {
  const data = new Uint8Array(readFileSync(file))
  pdfjs.GlobalWorkerOptions.workerSrc = ''
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i)
    const tc = await pg.getTextContent()
    pages.push(tc.items.map((t) => ('str' in t ? t.str : '')).join(' '))
  }
  await doc.destroy()
  return pages
}

const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profilo = profili.find((p) => p.name === 'RC PROF MED V2')
if (!profilo) { console.error('Profilo non trovato'); process.exit(2) }
const fieldDefs = (profilo.fields || []).filter((f) => f.enabled !== false).map((f) => ({ id: f.id, label: f.label, description: f.description }))

const settings = {
  ollamaUrl: OLLAMA_URL,
  ollamaModel: MODEL,
  embeddingModel: 'bge-m3',
  ollamaNumCtx: 8192,
  llmModel: MODEL,
  llmProvider: 'ollama',
}

// Password di runPrecheck vuole mode, profile, fieldDefs, docs, settings
const fascicoli = ['Cond Via della libertà 55', 'DiGrazia', 'in vigore']
for (const f of fascicoli) {
  const folder = join(ROOT, f)
  if (!readdirSync(folder)) continue
  const files = readdirSync(folder).filter((x) => x.toLowerCase().endsWith('.pdf'))
  const docs = []
  for (const file of files) {
    const pages = await pdfToPages(join(folder, file))
    docs.push({ name: file, pages })
  }
  const norm = docs.map((d) => d.pages.join('\n')).join('\n')
  console.log(`\n═══ Fascicolo: ${f} (${files.length} file, ${norm.length} char) ═══`)
  for (const mode of ['keywords', 'semantic', 'llm']) {
    try {
      const r = await precheck.runPrecheck({ docs, fieldDefs, profile: profilo, profileName: profilo.name, mode, settings })
      console.log(`  [${mode}] verdict=${r.verdict} score=${r.score != null ? r.score.toFixed(3) : '-'} thr=${r.threshold} — ${r.reason}`)
    } catch (e) {
      console.log(`  [${mode}] ERRORE: ${e.message}`)
    }
  }
}