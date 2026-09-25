/**
 * Test del controllo di OPERATIVITÀ (parte PURA: pagine, prompt, risposta,
 * prova, decisione) e della sua integrazione in decidePrecheck.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  selectOperativitaPages, buildOperativitaPrompt, operativitaSchema, parseOperativitaAnswer,
  verifyOperativitaEvidence, decideOperativita, cutUseful, operativitaPageTag, OPERATIVITA_MIN_EVIDENCE,
  combineOperativitaBatches, OPERATIVITA_MAX_BATCHES, recognitionDistinctiveTokens, namesCoverage,
  pageHasAmount, recognitionCoverName, structuralCoverLines, lineHasCheck,
  buildContrattoPrompt, contrattoSchema, parseContrattoAnswer,
} from '../src/services/polizzaOperativita.js'
import { decidePrecheck, effectivePrecheckMode, degradeWithoutRecognition } from '../src/services/polizzaPrecheck.js'

const page = (ord, page, text, score) => ({ ord, page, text, flat: text.replace(/\s{2,}/g, ' '), score })

test('selectOperativitaPages: prime pagine per affinità, poi le altre, entro il budget, ordinate per documento', () => {
  const cands = [
    page(1, 1, 'FRONTESPIZIO polizza A '.repeat(5), 0.40),
    page(1, 2, 'condizioni generali A '.repeat(5), 0.80),
    page(2, 1, 'FRONTESPIZIO quietanza B '.repeat(5), 0.70),
    page(2, 3, 'tabella premi B tutela legale '.repeat(5), 0.90),
    page(3, 1, '', 0.99), // vuota: mai
  ]
  const budget = cands[0].text.length + cands[2].text.length + cands[3].text.length + 3
  const out = selectOperativitaPages(cands, { budgetChars: budget })
  // prime pagine (2.1 poi 1.1 per affinità), poi 2.3 (0.90) — 1.2 non entra
  assert.deepEqual(out.map((b) => `${b.ord}.${b.page}`), ['1.1', '2.1', '2.3'])
  // una sola pagina troppo grande entra TAGLIATA al budget
  const big = selectOperativitaPages([page(1, 1, 'riga uno\n'.repeat(100), 0.5)], { budgetChars: 30 })
  assert.equal(big.length, 1); assert.ok(big[0].cut); assert.ok(big[0].text.length <= 30)
  assert.equal(cutUseful('a  b   c', 100), 'a  b   c')
})

test('buildOperativitaPrompt: definizione dell\'utente, indizi, marcatori senza nome file', () => {
  const { system, user } = buildOperativitaPrompt({
    recognition: 'Polizza di tutela legale acquistata',
    contentKeywords: ['tutela legale'], contentExcludeKeywords: ['infortuni'],
    blocks: [{ ord: 2, page: 1, text: 'TUTELA LEGALE    premio 240,00' }],
  })
  assert.match(system, /JSON/)
  assert.match(user, /«Polizza di tutela legale acquistata»/)
  assert.match(user, /tutela legale/); assert.match(user, /infortuni/)
  assert.ok(user.includes(operativitaPageTag(2, 1)))
  assert.ok(user.includes('[Documento 2 · pag. 1]'))
  assert.ok(!/\.pdf/i.test(user))
  const schema = operativitaSchema()
  assert.deepEqual(schema.required, ['esito', 'documento', 'pagina', 'evidenza', 'motivo'])
  assert.deepEqual(schema.properties.esito.enum, ['operante', 'non operante', 'non determinabile'])
})

test('parseOperativitaAnswer: JSON sporco, grafie dell\'esito, documento/pagina', () => {
  const a = parseOperativitaAnswer('Ecco: {"esito":"NON_OPERANTE","documento":"Documento 3","pagina":"2","evidenza":" x ","motivo":"m"} fine')
  assert.equal(a.esito, 'non operante'); assert.equal(a.documento, 3); assert.equal(a.pagina, 2); assert.equal(a.evidenza, 'x')
  assert.equal(parseOperativitaAnswer('{"esito":"operante","documento":1,"pagina":0,"evidenza":"","motivo":""}').pagina, null)
  assert.equal(parseOperativitaAnswer('{"esito":"boh"}').esito, 'non determinabile')
  assert.equal(parseOperativitaAnswer('niente json'), null)
})

test('verifyOperativitaEvidence: pagina citata, altra pagina, per token, assente, troppo corta', () => {
  const blocks = [
    { ord: 1, page: 1, text: 'GARANZIE PRESTATE:   Tutela Legale   premio annuo € 240,00', flat: 'GARANZIE PRESTATE: Tutela Legale premio annuo € 240,00' },
    { ord: 2, page: 1, text: 'Helvetia Assistance [X]   Tutela legale della circolazione [ ]', flat: 'Helvetia Assistance [X] Tutela legale della circolazione [ ]' },
  ]
  const ok = verifyOperativitaEvidence({ documento: 1, pagina: 1, evidenza: 'Tutela Legale premio annuo € 240,00' }, blocks)
  assert.equal(ok.found, true); assert.equal(ok.where, 'citata')
  const other = verifyOperativitaEvidence({ documento: 1, pagina: 1, evidenza: 'Tutela legale della circolazione [ ]' }, blocks)
  assert.equal(other.found, true); assert.equal(other.where, 'altra pagina'); assert.equal(other.ord, 2)
  // riscritta dal modello ma con tutti i token nella pagina
  const tok = verifyOperativitaEvidence({ documento: 1, pagina: 1, evidenza: 'premio annuo 240,00 Tutela Legale garanzie prestate' }, blocks)
  assert.equal(tok.found, true)
  const no = verifyOperativitaEvidence({ documento: 1, pagina: 1, evidenza: 'Sezione incendio fabbricato attivata' }, blocks)
  assert.equal(no.found, false)
  const short = verifyOperativitaEvidence({ documento: 1, pagina: 1, evidenza: 'premio' }, blocks)
  assert.equal(short.found, false); assert.match(short.reason, /corta/)
  assert.ok(OPERATIVITA_MIN_EVIDENCE > 5)
})

test('decideOperativita: la tabella di decisione', () => {
  const found = { found: true, ord: 1, page: 1, reason: 'ok' }
  const missing = { found: false, ord: null, page: null, reason: 'prova citata non trovata nel testo inviato' }
  const op = (esito, motivo = 'perché') => ({ esito, documento: 1, pagina: 1, evidenza: 'una prova abbastanza lunga', motivo })
  assert.equal(decideOperativita({ answer: op('operante'), evidence: found }).verdict, 'ok')
  assert.equal(decideOperativita({ answer: op('operante'), evidence: found, excludeMatched: ['esclusa'] }).verdict, 'review')
  assert.equal(decideOperativita({ answer: op('operante'), evidence: missing }).verdict, 'review')
  const mm = decideOperativita({ answer: op('non operante'), evidence: found })
  assert.equal(mm.verdict, 'mismatch'); assert.match(mm.reason, /non operante: perché/)
  assert.equal(decideOperativita({ answer: op('non operante'), evidence: missing }).verdict, 'review')
  assert.equal(decideOperativita({ answer: op('non determinabile'), evidence: found }).verdict, 'review')
  assert.equal(decideOperativita({ error: 'Ollama giù' }).verdict, 'review')
  assert.equal(decideOperativita({ answer: null }).verdict, 'review')
  // la pagina della prova è quella VERIFICATA, non quella dichiarata
  const d = decideOperativita({ answer: { ...op('operante'), documento: 9, pagina: 9 }, evidence: { found: true, ord: 2, page: 3 } })
  assert.equal(d.documento, 2); assert.equal(d.pagina, 3)
})

test('decidePrecheck con operatività: il verdetto è quello del controllo; le parole da evitare non bloccano da sole', () => {
  const base = { mode: 'keywords', hasProfile: true, hasContentKeywords: true, hasRecognition: true, hasContentExclude: true, contentExclude: { matched: ['esclusa'] }, keyword: { ratio: 0 } }
  const ok = decidePrecheck({ ...base, operativita: { verdict: 'ok', reason: 'copertura operante' } })
  assert.equal(ok.verdict, 'ok'); assert.equal(ok.mode, 'operativita')
  assert.equal(decidePrecheck({ ...base, operativita: { verdict: 'review', reason: 'dubbio' } }).verdict, 'review')
  assert.equal(decidePrecheck({ ...base, operativita: null }).verdict, 'review', 'senza risultato mai accettato')
  // senza «Come riconoscerla» resta la regola storica: parola da evitare → mismatch
  assert.equal(decidePrecheck({ ...base, hasRecognition: false }).verdict, 'mismatch')
  // a switch 'off' l'operatività non gira (regole storiche)
  assert.equal(decidePrecheck({ ...base, mode: 'off', operativita: { verdict: 'ok', reason: 'x' } }).verdict, 'mismatch')
  // la validità "polizza vera" viene PRIMA (cartella senza polizza principale)
  const set = decidePrecheck({ ...base, hasPolicyEvidence: false, requireValidPolicy: true, operativita: { verdict: 'ok', reason: 'x' } })
  assert.equal(set.verdict, 'mismatch'); assert.equal(set.setAside, true)
})

test('effectivePrecheckMode: una sola regola per decisione e servizio (bug semantico + parole)', () => {
  assert.equal(effectivePrecheckMode('semantic', true), 'semantic')
  assert.equal(effectivePrecheckMode('off', true), 'keywords')
  assert.equal(effectivePrecheckMode('off', false), 'off')
  assert.equal(effectivePrecheckMode('keywords', false), 'semantic')
  assert.equal(effectivePrecheckMode('keywords', true), 'keywords')
  assert.equal(effectivePrecheckMode('llm', true), 'llm')
  // modo semantico + parole del profilo + classifica → verdetto vero, non skipped
  const rk = [{ id: 'a', name: 'A', score: 0.6 }, { id: 'b', name: 'B', score: 0.5 }]
  const d = decidePrecheck({ mode: 'semantic', hasProfile: true, hasContentKeywords: true, keyword: { ratio: 1 }, semanticRanking: rk, jobProfileId: 'b' })
  assert.equal(d.mode, 'semantic'); assert.equal(d.verdict, 'mismatch')
})

test('degradeWithoutRecognition: senza «Come riconoscerla» ok+suggerimento e skipped diventano da verificare', () => {
  const ok = { verdict: 'ok', mode: 'keywords', reason: 'parole trovate' }
  assert.equal(degradeWithoutRecognition(ok, { hasRecognition: false, mode: 'keywords', suggestion: { name: 'TL' } }).verdict, 'review')
  assert.equal(degradeWithoutRecognition(ok, { hasRecognition: false, mode: 'keywords', suggestion: null }).verdict, 'ok')
  assert.equal(degradeWithoutRecognition(ok, { hasRecognition: true, mode: 'keywords', suggestion: { name: 'TL' } }).verdict, 'ok')
  const sk = { verdict: 'skipped', mode: 'semantic', reason: 'classifica non disponibile' }
  const r = degradeWithoutRecognition(sk, { hasRecognition: false, mode: 'semantic' })
  assert.equal(r.verdict, 'review'); assert.match(r.reason, /Come riconoscerla/)
  assert.equal(degradeWithoutRecognition({ verdict: 'skipped', mode: 'off', reason: 'off' }, { hasRecognition: false, mode: 'off' }).verdict, 'skipped')
  assert.equal(degradeWithoutRecognition({ verdict: 'mismatch', mode: 'keywords', reason: 'x' }, { hasRecognition: false, mode: 'keywords' }).verdict, 'mismatch')
})

test('combineOperativitaBatches: un batch operante basta; tutti non operanti → mismatch; altrimenti review', () => {
  const ok = { verdict: 'ok', reason: 'copertura operante', esito: 'operante' }
  const mm = { verdict: 'mismatch', reason: 'copertura non operante: x', esito: 'non operante' }
  const rv = { verdict: 'review', reason: 'copertura non determinabile', esito: 'non determinabile' }
  assert.equal(combineOperativitaBatches([ok]).verdict, 'ok')
  assert.equal(combineOperativitaBatches([ok, mm]).verdict, 'ok', 'operante sulle pagine più forti: i batch dopo non lo smentiscono')
  assert.equal(combineOperativitaBatches([rv, ok]).verdict, 'ok', 'un dubbio prima non contraddice')
  const contra = combineOperativitaBatches([mm, mm, ok])
  assert.equal(contra.verdict, 'review', 'operante tardivo dopo «non operante» provato = dubbio (CAMPESTRE)')
  assert.match(contra.reason, /contraddittori/)
  assert.equal(contra.batches, 3)
  assert.equal(combineOperativitaBatches([mm, mm]).verdict, 'mismatch')
  assert.match(combineOperativitaBatches([mm, mm]).reason, /2 batch/)
  assert.equal(combineOperativitaBatches([mm]).reason, mm.reason)
  assert.equal(combineOperativitaBatches([mm, rv]).verdict, 'review')
  assert.equal(combineOperativitaBatches([rv, mm]).verdict, 'review')
  assert.equal(combineOperativitaBatches([]).verdict, 'review')
  assert.equal(combineOperativitaBatches([ok, mm]).batches, 2)
  assert.ok(OPERATIVITA_MAX_BATCHES >= 2)
})

test('combineOperativitaBatches: «non operante» senza prova ritrovata non contraddice i «non operante» provati (ALZAIA 104)', () => {
  const mm = { verdict: 'mismatch', reason: 'copertura non operante: x', esito: 'non operante' }
  const noProof = { verdict: 'review', reason: 'copertura dichiarata non operante ma la prova citata non è nel testo (prova troppo corta)', esito: 'non operante' }
  const undet = { verdict: 'review', reason: 'copertura non determinabile', esito: 'non determinabile' }
  const r = combineOperativitaBatches([mm, noProof, mm, mm, mm, mm])
  assert.equal(r.verdict, 'mismatch')
  assert.match(r.reason, /5 con prova, 1 con prova non ritrovata/)
  assert.equal(combineOperativitaBatches([noProof, noProof]).verdict, 'review', 'nessuna prova trovata: resta un dubbio')
  assert.equal(combineOperativitaBatches([mm, undet]).verdict, 'review', '«non determinabile» resta un dubbio')
  assert.equal(combineOperativitaBatches([mm, noProof], { unreadNamed: 2 }).verdict, 'review', 'pagine che nominano la copertura non lette')
})

const PROFILES = [
  { id: 'tl', recognition: 'Polizza o sezione di TUTELA LEGALE effettivamente ACQUISTATA dal contraente: un prodotto autonomo (es. DAS, ARAG) oppure una sezione "Tutela legale" operante. NON lo è: una RC professionale.' },
  { id: 'rc', recognition: 'Polizza di RESPONSABILITÀ CIVILE PROFESSIONALE effettivamente ACQUISTATA: copre i danni a terzi. NON lo è: una tutela legale.' },
  { id: 'rct', recognition: "Polizza di RESPONSABILITÀ CIVILE VERSO TERZI (RCT) e VERSO PRESTATORI DI LAVORO (RCO) di un'azienda, effettivamente ACQUISTATA: copre i danni. NON lo è: una tutela legale." },
]

test('recognitionDistinctiveTokens: dalla TESTA di «Come riconoscerla», frequenza inversa sugli altri profili', () => {
  const tl = recognitionDistinctiveTokens(PROFILES, 'tl')
  assert.ok(tl.includes('tutela') && tl.includes('legale'), tl.join(','))
  assert.ok(!tl.includes('polizza') && !tl.includes('acquistata'), 'parole comuni a tutte le teste non distinguono')
  const rc = recognitionDistinctiveTokens(PROFILES, 'rc')
  assert.ok(rc.includes('professionale'), rc.join(','))
  assert.ok(!rc.includes('tutela'), 'il "NON lo è" non è nella testa')
  assert.deepEqual(recognitionDistinctiveTokens(PROFILES, 'assente'), [])
  assert.deepEqual(recognitionDistinctiveTokens([{ id: 'x', recognition: '' }], 'x'), [])
  // profilo SOLO: niente frequenza inversa → tutta la testa
  const solo = recognitionDistinctiveTokens([PROFILES[0]], 'tl')
  assert.ok(solo.includes('tutela') && solo.includes('legale'), solo.join(','))
  // testi REALI delle bozze: niente parole nate dagli apostrofi/virgolette lunghe ("oppure", "assistenza")
  const real = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
  const tlReal = real.find((p) => p.name === 'Tutela Legale 3')
  const rt = recognitionDistinctiveTokens(real, tlReal.id)
  assert.ok(rt.includes('tutela') && rt.includes('legale'), rt.join(','))
  assert.ok(!rt.includes('oppure') && !rt.includes('assistenza'), rt.join(','))
  for (const p of real) assert.ok(recognitionDistinctiveTokens(real, p.id).length > 0, `nessuna parola distintiva per ${p.name}`)
})

test('recognitionCoverName: la frase di parole distintive consecutive della testa', () => {
  assert.deepEqual(recognitionCoverName(PROFILES, 'tl'), [['tutela', 'legale']])
  assert.deepEqual(recognitionCoverName(PROFILES, 'rc'), [['professionale']])
  assert.deepEqual(recognitionCoverName(PROFILES, 'nope'), [])
  const real = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
  const names = Object.fromEntries(real.map((p) => [p.name, recognitionCoverName(real, p.id).map((r) => r.join(' '))]))
  assert.deepEqual(names['Tutela Legale 3'], ['tutela legale', 'tutela giudiziaria'], 'TUTELA LEGALE / TUTELA GIUDIZIARIA = due nomi (Allianz «Tutela Giudiziaria SI»)')
  assert.deepEqual(names['RC PROF MED V2'], ['medica', 'sanitaria'], 'MEDICA / SANITARIA = due nomi alternativi')
  assert.ok(names['CSA RCT-RCO completo'].includes('verso terzi'), names['CSA RCT-RCO completo'].join('|'))
  for (const p of real) assert.ok(names[p.name].length > 0, `nome non determinabile per ${p.name}`)
  assert.equal(namesCoverage('RC professionale medica per medici', [['medica'], ['sanitaria']]), true)
  assert.equal(namesCoverage('assicurazione fabbricati', [['medica'], ['sanitaria']]), false)
  // riga strutturale: nome + importo/spunta sulla stessa riga
  const nm = [['tutela', 'legale']]
  assert.equal(structuralCoverLines('TUTELA LEGALE            Imponibile annuo       € 249,06', nm).length, 1)
  assert.equal(structuralCoverLines('Tutela Legale               ESCLUSA          31.000,00', nm).length, 1)
  assert.equal(structuralCoverLines('Tutela Legale  240,00  42,06  21,25  30/10/2015', nm).length, 1)
  assert.equal(structuralCoverLines('X Tutela Legale', nm).length, 1)
  assert.equal(structuralCoverLines('TUTELA LEGALE  (opzionale)\nScoperto: 10% con il minimo di 500,00 euro', nm).length, 0, 'opzione senza importo sulla riga')
  assert.equal(structuralCoverLines('Sezione D - Tutela Legale premessa', nm).length, 0)
  assert.equal(structuralCoverLines('qualsiasi 1,00', []), null)
  assert.equal(lineHasCheck('[x] Tutela legale'), true); assert.equal(lineHasCheck('XL Tutela'), false)
})

test('namesCoverage + selectOperativitaPages: le pagine che nominano la copertura vanno PRIMA (BOIARDO pag. 3)', () => {
  const tokens = recognitionCoverName(PROFILES, 'tl')
  assert.equal(namesCoverage('SEZIONE TUTELA LEGALE  Imponibile annuo € 249,06  Somma Assicurata € 30.000,00', tokens), true)
  assert.equal(namesCoverage('Ogni garanzia opera secondo i termini e le condizioni riportati nelle apposite sezioni', tokens), false)
  assert.equal(namesCoverage('qualsiasi', []), null)
  const cands = [
    page(2, 1, 'CONDIZIONI DI ASSICURAZIONE fabbricati '.repeat(4), 0.53),
    page(2, 9, 'norme generali sinistri e premi '.repeat(4), 0.64),
    page(3, 1, 'POLIZZA FABBRICATI CONDOMINIO BOIARDO 18 frontespizio '.repeat(3), 0.49),
    page(3, 3, 'SEZIONE TUTELA LEGALE  Imponibile annuo € 249,06  Somma Assicurata € 30.000,00 '.repeat(2), 0.45),
  ]
  const big = cands.reduce((n, c) => n + c.text.length, 0) + 10
  const out = selectOperativitaPages(cands, { budgetChars: big, lexTokens: tokens })
  assert.ok(out.find((b) => b.ord === 3 && b.page === 3)?.lex === true)
  // budget stretto: entra PRIMA la pagina che nomina la copertura, anche con affinità più bassa
  const tight = selectOperativitaPages(cands, { budgetChars: cands[3].text.length + 2, lexTokens: tokens })
  assert.deepEqual(tight.map((b) => `${b.ord}.${b.page}`), ['3.3'])
  // senza parole distintive: ordine storico (prime pagine per affinità: 2.1 a 0.53 batte 3.1 a 0.49)
  const hist = selectOperativitaPages(cands, { budgetChars: cands[0].text.length + 2 })
  assert.deepEqual(hist.map((b) => `${b.ord}.${b.page}`), ['2.1'])
})

test('decideOperativita: prova GENERICA per "operante" → da verificare (CAMPESTRE RINNOVO)', () => {
  const tokens = recognitionCoverName(PROFILES, 'tl')
  const blocks = [{ ord: 2, page: 24, text: 'Ogni garanzia opera secondo i termini e le condizioni riportati nelle apposite sezioni, con propri limiti, Franchigie ed esclusioni.', flat: '' }]
  const ans = { esito: 'operante', documento: 2, pagina: 24, evidenza: 'Ogni garanzia opera secondo i termini e le condizioni riportati nelle apposite sezioni, con propri limiti', motivo: 'm' }
  const ev = verifyOperativitaEvidence(ans, blocks, { lexTokens: tokens })
  assert.equal(ev.found, true); assert.equal(ev.names, false)
  const d = decideOperativita({ answer: ans, evidence: ev })
  assert.equal(d.verdict, 'review'); assert.match(d.reason, /generica/)
  // la stessa prova che NOMINA la copertura passa
  const blocks2 = [{ ord: 3, page: 3, text: 'SEZIONE TUTELA LEGALE  Imponibile annuo € 249,06', flat: '' }]
  const ans2 = { esito: 'operante', documento: 3, pagina: 3, evidenza: 'SEZIONE TUTELA LEGALE Imponibile annuo € 249,06', motivo: 'm' }
  const ev2 = verifyOperativitaEvidence(ans2, blocks2, { lexTokens: tokens })
  assert.equal(ev2.names, true)
  assert.equal(decideOperativita({ answer: ans2, evidence: ev2 }).verdict, 'ok')
  // senza parole distintive (names null) nessun blocco lessicale
  const ev3 = verifyOperativitaEvidence(ans, blocks, {})
  assert.equal(ev3.names, null)
  assert.equal(decideOperativita({ answer: ans, evidence: ev3 }).verdict, 'ok')
  // per "non operante" la prova non deve nominare nulla
  const ev4 = verifyOperativitaEvidence({ ...ans, esito: 'non operante' }, blocks, { lexTokens: tokens })
  assert.equal(decideOperativita({ answer: { ...ans, esito: 'non operante' }, evidence: ev4 }).verdict, 'mismatch')
})

test('selectOperativitaPages: pagine che nominano la copertura CON importi prima della prosa; batch pieno → ci si ferma', () => {
  const tokens = recognitionCoverName(PROFILES, 'tl')
  assert.equal(pageHasAmount('TUTELA LEGALE Imponibile annuo € 249,06'), true)
  assert.equal(pageHasAmount('Somma Assicurata € 30.000,00'), true)
  assert.equal(pageHasAmount('Sezione D - Tutela Legale: premessa, art. 6.1 oggetto'), false)
  assert.equal(pageHasAmount('pag. 12 di 44 art. 6.7'), false)
  const cands = [
    page(2, 6, 'Sezione D - Tutela Legale premessa oggetto '.repeat(6), 0.63),   // prosa, affinità alta
    page(2, 39, 'tutela legale ambito e garanzie '.repeat(6), 0.62),              // prosa
    page(3, 3, 'SEZIONE TUTELA LEGALE Imponibile annuo € 249,06 Somma Assicurata € 30.000,00 '.repeat(2), 0.49), // scheda, affinità bassa
    page(3, 1, 'POLIZZA Numero 212.044 Agenzia frontespizio '.repeat(3), 0.48),
  ]
  const one = selectOperativitaPages(cands, { budgetChars: cands[2].text.length + 2, lexTokens: tokens })
  assert.deepEqual(one.map((b) => `${b.ord}.${b.page}`), ['3.3'], 'la scheda con importi entra per prima')
  assert.equal(one[0].amount, true)
  // batch pieno: NON si salta alla pagina più corta successiva
  const two = selectOperativitaPages(cands, { budgetChars: cands[2].text.length + cands[0].text.length - 5, lexTokens: tokens })
  assert.deepEqual(two.map((b) => `${b.ord}.${b.page}`), ['3.3'], 'con 2.6 che non entra ci si ferma: aprirà il batch dopo')
  // batch successivo (senza 3.3): riparte da 2.6
  const next = selectOperativitaPages(cands.filter((c) => !(c.ord === 3 && c.page === 3)), { budgetChars: cands[0].text.length + 2, lexTokens: tokens })
  assert.deepEqual(next.map((b) => `${b.ord}.${b.page}`), ['2.6'])
})


test('decideOperativita: "operante" con prova su pagina SENZA riga copertura+importo → da verificare (CAMPESTRE DIP)', () => {
  const nm = recognitionCoverName(PROFILES, 'tl')
  assert.deepEqual(nm, [['tutela', 'legale']])
  const dip = { ord: 1, page: 5, text: 'OPZIONI CON PAGAMENTO DI UN PREMIO AGGIUNTIVO\nEventi atmosferici 20.000,00 Scoperto 10% minimo 500,00 euro\nTUTELA LEGALE  (opzionale)\nINFORTUNI (opzionale)' }
  const ans = { esito: 'operante', documento: 1, pagina: 5, evidenza: 'TUTELA LEGALE  (opzionale)', motivo: 'premio aggiuntivo' }
  const ev = verifyOperativitaEvidence(ans, [dip], { lexTokens: nm })
  assert.equal(ev.found, true); assert.equal(ev.names, true); assert.equal(ev.structural, false)
  const d = decideOperativita({ answer: ans, evidence: ev })
  assert.equal(d.verdict, 'review'); assert.match(d.reason, /premio, importo o spunta/)
  // la scheda: riga con nome e importo → ok
  const scheda = { ord: 3, page: 3, text: 'SEZIONE TUTELA LEGALE\nTUTELA LEGALE            Imponibile annuo       € 249,06\nSomma Assicurata € 30.000,00' }
  const ans2 = { esito: 'operante', documento: 3, pagina: 3, evidenza: 'TUTELA LEGALE Imponibile annuo € 249,06', motivo: 'm' }
  const ev2 = verifyOperativitaEvidence(ans2, [scheda], { lexTokens: nm })
  assert.equal(ev2.structural, true)
  assert.equal(decideOperativita({ answer: ans2, evidence: ev2 }).verdict, 'ok')
  // ordine: la pagina strutturale entra per prima anche con affinità più bassa
  const cands = [page(1, 7, 'condizioni generali di tutela legale: premessa\nspese fino a 240,00 per sinistro\n'.repeat(3), 0.65), page(1, 1, 'ARAG Tutela Legale Impresa\nTutela Legale  240,00  42,06 '.repeat(2), 0.61)]
  const one = selectOperativitaPages(cands, { budgetChars: cands[1].text.length + 2, lexTokens: nm })
  assert.deepEqual(one.map((b) => `${b.ord}.${b.page}`), ['1.1']); assert.equal(one[0].structural, true)
  // batch di SOLE pagine strutturali anche se il budget ne farebbe entrare altre
  const only = selectOperativitaPages(cands, { budgetChars: 100000, lexTokens: nm })
  assert.deepEqual(only.map((b) => `${b.ord}.${b.page}`), ['1.1'])
  // esaurite le strutturali, il batch dopo prende il resto
  const next = selectOperativitaPages(cands.filter((c) => c.page !== 1), { budgetChars: 100000, lexTokens: nm })
  assert.deepEqual(next.map((b) => `${b.ord}.${b.page}`), ['1.7'])
})

test('sole quietanze: operante senza contratto visto → accantonata (forzabile); con contratto → ok', () => {
  const okQ = { verdict: 'ok', reason: 'copertura operante', esito: 'operante', contratto: 'assente', evidenza: 'Tutela Legale ESCLUSA 31.000,00', motivo: 'premio 746' }
  const okC = { verdict: 'ok', reason: 'copertura operante', esito: 'operante', contratto: 'presente', evidenza: 'TUTELA LEGALE Imponibile annuo € 249,06' }
  const mmQ = { verdict: 'mismatch', reason: 'copertura non operante', esito: 'non operante', contratto: 'assente' }
  const sa = combineOperativitaBatches([okQ])
  assert.equal(sa.verdict, 'setaside'); assert.match(sa.reason, /sole quietanze|senza polizza principale/)
  assert.equal(combineOperativitaBatches([okC]).verdict, 'ok')
  assert.equal(combineOperativitaBatches([okQ, { ...mmQ, contratto: 'presente' }]).verdict, 'ok', 'il contratto visto in un batch successivo sblocca')
  assert.equal(combineOperativitaBatches([okQ, { verdict: 'review', reason: 'x', contratto: 'non determinabile' }]).verdict, 'ok', 'non determinabile non accantona')
  assert.equal(combineOperativitaBatches([mmQ]).verdict, 'mismatch', 'non operante resta non operante')
  // decidePrecheck: setaside → mismatch + setAside (stato «Accantonato», Procedi comunque)
  const d = decidePrecheck({ mode: 'semantic', hasProfile: true, hasRecognition: true, operativita: sa })
  assert.equal(d.verdict, 'mismatch'); assert.equal(d.setAside, true); assert.equal(d.mode, 'operativita')
  // batch con «operante» ma domanda sul contratto non fatta ai batch precedenti: contano solo le risposte date
  assert.equal(combineOperativitaBatches([okQ, { ...mmQ, contratto: undefined }]).verdict, 'setaside')
  assert.equal(combineOperativitaBatches([{ verdict: 'review', reason: 'x' }, { ...okC, contratto: 'non determinabile' }]).verdict, 'ok')
  // domanda separata sul contratto: prompt, schema, parser
  const cq = buildContrattoPrompt({ blocks: [{ ord: 1, page: 1, text: 'QUIETANZA DI PAGAMENTO DEL PREMIO Polizza n. 0146905119' }] })
  assert.match(cq.user, /CONTRATTO vero e proprio/); assert.ok(cq.user.includes('[Documento 1 · pag. 1]'))
  assert.deepEqual(contrattoSchema().required, ['contratto', 'documento', 'pagina', 'motivo'])
  assert.deepEqual(parseContrattoAnswer('{"contratto":"ASSENTE","documento":"Documento 1","pagina":1,"motivo":"solo quietanza"}'), { contratto: 'assente', documento: 1, pagina: 1, motivo: 'solo quietanza' })
  assert.equal(parseContrattoAnswer('{"contratto":"boh"}').contratto, 'non determinabile')
  assert.equal(parseContrattoAnswer('niente'), null)
  // il prompt di operatività NON contiene la domanda sul contratto (misurato: la ribaltava)
  assert.ok(!/CONTRATTO/.test(buildOperativitaPrompt({ recognition: 'x', blocks: [] }).user))
})
