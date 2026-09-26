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
  recognitionAllowsSection, lineHasNonZeroAmount, coverNeverNamed,
  pageHasAmount, recognitionCoverName, structuralCoverLines, lineHasCheck,
  buildContrattoPrompt, contrattoSchema, parseContrattoAnswer,
  selectContrattoPages, decideContract, applyContractVerdict, operativitaVerdictLabel, checkContractAnswer,
  namesCoverageAnyForm, pageNamesCoverage,
} from '../src/services/polizzaOperativita.js'
import { isQuestionnairePageTitle, isQuestionnaireTitle } from '../src/services/polizzaFactsRegistry.js'
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
  // il filtro a parole «polizza vera» NON decide più (LUCCA: «Certificato N°» senza
  // «polizza n.»/«contraente»): decide la domanda sul contratto al modello (26/09/2026)
  const withOp = decidePrecheck({ ...base, hasPolicyEvidence: false, requireValidPolicy: true, operativita: { verdict: 'ok', reason: 'x' } })
  assert.equal(withOp.verdict, 'ok')
  const noRecog = decidePrecheck({ ...base, hasRecognition: false, contentExclude: null, hasPolicyEvidence: false, requireValidPolicy: true, keyword: { ratio: 1 } })
  assert.equal(noRecog.verdict, 'ok', 'la regex non ferma più nulla: senza contratto «assente» si prosegue')
  assert.ok(!noRecog.setAside && !noRecog.notValid)
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
  // Regola (a) (utente, 26/09/2026): un «non determinabile» non contraddice un
  // «non operante» provato dal contratto (le pagine meno affini, senza la copertura)
  assert.equal(combineOperativitaBatches([mm, rv]).verdict, 'mismatch')
  assert.equal(combineOperativitaBatches([rv, mm]).verdict, 'mismatch')
  assert.equal(combineOperativitaBatches([{ ...mm, formEvidence: true }, rv]).verdict, 'review', 'il solo «no» del questionario non basta')
  assert.equal(combineOperativitaBatches([rv, rv]).verdict, 'review')
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
  assert.match(r.reason, /5 «non operante» con prova, 1 con prova non ritrovata/)
  assert.equal(combineOperativitaBatches([noProof, noProof]).verdict, 'review', 'nessuna prova trovata: resta un dubbio')
  assert.equal(combineOperativitaBatches([mm, undet]).verdict, 'mismatch', 'regola (a): «non determinabile» accanto a un «no» provato dal contratto')
  assert.match(combineOperativitaBatches([mm, undet]).reason, /1 «non determinabile»/)
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

test('nessuna polizza → NON VALIDO su qualunque esito di operatività, mai forzabile (ALZAIA 101, 26/09/2026)', () => {
  const okOp = { verdict: 'ok', reason: 'copertura operante', esito: 'operante', evidenza: 'Tutela Legale ESCLUSA 31.000,00', motivo: 'premio 746' }
  const reviewOp = { verdict: 'review', reason: 'copertura dichiarata non operante ma la prova è la riga della copertura con un suo importo: dato contraddittorio', esito: 'non operante', evidenceFound: true }
  const mmNoProof = { verdict: 'review', reason: 'copertura dichiarata non operante ma la prova citata non è nel testo', esito: 'non operante', evidenceFound: false }
  const mmOp = { verdict: 'mismatch', reason: 'copertura non operante', esito: 'non operante', evidenceFound: true }
  const quietanza = { contratto: 'assente', documento: 1, pagina: 1, motivo: 'solo una quietanza di pagamento del premio' }
  const absent = decideContract([quietanza])
  assert.equal(absent.esito, 'assente')
  assert.match(absent.reason, /nessuna polizza/)
  assert.match(absent.reason, /quietanza di pagamento/, 'il motivo dice cosa c\'è al posto della polizza')
  // il caso vero: operatività contraddittoria (review) + contratto assente → Non valido
  for (const op of [reviewOp, mmNoProof, mmOp, okOp]) {
    const r = applyContractVerdict(combineOperativitaBatches([op]), absent)
    assert.equal(r.verdict, 'setaside', `${op.verdict}/${op.esito}`)
    assert.equal(r.notValid, true)
    assert.equal(r.operativitaVerdict, combineOperativitaBatches([op]).verdict)
    assert.equal(r.polizza.esito, 'assente')
    const d = decidePrecheck({ mode: 'llm', hasProfile: true, hasRecognition: true, operativita: r })
    assert.equal(d.verdict, 'mismatch'); assert.equal(d.notValid, true); assert.equal(d.mode, 'operativita')
    assert.match(d.reason, /nessuna polizza/)
  }
  // contratto visto (anche in un batch dopo) → l'esito di operatività resta
  const seen = decideContract([quietanza, { contratto: 'presente', documento: 2, pagina: 1, motivo: 'frontespizio di polizza' }])
  assert.equal(seen.esito, 'presente'); assert.equal(seen.documento, 2)
  assert.equal(applyContractVerdict(okOp, seen).verdict, 'ok')
  assert.equal(applyContractVerdict(reviewOp, seen).verdict, 'review')
  assert.equal(applyContractVerdict(mmOp, seen).verdict, 'mismatch')
  // la presenza della polizza non si decide più in combineOperativitaBatches
  assert.equal(combineOperativitaBatches([{ ...okOp, contratto: 'assente' }]).verdict, 'ok')
  // domanda separata sul contratto: prompt, schema, parser (invariati, misurati il 22/09)
  const cq = buildContrattoPrompt({ blocks: [{ ord: 1, page: 1, text: 'QUIETANZA DI PAGAMENTO DEL PREMIO Polizza n. 0146905119' }] })
  assert.match(cq.user, /CONTRATTO vero e proprio/); assert.ok(cq.user.includes('[Documento 1 · pag. 1]'))
  assert.deepEqual(contrattoSchema().required, ['contratto', 'documento', 'pagina', 'motivo'])
  assert.deepEqual(parseContrattoAnswer('{"contratto":"ASSENTE","documento":"Documento 1","pagina":1,"motivo":"solo quietanza"}'), { contratto: 'assente', documento: 1, pagina: 1, motivo: 'solo quietanza' })
  assert.equal(parseContrattoAnswer('{"contratto":"boh"}').contratto, 'non determinabile')
  assert.equal(parseContrattoAnswer('niente'), null)
  // il prompt di operatività NON contiene la domanda sul contratto (misurato: la ribaltava)
  assert.ok(!/CONTRATTO/.test(buildOperativitaPrompt({ recognition: 'x', blocks: [] }).user))
})

test('decideContract: «assente» solo se TUTTI i batch lo dicono e nessuna pagina è rimasta fuori; il resto è «polizza non vista»', () => {
  const nd = { contratto: 'non determinabile', documento: null, pagina: null, motivo: 'pagine poco leggibili' }
  const ab = { contratto: 'assente', documento: null, pagina: null, motivo: 'solo quietanze' }
  const onlyNd = decideContract([nd, nd, null])
  assert.equal(onlyNd.esito, 'non determinabile', 'solo non determinabile (o illeggibile): nessun Non valido')
  assert.equal(onlyNd.asked, 3)
  // risposte MISTE: un «assente» accanto a un «non determinabile» (la scheda
  // letta male) o a una risposta illeggibile (JSON troncato) NON è assente
  const mixed = decideContract([ab, nd])
  assert.equal(mixed.esito, 'non determinabile'); assert.match(mixed.reason, /1 su 2 risposte «assente»/)
  assert.equal(decideContract([nd, ab]).esito, 'non determinabile')
  assert.equal(decideContract([ab, null]).esito, 'non determinabile', 'risposta illeggibile = incerta')
  assert.equal(decideContract([ab, ab]).esito, 'assente')
  // assente: documento e pagina azzerati («Assente — Documento 1 pag. 1» sembrava dire dove sta la polizza)
  const a = decideContract([{ ...ab, documento: 1, pagina: 1 }])
  assert.equal(a.esito, 'assente'); assert.equal(a.documento, null); assert.equal(a.pagina, null)
  // senza motivo del modello, testo neutro (nessuna ipotesi del codice sul tipo di documento)
  assert.match(decideContract([{ contratto: 'assente', motivo: '' }]).reason, /il modello non ha visto un contratto/)
  // «polizza non vista» su un ok → dubbio; su un blocco resta il blocco, con la nota
  const reviewOp = { verdict: 'review', reason: 'dubbio', esito: 'non operante' }
  assert.equal(applyContractVerdict(reviewOp, onlyNd).verdict, 'review', 'resta l\'esito dell\'operatività')
  const okNd = applyContractVerdict({ verdict: 'ok', reason: 'copertura operante' }, onlyNd)
  assert.equal(okNd.verdict, 'review'); assert.equal(okNd.operativitaVerdict, 'ok')
  assert.match(okNd.reason, /polizza non vista dal modello \(non determinabile\)/)
  // pagine mai mostrate (tetto dei batch) o documento senza testo: niente Non valido
  const unread = decideContract([ab], { unreadPages: 2 })
  assert.equal(unread.esito, 'non verificata'); assert.match(unread.reason, /2 pagine non sono state mostrate/)
  const noText = decideContract([ab], { docsWithoutText: 1 })
  assert.equal(noText.esito, 'non verificata'); assert.match(noText.reason, /senza testo/)
  assert.equal(applyContractVerdict({ verdict: 'ok', reason: 'copertura operante' }, unread).verdict, 'review')
  const mmUnread = applyContractVerdict({ verdict: 'mismatch', reason: 'non operante' }, unread)
  assert.equal(mmUnread.verdict, 'mismatch'); assert.match(mmUnread.reason, /polizza non vista dal modello/)
  // nessuna risposta (nessun batch) → non verificata, mai assente
  assert.equal(decideContract([]).esito, 'non verificata')
  // decidePrecheck: guasto della domanda → review su ok/skipped, mai Non valido
  const guasto = { esito: 'non verificata', reason: 'controllo della polizza non eseguibile: Ollama giù', error: true }
  const d = decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: { ratio: 1 }, contract: guasto })
  assert.equal(d.verdict, 'review'); assert.ok(!d.notValid); assert.match(d.reason, /non verificata/)
  assert.equal(decidePrecheck({ mode: 'off', hasProfile: true, contract: guasto }).verdict, 'review')
  assert.equal(decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: { ratio: 0 }, contract: guasto }).verdict, 'mismatch', 'un blocco resta un blocco (forzabile)')
})

test('checkContractAnswer: un «presente» vale solo se cita un documento/pagina MOSTRATI in quel batch', () => {
  const blocks = [{ ord: 1, page: 1 }, { ord: 1, page: 2 }, { ord: 3, page: 1 }]
  const yes = (documento, pagina) => ({ contratto: 'presente', documento, pagina, motivo: 'frontespizio' })
  assert.equal(checkContractAnswer(yes(1, 2), blocks).contratto, 'presente')
  assert.equal(checkContractAnswer(yes(3, null), blocks).contratto, 'presente', 'senza pagina basta il documento')
  const outDoc = checkContractAnswer(yes(2, 1), blocks)
  assert.equal(outDoc.contratto, 'non determinabile'); assert.equal(outDoc.citedOutside, true)
  assert.match(outDoc.motivo, /Documento 2 pag\. 1, che non è tra le pagine mostrate/)
  assert.equal(checkContractAnswer(yes(1, 5), blocks).contratto, 'non determinabile', 'pagina non mostrata')
  assert.equal(checkContractAnswer(yes(null, null), blocks).contratto, 'non determinabile', 'nessun documento citato')
  // assente / non determinabile: documento e pagina azzerati
  const no = checkContractAnswer({ contratto: 'assente', documento: 1, pagina: 1, motivo: 'solo quietanza' }, blocks)
  assert.deepEqual(no, { contratto: 'assente', documento: null, pagina: null, motivo: 'solo quietanza' })
  assert.equal(checkContractAnswer(null, blocks), null)
  // un «presente» citato fuori non fa Non valido insieme agli «assente» degli altri batch
  assert.equal(decideContract([{ contratto: 'assente', motivo: 'x' }, checkContractAnswer(yes(9, 9), blocks)]).esito, 'non determinabile')
})

test('decidePrecheck: contratto «assente» vince su TUTTO (ok, non pertinente, da verificare, parole da evitare, pre-controllo spento)', () => {
  const absent = { esito: 'assente', reason: 'nessuna polizza tra i documenti letti: solo quietanze', documento: 1, pagina: 1, motivo: 'solo quietanze' }
  const cases = [
    { mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: { ratio: 1 } },
    { mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: { ratio: 0 } },
    { mode: 'keywords', hasProfile: true, hasContentExclude: true, contentExclude: { matched: ['vita'] } },
    { mode: 'off', hasProfile: true },
    { mode: 'semantic', hasProfile: false },
    { mode: 'llm', hasProfile: true, hasRecognition: true, operativita: { verdict: 'ok', reason: 'copertura operante' } },
    { mode: 'llm', hasProfile: true, hasRecognition: true, operativita: { verdict: 'review', reason: 'dubbio' } },
  ]
  for (const c of cases) {
    const d = decidePrecheck({ ...c, contract: absent })
    assert.equal(d.verdict, 'mismatch', JSON.stringify(c))
    assert.equal(d.notValid, true)
    assert.equal(d.polizza.esito, 'assente')
    assert.match(d.reason, /nessuna polizza/)
  }
  // contratto presente: la decisione è quella di sempre, con la polizza allegata
  const ok = decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: { ratio: 1 }, contract: { esito: 'presente', reason: 'polizza presente' } })
  assert.equal(ok.verdict, 'ok'); assert.equal(ok.polizza.esito, 'presente'); assert.ok(!ok.notValid)
})

test('selectContrattoPages: prima le PRIME pagine di ogni documento, poi le altre; batch pieno → ci si ferma', () => {
  const pg = (ord, page, n = 100, first) => ({ ord, page, text: 'x'.repeat(n), ...(first !== undefined ? { first } : {}) })
  const cands = [pg(1, 2), pg(2, 3), pg(1, 1), pg(3, 1), pg(2, 1)]
  const all = selectContrattoPages(cands, { budgetChars: 100000 })
  assert.deepEqual(all.map((b) => `${b.ord}.${b.page}`), ['1.1', '1.2', '2.1', '2.3', '3.1'], 'ordinate per documento e pagina')
  // budget per tre pagine: entrano le tre prime pagine, non la pagina 2 del documento 1
  const three = selectContrattoPages(cands, { budgetChars: 320 })
  assert.deepEqual(three.map((b) => `${b.ord}.${b.page}`), ['1.1', '2.1', '3.1'])
  // «prima pagina» = la prima CON TESTO quando i candidati lo marcano (copertina scansionata vuota)
  const marked = [pg(1, 2, 100, true), pg(1, 3, 100, false), pg(2, 1, 100, true)]
  assert.deepEqual(selectContrattoPages(marked, { budgetChars: 210 }).map((b) => `${b.ord}.${b.page}`), ['1.2', '2.1'])
  // la prima pagina entra sempre, tagliata al budget
  const cut = selectContrattoPages([pg(1, 1, 5000)], { budgetChars: 200 })
  assert.equal(cut.length, 1); assert.ok(cut[0].cut)
  assert.equal(operativitaVerdictLabel('setaside'), 'non valido')
})

test('recognitionAllowsSection: la riga strutturale serve solo se la definizione ammette una SEZIONE', () => {
  assert.equal(recognitionAllowsSection('Polizza o sezione di TUTELA LEGALE effettivamente ACQUISTATA: …'), true)
  assert.equal(recognitionAllowsSection('Polizza di RESPONSABILITÀ CIVILE PROFESSIONALE effettivamente ACQUISTATA: una sezione …'), false, 'conta solo la testa, prima dei due punti')
  assert.equal(recognitionAllowsSection(''), false)
})

test('decideOperativita: senza riga strutturale va bene se la copertura è il prodotto; la riga della copertura con importo contraddice un «non operante»', () => {
  const op = { esito: 'operante', evidenza: 'Tipo di contratto: Responsabilità Civile Professionale', documento: 1, pagina: 1 }
  const ev = { found: true, names: true, structural: false, ord: 1, page: 1 }
  assert.equal(decideOperativita({ answer: op, evidence: ev }).verdict, 'review', 'default: riga strutturale richiesta')
  assert.equal(decideOperativita({ answer: op, evidence: ev, requireStructural: false }).verdict, 'ok')
  const no = { esito: 'non operante', evidenza: 'Tutela Legale ESCLUSA 31.000,00', documento: 1, pagina: 1 }
  assert.equal(decideOperativita({ answer: no, evidence: { found: true, names: true, structural: true, proofIsCoverageRow: true } }).verdict, 'review')
  assert.equal(decideOperativita({ answer: no, evidence: { found: true, names: true, structural: true, proofIsCoverageRow: false } }).verdict, 'mismatch')
  assert.equal(lineHasNonZeroAmount('Tutela Legale   ESCLUSA   31.000,00'), true)
  assert.equal(lineHasNonZeroAmount('Tutela Legale   NO   0,00'), false)
  // combinazione: la contraddizione (prova trovata) non si somma ai «non operante» provati
  const mm = { verdict: 'mismatch', reason: 'copertura non operante', esito: 'non operante', evidenceFound: true }
  const contra = { verdict: 'review', reason: 'contraddittorio', esito: 'non operante', evidenceFound: true }
  assert.equal(combineOperativitaBatches([mm, contra]).verdict, 'review')
})

test('coverNeverNamed: copertura mai nominata in nessuna pagina = non operante per fatto del testo', () => {
  const names = [['tutela', 'legale'], ['tutela', 'giudiziaria']]
  assert.equal(coverNeverNamed(['Polizza vita MetLife — capitale caso morte 100.000,00', 'Indennità di preavviso dirigenti'], names), true)
  assert.equal(coverNeverNamed(['Garanzie: RCA, Incendio', 'Tutela Giudiziaria   SI   18,19'], names), false)
  assert.equal(coverNeverNamed(['', '  '], names), false, 'senza testo non si giudica')
  assert.equal(coverNeverNamed(['qualunque testo'], []), false, 'nome non determinabile: non si giudica')
})

// ─── 26/09/2026: polizze vere bloccate dalla pertinenza (BOLCHINI RC 2025, LUCCA) ───

// BOLCHINI RC 2025, questionario AIG (griglia pdf.js vera, pag. 3, accorciata):
// ogni pagina porta il titolo «Questionario di Assicurazione Rc Professionale».
const BOLCHINI_Q3 = [
  'Questionario di Assicurazione Rc Professionale',
  '                                     Ingegneri & Architetti',
  '       12  La società si avvale di sub - appaltatori / consulenti esterni? ⃝ Sì ⃝ X No',
  '            b) Richiedete che tali sub - appaltatori dispongano di una loro polizza di assicurazione per la responsabilità',
  '            professionale?                                                   ⃝ Sì ⃝ X No',
  '          OPZIONI DI COPERTURA',
  '          Indicare il massimale per il quale si richiede copertura:',
  '           € 250.000   € 500.000    € 1.000.000  €1.500.000   € 2.000.000  € 2.500.000',
  '               ⃝            ⃝            ⃝            ⃝            ⃝           ⃝',
].join('\n')
// La polizza (appendice di rinnovo AIG, stessa cartella).
const BOLCHINI_APP = [
  'APPENDICE          N. 1    - RINNOVO',
  '                                             POLIZZA       IPD0017417',
  "          Descrizione del rischio            RESPONSABILITA' CIVILE PROFESSIONALE  INGEGNERI E ARCHITETTI",
  '          Totale Premio annuo lordo risultante dal Calcolo del Premio (in euro)                     756,42',
].join('\n')
const RC_NAME = [['professionale']]
const MED = [['medica'], ['sanitaria']]
const TL_NAME = [['tutela', 'legale'], ['tutela', 'giudiziaria']]
const Q_MASSIMALE = 'Indicare il massimale per il quale si richiede copertura: € 250.000'
const POL_OK = { esito: 'operante', documento: 3, pagina: 1, evidenza: "Descrizione del rischio RESPONSABILITA' CIVILE PROFESSIONALE INGEGNERI E ARCHITETTI", motivo: 'premio lordo 756,42' }

test('BOLCHINI RC 2025: «non operante» provato SOLO nel questionario = scarto marcato, che non contraddice la polizza «operante»', () => {
  const q = { ord: 1, page: 3, text: BOLCHINI_Q3, questionnaire: true, first: false }
  const pol = { ord: 3, page: 1, text: BOLCHINI_APP, questionnaire: false, first: true }
  // le due prove di produzione: la DOMANDA del modulo (qwen3:32b n9) e il TITOLO della pagina (think off)
  const noOf = (evidenza) => {
    const ans = { esito: 'non operante', documento: 1, pagina: 3, evidenza, motivo: 'citata come opzione richiesta' }
    const ev = verifyOperativitaEvidence(ans, [q], { lexTokens: RC_NAME })
    assert.equal(ev.found, true, evidenza); assert.equal(ev.formPage, true)
    return decideOperativita({ answer: ans, evidence: ev, requireStructural: false })
  }
  for (const evidenza of [Q_MASSIMALE, 'Questionario di Assicurazione Rc Professionale']) {
    const d = noOf(evidenza)
    assert.equal(d.verdict, 'mismatch', evidenza)
    assert.equal(d.formEvidence, true)
    assert.match(d.reason, /questionario\/proposta/)
  }
  const no = noOf(Q_MASSIMALE)
  const okEv = verifyOperativitaEvidence(POL_OK, [pol], { lexTokens: RC_NAME })
  assert.equal(okEv.found, true); assert.equal(okEv.formPage, false)
  const ok = decideOperativita({ answer: POL_OK, evidence: okEv, requireStructural: false })
  assert.equal(ok.verdict, 'ok')
  // [questionario «no», polizza «operante»] → ok (prima: «esiti contraddittori» → Da verificare)
  const both = combineOperativitaBatches([no, ok])
  assert.equal(both.verdict, 'ok'); assert.equal(both.batches, 2)
  assert.match(both.reason, /solo da un questionario\/proposta/)
  // il «non operante» provato nel CONTRATTO resta una contraddizione (CAMPESTRE invariato)
  const mm = { verdict: 'mismatch', reason: 'copertura non operante: x', esito: 'non operante', evidenceFound: true, evidenza: 'Tutela legale solo nelle condizioni' }
  assert.match(combineOperativitaBatches([mm, ok]).reason, /contraddittori/)
  assert.equal(combineOperativitaBatches([no, mm, ok]).verdict, 'review')
  // [questionario «no», contratto «no» provato] → mismatch; riportata la prova del contratto
  const r = combineOperativitaBatches([no, mm])
  assert.equal(r.verdict, 'mismatch'); assert.ok(!r.formEvidence); assert.equal(r.evidenza, mm.evidenza)
  // il SOLO questionario che dice «no» resta uno scarto (come prima: è la prova più comune del non acquisto)
  assert.equal(combineOperativitaBatches([no]).verdict, 'mismatch')
  assert.equal(combineOperativitaBatches([no, no]).verdict, 'mismatch')
  // … e con la polizza muta («non determinabile») è un dubbio, come prima
  assert.equal(combineOperativitaBatches([no, { verdict: 'review', esito: 'non determinabile', evidenceFound: false, reason: 'x' }]).verdict, 'review')
  // con pagine nominate non lette resta un dubbio
  assert.equal(combineOperativitaBatches([no, mm], { unreadNamed: 1 }).verdict, 'review')
  // la stessa frase in una pagina che NON è di questionario è una prova del contratto
  const plain = verifyOperativitaEvidence({ documento: 1, pagina: 3, evidenza: Q_MASSIMALE }, [{ ...q, questionnaire: false }], { lexTokens: RC_NAME })
  assert.equal(plain.formPage, false)
  const dPlain = decideOperativita({ answer: { esito: 'non operante', evidenza: Q_MASSIMALE }, evidence: plain, requireStructural: false })
  assert.equal(dPlain.verdict, 'mismatch'); assert.ok(!dPlain.formEvidence)
  // la stessa frase sia nel questionario sia nel contratto: vale il contratto, qualunque sia l'ordine
  const twice = verifyOperativitaEvidence({ documento: 1, pagina: 3, evidenza: Q_MASSIMALE }, [q, { ...q, ord: 2, page: 1, questionnaire: false }], { lexTokens: RC_NAME })
  assert.equal(twice.found, true); assert.equal(twice.formPage, false)
})

test('questionario delle esigenze: l\'opzione della copertura NON barrata, in qualsiasi forma, resta uno scarto (CASORETTO, EH448TD)', () => {
  // Vittoria (IDD rilegato nella polizza fabbricati): la riga «Tutela Legale» senza X, nessun glifo di casella
  const vittoria = { ord: 1, page: 8, questionnaire: true, first: false, text: 'QUESTIONARIO DI VALUTAZIONE DELLE\nRICHIESTE ED ESIGENZE DEL CONTRAENTE\n   X   Incendio          X   Responsabilità Civile\n       IMPRESA Assistenza Tutela Legale Welfare Aziendale' }
  // Unipol ADEGUATEZZA: l'opzione è una lettera «o», non una casella
  const unipol = { ord: 1, page: 1, questionnaire: true, first: true, text: 'QUESTIONARIO DEMANDS & NEEDS\n  o   la fornitura di servizi di tutela legale per problematiche correlate alla circolazione stradale (garanzia Tutela Legale )' }
  for (const [b, evidenza] of [[vittoria, 'IMPRESA Assistenza Tutela Legale Welfare Aziendale'], [unipol, 'o la fornitura di servizi di tutela legale per problematiche correlate alla circolazione stradale (garanzia Tutela Legale )']]) {
    const ans = { esito: 'non operante', documento: b.ord, pagina: b.page, evidenza, motivo: 'non selezionata' }
    const ev = verifyOperativitaEvidence(ans, [b], { lexTokens: TL_NAME })
    const d = decideOperativita({ answer: ans, evidence: ev, requireStructural: true })
    assert.equal(d.verdict, 'mismatch', evidenza); assert.equal(d.formEvidence, true)
    // da solo, o con gli altri batch «non operante» senza prova: non pertinente
    assert.equal(combineOperativitaBatches([d, { verdict: 'review', esito: 'non operante', evidenceFound: false, reason: 'x' }]).verdict, 'mismatch')
  }
})

test('DECISIONE: un «NO [X]» del questionario non contraddice l\'«operante» del contratto (per forma non si distingue da una domanda su altro)', () => {
  const quest = { ord: 1, page: 1, questionnaire: true, first: true, text: 'QUESTIONARIO PER LA VALUTAZIONE DELLE RICHIESTE ED ESIGENZE\nTutela legale                 SI [ ]   NO [X]' }
  const no = decideOperativita({ answer: { esito: 'non operante', documento: 1, pagina: 1, evidenza: 'Tutela legale SI [ ] NO [X]', motivo: 'm' }, evidence: verifyOperativitaEvidence({ documento: 1, pagina: 1, evidenza: 'Tutela legale SI [ ] NO [X]' }, [quest], { lexTokens: TL_NAME }), requireStructural: true })
  assert.equal(no.verdict, 'mismatch'); assert.equal(no.formEvidence, true)
  const scheda = { ord: 2, page: 1, questionnaire: false, first: true, text: 'POLIZZA N. 123\nSEZIONE TUTELA LEGALE          Premio annuo imponibile  25,00' }
  const okAns = { esito: 'operante', documento: 2, pagina: 1, evidenza: 'SEZIONE TUTELA LEGALE Premio annuo imponibile 25,00', motivo: 'premio proprio' }
  const ok = decideOperativita({ answer: okAns, evidence: verifyOperativitaEvidence(okAns, [scheda], { lexTokens: TL_NAME }), requireStructural: true })
  assert.equal(ok.verdict, 'ok')
  // il contratto dice che cosa è stato acquistato; la stessa forma (nome + X) nelle righe del
  // questionario RC di BOLCHINI è una domanda sui sub-appaltatori: una regola per forma la
  // renderebbe contraddittoria e bloccherebbe di nuovo la polizza vera
  assert.equal(combineOperativitaBatches([no, ok]).verdict, 'ok')
  assert.equal(structuralCoverLines(BOLCHINI_Q3, RC_NAME).filter(lineHasCheck).length, 1)
})

test('non operanti VERI restano tali: la prova sta nel contratto (BESA RUZZA ET103PP, SANTANGELO FV180JE, DAS «ESCLUSA»)', () => {
  const cases = [
    ['Tutela Legale                                        NON OPERANTE', 'Tutela Legale NON OPERANTE'],
    ['Tutela Giudiziaria                                                      NON   OPERANTE', 'Tutela Giudiziaria NON OPERANTE'],
  ]
  for (const [row, evidenza] of cases) {
    const b = { ord: 4, page: 5, questionnaire: false, text: `RIEPILOGO GARANZIE\nResponsabilità Civile Auto       OPERANTE\n${row}` }
    const ans = { esito: 'non operante', documento: 4, pagina: 5, evidenza, motivo: 'indicata come NON OPERANTE' }
    const ev = verifyOperativitaEvidence(ans, [b], { lexTokens: TL_NAME })
    assert.equal(ev.found, true); assert.equal(ev.formPage, false)
    const d = decideOperativita({ answer: ans, evidence: ev, requireStructural: true })
    assert.equal(d.verdict, 'mismatch', evidenza); assert.ok(!d.formEvidence)
  }
  // la riga della copertura con un suo importo resta una contraddizione (dubbio), anche in un modulo
  const das = { ord: 1, page: 1, questionnaire: false, text: 'Garanzia            Indicizzazione     Massimale\nTutela Legale       ESCLUSA            31.000,00' }
  const dasAns = { esito: 'non operante', documento: 1, pagina: 1, evidenza: 'Tutela Legale ESCLUSA 31.000,00', motivo: 'esclusa' }
  for (const questionnaire of [false, true]) {
    const d = decideOperativita({ answer: dasAns, evidence: verifyOperativitaEvidence(dasAns, [{ ...das, questionnaire }], { lexTokens: TL_NAME }), requireStructural: true })
    assert.equal(d.verdict, 'review'); assert.ok(!d.formEvidence)
    assert.equal(combineOperativitaBatches([d, { verdict: 'mismatch', esito: 'non operante', evidenceFound: true, reason: 'x' }]).verdict, 'review')
  }
})

test('namesCoverageAnyForm: il nome della copertura in forma FLESSA (vocali finali), mai per troncamento', () => {
  // i titoli veri che per forma esatta non nominavano la copertura
  for (const t of ['AMTRUST PROFESSIONISTA SANITARIO PROTETTO', 'Assicurazione della Responsabilità Civile Professionale del Medico', 'COPERTURE ACQUISTATE - Professioni Sanitarie', 'RC professionale dei medici']) {
    assert.equal(namesCoverage(t, MED), false, t)
    assert.equal(namesCoverageAnyForm(t, MED), true, t)
  }
  // la sottostringa esatta resta (kerning: «M edical Malpractice» contiene «medica»)
  assert.equal(namesCoverageAnyForm('CSMM C entro S tudi M edical M alpractice', MED), true)
  assert.equal(namesCoverageAnyForm('qualsiasi', []), null)
  // parole DIVERSE non combaciano (col troncamento a 6 caratteri sì: «profes», «medic», «giudiz»)
  assert.equal(namesCoverageAnyForm('assicurazione fabbricati e medicina del lavoro', MED), false)
  assert.equal(namesCoverageAnyForm('Contraente   Professione/Attività   AMMINISTRATORE', RC_NAME), false)
  assert.equal(namesCoverageAnyForm('DAS Tutela Legale del Professionista', RC_NAME), false)
  assert.equal(namesCoverageAnyForm('Tutela giudiziale delle controversie', TL_NAME), false)
  // la flessione della STESSA parola sì (per questo vale solo sul frontespizio: pageNamesCoverage)
  assert.equal(namesCoverageAnyForm('Lett. F) Malattie professionali X', RC_NAME), true)
  assert.equal(namesCoverageAnyForm('AMTRUST TUTELA MEDICI', MED), true)
  // tutela legale: stesse risposte di sempre
  assert.equal(namesCoverageAnyForm('Tutela Giudiziaria   SI   18,19', TL_NAME), true)
  assert.equal(namesCoverageAnyForm('per ricevere supporto legale per la tutela dei suoi diritti', TL_NAME), false)
  // le righe STRUTTURALI restano per forma esatta: una domanda di questionario RC non diventa «copertura + importo»
  assert.equal(structuralCoverLines('svolto attività professionali per opere il cui valore è superiore ad € 3.500.000,00 ? SI NO', RC_NAME).length, 0)
})

test('pageNamesCoverage / coverNeverNamed: la forma flessa vale SOLO sul frontespizio del documento', () => {
  assert.equal(pageNamesCoverage({ text: 'AMTRUST PROFESSIONISTA SANITARIO PROTETTO', first: true }, MED), true)
  assert.equal(pageNamesCoverage({ text: 'AMTRUST TUTELA MEDICI', first: false }, MED), false, 'pag. 2 di LUCCA: il certificato di tutela legale')
  assert.equal(pageNamesCoverage({ text: 'Rimborso spese sanitarie massimale 50.000,00', first: false }, MED), false)
  assert.equal(pageNamesCoverage({ text: 'attività sanitaria', first: false }, MED), true, 'forma esatta: ovunque')
  assert.equal(pageNamesCoverage({ text: 'x', first: true }, []), null)
  // polizze «…del Medico» / «Professioni Sanitarie»: nominate dal frontespizio, decide il modello
  const badran = 'Assicurazione della Responsabilità Civile Professionale del Medico — massimale 1.000.000,00'
  assert.equal(coverNeverNamed([badran], MED, { titlePages: [badran] }), false)
  // lo stesso titolo in una pagina interna non basta: PRINA tl «PROFESSIONE ASSICURATA: Giovane Medico» a pag. 3
  assert.equal(coverNeverNamed(['MyLegalProtection', 'Condizioni', 'PROFESSIONE ASSICURATA: Giovane Medico'], MED, { titlePages: ['MyLegalProtection'] }), true)
  // infortuni: «certificato medico» nelle condizioni → mai nominata, niente modello
  assert.equal(coverNeverNamed(['POLIZZA INFORTUNI N. 46211795', 'la denuncia va corredata da certificato medico'], MED, { titlePages: ['POLIZZA INFORTUNI N. 46211795'] }), true)
  assert.equal(coverNeverNamed(['Polizza fabbricati condominio — incendio, RC del fabbricato'], MED), true)
})

test('selectOperativitaPages: il frontespizio che nomina la copertura in forma flessa è una pagina † (stessa regola delle pagine non lette)', () => {
  const cands = [
    { ord: 1, page: 1, first: true, text: 'AMTRUST PROFESSIONISTA SANITARIO PROTETTO\nPREMIO LORDO ALLA FIRMA € 145,36', score: 0.3 },
    { ord: 1, page: 2, first: false, text: 'AMTRUST TUTELA MEDICI\nATTIVITÀ: PERSONALE SANITARIO NON MEDICO', score: 0.9 },
    { ord: 1, page: 3, first: false, text: 'condizioni generali di assicurazione', score: 0.8 },
  ].map((c) => ({ ...c, flat: c.text }))
  const sel = selectOperativitaPages(cands, { budgetChars: 5000, lexTokens: MED })
  assert.deepEqual(sel.map((c) => [c.page, c.lex]), [[1, true], [2, false], [3, false]])
  assert.equal(sel.find((c) => c.page === 1).structural, false, 'righe strutturali solo per forma esatta')
})

test('LUCCA (RC sanitaria di un\'infermiera): la prova dal titolo del certificato basta; la TL per medici a pag. 2 no', () => {
  const real = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
  const med = real.find((p) => p.name === 'RC PROF MED V2')
  // fatti DERIVATI dal testo del profilo (mai le sue frasi: le scrive l'utente)
  assert.deepEqual(recognitionCoverName(real, med.id), MED)
  assert.equal(recognitionAllowsSection(med.recognition), false, 'la copertura È il prodotto: nessuna riga strutturale richiesta')
  // LUCCA_VIVIANA.pdf, griglia pdf.js (accorciata): pag. 1 RC sanitaria, pag. 2 tutela legale per medici
  const p1 = { ord: 1, page: 1, first: true, questionnaire: false, text: [
    '                          CERTIFICATO DI ADESIONE',
    '                                Polizza di Assicurazione',
    '                   AMTRUST PROFESSIONISTA SANITARIO PROTETTO',
    '                            Certificato N° RCSPEM00000098',
    '    ASSICURATO: LUCCA VIVIANA',
    "    ATTIVITÀ: INFERMIERE PROFESSIONALE/INFERMIERE PEDIATRICO/VIGILATRICE D'INFANZIA",
    '    MASSIMALE PER SINISTRO / ANNO         PERIODO DI RETROATTIVITA',
    '          € 1.000.000/3.000.000                      ILLIMITATA',
    '    PREMIO NETTO ALLA FIRMA IMPOSTE ALLA FIRMA      PREMIO LORDO ALLA FIRMA',
    '                   € 118,90                 € 26,46                € 145,36',
  ].join('\n') }
  const p2 = { ord: 1, page: 2, first: false, questionnaire: false, text: [
    '                             AMTRUST TUTELA MEDICI',
    '                             Certificato N° TLM190942268',
    '    ASSICURATO: LUCCA VIVIANA',
    '    ATTIVITÀ: PERSONALE SANITARIO NON MEDICO CON ESCLUSIONE DI OSTETRICHE',
  ].join('\n') }
  const blocks = [p1, p2]
  const decide = (esito, pagina, evidenza) => {
    const ans = { esito, documento: 1, pagina, evidenza, motivo: 'm' }
    const ev = verifyOperativitaEvidence(ans, blocks, { lexTokens: MED })
    return { ev, d: decideOperativita({ answer: ans, evidence: ev, requireStructural: false }) }
  }
  const title = decide('operante', 1, 'AMTRUST PROFESSIONISTA SANITARIO PROTETTO')
  assert.equal(title.ev.names, true)
  assert.equal(title.d.verdict, 'ok', 'prima: «prova generica: non nomina la copertura» → Da verificare')
  assert.equal(decide('operante', 1, 'Polizza di Assicurazione AMTRUST PROFESSIONISTA SANITARIO PROTETTO Certificato N° RCSPEM00000098').d.verdict, 'ok')
  // il titolo del certificato di TUTELA LEGALE (pag. 2, non frontespizio) non nomina la RC sanitaria
  const tl = decide('operante', 2, 'AMTRUST TUTELA MEDICI Certificato N° TLM190942268')
  assert.equal(tl.ev.names, false); assert.equal(tl.d.verdict, 'review'); assert.match(tl.d.reason, /generica/)
  // la riga dell'attività o del massimale non nomina la copertura: resta da verificare
  const act = decide('operante', 1, "ATTIVITÀ: INFERMIERE PROFESSIONALE/INFERMIERE PEDIATRICO/VIGILATRICE D'INFANZIA")
  assert.equal(act.ev.names, false); assert.equal(act.d.verdict, 'review'); assert.match(act.d.reason, /generica/)
  assert.equal(decide('operante', 1, 'MASSIMALE PER SINISTRO / ANNO € 1.000.000/3.000.000').d.verdict, 'review')
  // «non operante» sulla riga ATTIVITÀ del certificato di TUTELA LEGALE: nessuna regola di
  // codice lo distingue da un non operante vero (Medica su una RC ingegneri: «Attività:
  // Ingegnere»): lo corregge la definizione del profilo, non il codice
  assert.equal(decide('non operante', 2, 'ASSICURATO: LUCCA VIVIANA ATTIVITÀ: PERSONALE SANITARIO NON MEDICO').d.verdict, 'mismatch')
})

test('isQuestionnairePageTitle: una CELLA della testa della pagina comincia col titolo; la prosa e gli elenchi del contratto no', () => {
  // titoli veri (pagine di questionario)
  for (const t of [
    BOLCHINI_Q3,
    'Abitazione\n                                     POLIZZA N. 789401723-07\n                  QUESTIONARIO PER LA VALUTAZIONE DELLE RICHIESTE ED ESIGENZE DEL CONTRAENTE',
    'PROFILO CLIENTE E CONSULENZA ASSICURATIVA\nCOLLEGATO ALLA POLIZZA N. 01469DAS00074          01469DAS00074_AA\nQUESTIONARIO DEMANDS & NEEDS',
    'Questionario: GUFFANTI GROUP             Quote Id: 1046945',
    'Multibusiness     INTERMEDIARIO 001190 PANIZZA        QUESTIONARIO PER LA VALUTAZIONE DELLE RICHIESTE',
    'MODULO DI PROPOSTA / QUESTIONARIO\nPER L’ ASSICURAZIONE DELLA RESPONSABILITÀ CIVILE PROFESSIONALE',
  ]) assert.equal(isQuestionnairePageTitle(t), true, t.slice(0, 60))
  // pagine di CONTRATTO che isQuestionnaireTitle (pensata per la prima pagina di un documento) marcava
  const saporiti = 'per l’esecuzione dell’ attività) in favore di Terzi e definiti nella proposta di Assicurazione compilata dall’\nAssicurato , nel materiale ad essa incorporato'
  const metlife = 'per un capitale assicurato superiore a €\n400.000,00=, anche a seguito di aumenti di\n▪ Questionario medico - sportivo'
  for (const t of [saporiti, metlife]) {
    assert.equal(isQuestionnaireTitle(t), true)
    assert.equal(isQuestionnairePageTitle(t), false, t.slice(0, 40))
  }
  // limiti noti (documentati): una pagina di questionario SENZA titolo ripetuto non è marcata
  assert.equal(isQuestionnairePageTitle('Sono mai state annullate o rifiutate coperture assicurative di questo tipo?   SI  X  NO'), false)
  assert.equal(isQuestionnairePageTitle(''), false)
})

test('prova «operante» di un PRODOTTO di tutela legale: la riga del premio o la scheda che nomina la copertura (DAS, decisione dell\'utente 26/09)', () => {
  const TL = [['tutela', 'legale']]
  // AGRIPPA 12 (DAS Difesa Condominio): intestazione «TUTELA / LEGALE» spezzata, riga del premio senza la parola
  const p1 = { ord: 1, page: 1, first: true, questionnaire: false, text: '   TUTELA   PERDITE   ASSISTENZA   IMPOSTE   PREMIO\n   LEGALE   PECUNIARIE   LORDO\n   Difesa Condominio   431,81   91,76   523,57' }
  const p2 = { ord: 1, page: 2, first: false, questionnaire: false, text: 'DISPOSIZIONI PARTICOLARI CHE REGOLANO LE COPERTURE (TUTELA LEGALE)' }
  const ans = { esito: 'operante', documento: 1, pagina: 1, evidenza: 'Difesa Condominio 431,81 91,76 523,57', motivo: 'm' }
  const ev = verifyOperativitaEvidence(ans, [p1, p2], { lexTokens: TL })
  assert.equal(ev.names, false); assert.equal(ev.productProof, true)
  assert.equal(decideOperativita({ answer: ans, evidence: ev }).verdict, 'ok')
  // Stessa riga ma il documento non nomina mai la copertura: resta un dubbio
  const ev2 = verifyOperativitaEvidence(ans, [{ ...p1, text: 'Difesa Condominio   431,81   91,76   523,57' }], { lexTokens: TL })
  assert.equal(decideOperativita({ answer: ans, evidence: ev2 }).verdict, 'review')
  // Scheda DAS «POLIZZA RAMO TUTELA GIUDIZIARIA»: la frase delle garanzie prescelte sul frontespizio con importi
  const TG = [['tutela', 'giudiziaria']]
  const s1 = { ord: 1, page: 1, first: true, questionnaire: false, text: 'POLIZZA RAMO TUTELA GIUDIZIARIA\ngaranzie prescelte (si intendono operative quelle crocesegnate)\n[x] Difesa Penale e Civile   99,84   21,22   121,06' }
  const a2 = { esito: 'operante', documento: 1, pagina: 1, evidenza: 'garanzie prescelte (si intendono operative quelle crocesegnate)', motivo: 'm' }
  assert.equal(decideOperativita({ answer: a2, evidence: verifyOperativitaEvidence(a2, [s1], { lexTokens: TG }) }).verdict, 'ok')
  // …ma non dalla pagina di un questionario
  const q1 = { ...s1, questionnaire: true }
  assert.equal(decideOperativita({ answer: a2, evidence: verifyOperativitaEvidence(a2, [q1], { lexTokens: TG }) }).verdict, 'review')
})
