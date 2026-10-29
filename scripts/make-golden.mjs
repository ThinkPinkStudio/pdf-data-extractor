#!/usr/bin/env node
/**
 * Genera una BOZZA di golden (valori attesi) per un PDF+profilo.
 *
 * Uso:
 *   node scripts/make-golden.mjs --pdf <file.pdf> --profile "<Profilo>" [--profile-json <file>] [--out <golden.json>]
 *
 * Legge il text layer del PDF (piatta), e per ogni campo attivo del profilo
 * cerca nella finestra di contesto le parole più significative della
 * description (n-grammi ≥ 4 char) e stampa la riga dove compaiono — così da
 * vedere DOVE sta il dato e compilarlo a mano. Lo script NON indovina i valori:
 * produce { id: { value: null, hint: "riga di contesto" } } da correggere.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}

const pdf = arg('pdf')
const profileName = arg('profile')
const out = arg('out')
const profileJson = arg('profile-json', join(root, 'polizze_test/profili-polizza-calibrato.json'))
if (!pdf || !profileName) {
  console.error('Uso: node scripts/make-golden.mjs --pdf <file.pdf> --profile "<Profilo>" [--out out.json]')
  process.exit(2)
}
if (!existsSync(pdf)) { console.error('PDF non trovato:', pdf); process.exit(2) }

// Dump del text layer (piatto) come lo script calibrazione.
const pdfjsMod = await import('pdfjs-dist/legacy/build/pdf.js')
const pdfjs = pdfjsMod.default || pdfjsMod
if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(pdf)),
  useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true, disableFontFace: true,
}).promise
const pages = []
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const content = await page.getTextContent({ includeMarkedContent: false })
  const text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ').trim()
  if (text) pages.push({ p, text })
}
const allText = pages.map((x) => x.text).join('\n')
console.log(`PDF: ${pdf.split('/').pop()} — ${doc.numPages} pagine, ${allText.length} char`)

const profiles = JSON.parse(readFileSync(profileJson, 'utf8'))
const profile = profiles.find((x) => x.name === profileName)
if (!profile) { console.error('Profilo non trovato:', profileName); process.exit(2) }
const fields = profile.fields.filter((f) => f.enabled !== false)
console.log(`Profilo: ${profile.name} — ${fields.length} campi attivi`)

// Etichette da cercare: parole chiave della label + description (≥4 char, senza stopword).
const STOP = new Set(['della', 'delle', 'dello', 'degli', 'della', 'di', 'del', 'per', 'con', 'una', 'un', 'che', 'non', 'il', 'lo', 'la', 'le', 'i', 'gli', 'e', 'o', 'sono', 'sia', 'anche', 'piu', 'più', 'es', 'esempio', 'valore', 'campo', 'campi', 'della'])
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const words = (s) => norm(s).split(' ').filter((w) => w.length >= 4 && !STOP.has(w))

const golden = { id: profile.name.replace(/\s+/g, '-').toLowerCase(), label: pdf.split('/').pop(), source: pdf, fields: {} }
for (const f of fields) {
  const terms = words(`${f.label || ''} ${f.description || ''}`)
  // Trova la riga del text dove compaiono il maggior numero di termini.
  let bestLine = null; let bestScore = 0
  for (const line of allText.split('\n')) {
    const n = norm(line)
    const score = terms.filter((t) => n.includes(t)).length
    if (score > bestScore) { bestScore = score; bestLine = line }
  }
  golden.fields[f.id] = {
    value: null,
    mode: 'text',
    hint: bestScore > 0 ? bestLine.trim().slice(0, 160) : '(non trovato)',
  }
}

if (out) { writeFileSync(out, JSON.stringify(golden, null, 2)); console.log('Golden bozza salvato:', out) }
else console.log(JSON.stringify(golden, null, 2))