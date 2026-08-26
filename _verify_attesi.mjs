#!/usr/bin/env node
// Verifica che i VALORI ATTESI del report (ground truth) siano presenti nei
// testi OCR dei fascicoli (la stessa fonte che vede il motore). Per ogni campo:
//   1. trova il documento citato (fonteFile) e la pagina (fontePagina) nella cache OCR;
//   2. cerca il valore atteso in quella pagina (match normalizzato, spazi/case/punteggiatura);
//   3. se non trovato nella fonte citata, cerca la cifra/valore in TUTTO il fascicolo
//      e riporta dove sta (per capire se la fonte è solo "storica").
// Salva out/_verify_attesi.json e un report markdown.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

const PREP = '_prep_casi_report.json'
const prep = JSON.parse(readFileSync(PREP, 'utf8'))

// cartella cache: mappa caso → suffisso dei file cache OCR
const OCR_PREFIX = {
  A: 'in_vigore__',
  B: 'in_vigore_3__',
}

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[.,;:()"'’/\\|-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const normDigits = (s) => String(s ?? '').replace(/\D/g, '')

function isNumericValue(s) {
  return /^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(String(s || '').trim())
}

// carica le pagine OCR di un caso
function loadPagesForCase(caseId) {
  const prefix = OCR_PREFIX[caseId]
  const files = readdirSync('out/ocr').filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
  const docs = new Map()
  for (const f of files) {
    const name = f.slice(prefix.length, -'.json'.length).replace(/_/g, ' ')
    let pages = []
    try { pages = JSON.parse(readFileSync(join('out/ocr', f), 'utf8')) } catch {}
    docs.set(name, { file: f, pages: Array.isArray(pages) ? pages : [], nameRaw: name })
  }
  return docs
}

// trova il documento nella mappa per il nome file (normalizzato)
function findByFile(docs, file) {
  const target = norm(file)
  for (const [k, v] of docs) {
    if (norm(k) === target) return v
    // accetta anche se il nostro nome normalizzato è contenuto nel target per i trattini/punti
    if (target.includes(norm(v.nameRaw))) return v
    if (norm(v.nameRaw).includes(target)) return v
  }
  return null
}

function findInPages(pages, atteso, { pageOnly = null } = {}) {
  const nv = norm(atteso)
  const dv = normDigits(atteso)
  const start = pageOnly != null ? Math.max(0, pageOnly - 1) : 0
  const end = pageOnly != null ? pageOnly : pages.length
  for (let pi = start; pi < Math.min(end, pages.length); pi++) {
    const page = String(pages[pi] || '')
    const np = norm(page)
    if (nv && np.includes(nv)) return { found: true, page: pi + 1, how: 'norm' }
    // valori numerici: confronto su sole cifre (tolleranza spazi/sep)
    if (dv && dv.length >= 3 && normDigits(page).includes(dv)) return { found: true, page: pi + 1, how: 'digits' }
  }
  return { found: false, page: null }
}

function normValAtteso(atteso) {
  return norm(atteso)
}

const report = { verificato: new Date().toISOString(), casi: {} }
const lines = []
lines.push('# Verifica indipendente dei valori attesi nei testi OCR')
lines.push('')
lines.push('Per ogni campo cerco il valore atteso nel documento citato dalla ground truth. Il confronto estrazione/atteso poi usa QUESTA verifica come base: ciò che NON trovo nel testo non può essere un valore estratto corretto.')
lines.push('')

for (const caso of prep.casi) {
  const docs = loadPagesForCase(caso.id)
  if (!docs.size) { console.log(`caso ${caso.id}: nessuna cache OCR`); continue }
  const rows = []
  let citata = 0, soloFascicolo = 0, nonTrovato = 0, vuoto = 0
  for (const [fid, va] of Object.entries(caso.valoriAttesi)) {
    const atteso = String(va.atteso ?? '')
    const isEmptyExpected = /non presente|non indicato|nessun sinistro|da data specifica/.test(atteso)
    if (isEmptyExpected) { vuoto++; rows.push({ campo: fid, label: va.label, atteso: '', esito: 'vuoto-atteso', note: 'niente da cercare' }); continue }
    const file = findByFile(docs, va.fonteFile)
    const pagina = va.fontePagina || null
    let esito, dove, come
    if (file) {
      const r = findInPages(file.pages, atteso, { pageOnly: pagina })
      if (r.found) { citata++; esito = 'OK-fonte'; dove = `${file.nameRaw} pag.${r.page}`; come = r.how }
      else { esito = 'non-pagina'; dove = `${file.nameRaw} (pag ${pagina})` }
    } else {
      esito = 'file-non-trovato'
    }
    // se non trovato nella fonte citata (o file assente), cerco in tutto il fascicolo
    if (esito !== 'OK-fonte') {
      let anywhere = null
      for (const [, d] of docs) {
        const r = findInPages(d.pages, atteso)
        if (r.found) { anywhere = { file: d.nameRaw, page: r.page }; break }
      }
      if (anywhere) { soloFascicolo++; rows.push({ campo: fid, label: va.label, atteso, esito: 'solo-fascicolo', dove: `${anywhere.file} pag.${anywhere.page}` }) }
      else { nonTrovato++; rows.push({ campo: fid, label: va.label, atteso, esito: 'non-trovato', dove }) }
      continue
    }
    rows.push({ campo: fid, label: va.label, atteso, esito, dove: `${dove} (${come})` })
  }
  report.casi[caso.id] = { nome: caso.nome, profilo: caso.profiloAbilitato?.nome, counts: { citata, soloFascicolo, nonTrovato, vuoto }, rows }
  lines.push(`## Caso ${caso.id} — ${caso.nome}`)
  lines.push(`Trovati nella fonte citata: **${citata}** · solo in altro doc: ${soloFascicolo} · non trovati: **${nonTrovato}** · attesi vuoti: ${vuoto}`)
  lines.push('')
  lines.push('| Campo | Label | Valore atteso | Esito verifica | Dove |')
  lines.push('|---|---|---|---|---|')
  for (const r of rows) {
    lines.push(`| ${r.campo} | ${r.label} | ${r.atteso || '—'} | **${r.esito}** | ${r.dove || (r.note || '')} |`)
  }
  lines.push('')
  console.log(`Caso ${caso.id}: fonte-citata ${citata}, solo-fascicolo ${soloFascicolo}, non-trovato ${nonTrovato}, vuoti ${vuoto}`)
}

mkdirSync('out', { recursive: true })
writeFileSync('out/_verify_attesi.json', JSON.stringify(report, null, 2))
writeFileSync('out/_verify_attesi.md', lines.join('\n'))
console.log('\nScritto out/_verify_attesi.json/.md')