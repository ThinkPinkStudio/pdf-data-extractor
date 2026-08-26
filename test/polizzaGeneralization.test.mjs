import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  autoKind, kindFromType,
} from '../src/main/services/polizzaFieldKind.js'
import {
  isTextualField, isLabelLikeValue, isTextualZeroPlaceholder,
} from '../src/main/services/polizzaValidation.js'
import {
  guardAntiSpill, vetoFranchigiaAsMassimale, buildFactsRegistry,
} from '../src/main/services/polizzaFactsRegistry.js'
import {
  scanDocument, buildNumericHints, completePremiumTotals, pickOverrideHint,
  applyDeterministicOverrides, isBareGlobalFranchigia, NUMERIC_SCAN_KINDS,
} from '../src/main/services/polizzaNumericScan.js'

// ── Regola 2: auto-kind da label (anti-0 universale senza type esplicito) ────
test('R2 autoKind: label testuali senza type esplicito → kind text', () => {
  for (const label of ['Tacito Rinnovo', 'Frazionamento', 'Esclusioni',
    'Condizioni particolari', 'Visto leggero', 'Sottolimiti', 'Retroattività']) {
    const k = autoKind({ label })
    assert.equal(k, 'text', `label "${label}" dovrebbe essere text, got ${k}`)
  }
})

test('R2 isTextualField: label testuale con type assente → true (anti-0)', () => {
  const f = { id: 'rcp_frazionamento', label: 'Frazionamento' }
  assert.equal(isTextualField(f), true)
})

test('R2 isTextualZeroPlaceholder: "0" su campo text → scartato', () => {
  const f = { id: 'rcp_imposta', type: 'text', label: 'Visto leggero' }
  assert.equal(isTextualField(f), true)
  assert.equal(isTextualZeroPlaceholder(f, '0'), true)
})

test('R2 fieldKind esplicito non regredisce: "0" su campo number resta valorizzabile', () => {
  const f = { id: 'rcp_max', type: 'number', label: 'Massimale' }
  assert.notEqual(isTextualField(f), true)
})

// ── Regola 7: anti-label blacklist (intestazioni di sezione) ────────────────
test('R7 isLabelLikeValue: intestazioni di sezione → true (scartate)', () => {
  for (const v of ['IL CONTRAENTE', 'Contratto di Assicurazione per la Responsabilità Civile Professionale del Medico', 'Ramo di competenza: RC']) {
    assert.equal(isLabelLikeValue(v), true, `"${v}" dovrebbe essere scartata`)
  }
})

test('R7 isLabelLikeValue: valori reali sopravvivono', () => {
  for (const v of ['ACQUI TERME', 'Mario Rossi S.r.l.', '00151510344', '31/12/2025', 'Ambulatorio di Diagnostica']) {
    assert.equal(isLabelLikeValue(v), false, `"${v}" non deve essere scartata`)
  }
  assert.equal(isLabelLikeValue('ACQUI TERME 1234'), false)
})

// ── Regola 1: anti-spill (massimali/scoperti duplicati senza varietà) ───────
function mkField(id, label) {
  return { id, label }
}
function mkBest(entries) {
  const o = {}
  for (const [k, v] of entries) o[k] = (typeof v === 'number') ? { valore: String(v) } : { valore: v }
  return o
}

test('R1 guardAntiSpill: stesso massimale su troppi campi (>=4) → svuota', () => {
  const fields = [
    mkField('rcp_massimale_sinistro', 'Massimale per sinistro'),
    mkField('rcp_massimale_annuo', 'Massimale annuo'),
    mkField('rcp_massimale_mat', 'Massimale materiale'),
    mkField('rcp_massimale_interr', 'Massimale interruzione'),
  ]
  const best = mkBest([
    ['rcp_massimale_sinistro', 7500000], ['rcp_massimale_annuo', 7500000],
    ['rcp_massimale_mat', 7500000], ['rcp_massimale_interr', 7500000],
  ])
  const notes = []
  const cleared = guardAntiSpill(best, fields, notes)
  assert.equal(cleared, 4)
  for (const f of fields) assert.equal(best[f.id], undefined, `${f.id} dovrebbe restare vuoto`)
  assert.ok(notes.some((n) => n.includes('Anti-spill')))
})

test('R1 guardAntiSpill: <4 campi o importi diversi → nessun effetto', () => {
  const fields = [
    mkField('rcp_massimale_sinistro', 'Massimale per sinistro'),
    mkField('rcp_massimale_annuo', 'Massimale annuo'),
  ]
  const best = mkBest([
    ['rcp_massimale_sinistro', 7500000], ['rcp_massimale_annuo', 7500000],
  ])
  assert.equal(guardAntiSpill(best, fields), 0)
  assert.equal(best.rcp_massimale_sinistro.valore, '7500000')
})

// ── Regola 9: franchigia MAI come massimale ─────────────────────────────────
test('R9 vetoFranchigiaAsMassimale: importo franchigia bassa di fronte a massimale → veto', () => {
  const registry = buildFactsRegistry([{ name: 'polizza', text: 'franchigia frontale di € 20.000,00' }])
  const field = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' }
  assert.equal(vetoFranchigiaAsMassimale(registry, field, '20000'), true)
})

test('R9 vetoFranchigiaAsMassimale: importo massimale vero → nessun veto', () => {
  const registry = buildFactsRegistry([{ name: 'polizza', text: 'Unico per sinistro MASSIMALE 7.500.000,00' }])
  const field = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' }
  assert.equal(vetoFranchigiaAsMassimale(registry, field, '7500000'), false)
})

// ── Regola 6: sottolimiti senza franchigia globale / premio ──────────────
test('R6 isBareGlobalFranchigia: franchigia/scoperto globale → true', () => {
  for (const v of ['franchigia frontale', 'franchigia assoluta', 'scoperto 10%',
    'massimale', 'premio imponibile', 'totale premio']) {
    assert.equal(isBareGlobalFranchigia(v), true, `"${v}" dovrebbe essere franchigia globale`)
  }
})

test('R6 isBareGlobalFranchigia: garanzia reale → false', () => {
  for (const v of ['garanzia AIDS/HIV', 'garanzia trattamento dati', 'perdite patrimoniali']) {
    assert.equal(isBareGlobalFranchigia(v), false, `"${v}" è una garanzia`)
  }
})

// ── Regola 3/10: MAI calcolare il premio lordo (imponibile+imposta) ─────────
test('R3/10 completePremiumTotals: NON scrive mai un totale calcolato → totale resta il valore dichiarato', () => {
  const best = {
    rcp_premio_imponibile: { valore: '2.862,16' },
    rcp_imposta: { valore: '2.862,16' }, // premio RATA scambiato per imposta: l'azzardo che causò la regressione
    rcp_premio_totale: { valore: '3.499,00' },
  }
  const docs = [{
    name: 'quietanza', type: 'quietanza', text:
      'Imponibile 2.862,16 Imposta 636,84 TOTALE 3.499,00 gold rincond 3499',
  }]
  const byKind = buildNumericHints(docs).byKind
  const fields = [{ id: 'rcp_premio_totale', label: 'Premio lordo annuo' }]
  const diag = []
  const n = completePremiumTotals(best, fields, byKind, diag)
  assert.equal(n, 0, 'NON deve completare alcun totale')
  assert.equal(best.rcp_premio_totale.valore, '3.499,00', 'il totale dichiarato va MANTENUTO')
})

test('R3/10 completePremiumTotals: totale mancante → NON scrive imponibile+imposta (resta assente)', () => {
  const docs = [{
    name: 'quietanza', type: 'quietanza', text:
      'Imponibile 10.689,58  Imposta 2.378,43  TOTALE 13.068,01 gold',
  }]
  const byKind = buildNumericHints(docs).byKind
  const imp = pickOverrideHint(byKind, NUMERIC_SCAN_KINDS.PREMIO_IMPONIBILE)
  const tax = pickOverrideHint(byKind, NUMERIC_SCAN_KINDS.IMPOSTA)
  assert.ok(imp && imp.value.includes('10.689,58'), 'imponibile trovato')
  assert.ok(tax && tax.value.includes('2.378,43'), 'imposta trovata')
  const best = {}
  const fields = [{ id: 'rcp_premio_totale', label: 'Premio lordo annuo' }]
  const diag = []
  const n = completePremiumTotals(best, fields, byKind, diag)
  assert.equal(n, 0)
  assert.ok(!('rcp_premio_totale' in best), 'il campo premio totale NON deve essere scritto')
  assert.ok(diag.some((d) => d.includes('totale premio NON recuperato')), 'deve segnalare totale non recuperato')
})

test('R3/10 completePremiumTotals: totale già corretto (>= imponibile) NON cambiato', () => {
  const docs = [{
    name: 'quietanza', type: 'quietanza', text:
      'Imponibile 2.862,16 Imposta 636,84 TOTALE 3.499,00 gold rincond 3499',
  }]
  const byKind = buildNumericHints(docs).byKind
  const best = { rcp_premio_totale: { valore: '3.499,00' } }
  const fields = [{ id: 'rcp_premio_totale', label: 'Premio lordo annuo' }]
  const n = completePremiumTotals(best, fields, byKind)
  assert.equal(n, 0)
  assert.equal(best.rcp_premio_totale.valore, '3.499,00')
})

test('R3/10 completePremiumTotals: senza imposta nota → nessun completamento', () => {
  const best = {}
  const fields = [{ id: 'rcp_premio_totale', label: 'Premio lordo annuo' }]
  assert.equal(completePremiumTotals(best, fields, new Map()), 0)
})

// ── Regola 4: fatturato preferisce il consuntivo/valore maggiore ────────────
test('R4 pickOverrideHint: fatturato consuntivo (maggiore) vince sul preventivato', () => {
  const docs = [{
    name: 'atto', type: 'atto', text: 'Fatturato preventivato 4.000.000 oro',
  }, {
    name: 'regolazione', type: 'regolazione', text: 'Fatturato consuntivo 8.045.000 oro',
  }]
  const { byKind } = buildNumericHints(docs)
  const hint = pickOverrideHint(byKind, NUMERIC_SCAN_KINDS.FATTURATO)
  assert.ok(hint, 'hint fatturato presente')
  assert.match(hint.value, /8\.0?45\.000/, `dovrebbe essere 8.045.000, got ${hint.value}`)
})

test('R4 applyDeterministicOverrides: campo fatturato → valore consuntivo', () => {
  const docs = [{
    name: 'atto', type: 'atto', text: 'Fatturato preventivato 4.000.000 oro',
  }, {
    name: 'regolazione', type: 'regolazione', text: 'Fatturato consuntivo 8.045.000 oro',
  }]
  const best = {}
  const fields = [{ id: 'fatturato', label: 'Fatturato', kind: 'fatturato' }]
  applyDeterministicOverrides(best, fields, docs, [])
  assert.ok(best.fatturato)
  assert.match(best.fatturato.valore, /8\.0?45\.000/, `got ${best.fatturato?.valore}`)
})

// ── Regola 5: massimali da tabella-opzioni (coppie label:value, no checkbox) ─
test('R5 tabella opzioni: massimale per sinistro/annuo espliciti → hint ad alta conf', () => {
  const docs = [{
    name: 'opzioni', type: 'polizza', text:
      'MASSIMALE PER SINISTRO 6.000.000,00\nMASSIMALE ANNUO 2.000.000,00\nFRANCHIGIA 10.000,00',
  }]
  const { byKind } = buildNumericHints(docs)
  const sin = pickOverrideHint(byKind, NUMERIC_SCAN_KINDS.MASSIMALE_SINISTRO)
  assert.ok(sin && sin.value.includes('6.000.000,00'), `sinistro got ${sin?.value}`)
  const ann = pickOverrideHint(byKind, NUMERIC_SCAN_KINDS.MASSIMALE_ANNUO)
  assert.ok(ann && ann.value.includes('2.000.000,00'), `annuo got ${ann?.value}`)
})

// ── Regola 8: decorrenza più antica / scadenza più recente ──────────────────
test('R8 supporti date: il seed usa MIN per decorrenza (verifica helper via scan non regredisce)', () => {
  // La selezione finestra "decorrenza→data" nel seed: garantiamo che scanDocument
  // non introduca regressioni sul testo data (i test di decorrenza vivono nel
  // service; qui verifichiamo che gli hint numerici non toccano le date).
  const docs = [{
    name: 'polizza', type: 'polizza', text: 'Decorrenza 01/07/2010 Scadenza 31/12/2026',
  }]
  const { all } = buildNumericHints(docs)
  // Nessun hint numerico da puro testo data.
  assert.equal(all.length, 0)
})

// ── Regola 1 applicato via applyDeterministicOverrides: non rompe nothing ──
test('R1/R9 integrati: override non inserisce franchigia nei massimali', () => {
  const docs = [{
    name: 'polizza', type: 'polizza', text: 'franchigia frontale di € 20.000,00',
  }, {
    name: 'polizza', type: 'polizza', text: 'Unico per sinistro MASSIMALE 7.500.000,00',
  }]
  const best = {}
  const fields = [{ id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', kind: 'massimale' }]
  applyDeterministicOverrides(best, fields, docs, [])
  assert.ok(best.rct_massimale_sinistro)
  assert.match(best.rct_massimale_sinistro.valore, /7\.500\.000/, `got ${best.rct_massimale_sinistro?.valore}`)
})

test('R3 diag prefix determinista presente in completePremiumTotals', () => {
  const docs = [{
    name: 'q', type: 'quietanza', text: 'Imponibile 100,00 Imposta 22,00',
  }]
  const byKind = buildNumericHints(docs).byKind
  const best = {}
  const diag = []
  completePremiumTotals(best, [{ id: 'rcp_premio_totale', label: 'Premio lordo' }], byKind, diag)
  assert.ok(!best.rcp_premio_totale, 'il totale calcolato NON deve mai comparire')
  assert.ok(diag.some((d) => d.includes('totale premio NON recuperato')), `diag=${diag.join(' | ')}`)
})