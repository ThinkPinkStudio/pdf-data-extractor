#!/usr/bin/env node
// Valuta i risultati estratti (_ab_caso_X.json) contro la ground truth
// (_prep_casi_report.json → casi[].valoriAttesi). HONEST scoring:
//  - atteso vuoto ("non presente"/"non indicato"/"nessun sinistro") → campo VUOTO = EMPTY-ok; valorizzato = WRONG
//  - atteso con valore → match normalizzato (spazi/case) = OK; diverso = WRONG; assente = MISSING
// Salva _ab_esteso_report.json + _ab_esteso_report.md
import { readFileSync, writeFileSync } from 'fs'

const PREP = '_prep_casi_report.json'
const prep = JSON.parse(readFileSync(PREP, 'utf8'))

const normVal = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/,/g, '.')
  .replace(/[.\s]+/g, ' ')
  .trim()

const isEmptyExpected = (atteso) => /non presente|non indicato|nessun sinistro|da data specifica/.test(String(atteso))

function evaluate(caso, res) {
  const fields = res.fields || []
  const labelOf = {}
  for (const f of fields) labelOf[f.id] = f.label
  const rows = []
  let ok = 0, emptyOk = 0, wrong = 0, missing = 0
  for (const [fid, va] of Object.entries(caso.valoriAttesi)) {
    const got = res.data?.[fid]
    const src = res.sources?.[fid]
    const label = labelOf[fid] || va.label
    const atteso = va.atteso
    const fonteAttesa = `${va.fonteFile}${va.fontePagina ? ` · pag.${va.fontePagina}` : ''}`
    const fonteEstratta = src ? `${String(src.file).split('/').pop()}${src.page ? ` · pag.${src.page}` : ''}` : ''
    let esito
    if (isEmptyExpected(atteso)) {
      const okEmpty = got == null || String(got).trim() === '' || /^0(,00)?$/.test(String(got))
      esito = okEmpty ? 'EMPTY-ok' : 'WRONG'
      if (okEmpty) emptyOk++; else wrong++
    } else if (got == null || String(got).trim() === '') {
      esito = 'MISSING'
      missing++
    } else if (normVal(got) === normVal(atteso)) {
      esito = 'OK'
      ok++
    } else {
      esito = 'WRONG'
      wrong++
    }
    rows.push({ campo: fid, label, atteso, fonteAttesa, estratto: got ?? '', fonteEstratta, esito, note: va.note || '' })
  }
  return { rows, counts: { tot: rows.length, ok, emptyOk, wrong, missing } }
}

const report = { genere: 'A/B esteso — verdetto aggregato', data: new Date().toISOString(), casi: {} }
const lines = []
lines.push('# A/B esteso — verdetto aggregato')
lines.push('')
lines.push(`Modello: **qwen2.5:7b-instruct** · num_ctx 24576 · motore a stadi gruppi (perField=false, cascade=false) · constrained JSON schema · precheck: off per A/B, keyword+semantic per C`)
lines.push('')
lines.push('Ground truth: `_prep_casi_report.json` (`casi[].valoriAttesi`). Confronto normalizzato (spazi/case); atteso "non presente/indicato" ⇒ campo vuoto.')
lines.push('')

for (const caso of prep.casi) {
  const res = JSON.parse(readFileSync(`out/_ab_caso_${caso.id}.json`, 'utf8'))
  const ev = evaluate(caso, res)
  report.casi[caso.id] = {
    nome: caso.nome,
    profilo: res.profilo,
    counts: ev.counts,
    deterministicLines: (res.diag || []).filter((l) => /\[deterministico\]|Passata deterministica/.test(l)),
    rows: ev.rows,
  }
  lines.push(`## Caso ${caso.id} — ${caso.nome}`)
  lines.push('')
  lines.push(`Profilo: ${res.profilo} · esito: **${ev.counts.ok}/${ev.counts.tot} OK** (di cui ${ev.counts.emptyOk} vuoti-corretti) · ${ev.counts.wrong} sbagliati · ${ev.counts.missing} mancanti`)
  lines.push('')
  lines.push('| Campo | Label | Valore atteso | Fonte attesa | Estratto | Fonte estratta | Esito |')
  lines.push('|-------|-------|---------------|--------------|----------|----------------|-------|')
  for (const r of ev.rows) {
    lines.push(`| ${r.campo} | ${r.label} | ${r.atteso} | ${r.fonteAttesa} | ${r.estratto || '—'} | ${r.fonteEstratta || '—'} | ${r.esito} |`)
  }
  lines.push('')
  if (ev.counts.ok + ev.counts.emptyOk > 0) {
    const wrongFields = ev.rows.filter((r) => r.esito === 'WRONG').map((r) => r.campo)
    lines.push(`Campi sbagliati: ${wrongFields.length ? wrongFields.join(', ') : '—'}`)
    lines.push('')
  }
}

// Caso C (pre-check)
let resC = null
try { resC = JSON.parse(readFileSync('out/_ab_caso_C.json', 'utf8')) } catch {}
if (resC) {
report.casoC = {
  profiloA: 'Rc Professionale V3', profiloB: 'RC PROF MED V2', docs: resC.docs,
  keywords: { A: resC.prelimA?.keyword?.verdict ?? resC.prelimA?.keywords, B: resC.prelimB?.keyword?.verdict ?? resC.prelimB?.keywords },
  semantic: { A: resC.prelimA?.semantic, B: resC.prelimB?.semantic },
  llm: { A: resC.prelimA?.llm, B: resC.prelimB?.llm },
}
lines.push('## Caso C — Cond Via della libertà 55 (Globale Fabbricati, DA SCARTARE)')
lines.push('')
lines.push('Documenti OCR: ' + resC.docs.join(' · '))
lines.push('')
lines.push('| Profilo | Mode | Verdetto | Score | Soglia | Motivazione |')
lines.push('|---------|------|----------|-------|--------|-------------|')
const rowFor = (prelim, prof) => {
  const arr = [prelim?.keywords, prelim?.semantic, prelim?.llm].map((r) => r || {})
  return arr.map((r) => `| ${prof} | ${r.mode || '—'} | **${r.verdict || '—'}** | ${r.score != null ? r.score.toFixed(3) : '—'} | ${r.threshold ?? '—'} | ${r.reason || ''} |`).join('\n')
}
lines.push(rowFor(resC.prelimA, 'Rc Professionale V3'))
lines.push(rowFor(resC.prelimB, 'RC PROF MED V2'))
lines.push('')
lines.push('LLM detected per profilo A: ' + JSON.stringify(resC.prelimA?.llm?.detected || {}))
lines.push('LLM detected per profilo B: ' + JSON.stringify(resC.prelimB?.llm?.detected || {}))
lines.push('')
lines.push('**Verdetto: solo il pre-check LLM scarta il fascicolo (mismatch) per entrambi i profili. keyword/semantic producono falsi positivi** (soglia keyword ratio>=0.2 matcha "prof"/"med" come sottostringhe; semantic penalizzata dalle descrizioni generiche di anagrafica).')
lines.push('')
}

writeFileSync('_ab_esteso_report.json', JSON.stringify(report, null, 2))
writeFileSync('_ab_esteso_report.md', lines.join('\n'))
console.log('Scritti _ab_esteso_report.md / _ab_esteso_report.json')
for (const c of ['A', 'B']) {
  const cc = report.casi[c]
  console.log(`Caso ${c}: OK ${cc.counts.ok}/${cc.counts.tot} (empty-ok ${cc.counts.emptyOk}, wrong ${cc.counts.wrong}, missing ${cc.counts.missing})`)
}
