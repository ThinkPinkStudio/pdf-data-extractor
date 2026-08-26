#!/usr/bin/env node
// Scorer generico per i probe staged dei fix. Golden = _prep_casi_report.json (caso B).
// Semantica identica a _local14_score.mjs: OK = non vuoto e normalizzato == atteso;
// atteso "(non presente)/(non indicato)/nessun..." -> deve restare vuoto (EMPTY-ok).
// NON committare.
import { readFileSync, writeFileSync } from 'fs'

const [,, rawPath = 'out/probe_B_fix.json', caso = 'B', outMd = `_${caso}_fix_report.md`, outJson = `_${caso}_fix_report.json`] = process.argv

const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
const prep = JSON.parse(readFileSync('_prep_casi_report.json', 'utf8'))
const golden = prep.casi.find((c) => c.id === caso)?.valoriAttesi || {}

function textNorm(s) {
  return String(s || '')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}
function moneyCents(v) {
  let s = String(v || '').trim().replace(/^(?:€|eur)\s*/i, '').replace(/\s+/g, '')
  if (!/^\d[\d.,]*$/.test(s) || !/\d/.test(s)) return null
  const m = s.match(/^(.*)[.,](\d{2})$/)
  const intPart = m ? m[1] : s
  const dec = m ? m[2] : '00'
  const int = intPart.replace(/[.,]/g, '')
  if (!/^\d+$/.test(int)) return null
  return parseInt(int + dec, 10)
}
function isDateLike(v) { return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(v || '').trim()) }
function normForCompare(v) {
  if (v == null) return ''
  const s = String(v).trim()
  if (!s) return ''
  if (isDateLike(s)) {
    const [d, mo, y] = s.split('/')
    const yy = y.length === 2 ? '20' + y : y
    return `${yy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const c = moneyCents(s)
  if (c != null) return `M${c}`
  return textNorm(s)
}
const EXPECTED_ABS = /^\(non presente\)|^\(non indicato\)|^non presente|^non indicato|^non dichiarato|^nessun|^non c'è|^non esiste/
function isAbs(a) { return EXPECTED_ABS.test(String(a || '').trim().toLowerCase()) }

const rows = []
let ok = 0, emptyOk = 0, wrong = 0, missing = 0
const order = Object.keys(golden)
for (const id of order) {
  const g = golden[id] || {}
  const label = g.label || id
  const atteso = g.atteso || ''
  const extracted = raw.data?.[id] != null ? String(raw.data[id]).trim() : ''
  const expectedAbs = isAbs(atteso)

  let esito
  if (expectedAbs) esito = (extracted === '') ? 'EMPTY-ok' : 'WRONG'
  else if (extracted === '') esito = 'MISSING'
  else if (normForCompare(extracted) === normForCompare(atteso)) esito = 'OK'
  else {
    const nA = textNorm(atteso); const nE = textNorm(extracted)
    esito = (nA.length >= 8 && nE.includes(nA)) ? 'OK-text' : 'WRONG'
  }
  if (esito === 'OK' || esito === 'OK-text') ok++
  else if (esito === 'EMPTY-ok') emptyOk++
  else if (esito === 'MISSING') missing++
  else wrong++
  rows.push({ campo: id, label, atteso: atteso || '(non presente)', estratto: extracted, fonte: raw.sources?.[id]?.file || '', esito })
}
const totOk = ok + emptyOk
const lines = []
lines.push(`# Probe STAGED fix — caso ${caso} (${raw.profilo || ''})`)
lines.push(`\n- Modello: ${raw.modello} · Ollama: ${raw.ollamaUrl} · strategia ${raw.strategiaIng || 'staged-gruppi'}`)
lines.push(`- **Punteggio: ${totOk}/${order.length}** (ok=${ok} · emptyOk=${emptyOk} · wrong=${wrong} · missing=${missing})`)
lines.push('\n## Campo per campo')
lines.push('\n| campo | label | atteso | estratto | esito |')
lines.push('|---|---|---|---|---|')
for (const r of rows) {
  lines.push(`| \`${r.campo}\` | ${r.label} | \`${(r.atteso||'').replace(/\|/g,'\\|')}\` | \`${(r.estratto||'').replace(/\|/g,'\\|')}\` | ${r.esito} |`)
}
lines.push('\nLegenda: OK/OK-text = corretto · EMPTY-ok = atteso assente e resta vuoto · MISSING = atteso valorizzato ma manca · WRONG = presente ma errato.')
writeFileSync(outMd, lines.join('\n') + '\n')
writeFileSync(outJson, JSON.stringify({
  caso, profilo: raw.profilo, modello: raw.modello, ollamaUrl: raw.ollamaUrl,
  totale: order.length, ok, emptyOk, wrong, missing, verdetto: `${totOk}/${order.length}`, rows,
}, null, 2))
console.log(`Verdetto ${totOk}/${order.length} — ok=${ok} emptyOk=${emptyOk} wrong=${wrong} missing=${missing}`)
console.log('SALVATI', outMd, outJson)