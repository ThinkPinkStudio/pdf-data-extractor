// Guardie del sanitizer, dell'evidenza e dei vincoli di formato lette dalla
// DESCRIZIONE (analisi errori 25/09/2026, F09): mai id né label (Regola 1),
// solo la parte POSITIVA della descrizione (e la sua testa quando conta la
// natura del campo). Stringhe reali dei fascicoli GUFFANTI RC 2026, RCP
// CRESTA/SAPORITI, BOLCHINI RC, LUCCA, SPALLINO RC, EULIP; descrizioni reali
// dei profili (polizze_test/profili-polizza-riconoscimento.json e, per RCT RCO
// di EULIP, profili-polizza-calibrato.json).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  positiveDescriptionText, positiveDescriptionHead, descriptionAsksDocumentNumber,
  descriptionOfferedWords, descriptionPercentExample, descriptionGivesNumericFormat,
} from '../src/services/polizzaFieldKind.js'
import {
  fieldValueKind, VALUE_PATTERNS, buildJsonSchema, buildGbnfGrammar, amountAllowsWord, amountPatternKey,
} from '../src/services/gbnfSchema.js'
import {
  isLabelLikeValue, passesStagedEvidence, normForMatch, fieldAsksIdentifier, partitionFields,
} from '../src/services/polizzaValidation.js'
import { vetoOptionSourceOnly } from '../src/services/polizzaFactsRegistry.js'
import { sanitizeFieldValue, absorbStagedEntries, frontespizioFocusFields } from '../src/services/polizzaService.js'

const load = (file) => JSON.parse(readFileSync(new URL(`../polizze_test/${file}`, import.meta.url), 'utf8'))
const PROFILES = load('profili-polizza-riconoscimento.json')
const CALIBRATO = load('profili-polizza-calibrato.json')
const prof = (list, name) => list.find((p) => p.name === name).fields
const RC = prof(PROFILES, 'Rc Professionale V3')
const MED = prof(PROFILES, 'RC PROF MED V2')
const TL = prof(PROFILES, 'Tutela Legale 3')
const CSA_RCT = prof(PROFILES, 'CSA RCT-RCO completo')
const CSA_RCP = prof(PROFILES, 'CSA RC Professionale')
const EULIP = prof(CALIBRATO, 'RCT RCO')
const byLabel = (fields, label) => {
  const f = fields.find((x) => String(x.label).trim() === label)
  assert.ok(f, `campo "${label}" nel profilo`)
  return f
}
const patternOf = (field) => buildJsonSchema([field], 'staged').properties.c0.properties.valore.anyOf[0].pattern
const counters = () => ({ unknown: 0, sanitized: 0, placeholders: 0, noEvidence: 0, guardrail: 0 })
const outcomes = (report, field) => report.filter((r) => r.id === field.id && r.outcome !== 'chiave-corretta').map((r) => r.outcome)
const doc = (name, ord, text, dateStr = null) => ({ name, ord, text, pages: [text], spatialPages: [text], normPages: [normForMatch(text)], dateStr })
const used = (analyzed) => new Set(analyzed.map((d) => d.name))

// ─── (1) isLabelLikeValue: intestazione = TUTTO il valore ────────────────────

test('isLabelLikeValue: gli elenchi che CONTENGONO parole di intestazione non sono intestazioni', () => {
  // GUFFANTI RC 2026, Sottolimiti (pag. 16 della polizza): /massimale per sinistro/ in substring
  assert.equal(isLabelLikeValue('Perdita o interruzione di attività di Terzi: 50% del Massimale per Sinistro; Perdita di documenti: 50% del Massimale indicato nella Scheda'), false)
  // RCP CRESTA, Esclusioni: /esclusioni/ in substring
  assert.equal(isLabelLikeValue('Antitrust; Esclusioni territoriali USA e Canada'), false)
  // BOLCHINI RC 2025/2026, Esclusioni (la verità del golden): /^estensione/
  assert.equal(isLabelLikeValue('Estensione territoriale: Mondo intero escluso USA e Canada'), false)
  // le intestazioni NUDE restano fuori
  for (const v of ['Massimale per sinistro', 'Esclusioni', 'Estensione', 'IL CONTRAENTE', 'Condizioni particolari']) assert.equal(isLabelLikeValue(v), true, v)
})

// ─── (2) sanitizeFieldValue: "%" e date solo sui campi IMPORTO ───────────────

test('sanitizeFieldValue: i Sottolimiti (elenco di TESTO) tengono il "50%" e le parole "Massimale per Sinistro"', () => {
  const sot = byLabel(RC, 'Sottolimiti')
  const lista = 'Perdita o interruzione di attività di Terzi: 50% del Massimale per Sinistro; Perdita di documenti: 50% del Massimale indicato nella Scheda; Responsabilità Civile nella conduzione dello Studio: € 500.000,00'
  assert.equal(sanitizeFieldValue(sot, lista), lista)
  // elenco che FINISCE col "%": prima la guardia (label+descrizione con "massimale") lo buttava
  assert.equal(sanitizeFieldValue(sot, 'Perdita o interruzione di attività di Terzi: 50%'), 'Perdita o interruzione di attività di Terzi: 50%')
  // la LABEL non decide: stessa descrizione, label "Massimale per sinistro"
  assert.equal(sanitizeFieldValue({ ...sot, label: 'Massimale per sinistro' }, 'Perdita di documenti: 50%'), 'Perdita di documenti: 50%')
})

test('sanitizeFieldValue: le Esclusioni vere di CRESTA e BOLCHINI sopravvivono', () => {
  const esc = byLabel(RC, 'Esclusioni particolari')
  assert.equal(sanitizeFieldValue(esc, 'Antitrust; Esclusioni territoriali USA e Canada'), 'Antitrust; Esclusioni territoriali USA e Canada')
  assert.equal(sanitizeFieldValue(esc, 'Estensione territoriale: Mondo intero escluso USA e Canada'), 'Estensione territoriale: Mondo intero escluso USA e Canada')
})

test('sanitizeFieldValue: lo Scoperto con esempio "(es. 10%)" riceve la percentuale; gli altri importi no', () => {
  const sco = byLabel(RC, 'Scoperto base')
  assert.equal(descriptionPercentExample(sco.description), true)
  assert.equal(sanitizeFieldValue(sco, '10%'), '10%')
  assert.equal(sanitizeFieldValue(sco, '10 %'), '10 %')
  // premio e massimale: somme, mai aliquote né date
  assert.equal(sanitizeFieldValue(byLabel(RC, 'Premio lordo'), '10%'), null)
  assert.equal(sanitizeFieldValue(byLabel(RC, 'Massimale annuo'), '04/06/2025'), null)
  assert.equal(sanitizeFieldValue(byLabel(RC, 'Premio lordo'), '269,50'), '269,50')
})

// ─── (6) identificativi: descrizione, mai label ──────────────────────────────

test('descriptionAsksDocumentNumber: legge la parte positiva, fuori dalle clausole negate', () => {
  for (const [fields, label] of [[RC, 'N° Polizza'], [MED, 'N° Polizza'], [TL, 'N° Polizza'], [CSA_RCT, 'N° Polizza'], [CSA_RCP, 'N° Polizza']]) {
    assert.equal(descriptionAsksDocumentNumber(byLabel(fields, label).description), true, label)
  }
  // "indicata in polizza" non è "N. polizza"
  assert.equal(descriptionAsksDocumentNumber(byLabel(EULIP, 'Attività assicurata').description), false)
  // "NON il numero di preventivo…" (negazione senza verbo) non fa di un campo un identificativo
  assert.equal(descriptionAsksDocumentNumber('Premio annuo totale della polizza. NON il numero di preventivo, proposta o appendice.'), false)
  // la label non conta: nessun parametro la riceve
  assert.equal(descriptionAsksDocumentNumber('Identificativo del contratto'), false)
})

test('fieldValueKind (type number): decide la descrizione, mai la label "N° Polizza"', () => {
  // Tutela Legale 3: type 'number' + "Numero identificativo della polizza" → testo libero
  assert.equal(fieldValueKind(byLabel(TL, 'N° Polizza')), 'text')
  // label "N° Polizza" ma descrizione di un premio → importo
  assert.equal(fieldValueKind({ id: 'x', type: 'number', label: 'N° Polizza', description: 'Importo del premio lordo' }), 'amount')
  // "NON è il numero di polizza" non toglie il pattern a un importo
  assert.equal(fieldValueKind({ id: 'x', type: 'number', description: 'Premio lordo della polizza. NON è il numero di polizza' }), 'amount')
})

test('sanitizeFieldValue: identificativo SPORCO scartato solo se la descrizione chiede un numero di documento', () => {
  assert.equal(sanitizeFieldValue(byLabel(RC, 'N° Polizza'), '3ROL]]D'), null)
  // la sola label "N° Polizza" non basta più
  assert.equal(sanitizeFieldValue({ id: 'x', label: 'N° Polizza', description: 'Identificativo del contratto' }, '3ROL]]D'), '3ROL]]D')
})

test('passesStagedEvidence: numero di polizza di sole cifre = stringa identità, per descrizione', () => {
  const ctx = '[Documento 1 · pag. 1]\nPolizza n. 283618616   Decorrenza 31/12/2024'
  // EULIP (283618616): prima passava solo grazie al "NON è … la partita IVA" della descrizione
  assert.equal(passesStagedEvidence(byLabel(RC, 'N° Polizza'), '283618616', {}, normForMatch(ctx), ctx), true)
  // CSA RCT-RCO: "Numero di polizza (es. 410000880)" non citava la P.IVA e il numero cadeva come importo non formattato
  const ctx2 = '[Documento 1 · pag. 1]\nPolizza n. 410000880'
  assert.equal(passesStagedEvidence(byLabel(CSA_RCT, 'N° Polizza'), '410000880', {}, normForMatch(ctx2), ctx2), true)
  // su un campo IMPORTO la stessa cifra nuda non è un importo
  assert.equal(passesStagedEvidence(byLabel(RC, 'Premio lordo'), '283618616', {}, normForMatch(ctx), ctx), false)
  // la label "P. IVA" su una descrizione d'altro non fa un identificativo ("assicurativa" contiene "iva")
  const f = { id: 'y', label: 'P. IVA / Cod. Fiscale', description: "Nome dell'agenzia assicurativa (es. ACQUI TERME)" }
  assert.equal(fieldAsksIdentifier(f), false)
  const ctx3 = '[Documento 1 · pag. 1]\nP.IVA 00151510344'
  assert.equal(passesStagedEvidence(f, '00151510344', {}, normForMatch(ctx3), ctx3), false)
  assert.equal(fieldAsksIdentifier(byLabel(RC, 'P. IVA / Cod. Fiscale')), true)
})

test('absorbStagedEntries: P.IVA della riga societaria mai come numero di polizza (LUCCA)', async () => {
  const num = byLabel(MED, 'N° Polizza')
  const page = [
    'AMTRUST PROFESSIONISTA SANITARIO PROTETTO   Certificato N° RCSPEM00000098',
    'Partita Iva e Codice Fiscale 09349380965 - Capitale Sociale 30.000,00 euro - Iscrizione RUI A000542486 del 22.02.2016',
  ].join('\n')
  const analyzed = [doc('LUCCA_VIVIANA.pdf', 1, page, '30/11/2025')]
  const ctx = `[Documento 1 · pag. 1]\n${page}`
  const report = []
  const best = {}
  await absorbStagedEntries({ c0: { valore: '09349380965' } }, [num], best, {}, analyzed, normForMatch(ctx), used(analyzed), counters(), report, null, null, null, null, ctx)
  assert.deepEqual(outcomes(report, num), ['guardrail:piva-assicuratore'])
  const rep2 = []
  await absorbStagedEntries({ c0: { valore: 'RCSPEM00000098' } }, [num], best, {}, analyzed, normForMatch(ctx), used(analyzed), counters(), rep2, null, null, null, null, ctx)
  assert.deepEqual(outcomes(rep2, num), ['ok'])
})

test('absorbStagedEntries: capitale sociale mai come franchigia (tipo importo dalla testa, SPALLINO RC)', async () => {
  // "Franchigia indicata specificatamente come generica": nessuna delle vecchie
  // parole (massimale|premio|imponibile|imposta|importo|tasso|capitale) — la guardia non scattava
  const fr = byLabel(EULIP, 'Franchigia generica o minima RCT')
  const page = 'Sede legale: Avenue John F. Kennedy n. 35D, L-1855 Lussemburgo - Capitale Sociale Euro 47.000.000.'
  const analyzed = [doc('polizza.pdf', 1, page, '31/03/2026')]
  const ctx = `[Documento 1 · pag. 1]\n${page}`
  const report = []
  await absorbStagedEntries({ c0: { valore: '47.000.000' } }, [fr], {}, {}, analyzed, normForMatch(ctx), used(analyzed), counters(), report, null, null, null, null, ctx)
  assert.deepEqual(outcomes(report, fr), ['guardrail:capitale-sociale'])
})

test('absorbStagedEntries: nome file mai come contraente (testa positiva della descrizione)', async () => {
  const con = byLabel(TL, 'Contraente/Assicurato')
  const name = 'LAMBRATE 3 COND. - STUDIO MA_TUT. LEGALE_LAMBRATE 3 CONDOMINIO (1).pdf'
  const page = `${name}\nCONTRAENTE: CONDOMINIO LAMBRATE 3`
  const analyzed = [doc('polizza.pdf', 1, page, '01/01/2025')]
  const ctx = `[Documento 1 · pag. 1]\n${page}`
  const report = []
  await absorbStagedEntries({ c0: { valore: name } }, [con], {}, {}, analyzed, normForMatch(ctx), used(analyzed), counters(), report, null, null, null, null, ctx)
  assert.deepEqual(outcomes(report, con), ['guardrail:nome-file-anagrafica'])
  // "NON è la compagnia" nel corpo della descrizione dell'Agenzia non è la sua testa
  const ag = byLabel(RC, 'Agenzia')
  assert.match(ag.description, /compagnia/i)
  assert.doesNotMatch(positiveDescriptionHead(ag.description), /compagnia|contraente|indirizzo/i)
})

test('frontespizioFocusFields (Stadio A.8): la compagnia si riconosce dalla testa della descrizione, non dalla label', () => {
  for (const fields of [RC, MED, TL, CSA_RCT, CSA_RCP]) {
    const anag = partitionFields(fields).anagrafica
    const kept = new Set(frontespizioFocusFields(anag).map((f) => f.id))
    assert.deepEqual(anag.filter((f) => !kept.has(f.id)).map((f) => f.label), ['Compagnia'])
  }
  const con = byLabel(RC, 'Contraente/Assicurato')
  // una label "Compagnia" su una descrizione del contraente resta nello stadio
  assert.equal(frontespizioFocusFields([{ ...con, label: 'Compagnia' }]).length, 1)
})

// ─── (3) veto "solo nel questionario": solo campi IMPORTO, mai con fonte-questionario ──

test('vetoOptionSourceOnly: mai su un elenco di testo né su un campo che nomina il questionario', () => {
  // GUFFANTI RC 2026: 2.500.000 esiste solo nel questionario (doc7 p3 "€ 2.000.000,00 € 2.500.000,00 ALTRO")
  const reg = { facts: [{ kind: 'amount', value: 2_500_000, doc: 'questionario.pdf', page: 3 }], index: new Map() }
  const optionDocs = new Set(['questionario.pdf'])
  const lista = { valore: 'Perdita o interruzione di attività di Terzi: 2.500.000; Perdita di documenti: 2.500.000' }
  // storico (senza campo): looseAmount sul primo numero dell'elenco → veto
  assert.equal(vetoOptionSourceOnly(reg, optionDocs, lista), true)
  assert.equal(vetoOptionSourceOnly(reg, optionDocs, lista, null, byLabel(RC, 'Sottolimiti')), false)
  // un massimale (importo) solo-questionario resta vetato
  assert.equal(vetoOptionSourceOnly(reg, optionDocs, { valore: '2.500.000,00' }, null, byLabel(RC, 'Massimale per sinistro')), true)
  // SPALLINO RC: il Fatturato 385.000,00 del questionario ("nel questionario o nella proposta")
  const reg2 = { facts: [{ kind: 'amount', value: 385_000, doc: 'questionario.pdf', page: 3 }], index: new Map() }
  assert.equal(vetoOptionSourceOnly(reg2, optionDocs, { valore: '385.000,00' }), true)
  assert.equal(vetoOptionSourceOnly(reg2, optionDocs, { valore: '385.000,00' }, null, byLabel(RC, 'Fatturato dichiarato')), false)
})

test('absorbStagedEntries: i Sottolimiti con una cifra del questionario non cadono più per veto (GUFFANTI RC 2026)', async () => {
  const sot = byLabel(RC, 'Sottolimiti')
  const pol = '2.4 - Perdita o interruzione di attività di Terzi … Sottolimite pari al 50% del Massimale per Sinistro'
  const q = '€ 2.000.000,00 € 2.500.000,00 ALTRO'
  const analyzed = [doc('polizza quietanzata firmata.pdf', 1, pol, '30/06/2026'), doc('questionario.pdf', 2, q)]
  const ctx = `[Documento 1 · pag. 1]\n${pol}\n[Documento 2 · pag. 1]\n${q}`
  const reg = { facts: [{ kind: 'amount', value: 2_500_000, doc: 'questionario.pdf', page: 1 }], index: new Map() }
  const report = []
  const best = {}
  await absorbStagedEntries({ c0: { valore: 'Perdita o interruzione di attività di Terzi: 2.500.000' } }, [sot], best, {}, analyzed, normForMatch(ctx), used(analyzed), counters(), report, null, reg, new Set(['questionario.pdf']), null, ctx)
  assert.equal(outcomes(report, sot).includes('veto:opzione-questionario'), false)
  assert.equal(best[sot.id]?.valore, 'Perdita o interruzione di attività di Terzi: 2.500.000')
})

// ─── (4) grammatica degli importi dalla parte positiva della descrizione ─────

test('descriptionOfferedWords: parole offerte come RISPOSTA, mai etichette né negazioni', () => {
  assert.deepEqual(descriptionOfferedWords(byLabel(TL, 'Massimale per anno tutela legale').description), ['Illimitato', 'ILLIMITATO'])
  assert.deepEqual(descriptionOfferedWords(byLabel(RC, 'Massimale visto leggero').description), ['entro il massimale di polizza'])
  assert.deepEqual(descriptionOfferedWords(byLabel(MED, 'Franchigia base').description), ['NESSUNA', 'COME DA SCHEDA TECNICA'])
  // RCP SAPORITI: "accanto a 'Scoperto'" è un'etichetta, "e nessuna percentuale" non offre nulla
  assert.deepEqual(descriptionOfferedWords(byLabel(RC, 'Scoperto base').description), [])
  // "Vuoto se nessun documento lo dichiara"
  assert.deepEqual(descriptionOfferedWords(byLabel(RC, 'Fatturato dichiarato').description), [])
  // CSA RCT-RCO: "NON una sigla o il nome della garanzia (es. 'RCO', 'R.C.O.')"
  assert.deepEqual(descriptionOfferedWords(byLabel(CSA_RCT, 'Massimale RCO per sinistro').description), [])
  // MED V2 (premio imponibile): "(es. 'PREMIO NETTO ALLA FIRMA')" è il nome della colonna, il valore è "(es. 118,90)"
  const imp = MED.find((f) => /PREMIO NETTO ALLA FIRMA/.test(f.description))
  assert.deepEqual(descriptionOfferedWords(imp.description), [])
})

test('schema: Scoperto base = importo o percentuale; la frase troncata di SAPORITI non è scrivibile', () => {
  const sco = byLabel(RC, 'Scoperto base')
  assert.equal(amountAllowsWord(sco), false)
  assert.equal(amountPatternKey(sco), 'amountOrPercent')
  const re = new RegExp(patternOf(sco))
  for (const v of ['10%', '10 %', '12,5%', '1.500,00', '1500']) assert.equal(re.test(v), true, v)
  assert.equal(re.test('RCO per ogni Sinistro di un importo pari'), false)
  assert.match(buildGbnfGrammar([sco], 'staged'), /_entry ::= .*\(amount-or-percent \| null\)/)
  assert.match(buildGbnfGrammar([sco], 'staged'), /percent-body ::= /)
})

test('schema: parole solo dove la descrizione le offre o non chiede un numero', () => {
  // Fatturato RC V3: esempio numerico, "nessun documento" non apre le parole
  assert.equal(patternOf(byLabel(RC, 'Fatturato dichiarato')), VALUE_PATTERNS.amount)
  // Imposte MED V2 ("Rispondi: Sì, No, Non indicato" senza citazioni): resta importo (verità LUCCA 26,46)
  const imposte = MED.find((f) => /IMPOSTE ALLA FIRMA/.test(f.description))
  assert.equal(patternOf(imposte), VALUE_PATTERNS.amount)
  // parole offerte: "Illimitato", "NESSUNA", "entro il massimale di polizza"
  assert.equal(new RegExp(patternOf(byLabel(TL, 'Massimale per anno tutela legale'))).test('Illimitato'), true)
  assert.equal(new RegExp(patternOf(byLabel(MED, 'Franchigia base'))).test('COME DA SCHEDA TECNICA'), true)
  assert.equal(new RegExp(patternOf(byLabel(RC, 'Massimale visto leggero'))).test('entro il massimale di polizza'), true)
  // tipo importo solo per la parola "premio" della testa, esempio di PAROLE (EULIP: parametro "retribuzioni")
  const par = byLabel(EULIP, 'Parametro regolazione (RCTO)')
  assert.equal(fieldValueKind(par), 'amount')
  assert.equal(descriptionGivesNumericFormat(par.description), false)
  assert.equal(new RegExp(patternOf(par)).test('Retribuzioni'), true)
  // premi e massimali con formato numerico restano solo importo
  for (const f of [byLabel(RC, 'Premio lordo'), byLabel(RC, 'Massimale per sinistro'), byLabel(TL, 'Premio lordo totale tutela legale')]) {
    assert.equal(patternOf(f), VALUE_PATTERNS.amount, f.label)
  }
  // un type forte (number) non si apre alle parole senza un'offerta esplicita
  assert.equal(amountAllowsWord({ id: 'p', type: 'number', description: 'Premio annuo totale comprensivo di imposte' }), false)
})

test('positiveDescriptionText: le clausole "NON è…" non fanno parte della descrizione positiva', () => {
  const d = byLabel(RC, 'N° Polizza').description
  assert.match(d, /numero di proposta/)
  assert.doesNotMatch(positiveDescriptionText(d), /numero di proposta/)
  assert.match(positiveDescriptionText(d), /^Numero di polizza: l'identificativo alfanumerico/)
})
