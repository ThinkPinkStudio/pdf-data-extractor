#!/usr/bin/env node
// Genera out/_ab_esteso_report.pdf dalle tabelle in _ab_esteso_report.json
// usando playwright + Chrome di sistema (headless).
import { readFileSync, writeFileSync } from 'fs'
import pkg from './web/node_modules/playwright/index.js'
const { chromium } = pkg

const report = JSON.parse(readFileSync('_ab_esteso_report.json', 'utf8'))

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function esitoBadge(esito) {
  const map = { OK: 'ok', 'EMPTY-ok': 'emp', WRONG: 'wrong', MISSING: 'miss' }
  return `<span class="b ${map[esito] || ''}">${esc(esito)}</span>`
}

function rowTable(rows) {
  const head = `<thead><tr><th>Campo</th><th>Label</th><th>Valore atteso</th><th>Fonte attesa</th><th>Estratto</th><th>Fonte estratta</th><th>Esito</th></tr></thead>`
  const body = rows.map((r) => `<tr class="${r.esito.toLowerCase()}">
    <td class="mono">${esc(r.campo)}</td>
    <td>${esc(r.label)}</td>
    <td class="mono">${esc(r.atteso)}</td>
    <td class="src">${esc(r.fonteAttesa)}</td>
    <td class="mono">${r.estratto ? esc(r.estratto) : '—'}</td>
    <td class="src">${r.fonteEstratta ? esc(r.fonteEstratta) : '—'}</td>
    <td>${esitoBadge(r.esito)}</td>
  </tr>`).join('')
  return `<table>${head}<tbody>${body}</tbody></table>`
}

const caseHtml = (id) => {
  const c = report.casi?.[id]
  if (!c) return ''
  const counts = c.counts
  const det = (c.deterministicLines || []).map((l) => `<li class="mono">${esc(l)}</li>`).join('')
  return `<section>
    <h2>Caso ${id} — ${esc(c.nome||'')}</h2>
    <p class="profilo">Profilo: <b>${esc(c.profilo || '')}</b> · esito <b>${counts.ok}/${counts.tot} OK</b> (di cui ${counts.emptyOk} vuoti-corretti) · ${counts.wrong} sbagliati · ${counts.missing} mancanti</p>
    ${det ? `<details><summary>Righe [deterministico]</summary><ul>${det}</ul></details>` : ''}
    ${rowTable(c.rows)}
  </section>`
}

let detC = ''
if (report.casoC) {
  const pc = report.casoC
  const row = (r, prof) => `<tr><td>${esc(prof)}</td><td>${esc(r?.mode || '—')}</td><td><b>${esc(r?.verdict || '—')}</b></td><td class="mono">${r?.score != null ? Number(r.score).toFixed(3) : '—'}</td><td class="mono">${esc(r?.threshold ?? '—')}</td><td class="src">${esc(r?.reason || '')}</td></tr>`
  let rows = ''
  rows += row(pc.keywords?.A, 'Rc Prof. V3 (A)') + row(pc.semantic?.A, 'Rc Prof. V3 (A)') + row(pc.llm?.A, 'Rc Prof. V3 (A)')
  rows += row(pc.keywords?.B, 'RC PROF MED (B)') + row(pc.semantic?.B, 'RC PROF MED (B)') + row(pc.llm?.B, 'RC PROF MED (B)')
  detC = `<section>
    <h2>Caso C — Cond Via della libertà 55 (Globale Fabbricati, DA SCARTARE)</h2>
    <p class="src">Documenti OCR: ${esc(pc.docs?.join(' · ') || '')}</p>
    <table><thead><tr><th>Profilo</th><th>Mode</th><th>Verdetto</th><th>Score</th><th>Soglia</th><th>Motivazione</th></tr></thead><tbody>${rows}</tbody></table>
    <p><b>Verdetto: solo LLM scarta (mismatch); keyword/semantic = falsi positivi.</b></p>
  </section>`
}

const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 9px; color: #1c2333; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 18px 0 6px; border-bottom: 2px solid #3057a3; padding-bottom: 3px; color:#3057a3; }
  .sub { color:#5a6478; font-size:9.5px; margin:0 0 6px; }
  .profilo { margin: 2px 0 8px; }
  table { border-collapse: collapse; width: 100%; table-layout: auto; margin-top: 4px; }
  th { background:#3057a3; color:#fff; font-weight:600; text-align:left; padding:3px 5px; font-size:8.5px; }
  td { border: 1px solid #cbd3e0; padding: 3px 5px; vertical-align: top; }
  tr:nth-child(even) td { background:#f5f7fb; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size:8px; }
  .src { font-size:8px; color:#4a5366; }
  tr.ok td { background:#e8f5ee; }
  tr.tr.wrong td { background:#fdecee; }
  tr.missing td { background:#fff4dc; }
  .b { display:inline-block; padding:1px 6px; border-radius:8px; font-size:8px; font-weight:700; color:#fff; }
  .b.ok { background:#1f9d55; } .b.emp { background:#2b7cbd; }
  .b.wrong { background:#d64545; } .b.miss { background:#e8952f; }
  details summary { cursor:pointer; color:#3057a3; font-weight:600; margin:4px 0; }
  details ul { margin:2px 0 8px; padding-left:18px; }
  li.mono { margin-bottom:2px; }
</style></head><body>
  <h1>A/B esteso — verdetto aggregato estrazione polizze</h1>
  <p class="sub">Modello <b>qwen2.5:7b-instruct</b> · num_ctx 24576 · motore a stadi gruppi (perField=false, cascade=false) · constrained JSON schema · precheck off (A/B) · ${esc(report.data?.split('T')[0] || '')}</p>
  <p class="sub">Ground truth: <b>_prep_casi_report.json</b> (<code>casi[].valoriAttesi</code>). Confronto normalizzato (spazi/case); atteso "non presente/indicato" ⇒ campo vuoto.</p>
  ${caseHtml('A')}
  ${caseHtml('B')}
  ${detC}
</body></html>`

writeFileSync('out/_ab_esteso_report.html', html)

const launchOpts = { headless: true }
import fs from 'fs'
const ch = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find((p) => fs.existsSync(p))
if (ch) launchOpts.executablePath = ch

const browser = await chromium.launch(launchOpts)
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'networkidle' })
const outPdf = 'out/_ab_esteso_report.pdf'
await page.pdf({ path: outPdf, format: 'A4', landscape: true, printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } })
await browser.close()
console.log('Scritto', outPdf, '· usa', ch || 'playwright chromium predefinito')