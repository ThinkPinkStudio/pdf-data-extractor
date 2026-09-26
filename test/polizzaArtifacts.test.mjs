// Artefatti del formato/prompt che NON sono mai dati (GUFFANTI RC 2025, 13/09/2026):
// frammenti JSON come valore, zeri-segnaposto, importi con zeri iniziali (P.IVA
// letta come massimale) e il NOME FILE copiato dai marcatori di pagina.
import test from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeJsonFragment, isZeroPlaceholder } from '../src/services/polizzaValidation.js'
import { sanitizeFieldValue, buildGroupBatches, stagedDocTag } from '../src/services/polizzaService.js'
import { VALUE_PATTERNS, buildGbnfGrammar } from '../src/services/gbnfSchema.js'

test('looksLikeJsonFragment: frammento JSON sì, testi con due punti o virgolette normali no', () => {
  assert.equal(looksLikeJsonFragment('valore": null, "documento":"GUFFANTI GROUP'), true)
  assert.equal(looksLikeJsonFragment('{"valore":"5.000.000"}'), true)
  assert.equal(looksLikeJsonFragment("Lloyd's Insurance Company S.A."), false)
  assert.equal(looksLikeJsonFragment('Art. 6: nuove spese di progettazione'), false)
  assert.equal(looksLikeJsonFragment('Viale Caterina da Forlì 12'), false)
  assert.equal(looksLikeJsonFragment('5.000.000,00'), false)
})

test('isZeroPlaceholder: 0 / 0,00 / € 0.00 sono segnaposto, 0,5 e 10 no', () => {
  for (const v of ['0', '0,00', '€ 0.00', '00']) assert.equal(isZeroPlaceholder(v), true, v)
  for (const v of ['0,5', '10', '1.500,00', 'Sì', '']) assert.equal(isZeroPlaceholder(v), false, v)
})

const AMOUNT_FIELD = { id: 'f1', label: 'X', description: 'Massimale annuo aggregato della RC Professionale (es. 2.500.000,00): il massimale complessivo indicato nella scheda.' }
const TEXT_FIELD = { id: 'f2', label: 'Y', description: 'Verifica se sono coperte le attività giudiziali: Sì, No o vuoto.' }

test('sanitizeFieldValue: zeri iniziali, frammenti JSON e "Documento N" → vuoto; importo vero (anche 0,00) passa', () => {
  // lo zero NON è scartato qui (interessi di frazionamento 0,00 è un dato): il
  // consenso tra batch non conta i voti a zero, e basta.
  assert.equal(sanitizeFieldValue(AMOUNT_FIELD, '0,00'), '0,00')
  assert.equal(sanitizeFieldValue(AMOUNT_FIELD, '06457990965'), null, 'una P.IVA non è un importo')
  assert.equal(sanitizeFieldValue(AMOUNT_FIELD, '5.000.000,00'), '5.000.000,00')
  assert.equal(sanitizeFieldValue(AMOUNT_FIELD, '€ 1.500,00'), '1.500,00')
  assert.equal(sanitizeFieldValue(TEXT_FIELD, 'valore": null, "documento":"GUFFANTI GROUP'), null)
  assert.equal(sanitizeFieldValue(TEXT_FIELD, 'Documento 3'), null)
  assert.equal(sanitizeFieldValue(TEXT_FIELD, 'Sì'), 'Sì')
})

test('pattern importo (JSON Schema e GBNF): niente zeri iniziali, "0" e importi normali ammessi', () => {
  const re = new RegExp(VALUE_PATTERNS.amount)
  for (const ok of ['0', '5', '1.500,00', '5.000.000', '2.500.000,00', '18000,5']) assert.ok(re.test(ok), ok)
  for (const ko of ['06457990965', '01.010.000,00', '0110000000,00', '00,00', '1.5000']) assert.ok(!re.test(ko), ko)
  const g = buildGbnfGrammar([AMOUNT_FIELD], 'staged')
  assert.match(g, /int-plain ::= "0" \| \[1-9\] \[0-9\]\*/)
  assert.match(g, /int-grouped ::= \[1-9\] \[0-9\]\{0,2\}/)
})

test('stagedDocTag / buildGroupBatches: nei prompt il documento è "Documento N", mai il nome file', () => {
  const docs = [
    { name: 'GUFFANTI GROUP_CONTRATTO A4000060771-LB quietanzata.pdf', ord: 1, pages: ['Lloyd’s Insurance Company S.A.\nContraente: Guffanti Group & Partners Srl'], spatialPages: [] },
    { name: 'GUFFANTI GROUP_App A4000000061-LB (proroga fino al 30 06 2025).pdf', ord: 2, pages: ['Appendice di proroga\nPremio 18.000,00'], spatialPages: [] },
  ]
  assert.equal(stagedDocTag(docs[0]), 'Documento 1')
  const batches = buildGroupBatches(docs, 5000)
  const text = batches.map((b) => b.text).join('\n')
  assert.ok(text.includes('[Documento 1 · pag. 1]'), 'marcatore neutro')
  assert.ok(text.includes('[Documento 2 · pag. 1]'), 'marcatore neutro')
  assert.ok(!/GUFFANTI GROUP_|\.pdf|A4000000061|30 06 2025/.test(text), 'il nome file non entra nel prompt')
  // usedNames resta sul nome VERO (serve alla diagnostica e all’evidenza per documento)
  assert.ok(batches[0].usedNames.has(docs[0].name))
  // senza ordinale (documenti non passati dalla deduplica) resta il nome: nessun marcatore vuoto
  assert.equal(stagedDocTag({ name: 'x.pdf', pages: [] }), 'x.pdf')
})

test('sanitizeFieldValue: "Sì"/"No" solo per descrizioni che pongono una verifica o ammettono Sì/No', () => {
  const elenco = { id: 'e1', label: 'Esclusioni particolari', description: "Elenco TESTUALE breve delle esclusioni particolari della polizza, separate da '; '." }
  assert.equal(sanitizeFieldValue(elenco, 'Sì'), null)
  assert.equal(sanitizeFieldValue(elenco, 'No'), null)
  assert.equal(sanitizeFieldValue(elenco, 'Esclusi USA e Canada'), 'Esclusi USA e Canada')
  assert.equal(sanitizeFieldValue(TEXT_FIELD, 'No'), 'No', 'descrizione "Verifica se…"')
  const tacito = { id: 't1', label: 'Tacito rinnovo', description: 'Tacito rinnovo della polizza: rispondi Sì o No come indicato nel frontespizio.' }
  assert.equal(sanitizeFieldValue(tacito, 'Sì'), 'Sì')
  const barrato = { id: 't2', label: 'Sinistri', description: "Indica se risultano sinistri: 'Si' se la casella barrata è SI, 'No' altrimenti." }
  assert.equal(sanitizeFieldValue(barrato, 'No'), 'No')
})

test('sanitizeFieldValue: l\'eco di una chiave del formato ("valore") non è un dato', () => {
  assert.equal(sanitizeFieldValue(TEXT_FIELD, 'valore'), null)
  assert.equal(sanitizeFieldValue(TEXT_FIELD, 'evidenza'), null)
})

test('isRunningTextInDoc: piè di pagina su quasi tutte le pagine sì, frontespizio no, documenti corti no', async () => {
  const { isRunningTextInDoc, normForMatch } = await import('../src/services/polizzaValidation.js')
  const footer = normForMatch('DAS Difesa Automobilistica Sinistri S.p.A. - Via Enrico Fermi 9/B, 37135 Verona')
  const pages = Array.from({ length: 10 }, (_, i) => normForMatch(`pagina ${i} testo`) + footer)
  pages[0] = normForMatch('Contraente BOLCHINI MARGHERITA Via Mugello 7 20137 Milano') + footer
  assert.equal(isRunningTextInDoc(pages, 'Via Enrico Fermi 9/B, 37135 Verona'), true)
  assert.equal(isRunningTextInDoc(pages, 'Via Mugello 7 20137 Milano'), false)
  assert.equal(isRunningTextInDoc(pages.slice(0, 3), 'Via Enrico Fermi 9/B, 37135 Verona'), false)
})

test('pickConsensusCandidate: il testo corrente vale un voto per documento; le varianti dello stesso testo sommano i voti', async () => {
  const { pickConsensusCandidate } = await import('../src/services/polizzaService.js')
  const mk = (valore, file, extra = {}) => ({ valore, file, srcDate: '01/01/2025', affinity: 0.5, ...extra })
  // 9 voti per la sede della compagnia (piè di pagina) da 2 documenti contro 3 voti per il contraente
  const cands = [
    ...Array.from({ length: 6 }, () => mk('Via Enrico Fermi 9/B, 37135 Verona', 'polizza.pdf', { boilerplate: true })),
    ...Array.from({ length: 3 }, () => mk('Via Enrico Fermi 9/B, 37135 Verona', 'set.pdf', { boilerplate: true })),
    mk("VIALE CATERINA DA FORLI' 32", 'polizza.pdf', { affinity: 0.6 }),
    mk("VIALE CATERINA DA FORLI' 32 - 20146 MILANO", 'quietanza.pdf', { affinity: 0.58 }),
    mk("VIALE CATERINA DA FORLI' 32", 'app.pdf', { affinity: 0.55 }),
  ]
  const current = cands[9]
  const r = pickConsensusCandidate(current, cands, { tierBlind: true })
  assert.equal(r.changed, false, 'sede della compagnia: 2 voti (documenti) contro 3, non scavalca')
  // se il corrente fosse la sede della compagnia, il contraente (3 voti su 2) la scavalca
  const r2 = pickConsensusCandidate(cands[0], cands, { tierBlind: true })
  assert.equal(r2.changed, true)
  assert.match(r2.cand.valore, /VIALE CATERINA/)
  assert.equal(r2.votes, 3)
  // importi: nessun raggruppamento per contenimento ("5000000" dentro "15000000")
  const amt = [mk('5.000.000', 'a.pdf'), mk('15.000.000', 'b.pdf'), mk('15.000.000', 'c.pdf')]
  const r3 = pickConsensusCandidate(amt[0], amt, {})
  assert.equal(r3.changed, false, '2 voti contro 1 non bastano (servono 2·1+1)')
})

test('passesStagedEvidence: una data con anno a 2 cifre nel testo ("Dal 16/12/25 al 16/12/26") è evidenza della data completa', async () => {
  const { passesStagedEvidence, normForMatch } = await import('../src/services/polizzaValidation.js')
  const f = { id: 'd1', label: 'Decorrenza', description: 'Data di decorrenza della copertura', type: 'date' }
  const raw = 'QUIETANZA DI RINNOVO\nDal 16/12/25 al 16/12/26 ANNUALE € 28,00\nTel. 0161225777'
  assert.equal(passesStagedEvidence(f, '16/12/2025', {}, normForMatch(raw), raw), true)
  assert.equal(passesStagedEvidence(f, '16/12/2026', {}, normForMatch(raw), raw), true)
  assert.equal(passesStagedEvidence(f, '16/12/2024', {}, normForMatch(raw), raw), false, 'anno diverso')
  // sei cifre dentro un numero di telefono non sono una data (col contesto grezzo)
  const tel = 'Tel. 0161225777 fax 016122577'
  assert.equal(passesStagedEvidence(f, '16/12/2025', {}, normForMatch(tel), tel), false)
})

test('pickSemanticCandidate: tra due righe di tabella vince l\'etichetta di riga più coerente con la descrizione (TOTALE), non il rumore dell\'embedding', async () => {
  const { pickSemanticCandidate } = await import('../src/services/polizzaValidation.js')
  const row1 = { valore: '2.250,00', tableRow: true, structLex: 1, rowLex: 0.33, affinity: 0.9, effDate: '30/06/2026' }
  const tot = { valore: '18.000,00', tableRow: true, structLex: 1, rowLex: 1, affinity: 0.88, effDate: '30/06/2026' }
  assert.equal(pickSemanticCandidate(row1, tot, 'economici').valore, '18.000,00')
  assert.equal(pickSemanticCandidate(tot, row1, 'economici').valore, '18.000,00')
  // a parità completa resta la prima
  const a = { valore: 'A', tableRow: true, structLex: 1, rowLex: 1, affinity: 0.8 }
  const b = { valore: 'B', tableRow: true, structLex: 1, rowLex: 1, affinity: 0.8 }
  assert.equal(pickSemanticCandidate(a, b, 'anagrafica').valore, 'A')
})

test('isRunningTextInAnyLayer: piè di pagina presente solo nella griglia spaziale (Docling lo omette) è testo corrente', async () => {
  const { isRunningTextInAnyLayer, normForMatch } = await import('../src/services/polizzaValidation.js')
  const footer = 'A4000060771-LB Guffanti Group & Partners Srl pag. N di 34'
  const doc = {
    normPages: Array.from({ length: 6 }, (_, i) => normForMatch(`clausola ${i} senza piè di pagina`)),
    spatialPages: Array.from({ length: 6 }, (_, i) => `clausola ${i}\n${footer.replace('N', String(i + 1))}`),
  }
  assert.equal(isRunningTextInAnyLayer(doc, 'Guffanti Group & Partners Srl'), true)
  assert.equal(isRunningTextInAnyLayer(doc, "Lloyd's Insurance Company S.A."), false)
})

test('verificationAnswers: le parole citate della descrizione di verifica, non gli apostrofi del testo', async () => {
  const { verificationAnswers, canonicalVerificationAnswer } = await import('../src/services/polizzaFieldKind.js')
  const odv = "Verifica se sono coperti gli incarichi in Organismo di Vigilanza: 'Sì' solo se una garanzia li include espressamente (cita la frase); 'No' se una clausola li esclude ('a meno che non sia richiamata la condizione aggiuntiva' senza richiamo = escluso); vuoto se il fascicolo non li nomina. Nell'oggetto dell'assicurazione."
  assert.deepEqual(verificationAnswers(odv), ['Sì', 'No'])
  const visto = "Verifica se la polizza comprende la garanzia visto leggero: 'presente' solo se una voce la nomina; 'escluso' solo se una clausola la esclude; vuoto altrimenti."
  assert.deepEqual(verificationAnswers(visto), ['presente', 'escluso'])
  assert.deepEqual(verificationAnswers('Elenco testuale delle esclusioni (es. USA)'), [])
  assert.equal(canonicalVerificationAnswer(odv, 'si'), 'Sì')
  assert.equal(canonicalVerificationAnswer(odv, 'ARCHITETTI'), null)
  assert.equal(canonicalVerificationAnswer('Testo libero', 'ARCHITETTI'), undefined)
})

test('campo di verifica: valore LIBERO nello schema (niente enum: misurato, il modello sceglieva sempre "Sì"); sanitize canonizza e scarta il resto', async () => {
  const { buildJsonSchema, buildGbnfGrammar } = await import('../src/services/gbnfSchema.js')
  const f = { id: 'odv1', label: 'ODV / CDA', description: "Verifica se sono coperti gli incarichi in ODV: 'Sì' solo se inclusi espressamente; 'No' se esclusi; vuoto se non nominati." }
  const schema = buildJsonSchema([f], 'staged')
  const valore = schema.properties.c0.properties.valore
  assert.equal(valore.anyOf[0].enum, undefined)
  assert.deepEqual(schema.properties.c0.required, ['valore', 'evidenza'], 'evidenza resta obbligatoria')
  const g = buildGbnfGrammar([f], 'staged')
  assert.ok(!g.includes('"\\"Sì\\""'))
  assert.equal(sanitizeFieldValue(f, 'ARCHITETTI'), null)
  assert.equal(sanitizeFieldValue(f, 'presente'), null)
  assert.equal(sanitizeFieldValue(f, 'SI'), 'Sì')
  assert.equal(sanitizeFieldValue(f, 'No'), 'No')
})

test('negatedOwnerFields: i proprietari negati vengono dalla clausola "NON è … della compagnia" e dalle teste delle altre descrizioni', async () => {
  const { negatedOwnerFields } = await import('../src/services/polizzaValidation.js')
  const fields = [
    { id: 'ind', description: "Indirizzo (via, numero civico, CAP, città) del contraente/assicurato, come scritto nel blocco anagrafico del contraente. NON è l'indirizzo della compagnia, dell'intermediario, del broker o del corrispondente (spesso in intestazione o piè di pagina)." },
    { id: 'comp', description: "Compagnia assicuratrice, cioè l'ASSICURATORE che presta la copertura: la società nominata nel frontespizio. NON è l'intermediario, l'agenzia, il broker." },
    { id: 'ag', description: "Intermediario che ha collocato o incassato la polizza: agenzia, broker o corrispondente. NON è la compagnia assicuratrice." },
    { id: 'contr', description: "Nome o ragione sociale del contraente, come scritto accanto a 'Contraente'. NON è la compagnia, NON è l'intermediario." },
    { id: 'num', description: 'Numero di polizza: identificativo alfanumerico del contratto.' },
  ]
  assert.deepEqual(negatedOwnerFields(fields[0], fields).sort(), ['ag', 'comp'])
  assert.deepEqual(negatedOwnerFields(fields[1], fields), ['ag'])
  assert.deepEqual(negatedOwnerFields(fields[3], fields).sort(), ['ag', 'comp'])
  const contrNum = { id: 'contr2', description: "Nome del contraente. NON è il numero di polizza, NON è la compagnia." }
  assert.deepEqual(negatedOwnerFields(contrNum, [...fields, contrNum]).sort(), ['comp', 'num'], '"NON è il numero di polizza" → anche il numero di polizza è proprietario negato')
  assert.deepEqual(negatedOwnerFields(fields[4], fields), [])
})

test('descriptionAllowsRunningText: "intestazione di ogni pagina" nella parte positiva sì, solo nella clausola NON no', async () => {
  const { descriptionAllowsRunningText } = await import('../src/services/polizzaValidation.js')
  assert.equal(descriptionAllowsRunningText({ description: "Numero di polizza: l'identificativo del contratto nel frontespizio, spesso ripetuto nell'intestazione di ogni pagina. NON è il numero di proposta." }), true)
  assert.equal(descriptionAllowsRunningText({ description: "Indirizzo del contraente nel blocco anagrafico. NON è l'indirizzo della compagnia (spesso in intestazione o piè di pagina)." }), false)
  assert.equal(descriptionAllowsRunningText({ description: 'Premio lordo annuo totale della polizza.' }), false)
})

test('isFormQuestionEvidence: una citazione con tutte le opzioni ("Sì No", "SI X NO") è la domanda del modulo, non una prova', async () => {
  const { isFormQuestionEvidence } = await import('../src/services/polizzaService.js')
  assert.equal(isFormQuestionEvidence("Si richiede l'attivazione della garanzia aggiuntiva per gli incarichi di Amministratore di Stabili? Sì No", ['Sì', 'No']), true)
  assert.equal(isFormQuestionEvidence('è a conoscenza di Circostanze che possano dare origine ad una Richiesta SI X NO', ['Sì', 'No']), true)
  assert.equal(isFormQuestionEvidence("Si conferma che la copertura è estesa all'attività di Sindaco e Revisore", ['Sì', 'No']), false)
  assert.equal(isFormQuestionEvidence('Garanzia visto leggero: presente', ['presente', 'escluso']), false)
  assert.equal(isFormQuestionEvidence('Nessuna sinistrosità pregressa', ['Sì', 'No']), false, '"no" dentro "nessuna"/"sinistrosità" non conta')
})

test('valueTokens / isRunningTextInDoc: il piè di pagina riordinato dal modello resta testo corrente', async () => {
  const { valueTokens, pageHasValueTokens, isRunningTextInDoc, normForMatch } = await import('../src/services/polizzaValidation.js')
  assert.deepEqual(valueTokens('Via Enrico Fermi, 9/B - 37135 Verona'), ['via', 'enrico', 'fermi', '37135', 'verona'])
  const footer = 'D.A.S. Difesa Automobilistica Sinistri S.p.A. Sede e Direzione Generale: 37135 Verona - Via Enrico Fermi, 9/B'
  const pages = Array.from({ length: 8 }, (_, i) => normForMatch(`Art. ${i} condizioni ${footer}`))
  pages[0] = normForMatch(`Contraente BOLCHINI MARGHERITA VIA MUGELLO 7, 20137 MILANO ${footer}`)
  assert.equal(pageHasValueTokens(pages[3], valueTokens('Via Enrico Fermi, 9/B - 37135 Verona')), true)
  assert.equal(isRunningTextInDoc(pages, 'Via Enrico Fermi, 9/B - 37135 Verona'), true, 'riordinato ma su ogni pagina')
  assert.equal(isRunningTextInDoc(pages, 'VIA MUGELLO 7, 20137 MILANO'), false)
  assert.equal(isRunningTextInDoc(pages, '5.000.000'), false)
})

test('pickConsensusCandidate: il testo corrente conta per pagina se la descrizione lo prevede (runningTextAllowed)', async () => {
  const { pickConsensusCandidate } = await import('../src/services/polizzaService.js')
  const mk = (valore, file, extra = {}) => ({ valore, file, srcDate: '01/01/2025', affinity: 0.5, ...extra })
  const cands = [
    ...Array.from({ length: 6 }, () => mk('A46S513704A-LB', 'contratto.pdf', { boilerplate: true, runningTextAllowed: true, affinity: 0.59 })),
    mk('1046945', 'scheda.pdf', { affinity: 0.51 }), mk('1046945', 'scheda2.pdf', { affinity: 0.51 }),
  ]
  const r = pickConsensusCandidate(cands[6], cands, { tierBlind: true })
  assert.equal(r.changed, true); assert.equal(r.cand.valore, 'A46S513704A-LB'); assert.equal(r.votes, 6)
})

test('descriptionNamesQuestionnaire: fonte positiva sì, "elenco del questionario NON è una copertura" no', async () => {
  const { descriptionNamesQuestionnaire } = await import('../src/services/polizzaValidation.js')
  assert.equal(descriptionNamesQuestionnaire({ description: "Verifica se nel questionario o nella proposta risultano DICHIARATI sinistri: rispondi 'Sì' solo se la risposta barrata è SÌ." }), true)
  assert.equal(descriptionNamesQuestionnaire({ description: "Verifica se sono coperti gli incarichi in ODV: 'Sì' solo se una garanzia li include espressamente. Un elenco di attività del questionario NON è una copertura." }), false)
  assert.equal(descriptionNamesQuestionnaire({ description: "Verifica se è coperta la custodia documenti: 'Sì' se una estensione la include. NON dedurla dal questionario." }), false)
})

test('negatedQuotedLabels: etichette citate nella clausola NON, mai gli apostrofi del testo', async () => {
  const { negatedQuotedLabels } = await import('../src/services/polizzaValidation.js')
  const d = "Indirizzo del contraente, come scritto accanto a 'Indirizzo del Contraente', 'Indirizzo' o nel blocco anagrafico. NON è l'indirizzo della compagnia, dell'intermediario, del broker o del corrispondente (spesso in intestazione o piè di pagina, accanto a 'Sede legale', 'Sede e Direzione Generale', 'Rappresentanza Generale')."
  assert.deepEqual(negatedQuotedLabels(d), ['Sede legale', 'Sede e Direzione Generale', 'Rappresentanza Generale'])
  assert.deepEqual(negatedQuotedLabels("Numero di polizza accanto a 'Polizza n.'. NON è il numero di proposta."), [])
})

test('findValueWindow: valore riordinato dal modello → finestra attorno al token più lungo', async () => {
  const { findValueWindow, normForMatch } = await import('../src/services/polizzaValidation.js')
  const page = 'D.A.S. Difesa Automobilistica Sinistri S.p.A.\nSede e Direzione Generale: 37135 Verona - Via Enrico Fermi, 9/B Aut. D.M. del 26.11.59\nContraente: GUFFANTI GROUP\nVIALE CATERINA DA FORLI 32 20146 MILANO'
  const w = findValueWindow(page, 'Via Enrico Fermi, 9/B - 37135 Verona', '', 60)
  assert.ok(w && normForMatch(w).includes('sedeedirezionegenerale'), w)
  assert.equal(findValueWindow(page, 'Via Roma 123, 00100 Roma', '', 60), null)
})

test('sanitizeFieldValue: campo DATA per testa di descrizione → solo date, mai testo', () => {
  const dec = { id: 'dec', label: 'Decorrenza', type: 'date', description: "Data di decorrenza (inizio) della copertura: la data 'Dal' del periodo più recente (es. 19/04/2026)." }
  assert.equal(sanitizeFieldValue(dec, 'Data di continuità: dalle ore 24.00 del'), null)
  assert.equal(sanitizeFieldValue(dec, '19/04/2026'), '19/04/2026')
  assert.equal(sanitizeFieldValue(dec, '19/04/26'), '19/04/2026')
})

test('valueWindows: tutte le occorrenze del valore (esatte e riordinate), così l\'etichetta negata si vede anche se non è la prima', async () => {
  const { valueWindows, normForMatch } = await import('../src/services/polizzaValidation.js')
  const doc = 'Reclami: lettera a DAS SpA - Via Enrico Fermi 9/B - 37135 Verona.\n…\nSede e Direzione Generale: 37135 Verona - Via Enrico Fermi, 9/B Aut. D.M.'
  const wins = valueWindows(doc, 'Via Enrico Fermi 9/B - 37135 Verona', 80)
  assert.ok(wins.length >= 2, String(wins.length))
  assert.ok(wins.some((w) => normForMatch(w).includes('sedeedirezionegenerale')))
})
