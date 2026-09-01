/**
 * Test dello Scanner Numerico DETERMINISTICO per i campi strutturali
 * (passata deterministica passata al merge: polizzaNumericScan.js).
 *
 * Parte PURA: NESSUNA dipendenza da Ollama/Qdrant/fs. Usa stringhe OCR
 * realistiche ispirate ai fascicoli reali (Cedam/EULIP). Verifica la scan
 * per-documento (`scanDocument`), la selezione dell'hint (`pickOverrideHint`),
 * il mapping campo→natura (`scanKindForField`) e l'override (applyDeterministicOverrides)
 * comprese le righe [deterministico] in diagnostica.
 *
 * Esegui:  node --test test/polizzaNumericScan.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseAmountMaybe, formatAmountIT,
  scanDocument, buildNumericHints, pickOverrideHint,
  scanKindForField, applyDeterministicOverrides,
  DETERMINISTIC_MIN_CONFIDENCE, DETERMINISTIC_DIAG_PREFIX, NUMERIC_SCAN_KINDS,
  canApplyScanHint, isPlausibleScanValue,
  guardPostMergeSpill,
  guardEconomicToStructuralSpill, guardFranchigiaScoperto, isEconomicField,
} from '../src/main/services/polizzaNumericScan.js'

const K = NUMERIC_SCAN_KINDS

// ─── parseAmountMaybe / formatAmountIT ───────────────────────────────────────

test('parseAmountMaybe: importi italiani → numero', () => {
  assert.equal(parseAmountMaybe('7.500.000,00'), 7500000)
  assert.equal(parseAmountMaybe('20.000'), 20000)
  assert.equal(parseAmountMaybe('10.689,58'), 10689.58)
  assert.equal(parseAmountMaybe('10689,58'), 10689.58)
  assert.equal(parseAmountMaybe('4.000.000.00'), 4000000)
  assert.equal(parseAmountMaybe('1.001,25'), 1001.25)
})

test('parseAmountMaybe: non-importi → null', () => {
  assert.equal(parseAmountMaybe('abc'), null)
  assert.equal(parseAmountMaybe(''), null)
  assert.equal(parseAmountMaybe(null), null)
})

test('formatAmountIT: numero → importo italiano con migliaia (sempre 2 decimali)', () => {
  assert.equal(formatAmountIT(7500000), '7.500.000,00')
  assert.equal(formatAmountIT(20000), '20.000,00')
  assert.equal(formatAmountIT(10689.58), '10.689,58')
  assert.equal(formatAmountIT(1001.25), '1.001,25')
  assert.equal(formatAmountIT('5.501,25'), '5.501,25')
})

// ─── scanKindForField (mapping campo → natura, type-blind) ──────────────────

test('scanKindForField: label/description → kind corretto', () => {
  assert.equal(scanKindForField({ label: 'Massimale per sinistro', description: 'euro' }), K.MASSIMALE_SINISTRO)
  assert.equal(scanKindForField({ label: 'Franchigia base', description: '' }), K.FRANCHIGIA)
  assert.equal(scanKindForField({ label: 'Fatturato dichiarato', description: '' }), K.FATTURATO)
  assert.equal(scanKindForField({ label: 'Sottolimiti', description: '' }), K.SOTTOLIMITI)
  assert.equal(scanKindForField({ label: 'Scoperto base', description: 'minimo' }), K.SCOPERTO)
  assert.equal(scanKindForField({ label: 'Premio lordo', description: 'totale' }), K.PREMIO_TOTALE)
})

test('scanKindForField: massimale annuo ≠ sinistro, e MAI su Tutela/anagrafici', () => {
  // "massimale annuo" va ad ANNUO, non a sinistro
  const annuo = scanKindForField({ label: 'Massimale annuo', description: 'aggregato' })
  assert.equal(annuo, K.MASSIMALE_ANNUO)
  // massimale annuo + "per persona" è contraddittorio: la natura NON è stretta
  // (regola: annuo MAI a per-sinistro/per-persona/per-prestatore) → null
  assert.equal(scanKindForField({ label: 'Massimale annuo', description: 'per persona' }), null)
  // la scan NON tocca i campi Tutela
  assert.equal(scanKindForField({ label: 'Massimale Tutela', description: '' }), null)
  assert.equal(scanKindForField({ label: 'Indirizzo', description: 'sede' }), null)
})

test('canApplyScanHint: mapping 1:1 stretto (unico per sinistro → SOLO sinistro)', () => {
  const { canApplyScanHint } = { canApplyScanHint: (a, b) => a === b }
  // forma reale via pickOverrideHint sulle natura
  assert.equal(canApplyScanHint(K.MASSIMALE_SINISTRO, K.MASSIMALE_SINISTRO), true)
  assert.equal(canApplyScanHint(K.MASSIMALE_ANNUO, K.MASSIMALE_SINISTRO), false)
})

// ─── scanDocument: massimale per sinistro ───────────────────────────────────

test('scan: "Massimali Assicurati: RCT/RCO € 7.500.000,00 Unico per sinistro" → massimale sinistro conf alta', () => {
  const hints = scanDocument({ name: 'dichiarazione.pdf', pages: ['Massimali Assicurati: RCT/RCO € 7.500.000,00 Unico per sinistro'] })
  const m = hints.filter((h) => h.kind === K.MASSIMALE_SINISTRO)
  assert.ok(m.length >= 1)
  assert.equal(m[0].value, '7.500.000,00')
  assert.ok(m[0].confidence >= DETERMINISTIC_MIN_CONFIDENCE)
})

test('scan: "€ 7.500.000,00 per ogni sinistro" → massimale sinistro (mai spill 7.500)', () => {
  const hints = scanDocument({ name: 'polizza.pdf', pages: ['€ 7.500.000,00 per ogni sinistro'] })
  const m = hints.filter((h) => h.kind === K.MASSIMALE_SINISTRO)
  assert.ok(m.length)
  assert.equal(m[0].value, '7.500.000,00')
  assert.ok(m[0].confidence >= DETERMINISTIC_MIN_CONFIDENCE)
})

test('scan: il valore da OPZIONE-questionario NON vale come massimale', () => {
  const hints = scanDocument({ name: 'questionario.pdf', pages: ['[ ] € 7.500,00 per sinistro'] })
  assert.equal(hints.filter((h) => h.kind === K.MASSIMALE_SINISTRO).length, 0)
})

// ─── scanDocument: franchigia / scoperto ────────────────────────────────────

test('scan: franchigia frontale 20.000 dell\'atto 2019 → franchigia conf alta', () => {
  const hints = scanDocument({ name: 'atto.pdf', pages: ['si conviene una franchigia frontale per ogni tipo di danno di € 20.000,00'] })
  const f = hints.filter((h) => h.kind === K.FRANCHIGIA)
  assert.ok(f.length)
  assert.equal(f[0].value, '20.000,00')
  assert.ok(f[0].confidence >= DETERMINISTIC_MIN_CONFIDENCE)
})

test('scan: scoperto "con il minimo di € 1.000,00" → scoperto', () => {
  const hints = scanDocument({ name: 'condizioni.pdf', pages: ['scoperto con il minimo di € 1.000,00'] })
  const s = hints.filter((h) => h.kind === K.SCOPERTO)
  assert.ok(s.length)
  assert.equal(s[0].value, '1.000,00')
})

// ─── scanDocument: premi / imponibile / imposta da quietanza ────────────────

test('scan: header "Imponibile | TOTALE" + riga dati → imponibile ed imposta e totale', () => {
  const hints = scanDocument({
    name: 'quietanza.pdf',
    pages: ['Imponibile       TOTALE\n10.689,58  2.378,43  13.068,01'],
  })
  assert.equal(pickHint(hints, K.PREMIO_IMPONIBILE)?.value, '10.689,58')
  assert.equal(pickHint(hints, K.IMPOSTA)?.value, '2.378,43')
  assert.equal(pickHint(hints, K.PREMIO_TOTALE)?.value, '13.068,01')
})

test('scan: "Premio imponibile 12.066,75 imposta 1.001,25 totale 13.068,00" → economici', () => {
  const hints = scanDocument({ name: 'quietanza.pdf', pages: ['Premio imponibile 12.066,75 imposta 1.001,25 totale 13.068,00'] })
  assert.equal(pickHint(hints, K.PREMIO_IMPONIBILE)?.value, '12.066,75')
  assert.equal(pickHint(hints, K.IMPOSTA)?.value, '1.001,25')
  assert.equal(pickHint(hints, K.PREMIO_TOTALE)?.value, '13.068,00')
})

// ─── scanDocument: sottolimiti e fatturato ──────────────────────────────────

test('scan: sottolimiti "per garanzia" (≥2 coppie) ad alta confidenza', () => {
  const hints = scanDocument({ name: 'polizza.pdf', pages: ['GARANZIA AIDS/HIV: € 260.000,00 · FONTI RADIOATTIVE: € 260.000,00'] })
  const s = hints.filter((h) => h.kind === K.SOTTOLIMITI)
  assert.ok(s.length)
  assert.ok(/260\.000/.test(s[0].value))
  assert.ok(s[0].confidence >= DETERMINISTIC_MIN_CONFIDENCE)
})

test('scan: fatturato dichiarato ("Nuovo Fatturato Preventivato Annuo: € 4.000.000,00")', () => {
  const hints = scanDocument({ name: 'regolazione.pdf', pages: ['Nuovo Fatturato Preventivato Annuo: € 4.000.000,00'] })
  const f = hints.filter((h) => h.kind === K.FATTURATO)
  assert.ok(f.length)
  assert.equal(f[0].value, '4.000.000,00')
})

// ─── buildNumericHints / pickOverrideHint ───────────────────────────────────

function pickHint(hints, kind) {
  return hints.find((h) => h.kind === kind) || null
}

test('pickOverrideHint: migliore hint (più esplicito poi più recente), sopra soglia', () => {
  const docs = [
    { name: 'vecchio.pdf', dateStr: '01/07/2020', pages: ['Massimale per sinistro € 4.000.000,00'] },
    { name: 'nuovo.pdf', dateStr: '01/07/2025', pages: ['Massimali Assicurati: RCT/RCO € 7.500.000,00 Unico per sinistro'] },
  ]
  const { byKind } = buildNumericHints(docs)
  const h = pickOverrideHint(byKind, K.MASSIMALE_SINISTRO)
  assert.ok(h)
  assert.equal(h.value, '7.500.000,00') // più esplicito (conf 0.97) vince
})

test('pickOverrideHint: sotto soglia → null (nessun override)', () => {
  const docs = [{ name: 'd.pdf', dateStr: null, pages: ['franchigia assoluta di € 20.000,00'] }]
  const { byKind } = buildNumericHints(docs)
  // franchigia-assoluta a conf 0.8 < 0.9 → niente override
  assert.equal(pickOverrideHint(byKind, K.FRANCHIGIA), null)
})

test('pickOverrideHint: hint "colonna-totale" vince sull\'hint rata nella stessa quietanza (PREMIO_TOTALE)', () => {
  // La quietanza ha la tabella "Imponibile | Imposte | TOTALE" con la riga dati
  // (5 importi: rata, imponibile, rata, imposta, TOTALE 3.499,00) e SOTTO la
  // riga "Premio lordo € 2.862,16" (la RATA, non il lordo annuo). Il totale vero
  // è l'ultima colonna della riga dati: deve vincere anche se è scritto PRIMA.
  const docs = [{
    name: 'quietanza.pdf',
    dateStr: '10/07/2025',
    pages: [
      'Imponibile       Imposte      TOTALE\n2.862,16  0,00  2.862,16  636,84  3.499,00\nPremio lordo € 2.862,16',
    ],
  }]
  const { byKind } = buildNumericHints(docs)
  const h = pickOverrideHint(byKind, K.PREMIO_TOTALE)
  assert.ok(h, 'un hint premio totale deve esistere')
  assert.equal(h.value, '3.499,00', 'il colonna-totale (3.499,00) deve vincere sulla rata (2.862,16)')
  assert.equal(h.pattern, 'colonna-totale')
})

test('pickOverrideHint: senza colonna-totale, per PREMIO_TOTALE il più recente tra i label resta il criterio', () => {
  const docs = [
    { name: 'vecchio.pdf', dateStr: '10/07/2024', pages: ['Premio lordo € 3.400,00'] },
    { name: 'nuovo.pdf', dateStr: '10/07/2025', pages: ['Premio lordo € 3.499,00'] },
  ]
  const { byKind } = buildNumericHints(docs)
  const h = pickOverrideHint(byKind, K.PREMIO_TOTALE)
  assert.ok(h)
  assert.equal(h.value, '3.499,00')
})

// ─── applyDeterministicOverrides ────────────────────────────────────────────

test('applyDeterministicOverrides: sovrascrive il candidato LLM per i numeri strutturali e logga [deterministico]', () => {
  const docs = [{
    name: 'atto.pdf', dateStr: '01/07/2019', pages: ['franchigia frontale per ogni tipo di danno di € 20.000,00'],
  }]
  const fields = [
    { id: 'rct_massimale_danni', label: 'Franchigia base', description: 'euro' },
    { id: 'rct_massimale_prestatore', label: 'Scoperto base', description: 'minimo' },
  ]
  const best = {
    rct_massimale_danni: { valore: '7.500.000,00' }, // candidato LLM SBAGLIATO (massimale)
  }
  const diag = []
  const res = applyDeterministicOverrides(best, fields, docs, diag)
  assert.equal(res.applied, 1)
  assert.equal(best.rct_massimale_danni.valore, '20.000,00')
  assert.equal(best.rct_massimale_danni.deterministic, true)
  assert.ok(diag.some((l) => l.startsWith(DETERMINISTIC_DIAG_PREFIX)))
})

test('applyDeterministicOverrides: MAI sui campi Tutela (scanKindForField → null)', () => {
  const docs = [{ name: 'd.pdf', pages: ['premio lordo € 3.499,00'] }]
  const fields = [{ id: '0df0e5bc', label: 'Premio Lordo Tutela', description: '' }]
  const best = {}
  const res = applyDeterministicOverrides(best, fields, docs, [])
  assert.equal(res.applied, 0)
  assert.deepEqual(best, {})
})

// ─── FIX BUG 1: consuntivo fatturato dalla tabella di regolazione ──────────
test('scan: consuntivo FATTURATO dalla tabella regolazione (dato consuntivo → importo largo) vince sul preventivato', () => {
  // App di regolazione premio: header "Dato consuntivo …" e riga dati con un
  // importo LARGO = il FATTURATO/RETRIBUZIONI reale.
  const docs = [
    { name: 'app_regolazione.pdf', dateStr: '01/07/2025', pages: [
      'Dato consuntivo  Premio consuntivo (Premio minimo per Garanzia)\nCATEGORIA  8.045.000,00 €  |  326  |  26.226,70 €',
    ] },
    { name: 'atto_aumento.pdf', dateStr: '01/07/2018', pages: ['Nuovo Fatturato Preventivato Annuo: € 4.000.000,00'] },
  ]
  const { byKind } = buildNumericHints(docs)
  const h = pickOverrideHint(byKind, K.FATTURATO)
  assert.ok(h)
  assert.equal(h.value, '8.045.000,00') // il consuntivo (più grande) vince sul preventivato
  assert.ok(h.confidence >= DETERMINISTIC_MIN_CONFIDENCE)
})

// ─── FIX BUG 2: la franchigia frontale NON deve produrre un massimale ──────
test('scan: la franchigia frontale NON produce un hint massimale_sinistro', () => {
  const hints = scanDocument({ name: 'atto.pdf', pages: ['franchigia frontale per ogni tipo di danno di € 20.000,00'] })
  assert.equal(hints.filter((h) => h.kind === K.MASSIMALE_SINISTRO).length, 0)
  assert.ok(hints.some((h) => h.kind === K.FRANCHIGIA && h.value === '20.000,00'))
})

// ── FIX BUG 3: scoperto di GARANZIA specifica non diventa scoperto base ─────
test('scan: scoperto di garanzia specifica (errato trattamento dati) resta SOTTO la soglia di override', () => {
  const hints = scanDocument({
    name: 'polizza.pdf',
    pages: ['G. ERRATO TRATTAMENTO DATI PERSONALI\nlimite di risarcimento pari a € 52.000,00, e comunque con uno scoperto pari al 10% dell’importo di ogni sinistro, con il minimo assoluto di €\n1.000,00'],
  })
  const s = hints.filter((h) => h.kind === K.SCOPERTO)
  assert.ok(s.length >= 1)
  // nessuno scoperto di garanzia specifica deve superare la soglia di override
  for (const h of s) if (h.pattern === 'scoperto-garanzia-specifica') {
    assert.ok(h.confidence < DETERMINISTIC_MIN_CONFIDENCE, `conf ${h.confidence} di ${h.value} non deve sovrascrivere`)
  }
  // nessun hint vince per il campo scoperto base (tutti sotto soglia)
  const { byKind } = buildNumericHints([{ name: 'p.pdf', dateStr: null, pages: ['G. ERRATO TRATTAMENTO DATI PERSONALI min. assoluto di € 1.000,00'] }])
  assert.equal(pickOverrideHint(byKind, K.SCOPERTO), null)
})

// ── FIX BUG 3b: stato percentuale "scoperto del 10%" catturato NON si applica ─
test('scan: percentuale "scoperto del 10%" non diviene importo scoperto base', () => {
  const hints = scanDocument({ name: 'p.pdf', pages: ['con applicazione di uno scoperto del 10% per ogni sinistro con il minimo di € 500,00'] })
  const s = hints.filter((h) => h.kind === K.SCOPERTO)
  // nessun hint "10,00" a conf Alta da percentuale
  assert.ok(!s.some((h) => h.value === '10,00' && h.confidence >= DETERMINISTIC_MIN_CONFIDENCE))
})

// ── FIX FASCIOLI AMTRUST: franchigia in riga-selezione con checkbox ─────────
test('scan: "Indicare la Franchigia ... € 10.000" con checkbox → hint franchigia (ambiguità sotto soglia)', () => {
  // Fascicolo B (AmTrust): la franchigia vive SOLO in una riga del questionario
  // "20. Indicare la Franchigia facoltativa ... [ ] € 2.500,00 [ ] € 10.000,00"
  // (con checkbox). La label di natura è sulla riga PRECEDENTE. Con DUE opzioni
  // la scelta non è leggibile dell'OCR → confidenza SOTTO la soglia di override
  // (meglio vuoto che sbagliato), ma l'hint deve comunque esistere.
  const hints = scanDocument({
    name: 'polizza.pdf',
    pages: ['20. Indicare la Franchigia facoltativa che si desidera selezionare (compilare se selezionata ESCLUSIVAMENTE “Nessuno” alla domanda 22):\n|_] Nessuna |] €2500,00 |__| € 10.000,00'],
  })
  const f = hints.filter((h) => h.kind === K.FRANCHIGIA && h.pattern === 'franchigia-selezione-checkbox')
  assert.ok(f.length >= 2, `atteso 2 hint di selezione, trovati ${f.length}`)
  for (const h of f) assert.ok(h.confidence < DETERMINISTIC_MIN_CONFIDENCE, 'più opzioni → niente override deterministico')
  // Nessun hint vince per il campo franchigia (tutti sotto soglia)
  const { byKind } = buildNumericHints([{ name: 'p.pdf', dateStr: null, pages: ['Indicare la Franchigia facoltativa\n|_] Nessuna | €2500,00 | € 10.000,00'] }])
  assert.equal(pickOverrideHint(byKind, K.FRANCHIGIA), null)
})

test('scan: UNA sola opzione di franchigia selezionata → hint a soglia (override ok)', () => {
  // Se la riga-selezione ha un UNICO importo sotto la label (non ambigua), la
  // franchigia è determinabile → confidenza sopra la soglia.
  const hints = scanDocument({
    name: 'p.pdf',
    pages: ['Indicare la Franchigia facoltativa desiderata\n|_| € 10.000,00'],
  })
  const f = hints.filter((h) => h.kind === K.FRANCHIGIA && h.pattern === 'franchigia-selezione-checkbox')
  assert.ok(f.length >= 1)
  assert.equal(f[0].value, '10.000,00')
  assert.ok(f[0].confidence >= DETERMINISTIC_MIN_CONFIDENCE)
})

// ─── NATURA STRETTA: un hint di una natura NON si applica a campi di natura
// diversa (regola del CEDAM: il 7.500.000 per sinistro NON può finire su
// "Estensioni operative"/"Esclusioni"/campi rcp_* che citano "coperture").
// Un hint deterministico di una data NATURA può essere applicato SOLO a campi
// la cui natura matcha in modo STRETTO: se non è chiaro, NON applicare.
// ───────────────────────────────────────────────────────────────────────────

test('natura: hint "massimale per sinistro" NON si applica a campi annuo/persona/danni/prestatore/franchigia/scoperto/sottolimiti', () => {
  // Ogni campo straniero deve avere una natura DIVERSA da massimale_sinistro,
  // o proprio nessuna natura. canApplyScanHint è 1:1 stretto: nessuno di loro
  // può ricevere l'hint del per-sinistro.
  const foreign = [
    { id: 'rct_massimale_persona', label: 'Massimale annuo', description: 'Massimale annuo aggregato' },
    { id: 'x1', label: 'Massimale per persona', description: 'per ogni persona' },
    { id: 'x2', label: 'Massimale per prestatore', description: '' },
    { id: 'x3', label: 'Massimale per danni a cose', description: '' },
    { id: 'rct_massimale_danni', label: 'Franchigia base', description: 'franchigia frontale' },
    { id: 'x4', label: 'Scoperto base', description: 'minimo' },
    { id: 'rct_parametro', label: 'Sottolimiti', description: 'Tutti i sottolimiti per garanzia' },
  ]
  for (const f of foreign) {
    const kind = scanKindForField(f)
    assert.notEqual(kind, K.MASSIMALE_SINISTRO, `campo ${f.id} non deve avere natura per-sinistro`)
    assert.equal(canApplyScanHint(kind, K.MASSIMALE_SINISTRO), false, f.id)
  }
  // il campo GIUSTO invece lo riceve
  assert.equal(scanKindForField({ id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: '' }), K.MASSIMALE_SINISTRO)
  assert.equal(canApplyScanHint(K.MASSIMALE_SINISTRO, K.MASSIMALE_SINISTRO), true)
})

test('natura: hint "massimale annuo" NON si applica a campi per-sinistro/per-persona/per-prestatore', () => {
  const foreign = [
    { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: 'Massimale per singolo sinistro' },
    { id: 'x1', label: 'Massimale per persona', description: '' },
    { id: 'x2', label: 'Massimale prestatore', description: 'per prestatore' },
  ]
  for (const f of foreign) {
    const kind = scanKindForField(f)
    assert.notEqual(kind, K.MASSIMALE_ANNUO, f.id)
    assert.equal(canApplyScanHint(kind, K.MASSIMALE_ANNUO), false, f.id)
  }
  assert.equal(scanKindForField({ label: 'Massimale annuo', description: 'periodo assicurativo' }), K.MASSIMALE_ANNUO)
  assert.equal(canApplyScanHint(K.MASSIMALE_ANNUO, K.MASSIMALE_ANNUO), true)
})

test('natura: un campo la cui descrizione NON contiene la natura NON riceve hint (i campi copertura rcp_* restano fuori)', () => {
  // I campi rcp_* di Rc Professionale V3 sono campi di COPERTURA (Progettazione
  // /DL, Legge Merloni, Visto pesante...): la loro descrizione parla di una
  // copertura, NON del massimale per-sinistro del contratto. In più il fallback
  // "annuo" NON deve essere un catch-all per qualunque descrizione con la parola
  // "annuo" (l'hint del singolo sinistro NON deve arrivarci).
  const coperture = [
    { id: 'rct_importo_preventivo', label: 'Estensioni operative', description: 'Estrai le estensioni effettivamente operanti indicate in scheda, appendici o condizioni particolari.' },
    { id: 'rct_tasso', label: 'Esclusioni particolari', description: 'Estrai le esclusioni particolari o rilevanti.' },
    { id: 'rcp_massimale_sinistro', label: 'Progettazione / DL', description: 'Verifica se sono coperte progettazione, direzione lavori, coordinamento sicurezza...' },
    { id: 'rcp_massimale_annuo', label: 'Legge Merloni / Appalti', description: 'Verifica se è presente copertura per progettista, ex Legge Merloni, appalti pubblici...' },
    { id: 'rcp_massimale_mat', label: 'Visto pesante / bonus edilizi', description: 'Massimale RC Prodotti per danni materiali...' },
    { id: 'rcp_massimale_interr', label: 'Massimale visto pesante', description: 'Massimale RC Prodotti per danni da interruzione...' },
    { id: 'rcp_scoperto_min_mondo', label: 'Attività giudiziale / stragiudiziale', description: 'Verifica se sono coperte attività giudiziale, stragiudiziale...' },
    { id: 'rcp_scoperto_max_mondo', label: 'Incarichi giudiziari', description: 'Verifica se sono coperti incarichi di curatore...' },
  ]
  for (const f of coperture) {
    assert.equal(scanKindForField(f), null, `campo ${f.id} (${f.label}) non deve ricevere hint deterministici`)
  }
})

test('natura: la description che cita un\'altra grandezza in contrapposizione NON cambia la natura (non confondere, es.)', () => {
  // "Massimale per singolo sinistro ... Non riutilizzare un valore ... (es.
  // massimale annuo, franchigia)" resta un MASSIMALE PER SINISTRO.
  const sinistro = {
    label: 'Massimale per sinistro',
    description: 'NUMERO/IMPORTO (euro). Massimale per singolo sinistro (per esempio 7.500.000,00). Non riutilizzare un valore che appare identico in un altro campo (es. massimale annuo, franchigia).',
  }
  assert.equal(scanKindForField(sinistro), K.MASSIMALE_SINISTRO)
  // "Premio lordo ... Non confondere con premio imponibile" resta PREMIO_TOTALE.
  const premio = { label: 'Premio lordo', description: 'NUMERO/IMPORTO. Premio lordo annuo totale. Non confondere con premio imponibile o premio di rata.' }
  assert.equal(scanKindForField(premio), K.PREMIO_TOTALE)
})

test('applyDeterministicOverrides: il 7.500.000 per-sinistro NON finisce sui campi rcp_* di copertura né su Estensioni/Esclusioni', () => {
  const docs = [{
    name: 'dichiarazione.pdf',
    pages: ['Massimali Assicurati: RCT/RCO € 7.500.000,00 Unico per sinistro'],
  }]
  const fields = [
    { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: '' },
    { id: 'rct_massimale_persona', label: 'Massimale annuo', description: 'Massimale annuo aggregato' },
    { id: 'rct_importo_preventivo', label: 'Estensioni operative', description: 'Estrai le estensioni effettivamente operanti indicate in scheda, appendici o condizioni particolari.' },
    { id: 'rct_tasso', label: 'Esclusioni particolari', description: 'Estrai le esclusioni particolari o rilevanti.' },
    { id: 'rct_massimale_danni', label: 'Franchigia base', description: '' },
    { id: 'rct_massimale_prestatore', label: 'Scoperto base', description: '' },
    { id: 'rcp_massimale_sinistro', label: 'Progettazione / DL', description: 'Verifica se sono coperte progettazione, DL, collaudo...' },
    { id: 'rcp_massimale_annuo', label: 'Legge Merloni / Appalti', description: 'Verifica se coperte progettista, Merloni, appalti...' },
    { id: 'rcp_massimale_mat', label: 'Visto pesante / bonus edilizi', description: 'Massimale RC Prodotti per danni materiali' },
    { id: 'rcp_scoperto_min_mondo', label: 'Attività giudiziale', description: 'Verifica se coperte attività giudiziale...' },
  ]
  const best = {}
  const diag = []
  const res = applyDeterministicOverrides(best, fields, docs, diag)
  // SOLO il massimale per sinistro riceve il valore. Nessun campo di natura
  // diversa viene toccato.
  assert.equal(best.rct_massimale_sinistro?.valore, '7.500.000,00')
  for (const id of ['rct_importo_preventivo', 'rct_tasso', 'rct_massimale_danni', 'rct_massimale_prestatore',
    'rcp_massimale_sinistro', 'rcp_massimale_annuo', 'rcp_massimale_mat', 'rcp_scoperto_min_mondo']) {
    assert.ok(!(id in best), `il campo ${id} non deve ricevere il 7.500.000`)
  }
  assert.equal(res.applied, 1)
  const sc = scanDocument({ name: 'd.pdf', pages: ['Massimale per persona: € 7.500.000,00'] })
  assert.equal(sc.filter((h) => h.kind === K.MASSIMALE_SINISTRO).length, 0, 'un "per persona" nella riga non genera hint per-sinistro')
})

// ─── FIX 3 — GUARDIA ANTI-SPILL "MASSIMALE PER SINISTRO" + SOGLIA MINIMA ────
// (a) Un hint che nasce da un'unica evidenza PER SINISTRO ("Unico per sinistro"
// del caso CEDAM) NON deve popolare campi declinati su persona/prestatore/
// danni/scoperto, che vogliono il LORO importo specifico. La guardia in
// canApplyScanHint esclude quei campi anche se la natura coincide.
// (b) Un massimale <= 50 (es. "0,00" di ODON da POLIZZA_BASE p2) NON è MAI un
// valore valido per override: isPlausibleScanValue lo filtra.

test('FIX3: hint per-sinistro NON va su campi persona/prestatore/danni/scoperto (anche se la natura coincide)', () => {
  // canApplyScanHint: il per-sinistro resta applicabile solo al puro sinistro;
  // una label/description che declina la grandezza su persona/prestatore/danni/
  // scoperto NON lo riceve.
  assert.equal(canApplyScanHint(K.MASSIMALE_SINISTRO, K.MASSIMALE_SINISTRO, { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: '' }, null), true)
  const campiScoperti = [
    { id: 'rct_massimale_persona', label: 'Massimale per persona', description: 'per ogni persona che abbia subito lesioni' },
    { id: 'rct_massimale_prestatore', label: 'Massimale per prestatore', description: 'per ogni prestatore di lavoro' },
    { id: 'rct_massimale_danni', label: 'Massimale danni materiali', description: 'per danni materiali (compresi gli animali)' },
    { id: 'rcp_scoperto_base', label: 'Scoperto base', description: 'scoperto' },
  ]
  for (const f of campiScoperti) {
    assert.equal(canApplyScanHint(scanKindForField(f), K.MASSIMALE_SINISTRO, f), false, `${f.id} (${f.label}) non deve ricevere il hint per-sinistro`)
  }
})

test('FIX3: il 7.500.000 "Unico per sinistro" NON finisce su prestatore/scoperti/rcp_* nel flusso applyDeterministicOverrides', () => {
  const docs = [{
    name: 'dichiarazione.pdf',
    pages: ['Massimali Assicurati: RCT/RCO € 7.500.000,00 Unico per sinistro'],
  }]
  // Campi CEDAM: alcuni mappano il MASSIMALE_SINISTRO ma sono declinati su
  // persona/prestatore/danni/scoperto → la guardia li esclude.
  const fields = [
    { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: 'euro' },
    { id: 'rct_massimale_persona', label: 'Massimale per persona', description: 'per ogni persona' },
    { id: 'rct_massimale_prestatore', label: 'Massimale per prestatore', description: 'per ogni prestatore di lavoro' },
    { id: 'rcp_massimale_sinistro', label: 'Massimale per sinistro RC Prodotti', description: 'euro' },
    { id: 'rcp_massimale_mat', label: 'Massimale danni materiali', description: 'per danni materiali' },
    { id: 'rcp_scoperto_min_mondo', label: 'Scoperto attività giudiziale', description: 'scoperto' },
  ]
  const best = {}
  const diag = []
  const res = applyDeterministicOverrides(best, fields, docs, diag)
  // Il per-sinistro va SOLO ai campi puramente "per sinistro" (rct e il rcp
  // senza declinazioni su persona/prestatore/danni/scoperti).
  assert.equal(best.rct_massimale_sinistro?.valore, '7.500.000,00')
  for (const id of ['rct_massimale_persona', 'rct_massimale_prestatore', 'rcp_massimale_mat', 'rcp_scoperto_min_mondo']) {
    assert.ok(!(id in best), `il campo ${id} non deve ricevere il 7.500.000 (declinato su persona/prestatore/danni/scoperto)`)
  }
  assert.ok(res.applied >= 1)
})

test('FIX3: valore "0,00"/"50,00" NON è MAI un override valido (isPlausibleScanValue)', () => {
  assert.equal(isPlausibleScanValue(K.MASSIMALE_SINISTRO, '0,00'), false)
  assert.equal(isPlausibleScanValue(K.MASSIMALE_SINISTRO, '0'), false)
  assert.equal(isPlausibleScanValue(K.MASSIMALE_SINISTRO, '50,00'), false)
  assert.equal(isPlausibleScanValue(K.MASSIMALE_SINISTRO, '51,00'), true)
  assert.equal(isPlausibleScanValue(K.MASSIMALE_SINISTRO, '2.000.000,00'), true)
})

test('FIX3: il 0,00 ODON da POLIZZA_BASE non sovrascrive rct_massimale_sinistro (soglia minima)', () => {
  // Un finto "0,00" (o "20,00") non deve MAI arrivare al merge come override.
  const il20 = scanDocument({ name: 'polizza_base.pdf', pages: ['Massimale per sinistro € 20,00'] })
  const h20 = il20.find((h) => h.kind === K.MASSIMALE_SINISTRO && h.confidence >= DETERMINISTIC_MIN_CONFIDENCE)
  if (h20) assert.equal(isPlausibleScanValue(h20.kind, h20.value), false)
  const best = {}
  const diag = []
  applyDeterministicOverrides(best,
    [{ id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: '' }],
    [{ name: 'polizza_base.pdf', pages: ['Massimale per sinistro € 20,00'] }], diag)
  assert.ok(!('rct_massimale_sinistro' in best), 'un massimale <= 50 non deve mai sovrascrivere')
})

// ─── Fix A — GUARDIA ANTI-SPILL POST-MERGE (guardPostMergeSpill) ────────────
// Su CEDAM lo spill 7.500.000 lo scrive il LLM al batch (non la scan), e su ODON
// i "0,00" vengono scritti dal LLM: la guardia legge il `best` FINALE (LLM o
// scan indistintamente) e svuota ciò che è spill o placeholder.

const PM_FIELDS = [
  { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: '' },
  { id: 'rct_massimale_annuo', label: 'Massimale annuo', description: 'aggregato' },
  { id: 'rct_massimale_persona', label: 'Massimale per persona', description: 'per ogni persona' },
  { id: 'rct_massimale_prestatore', label: 'Massimale per prestatore', description: 'per ogni prestatore di lavoro' },
  { id: 'rct_massimale_danni', label: 'Massimale danni materiali', description: 'per danni materiali' },
  { id: 'rcp_massimale_sinistro', label: 'Massimale per sinistro RC Prodotti', description: '' },
  { id: 'rcp_massimale_annuo', label: 'Massimale annuo RC Prodotti', description: 'aggregato' },
  { id: 'rcp_scoperto_min_mondo', label: 'Scoperto attività giudiziale', description: 'scoperto' },
  { id: 'rcp_scoperto_max_mondo', label: 'Incarichi giudiziari', description: 'scoperto' },
]

test('guardPostMergeSpill: 7.500.000 su 9 campi di natura diversa → resta solo su per-sinistro/annuo, il resto svuotato', () => {
  const best = {
    rct_massimale_sinistro: { valore: '7.500.000,00' },   // per-sinistro → resta
    rct_massimale_annuo: { valore: '7.500.000,00' },        // annuo → resta (natura coerente)
    rct_massimale_persona: { valore: '7.500.000,00' },      // persona → spill
    rct_massimale_prestatore: { valore: '7.500.000,00' },   // prestatore → spill
    rct_massimale_danni: { valore: '7.500.000,00' },        // danni → spill
    rcp_massimale_sinistro: { valore: '7.500.000,00' },     // per-sinistro → resta
    rcp_massimale_annuo: { valore: '7.500.000,00' },        // annuo → resta
    rcp_scoperto_min_mondo: { valore: '7.500.000,00' },     // scoperto → spill
    rcp_scoperto_max_mondo: { valore: '7.500.000,00' },     // scoperto → spill
  }
  const diag = []
  const cleared = guardPostMergeSpill(best, PM_FIELDS, diag)
  assert.equal(cleared, 5, 'persona+prestatore+danni+2 scoperti svuotati')
  assert.equal(best.rct_massimale_sinistro.valore, '7.500.000,00')
  assert.equal(best.rct_massimale_annuo.valore, '7.500.000,00')
  assert.equal(best.rcp_massimale_sinistro.valore, '7.500.000,00')
  assert.equal(best.rcp_massimale_annuo.valore, '7.500.000,00')
  for (const id of ['rct_massimale_persona', 'rct_massimale_prestatore', 'rct_massimale_danni', 'rcp_scoperto_min_mondo', 'rcp_scoperto_max_mondo']) {
    assert.ok(!(id in best), `${id} svuotato (stesso valore su natura diversa)`)
  }
  assert.ok(diag.some((l) => /anti-spill-post-merge/.test(l)))
})

test('guardPostMergeSpill: campo numerico strutturale con 0,00 → vuoto', () => {
  const best = {
    rct_massimale_sinistro: { valore: '0,00' },
    rct_massimale_danni: { valore: '0,00' },
    rcp_scoperto_min_mondo: { valore: '0,00' },
  }
  guardPostMergeSpill(best, PM_FIELDS, [])
  assert.ok(!('rct_massimale_sinistro' in best), '0,00 su massimale = placeholder')
  assert.ok(!('rct_massimale_danni' in best))
  assert.ok(!('rcp_scoperto_min_mondo' in best))
})

test('guardPostMergeSpill: campo numerico strutturale con 50 (o meno) → vuoto', () => {
  const best = {
    rct_massimale_sinistro: { valore: '50' },
    rct_massimale_annuo: { valore: '50,00' },
  }
  guardPostMergeSpill(best, PM_FIELDS, [])
  assert.ok(!('rct_massimale_sinistro' in best), '50 = placeholder')
  assert.ok(!('rct_massimale_annuo' in best), '50,00 = placeholder')
})

test('guardPostMergeSpill: valori legittimi grandi e di natura unica NON vengono toccati', () => {
  const best = {
    rct_massimale_sinistro: { valore: '7.500.000,00' },
    rct_massimale_persona: { valore: '6.000.000,00' }, // persona 6M vs sinistro 7.5M: valori diversi, natura diversa
    rct_massimale_danni: { valore: '2.000.000,00' },
  }
  guardPostMergeSpill(best, PM_FIELDS, [])
  assert.equal(best.rct_massimale_sinistro.valore, '7.500.000,00')
  assert.equal(best.rct_massimale_persona.valore, '6.000.000,00', 'persona 6M diverso da sinistro: NON è spill')
  assert.equal(best.rct_massimale_danni.valore, '2.000.000,00')
})

test('guardPostMergeSpill: persona 6M vs sinistro 1M (rapporto 6) NON svuota (nessuna copia identica) + persona==sinistro su 3+ campi di natura diversa → pulisce', () => {
  // caso PROF.LE legittimo: persona diversa da sinistro → nessun spill
  const legittimo = {
    rct_massimale_sinistro: { valore: '1.000.000,00' },
    rct_massimale_annuo: { valore: '6.000.000,00' },
    rct_massimale_persona: { valore: '6.000.000,00' },
  }
  // 6.000.000 compare su annuo (annuo) e persona (persona): solo 2 nature, 1
  // coerente (annuo) + persona → NIENTE >= 2 nature da svuotare con 3+ campi:
  // annuo resta, persona resta (rapporto persona 6M / sinistro 1M = 6 legittimo)
  guardPostMergeSpill(legittimo, PM_FIELDS, [])
  assert.equal(legittimo.rct_massimale_persona.valore, '6.000.000,00', 'persona 6M/1M sinistro: NON svuota')
  assert.equal(legittimo.rct_massimale_annuo.valore, '6.000.000,00')
  assert.equal(legittimo.rct_massimale_sinistro.valore, '1.000.000,00')

  // caso spill: 8 campi con lo stesso valore identico + persona == sinistro → pulisce
  const spill = {}
  const ids = ['rct_massimale_sinistro', 'rct_massimale_annuo', 'rct_massimale_persona',
    'rct_massimale_prestatore', 'rct_massimale_danni', 'rcp_massimale_sinistro',
    'rcp_scoperto_min_mondo', 'rcp_scoperto_max_mondo']
  for (const id of ids) spill[id] = { valore: '5.000.000,00' }
  guardPostMergeSpill(spill, PM_FIELDS, [])
  assert.equal(spill.rct_massimale_sinistro.valore, '5.000.000,00', 'per-sinistro resta (natura coerente)')
  assert.equal(spill.rct_massimale_annuo.valore, '5.000.000,00', 'annuo resta')
  assert.equal(spill.rcp_massimale_sinistro.valore, '5.000.000,00', 'per-sinistro resta')
  assert.ok(!('rct_massimale_persona' in spill), 'persona == sinistro su +3 campi identici → pulito da spill')
  assert.ok(!('rct_massimale_prestatore' in spill))
  assert.ok(!('rct_massimale_danni' in spill))
  assert.ok(!('rcp_scoperto_min_mondo' in spill))
  assert.ok(!('rcp_scoperto_max_mondo' in spill))
})

// ─── FIX D1 — ECONOMICO → STRUTTURALE (guardEconomicToStructuralSpill) ───────
// Un importo il cui valore è GIÀ dichiarato su un campo ECONOMICO (premio /
// imponibile / imposta / fatturato / accessorio) NON deve comparire come valore
// di un campo STRUTTURALE (massimale/scoperto/franchigia/sottolimiti). Su ODON
// il premio RC 927,00 finiva su rct_massimale_sinistro; la guardia post-merge
// da ≥3 campi non lo vedeva perché compare solo lì.
const ECON_FIELDS = [
  { id: 'rct_premio_totale', label: 'Premio totale', description: 'Premio lordo annuo' },
  { id: 'rct_premio_imponibile', label: 'Premio imponibile', description: '' },
  { id: 'rcp_premio_totale', label: 'Premio totale RC Professionale', description: '' },
  { id: 'rcp_imposta', label: 'Imposta', description: '' },
  { id: 'rct_fatturato', label: 'Fatturato dichiarato', description: '' },
  { id: 'rct_importo_preventivo', label: 'Accessorio', description: 'accessorio di polizza' },
  { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: '' },
]

test('D1 guardEconomicToStructuralSpill: un premio dichiarato NON è un massimale (ODON 927,00)', () => {
  const best = {
    rct_premio_totale: { valore: '927,00' },
    rct_massimale_sinistro: { valore: '927,00' }, // premio copiato su massimale
  }
  const diag = []
  const cleared = guardEconomicToStructuralSpill(best, ECON_FIELDS, diag)
  assert.equal(cleared, 1)
  assert.equal(best.rct_premio_totale.valore, '927,00', 'il premio resta')
  assert.ok(!('rct_massimale_sinistro' in best), 'il massimale si svuota (era il premio copiato)')
  assert.ok(diag.some((l) => /anti-spill-econ-strutt/.test(l)))
})

test('D1 guardEconomicToStructuralSpill: premio infortuni 25,00 dichiarato NON va su un campo strutturale (PROF.LE, difetto gemello)', () => {
  // PROF.LE: un valore 25,00 di premio RC INFORTUNI (ramo sbagliato) finiva
  // come se fosse il valore di campi di questo fascicolo. La guardia chiude la
  // direzione ECONOMICO→STRUTTURALE: se 25,00 è GIÀ dichiarato su un campo
  // economico, non può essere anche un massimale/scoperto/franchigia.
  const best = {
    rct_premio_totale: { valore: '25,00' },
    rct_massimale_sinistro: { valore: '25,00' }, // premio infortuni copiato su massimale
  }
  const diag = []
  const cleared = guardEconomicToStructuralSpill(best, ECON_FIELDS, diag)
  assert.equal(cleared, 1)
  assert.equal(best.rct_premio_totale.valore, '25,00')
  assert.ok(!('rct_massimale_sinistro' in best), 'il massimale si svuota (il valore 25,00 è il premio infortuni)')
})

test('D1 guardEconomicToStructuralSpill: NON tocca campi economici (niente invenzioni su premi legittimi uguali)', () => {
  // Direzione gemella dello spill ECONOMICO→ECONOMICO (premio 25,00 infortuni su
  // rcp_premio_totale di altro ramo): una regola speculativa che azzerasse premi
  // totali legittimamente uguali sarebbe contro "non inventano". La guardia NON
  // interviene sui campi economici → il valore resta (viene gestito altrove da
  // coerenze cross-field e recency, già presenti).
  const best = {
    rcp_premio_totale: { valore: '25,00' },
  }
  const cleared = guardEconomicToStructuralSpill(best, ECON_FIELDS, [])
  assert.equal(cleared, 0)
  assert.equal(best.rcp_premio_totale.valore, '25,00')
})

test('D1 guardEconomicToStructuralSpill: nessun campo economico → nessun intervento (valori strutturali restano)', () => {
  const best = {
    rct_massimale_sinistro: { valore: '1.000.000,00' },
    rct_premio_totale: { valore: '5.501,25' },
  }
  const cleared = guardEconomicToStructuralSpill(best, ECON_FIELDS, [])
  assert.equal(cleared, 0)
  assert.equal(best.rct_massimale_sinistro.valore, '1.000.000,00')
  assert.equal(best.rct_premio_totale.valore, '5.501,25')
})

test('D1 isEconomicField: premio/imposta/fatturato/accessorio → true; strutturali → false (anche se citano "premio" per contrasto)', () => {
  assert.equal(isEconomicField({ id: 'rct_premio_totale', label: 'Premio totale' }), true)
  assert.equal(isEconomicField({ id: 'rcp_imposta', label: 'Imposta' }), true)
  assert.equal(isEconomicField({ id: 'rct_fatturato', label: 'Fatturato' }), true)
  assert.equal(isEconomicField({ id: 'rct_importo_preventivo', label: 'Accessorio' }), true)
  // una franchigia che nella description parla di "premio" per contrapposizione
  // NON è un campo economico: una vera franchigia non va mai svuotata da qui.
  assert.equal(isEconomicField({ id: 'rct_massimale_danni', label: 'Franchigia base', description: '…non confondere con il premio…' }), false)
  assert.equal(isEconomicField({ id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: 'non riutilizzare un premio' }), false)
  assert.equal(isEconomicField({ id: 'rcp_scoperto', label: 'Scoperto', description: '' }), false)
})

// ─── FIX D3 — FRANCHIGIA ↔ SCOPERTO (guardFranchigiaScoperto) ───────────────
// Lo stesso valore non può stare su un campo "franchigia" e su uno "scoperto":
// prevale la natura del campo su cui l'importo è etichettato. Su B la franchigia
// 10.000 finiva su rct_massimale_prestatore (scoperto) invece che su
// rct_massimale_danni (franchigia).
const FS_FIELDS = [
  { id: 'rct_massimale_danni', label: 'Franchigia base', description: 'franchigia da applicare per ogni sinistro' },
  { id: 'rct_massimale_prestatore', label: 'Scoperto base', description: 'scoperto minimo' },
]

test('D3 guardFranchigiaScoperto: franchigia 10.000 va su rct_massimale_danni, lo scoperto si svuota (caso B)', () => {
  const best = {
    rct_massimale_danni: { valore: '10.000,00' },       // franchigia (attesa 10.000)
    rct_massimale_prestatore: { valore: '10.000,00' },   // scoperto copiato (atteso vuoto)
  }
  const diag = []
  const cleared = guardFranchigiaScoperto(best, FS_FIELDS, diag)
  assert.equal(cleared, 1)
  assert.equal(best.rct_massimale_danni.valore, '10.000,00', 'la franchigia resta sul campo franchigia')
  assert.ok(!('rct_massimale_prestatore' in best), 'lo scoperto si svuota (il valore 10.000 è la franchigia)')
  assert.ok(diag.some((l) => /franchigia-scoperto/.test(l)))
})

test('D3 guardFranchigiaScoperto: valori DIVERSI su franchigia e scoperto → nessun intervento', () => {
  const best = {
    rct_massimale_danni: { valore: '10.000,00' },
    rct_massimale_prestatore: { valore: '5.000,00' },
  }
  assert.equal(guardFranchigiaScoperto(best, FS_FIELDS, []), 0)
  assert.equal(best.rct_massimale_danni.valore, '10.000,00')
  assert.equal(best.rct_massimale_prestatore.valore, '5.000,00')
})

test('D3 guardFranchigiaScoperto: solo franchigia valorizzata → resta', () => {
  const best = { rct_massimale_danni: { valore: '10.000,00' } }
  assert.equal(guardFranchigiaScoperto(best, FS_FIELDS, []), 0)
  assert.equal(best.rct_massimale_danni.valore, '10.000,00')
})

// ─── FIX PROF.LE/B-2 — valore su SOLO scoperto, campo franchigia definito vuoto ──
// Caso B: il 10.000 arriva SOLO sul campo scoperto (rct_massimale_prestatore);
// sul campo franchigia (rct_massimale_danni) era stato scartato come
// senza-evidenza PRIMA del merge, quindi `guardFranchigiaScoperto` non aveva
// nulla su cui equilibrare. La guardia ora, quando un valore V sta su uno
// scoperto e NON esiste nella famiglia alcuna franchigia con V, sposta V sul
// campo franchigia definito nel profilo (atteso vuoto) — "non inventano".
const FS_FIELDS_B2 = [
  { id: 'rct_massimale_danni', label: 'Franchigia base', description: 'franchigia da applicare per ogni sinistro' },
  { id: 'rct_massimale_prestatore', label: 'Scoperto base', description: 'scoperto minimo' },
]

test('B2 guardFranchigiaScoperto: 10.000 su SOLO scoperto → spostato sul campo franchigia definito vuoto (senza docs: natura assunta franchigia)', () => {
  const best = { rct_massimale_prestatore: { valore: '10.000,00' } }
  const diag = []
  const cleared = guardFranchigiaScoperto(best, FS_FIELDS_B2, diag)
  assert.equal(cleared, 1)
  assert.ok(!('rct_massimale_prestatore' in best), 'lo scoperto si svuota')
  assert.equal(best.rct_massimale_danni.valore, '10.000,00', 'il 10.000 va al campo franchigia')
  assert.ok(diag.some((l) => /spostato/.test(l)))
})

test('B2 guardFranchigiaScoperto: con docs il contesto "franchigia" conferma lo spostamento', () => {
  const docs = [{ name: 'polizza B.pdf', text: 'Franchigia facoltativa da applicare: € 10.000,00' }]
  const best = { rct_massimale_prestatore: { valore: '10.000,00', file: 'polizza B.pdf' } }
  const cleared = guardFranchigiaScoperto(best, FS_FIELDS_B2, [], docs)
  assert.equal(cleared, 1)
  assert.equal(best.rct_massimale_danni.valore, '10.000,00')
})

test('B2 guardFranchigiaScoperto: contesto SENZA "franchigia" (vero scoperto) → il valore resta sullo scoperto', () => {
  const docs = [{ name: 'polizza B.pdf', text: 'scoperto con il minimo di € 10.000,00' }]
  const best = { rct_massimale_prestatore: { valore: '10.000,00', file: 'polizza B.pdf' } }
  const cleared = guardFranchigiaScoperto(best, FS_FIELDS_B2, [], docs)
  assert.equal(cleared, 0, 'è uno scoperto vero: non si sposta')
  assert.equal(best.rct_massimale_prestatore.valore, '10.000,00')
})

test('B2 guardFranchigiaScoperto: valori DISTINTI su scoperto e franchigia non vengono toccati (nessun conflitto)', () => {
  const best = {
    rct_massimale_danni: { valore: '10.000,00' },
    rct_massimale_prestatore: { valore: '5.000,00' },
  }
  assert.equal(guardFranchigiaScoperto(best, FS_FIELDS_B2, []), 0)
  assert.equal(best.rct_massimale_danni.valore, '10.000,00')
  assert.equal(best.rct_massimale_prestatore.valore, '5.000,00')
})

test('B2 guardFranchigiaScoperto: scoperto valorizzato MA già presente una franchigia valorizzata con altro valore → nessun spostamento', () => {
  const best = {
    rct_massimale_danni: { valore: '2.500,00' },      // franchigia reale
    rct_massimale_prestatore: { valore: '10.000,00' }, // scoperto distinto
  }
  const cleared = guardFranchigiaScoperto(best, FS_FIELDS_B2, [])
  assert.equal(cleared, 0, 'i due valori distinti sono legittimi')
  assert.equal(best.rct_massimale_danni.valore, '2.500,00')
  assert.equal(best.rct_massimale_prestatore.valore, '10.000,00')
})

test('B2 guardFranchigiaScoperto: nessun campo franchigia definito in base → lo scoperto si svuota (niente franchigia dove va)', () => {
  const onlyScoperto = [
    { id: 'rct_massimale_prestatore', label: 'Scoperto base' },
    { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro' },
  ]
  const best = { rct_massimale_prestatore: { valore: '10.000,00' } }
  const diag = []
  const cleared = guardFranchigiaScoperto(best, onlyScoperto, diag)
  assert.equal(cleared, 1, 'senza campo franchigia dove va, lo scoperto non trattiene il valore')
  assert.ok(!('rct_massimale_prestatore' in best))
})