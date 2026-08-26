#!/usr/bin/env node
// ESPERIMENTO "ROLLING PURO" — una chiamata per documento, merge per recency nel codice.
// Obiettivo: verificare se il disegno "candidato → data → vince il più recente" (senza
// che il LLM decida nulla sulla data) migliora i missing dello staged sul fascicolo B.
// NON è parte del progetto: NON committare.
//
// Pipeline:
//   1. carica la cache OCR di B (out/ocr/in_vigore_3__*.json)
//   2. per ogni documento (ordinato dalla data NOTA della ground truth, dal più vecchio
//      al più recente), chiama Ollama con PERFIELD_SYSTEM per OGNI campo
//   3. merge nel codice: se il documento ha una data più recente e il campo è valorizzato,
//      sovrascrive; altrimenti tiene il precedente (recency esplicita, mai decisione del LLM)
//   4. confronta col golden (hardcoded qui, perché è un esperimento, non la ground truth)
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const svc = await import('./src/main/services/polizzaService.js')
const { isInsurerFooterPIva } = await import('./src/main/services/polizzaValidation.js')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const OCR_CACHE = join(here, 'out/ocr')
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'

// ── profilo RC PROF MED V2 ─────────────────────────────────────────────────
const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profilo = profili.find((p) => p.name === 'RC PROF MED V2')
if (!profilo) { console.error('Profilo RC PROF MED V2 non trovato'); process.exit(2) }
const fields = (profilo.fields || []).filter((f) => f.enabled !== false)
const fieldById = Object.fromEntries(fields.map((f) => [f.id, f]))
console.log(`Profilo: ${profilo.name} — ${fields.length} campi attivi`)

const settings = {
  ollamaUrl: OLLAMA_URL, ollamaModel: MODEL, embeddingModel: 'bge-m3', ollamaNumCtx: 24576,
  polizzaFields: fields, polizzaPromptExtra: profilo.promptExtra || '',
  polizzaPerField: false, polizzaStagedCascade: false, polizzaConstrainedJson: true,
  polizzaPrecheckMode: 'off', polizzaAutoVerify: false, polizzaArchivio: false,
}

// ── cache OCR di B ──────────────────────────────────────────────────────────
const PREFIX = 'in_vigore_3__'
const docs = []
for (const f of readdirSync(OCR_CACHE).filter((x) => x.startsWith(PREFIX) && x.endsWith('.json'))) {
  let pages = null
  try { pages = JSON.parse(readFileSync(join(OCR_CACHE, f), 'utf8')) } catch { continue }
  if (!Array.isArray(pages) || !pages.length) continue
  const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
  const name = f.slice(PREFIX.length, -'.json'.length).replace(/_/g, ' ')
  docs.push({ name, pages: spatial })
}
if (!docs.length) { console.error('Nessuna cache OCR per B'); process.exit(2) }
console.log(`${docs.length} documenti da cache OCR: ${docs.map((d) => d.name).join(', ')}`)

// Data NOTA dei documenti (oracolo per l'ordinamento recency; dal reale).
// quietanza 2025 = 2025, polizza = 2010 (emissione storica), questionario = 2024.
const docYearOf = (n) => {
  const s = String(n).toLowerCase()
  if (s.includes('quietanza')) return 2025
  if (s.includes('polizza')) return 2010
  return 2024
}
docs.sort((a, b) => docYearOf(a.name) - docYearOf(b.name))

// ── chiamata unica per documento, con TUTTI i campi (il LLM NON decide la data) ──
// ── chiamata una per PAGINA INTERA (non per chunk), con TUTTI i campi ─────
// Il LLM NON decide la data: la recency la decide il codice (merge sotto).
const SYSTEM =
  'Sei un estrattore di dati da documenti assicurativi italiani.\n' +
  'Ricevi UNA PAGINA di un documento e un ELENCO di CAMPI (id — nome: descrizione).\n' +
  'REGOLE:\n' +
  '1. Per ogni campo, restituisci il valore SOLO se ESPLICITAMENTE presente nella pagina.\n' +
  '2. Se la pagina contiene coppie "Etichetta: Valore" o tabelle, estraile come coppie.\n' +
  '3. MAI usare il FOOTER/referenze aziendali della compagnia (P.IVA, CF, indirizzo\n' +
  '   Sede Legale, tel, REA, codice Albo) come dati del contraente/assicurato.\n' +
  '4. Se un campo non è presente nella pagina, NON includerlo.\n' +
  '5. Non inventare, non dedurre, non usare esempi della descrizione.\n' +
  '6. Importi in formato italiano (es. 3.000.000,00). Date in GG/MM/AAAA.\n' +
  'FORMATO: un solo oggetto JSON {"<id>": "<valore>", ...}. Zero testo extra.'

async function callForPage(pageText) {
  const fieldLines = fields
    .map((f) => `- ${f.id} — ${f.label}: ${f.description || ''}`)
    .join('\n')
  const userPrompt = `CAMPI DA ESTRARRE (id — nome: descrizione):\n${fieldLines}\n\nPAGINA DEL DOCUMENTO:\n${pageText}\n\nRestituisci SOLO il JSON con i campi che trovi nella pagina.`
  // Chiamata streaming diretta a Ollama (stessa modalità del servizio, con watchdog
  // per token: lento ≠ morto). Non usa il motore staged né il per-campo.
  const url = `${settings.ollamaUrl}/api/chat`
  let content = ''
  const ac = new AbortController()
  const watchdog = setTimeout(() => ac.abort(), 240000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model: settings.ollamaModel,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        format: 'json',
        options: { temperature: 0, num_ctx: 32768, num_predict: 2048 },
      }),
    })
    if (!res.ok || !res.body) {
      const bodyTxt = await res.text().catch(() => '')
      console.error(`  HTTP ${res.status}: ${bodyTxt.slice(0, 160)}`)
      return {}
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      for (let nl = buf.indexOf('\n'); nl !== -1; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('{') && !line.startsWith('[')) continue
        try {
          const msg = JSON.parse(line)
          const piece = msg.message?.content
          if (typeof piece === 'string') content += piece
        } catch { /* riga parziale, ignora */ }
      }
    }
  } catch (e) {
    console.error(`  errore chiamata: ${e.message}`)
    return {}
  } finally {
    clearTimeout(watchdog)
  }
  try {
    return JSON.parse(content)
  } catch {
    console.error(`  risposta non-JSON da pagina: ${content.slice(0, 120)}`)
    return {}
  }
}

// ── merge per recency nel codice, iterando su PAGINE INTERE ────────────────
// Regola: "il documento più recente vince MA non se è VUOTO/PLACEHOLDER/FOOTER
// su quel campo". Un valore più recente che è un placeholder o la P.IVA/CF del
// footer della compagnia NON deve scavalcare il valore più vecchio e specifico.
const PLACEHOLDER_RE = /non indicat|non present|n\.?d\.?|n\/a|^s[iì]$|^si$|^medic[oa]$|^nessun/i
function isBanalValue(v) {
  const s = String(v || '').trim().toLowerCase()
  if (!s) return true
  if (PLACEHOLDER_RE.test(s)) return true
  return false
}

const best = {} // id → { valore, anno, doc, page }
for (const d of docs) {
  const anno = docYearOf(d.name)
  const pages = d.pages.map((p) => String(p || ''))
  const docFullText = pages.join('\n') // per isInsurerFooterPIva
  console.log(`\n— DOC: ${d.name} (anno ${anno}, ${pages.length} pagine)`)
  for (let pi = 0; pi < pages.length; pi++) {
    const pageText = pages[pi]
    if (!pageText.trim()) continue
    const parsed = await callForPage(pageText)
    const found = []
    for (const [k, v] of Object.entries(parsed)) {
      if (!(k in fieldById)) continue
      const val = (v && typeof v === 'object' && 'valore' in v) ? v.valore : v
      if (val == null || String(val).trim() === '') continue
      const s = String(val).trim()
      // Il codice fiscale/P.IVA del FOOTER della compagnia non è mai il dato.
      const f = fieldById[k]
      if (/fiscal|iva|codice/i.test(`${f?.id || ''} ${f?.label || ''}`) && isInsurerFooterPIva(docFullText, s)) {
        console.log(`  p.${pi + 1}: ${k} FOOTER scartato (${s})`)
        continue
      }
      found.push([k, s])
    }
    if (!found.length) continue
    console.log(`  p.${pi + 1}: ${found.map(([k, val]) => `${k}=${val}`).join(' · ')}`)
    for (const [k, val] of found) {
      const prev = best[k]
      if (!prev) {
        best[k] = { valore: val, anno, doc: d.name, page: pi + 1 }
      } else if (anno > prev.anno) {
        if (!isBanalValue(val)) {
          best[k] = { valore: val, anno, doc: d.name, page: pi + 1 }
        }
        // più recente ma banale: NON sovrascrive il valore specifico vecchio
      }
      // anno <= prev.anno: il vecchio resta (mai sovrascritto da un più vecchio)
    }
  }
}

// ── verdetto vs golden (esperimento) ────────────────────────────────────────
const GOLDEN = {
  polizza_numero: 'RCM00010027822', compagnia: 'AmTrust Assicurazioni S.p.A.',
  contraente: 'MAURO CARLO NEBULONI', codice_fiscale_iva: 'NBLMCR58L23D033D',
  indirizzo: 'VIA AMENDOLA,8', agenzia: '+SIMPLE ITALIA AGENCY',
  decorrenza: '14/10/2025', scadenza: '14/10/2026',
  rcp_imposta: 'si', rcp_premio_totale: '3.499,00', rcp_premio_imponibile: 'Annuale',
  attivita: 'Radiodiagnostica', e1d90f78: 'non presente',
  'c125c0d1-695b-4755-81db-e99137169686': '10 anni limitata',
  '89ffb116-bf3b-4bcb-a6bb-7ceeed04cfee': '14/10/2014',
  '6e39add8-de2c-4d48-b231-f03cd4e05bd5': '1 sinistro',
  rct_massimale_sinistro: '2.000.000,00', rct_massimale_persona: '6.000.000,00',
  rct_massimale_danni: '10.000,00', rct_massimale_prestatore: 'non indicato',
}
const norm = (s) => String(s || '').toLowerCase().replace(/[\s.,€]+/g, ' ').trim()
let ok = 0, wrong = 0, missing = 0, skipped = 0
const rows = []
for (const [k, gv] of Object.entries(GOLDEN)) {
  const got = best[k]
  if (/non presente|non indicato/.test(gv)) {
    if (!got) { skipped++; rows.push([k, 'vuoto-ok']) }
    else { wrong++; rows.push([k, 'WRONG (atteso vuoto)']) }
  } else if (!got) {
    missing++; rows.push([k, 'MISSING'])
  } else if (norm(got.valore) === norm(gv) || norm(gv).length >= 6 && norm(got.valore).includes(norm(gv).slice(0, 6))) {
    ok++; rows.push([k, `OK (${got.valore})`])
  } else {
    wrong++; rows.push([k, `WRONG: ${got.valore} (atteso ${gv})`])
  }
}
console.log('\n' + '='.repeat(70))
console.log('VERDETTO esperimento rolling-puro (B, 28 campi):')
for (const [k, r] of rows) console.log(`  ${k.padEnd(26)} ${r}`)
console.log(`\nOK=${ok}  WRONG=${wrong}  MISSING=${missing}  vuoti-ok=${skipped}  (su ${Object.keys(GOLDEN).length} valutati)`)

mkdirSync('out', { recursive: true })
writeFileSync('out/_experiment_rolling.json', JSON.stringify({
  profilo: profilo.name, modello: MODEL, strategia: 'rolling-puro (1 chiamata/doc + merge recency)',
  best: Object.fromEntries(Object.entries(best).map(([k, v]) => [k, { valore: v.valore, anno: v.anno, doc: v.doc }])),
  verdetto: { ok, wrong, missing, skipped }, rows, golden: GOLDEN,
}, null, 2))
console.log('Salvato out/_experiment_rolling.json')
