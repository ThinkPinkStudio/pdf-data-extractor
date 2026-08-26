#!/usr/bin/env node
// Scorer run 14b locale — golden IDENTICO al report baseline (_nonreg_report.json) e
// STESSA semantica applicata lì: campo corretto = non vuoto E normalizzato uguale
// all'atteso; atteso '(non presente)/(non indicato)' → deve restare vuoto.
// Importi/date confrontati sui separatori normalizzati (mai string-match cieco).
// NON fa parte del progetto: non committare.
import { readFileSync, writeFileSync } from 'fs'

const [,, rawPath = 'out/probe_local14_raw.json', baselinePath = '_nonreg_report.json',
  outMd = '_local14_report.md', outJson = '_local14_report.json'] = process.argv

const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))

// Golden = rows del report baseline (28 campi, atteso per-campo, fonte incluso).
const goldenRows = baseline.rows || []
const goldenById = new Map()
for (const r of goldenRows) goldenById.set(r.campo, r)
const fieldOrder = goldenRows.map((r) => r.campo)

// ── normalizzazione ─────────────────────────────────────────────────────────────
function textNorm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g, ' ')
}

// Importo → centesimi interi (gestisce 13.068,01 / 13068.01 / 13068,01 / 13.068.01 …).
// Regola: l'ULTIMO separatore con esattamente 2 cifre dopo è il DECIMALE; tutti gli
// altri (., spazi) sono migliaia. Senza decimale a 2 cifre → interi.
function moneyCents(v) {
  let s = String(v).trim().replace(/^(?:€|eur)\s*/i, '').replace(/\s+/g, '')
  if (!/^\d[\d.,]*$/.test(s) || !/\d/.test(s)) return null
  const m = s.match(/^(.*)[.,](\d{2})$/)
  let intPart = s
  let decDefault = '00'
  if (m) { intPart = m[1]; decDefault = m[2] }
  const int = intPart.replace(/[.,]/g, '')
  if (!/^\d+$/.test(int)) return null
  return parseInt(int + decDefault, 10)
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
  const cents = moneyCents(s)
  if (cents != null) return `M${cents}`
  return textNorm(s)
}

const EXPECTED_EMPTY_RE = /^\(non presente\)|^\(non indicato\)|^non presente|^non indicato|^non dichiarato|^nessun/
function isExpectedAbs(a) { return EXPECTED_EMPTY_RE.test(String(a || '').trim().toLowerCase()) }

// ── confronto ────────────────────────────────────────────────────────────────────
const rows = []
let ok = 0, emptyOk = 0, wrong = 0, missing = 0
for (const id of fieldOrder) {
  const g = goldenById.get(id)
  const label = g.label || id
  const atteso = g.atteso || ''
  const extracted = raw.data?.[id] != null ? String(raw.data[id]).trim() : ''
  const expectedAbsent = isExpectedAbs(atteso)

  let esito
  if (expectedAbsent) {
    esito = extracted === '' ? 'EMPTY-ok' : 'WRONG'
  } else if (extracted === '') {
    esito = 'MISSING'
  } else if (normForCompare(extracted) === normForCompare(atteso)) {
    esito = 'OK'
  } else {
    // per testi lunghi (es. condizioni/sottolimiti) il modello non trascrive mai
    // il testo esatto: OK-text se la normalizzata attesa è contenuta in estratto
    const nA = textNorm(atteso)
    const nE = textNorm(extracted)
    esito = (nA.length >= 8 && nE.includes(nA)) ? 'OK-text' : 'WRONG'
  }
  if (esito === 'OK' || esito === 'OK-text') ok++
  else if (esito === 'EMPTY-ok') emptyOk++
  else if (esito === 'MISSING') missing++
  else wrong++

  rows.push({
    campo: id, label, atteso: atteso || '(non presente)',
    estratto: extracted || '', fonte: raw.sources?.[id]?.file || '', esito,
  })
}

const totOk = ok + emptyOk
const baselineText = baseline.conteggio || `${(baseline.campiCorretti || 0) + (baseline.vuotiCorretti || 0)}/28`

// ── report ───────────────────────────────────────────────────────────────────────
const lines = []
lines.push(`# Run locale qwen2.5:14b — fascicolo CEDAM "in vigore" (RC PROF MED V2)`)
lines.push('')
lines.push(`- **Modello**: ${raw.modello} · **Embedding**: ${raw.embedding} · **Ollama**: ${raw.ollamaUrl} · **numCtx**: ${raw.numCtx}`)
lines.push(`- **Motore:** staged-gruppi (perField=false, cascade=false, **grounding=off**) — stesso percorso del baseline`)
lines.push(`- **Tempo reale:** ${raw.secs}s`)
if (raw.errore) lines.push(`- **Esito run:** ${raw.errore}`)
lines.push(`- **Verdetto (28 campi):** ${ok} OK + ${emptyOk} vuoti corretti = **${totOk}/28** — vs **baseline 7b (${baselineText})**`)
lines.push('')
lines.push('## Confronto campo per campo')
lines.push('')
lines.push('| campo | label | atteso | estratto | esito |')
lines.push('|---|---|---|---|---|')
for (const r of rows) {
  lines.push(`| \`${r.campo}\` | ${r.label} | \`${r.atteso.replace(/\|/g, '\\|')}\` | \`${r.estratto.replace(/\|/g, '\\|')}\` | ${r.esito} |`)
}
lines.push('')
lines.push('Legenda: OK = valore corretto · EMPTY-ok = atteso vuoto e resta vuoto · MISSING = atteso valorizzato ma manca · WRONG = valore presente ma errato.')

const jsonOut = {
  profilo: raw.profilo, modello: raw.modello, embedding: raw.embedding,
  ollamaUrl: raw.ollamaUrl, numCtx: raw.numCtx, secs: raw.secs,
  errore: raw.errore || null, strategia: raw.strategia,
  verdetto: `${totOk}/28`, ok, emptyOk, wrong, missing,
  baseline: baselineText, rows,
}
writeFileSync(outMd, lines.join('\n') + '\n')
writeFileSync(outJson, JSON.stringify(jsonOut, null, 2))
console.log(`Verdetto: ${totOk}/28 (baseline ${baselineText}`)
console.log(`   ok=${ok} emptyOk=${emptyOk} wrong=${wrong} missing=${missing}`)
console.log(`Salvato: ${outMd} · ${outJson}`)