/**
 * Test del pre-controllo di pertinenza profilo↔fascicolo (parte PURA).
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeForPrecheck, parseContentKeywords, keywordVerdict, contentExcludeVerdict, cosineSim,
  semanticScore, llmComparisonScore, decidePrecheck, topContentTerms, hasPolicyEvidence,
  KEYWORD_MIN_RATIO, SEMANTIC_MIN, LLM_MIN,
} from '../src/services/polizzaPrecheck.js'

test('normalizeForPrecheck: minuscole, senza accenti, spazi singoli', () => {
  assert.equal(normalizeForPrecheck('Responsabilità   CIVILE — R.C.T./R.C.O.'), 'responsabilita civile r c t r c o')
  assert.equal(normalizeForPrecheck(''), '')
  assert.equal(normalizeForPrecheck(null), '')
})

test('parseContentKeywords: separatori virgola/;/newline, scarti corti', () => {
  assert.deepEqual(parseContentKeywords('rct, rco; prestatori di lavoro\nresponsabilità civile'),
    ['rct', 'rco', 'prestatori di lavoro', 'responsabilità civile'])
  assert.deepEqual(parseContentKeywords('a, b'), []) // < 3 char: scartate
  assert.deepEqual(parseContentKeywords(''), [])
})

test('keywordVerdict: match a sottostringa normalizzata, frasi comprese', () => {
  const text = normalizeForPrecheck('POLIZZA RESPONSABILITÀ CIVILE VERSO TERZI (R.C.T.) e prestatori di lavoro')
  const v = keywordVerdict(['responsabilità civile', 'prestatori di lavoro', 'incendio'], text)
  assert.deepEqual(v.matched, ['responsabilità civile', 'prestatori di lavoro'])
  assert.deepEqual(v.missing, ['incendio'])
  assert.ok(Math.abs(v.ratio - 2 / 3) < 1e-9)
  // nessuna keyword → ratio 0, mai lanciare
  assert.deepEqual(keywordVerdict([], text), { matched: [], missing: [], ratio: 0 })
})

test('fallback contentKeywords→matchKeywords: profilo senza contentKeywords ma con matchKeywords medico', () => {
  // Simula il profilo RC PROF MED V2: contentKeywords assente, matchKeywords con "MEDICO, medico, med".
  // Stessa logica di runPrecheck: parseContentKeywords(undefined) → [] che è truthy,
  // quindi il fallback va deciso sulla LUNGHEZZA, non con ||.
  const profile = { contentKeywords: undefined, matchKeywords: 'MEDICO, medico, med' }
  const contentKws = parseContentKeywords(profile?.contentKeywords)
  const kws = contentKws.length ? contentKws : parseContentKeywords(profile?.matchKeywords)
  assert.deepEqual(kws, ['MEDICO', 'medico', 'med'])
  // documento RCT/Cedac rischi sanitari: il testo contiene MEDICO e medico → ratio alto
  const okText = normalizeForPrecheck('RC professionale rischi sanitari — MEDICO e medico assicurato')
  const vOk = keywordVerdict(kws, okText)
  assert.ok(vOk.ratio >= KEYWORD_MIN_RATIO, `ratio ${vOk.ratio} < ${KEYWORD_MIN_RATIO}`)
  assert.equal(decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: vOk }).verdict, 'ok')
  // documento estraneo (fabbricati): nessuna keyword → mismatch
  const noText = normalizeForPrecheck('Incendio fabbricati — esplosione scoppio danni alle cose')
  const vNo = keywordVerdict(kws, noText)
  assert.deepEqual(vNo.matched, [])
  assert.equal(decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: vNo }).verdict, 'mismatch')
})

test('cosineSim: vettori noti', () => {
  assert.equal(cosineSim([1, 0], [1, 0]), 1)
  assert.equal(cosineSim([1, 0], [0, 1]), 0)
  assert.ok(Math.abs(cosineSim([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-9)
  assert.equal(cosineSim([0, 0], [1, 0]), 0) // vettore nullo: 0, non NaN
})

test('semanticScore: media delle affinità per campo, robusto ai buchi', () => {
  assert.equal(semanticScore([0.8, 0.4]), 0.6000000000000001)
  assert.equal(semanticScore([0.5, NaN, undefined, 0.7]), 0.6)
  assert.equal(semanticScore([]), null)
  assert.equal(semanticScore(null), null)
})

test('llmComparisonScore: overlap token rilevati↔termini profilo', () => {
  const profileTerms = ['RCT RCO (ripristino descrizioni)', 'responsabilità civile, prestatori', 'Massimale per sinistro']
  // pieno: tutti i token rilevati stanno nei termini
  assert.equal(llmComparisonScore({ type: 'responsabilità civile', keywords: ['rct', 'massimale'] }, profileTerms), 1)
  // zero: tipo completamente estraneo
  assert.equal(llmComparisonScore({ type: 'polizza incendio fabbricati', keywords: ['fiamme'] }, profileTerms), 0)
  // niente di rilevato → null (non 0: è un'assenza di input, non un mismatch)
  assert.equal(llmComparisonScore({ type: '', keywords: [] }, profileTerms), null)
})

test('contentExcludeVerdict: parole del contenuto "da evitare" trovate/non trovate', () => {
  const text = normalizeForPrecheck('Polizza incendio fabbricati — esplosione scoppio danni alle cose')
  const v = contentExcludeVerdict(['incendio', 'fabbricati'], text)
  assert.deepEqual(v.matched, ['incendio', 'fabbricati'])
  assert.ok(v.ratio >= KEYWORD_MIN_RATIO)
  // parola assente → nessun match
  const v2 = contentExcludeVerdict(['responsabilità civile'], text)
  assert.deepEqual(v2.matched, [])
  assert.equal(v2.ratio, 0)
})

test('decidePrecheck: blocco "da evitare" SEMPRE, anche a switch off', () => {
  // Profilo con contentExcludeKeywords e una parola da evitare presente nel testo
  const base = { mode: 'off', hasProfile: true, hasContentKeywords: true, hasContentExclude: true }
  const contentExclude = contentExcludeVerdict(['incendio'], normalizeForPrecheck('incendio fabbricati'))
  const d = decidePrecheck({ ...base, contentExclude })
  assert.equal(d.verdict, 'mismatch')
  assert.match(d.reason, /da evitare/)
  // Nessuna parola da evitare nel testo → lo switch 'off' resta skipped
  const d2 = decidePrecheck({ ...base, contentExclude: contentExcludeVerdict(['incendio'], normalizeForPrecheck('polizza rc')) })
  assert.equal(d2.verdict, 'skipped')
  // Modo keywords + parola da evitare presente → prevale il blocco da evitare
  const d3 = decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: true, hasContentExclude: true, keyword: { ratio: 1 }, contentExclude: contentExcludeVerdict(['incendio'], normalizeForPrecheck('incendio')) })
  assert.equal(d3.verdict, 'mismatch')
  assert.match(d3.reason, /da evitare/)
})

test('decidePrecheck: verdetti ai bordi delle soglie', () => {
  const base = { hasProfile: true, hasContentKeywords: true }
  // keywords sopra/sotto soglia
  assert.equal(decidePrecheck({ ...base, mode: 'keywords', keyword: { ratio: KEYWORD_MIN_RATIO } }).verdict, 'ok')
  assert.equal(decidePrecheck({ ...base, mode: 'keywords', keyword: { ratio: KEYWORD_MIN_RATIO - 0.01 } }).verdict, 'mismatch')
  // semantic sopra/sotto
  // semantico = CONFRONTO tra profili (nessuna soglia): passa se il profilo del job è il più affine
  const rk = [{ id: 'a', name: 'A', score: 0.6 }, { id: 'b', name: 'B', score: 0.5 }]
  assert.equal(decidePrecheck({ ...base, mode: 'semantic', semanticRanking: rk, jobProfileId: 'a' }).verdict, 'ok')
  assert.equal(decidePrecheck({ ...base, mode: 'semantic', semanticRanking: rk, jobProfileId: 'b' }).verdict, 'mismatch')
  // llm sopra/sotto
  assert.equal(decidePrecheck({ ...base, mode: 'llm', llm: LLM_MIN }).verdict, 'ok')
  assert.equal(decidePrecheck({ ...base, mode: 'llm', llm: LLM_MIN - 0.01 }).verdict, 'mismatch')
})

test('decidePrecheck: TUTTE le degradazioni → mai bloccare per guasti o configurazioni assenti', () => {
  // off → skipped
  assert.equal(decidePrecheck({ mode: 'off', hasProfile: true }).verdict, 'skipped')
  // nessun profilo (campi globali) → skipped
  assert.equal(decidePrecheck({ mode: 'keywords', hasProfile: false }).verdict, 'skipped')
  // keywords senza contentKeywords → degrada a semantic (e la usa davvero)
  const d = decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: false, semanticRanking: [{ id: 'a', name: 'A', score: 0.9 }], jobProfileId: 'a' })
  assert.equal(d.mode, 'semantic')
  assert.equal(d.verdict, 'ok')
  // embeddings assenti nel modo semantic → skipped, MAI mismatch
  assert.equal(decidePrecheck({ mode: 'semantic', hasProfile: true, semantic: null }).verdict, 'skipped')
  // modello muto nel modo llm → skipped
  assert.equal(decidePrecheck({ mode: 'llm', hasProfile: true, llm: null }).verdict, 'skipped')
  // testo assente nel modo keywords → skipped
  assert.equal(decidePrecheck({ mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: null }).verdict, 'skipped')
  // modo sconosciuto → skipped
  assert.equal(decidePrecheck({ mode: 'boh', hasProfile: true }).verdict, 'skipped')
})

test('decidePrecheck: con switch off ma contentKeywords presenti, valuta SEMPRE le keyword', () => {
  // Il profilo ha parole del contenuto da cercare: lo switch globale 'off' NON
  // deve trasformarle in skipped. Le keyword vanno valutate (ok/mismatch).
  const textOk = normalizeForPrecheck('polizza responsabilità civile prestatori di lavoro')
  const kwOk = keywordVerdict(['responsabilità civile', 'prestatori di lavoro', 'incendio'], textOk)
  assert.equal(kwOk.ratio, 2 / 3) // >= KEYWORD_MIN_RATIO
  const dOk = decidePrecheck({ mode: 'off', hasProfile: true, hasContentKeywords: true, keyword: kwOk })
  assert.equal(dOk.verdict, 'ok')
  assert.equal(dOk.mode, 'keywords')

  // Sotto soglia → mismatch, NON skipped (le keyword erano attive)
  const textNo = normalizeForPrecheck('incendio fabbricati esplosione scoppio')
  const kwNo = keywordVerdict(['responsabilità civile', 'prestatori di lavoro'], textNo)
  assert.equal(kwNo.ratio, 0)
  const dNo = decidePrecheck({ mode: 'off', hasProfile: true, hasContentKeywords: true, keyword: kwNo })
  assert.equal(dNo.verdict, 'mismatch')
  assert.equal(dNo.mode, 'keywords')

  // Senza keyword da cercare e a switch off → resta skipped
  const dSkip = decidePrecheck({ mode: 'off', hasProfile: true, hasContentKeywords: false })
  assert.equal(dSkip.verdict, 'skipped')
  assert.match(dSkip.reason, /disattivato/)
})

test('topContentTerms: termini frequenti senza boilerplate assicurativo', () => {
  const norm = normalizeForPrecheck(
    'incendio fabbricati incendio fabbricati incendio esplosione scoppio polizza polizza assicurato compagnia euro'
  )
  const terms = topContentTerms(norm, 3)
  assert.deepEqual(terms.slice(0, 2), ['incendio', 'fabbricati'])
  assert.ok(!terms.includes('polizza') && !terms.includes('compagnia'))
})

test('hasPolicyEvidence: frontee "polizza vera" vs solo informativo/quietanza', () => {
  const withPol = normalizeForPrecheck('Numero polizza: BL05000049\nContraente: Pilato\nMassimale per sinistro: 2.500.000,00\nPremio: 3.300,00')
  const infoOnly = normalizeForPrecheck('Questo fascicolo contiene il prospetto informativo e la quietanza di rinnovo. Le condizioni generali di assicurazione sono allegate.')
  const tooShort = normalizeForPrecheck('Breve.')
  assert.equal(hasPolicyEvidence(withPol), true)
  assert.equal(hasPolicyEvidence(infoOnly), false)
  assert.equal(hasPolicyEvidence(tooShort), null) // non giudicabile → null → MAI mismatch
  assert.equal(hasPolicyEvidence(''), null)
})

test('decidePrecheck: la validità «polizza vera» la decide la domanda al modello, non la regex (26/09/2026)', () => {
  const base = { mode: 'keywords', hasProfile: true, hasContentKeywords: true, keyword: { ratio: 0.6 }, requireValidPolicy: true }
  // la vecchia regex (hasPolicyEvidence) non decide più: nessun blocco a parole
  assert.equal(decidePrecheck({ ...base, hasPolicyEvidence: true }).verdict, 'ok')
  assert.equal(decidePrecheck({ ...base, hasPolicyEvidence: false }).verdict, 'ok')
  // contratto «assente» (risposta del modello) → Non valido, con la ragione
  const d = decidePrecheck({ ...base, contract: { esito: 'assente', reason: 'nessuna polizza tra i documenti letti: solo informativa' } })
  assert.equal(d.verdict, 'mismatch'); assert.equal(d.notValid, true)
  assert.match(d.reason, /nessuna polizza/)
  // guasto della domanda → mai Non valido: da verificare
  const g = decidePrecheck({ ...base, contract: { esito: 'non verificata', reason: 'controllo della polizza non eseguibile', error: true } })
  assert.equal(g.verdict, 'review'); assert.ok(!g.notValid)
  // «non determinabile» = polizza NON VISTA dal modello: da soli non si
  // estrae (un «ok» diventa «da verificare», con la nota nel perché); un
  // blocco resta un blocco, con la nota (chi forza sa cosa forza)
  const nd = decidePrecheck({ ...base, contract: { esito: 'non determinabile', reason: 'il modello non ha potuto dire se c\'è una polizza' } })
  assert.equal(nd.verdict, 'review'); assert.ok(!nd.notValid)
  assert.match(nd.reason, /polizza non vista dal modello \(non determinabile\)/)
  const ndBlock = decidePrecheck({ ...base, keyword: { ratio: 0 }, contract: { esito: 'non determinabile', reason: 'x' } })
  assert.equal(ndBlock.verdict, 'mismatch'); assert.ok(!ndBlock.notValid); assert.match(ndBlock.reason, /polizza non vista dal modello/)
  // la nota non si ripete se l'operatività l'ha già messa (applyContractVerdict)
  const once = decidePrecheck({ mode: 'llm', hasProfile: true, hasRecognition: true, operativita: { verdict: 'review', reason: 'copertura operante; polizza non vista dal modello (non determinabile): x' }, contract: { esito: 'non determinabile', reason: 'x' } })
  assert.equal(once.reason.match(/polizza non vista dal modello/g).length, 1)
  // pre-controllo spento: la polizza vista serve lo stesso
  assert.equal(decidePrecheck({ mode: 'off', hasProfile: true, contract: { esito: 'non determinabile', reason: 'x' } }).verdict, 'review')
  assert.equal(decidePrecheck({ mode: 'off', hasProfile: true, contract: { esito: 'presente', reason: 'polizza presente' } }).verdict, 'skipped')
  // il flag non spegne più la regola (SEMPRE)
  assert.equal(decidePrecheck({ ...base, requireValidPolicy: false, contract: { esito: 'assente', reason: 'nessuna polizza' } }).notValid, true)
  // nessun profilo: la polizza si verifica lo stesso
  assert.equal(decidePrecheck({ mode: 'keywords', hasProfile: false }).verdict, 'skipped')
  assert.equal(decidePrecheck({ mode: 'keywords', hasProfile: false, contract: { esito: 'assente', reason: 'nessuna polizza' } }).notValid, true)
})

test('rankProfilesSemantic + semanticRankingVerdict: confronto tra profili, nessuna soglia', async () => {
  const { rankProfilesSemantic, semanticRankingVerdict, decidePrecheck } = await import('../src/services/polizzaPrecheck.js')
  const ranking = rankProfilesSemantic([
    { id: 'tl', name: 'Tutela Legale 3', perFieldMax: [0.5, 0.6, 0.7] },
    { id: 'rc', name: 'Rc Professionale V3', perFieldMax: [0.4, 0.5, 0.3] },
    { id: 'x', name: 'Senza embeddings', perFieldMax: [] },
  ])
  assert.deepEqual(ranking.map((r) => r.id), ['tl', 'rc', 'x'])
  assert.equal(semanticRankingVerdict('tl', ranking).verdict, 'ok')
  const m = semanticRankingVerdict('rc', ranking)
  assert.equal(m.verdict, 'mismatch')
  assert.equal(m.best.id, 'tl')
  assert.ok(/Tutela Legale 3/.test(m.reason))
  assert.equal(semanticRankingVerdict('x', ranking).verdict, 'skipped', 'senza punteggio mai mismatch')
  assert.equal(semanticRankingVerdict('tl', ranking.slice(0, 1)).verdict, 'ok', 'profilo unico: nessun confronto')
  // decidePrecheck integra la classifica; senza classifica → skipped (niente soglia)
  const d = decidePrecheck({ mode: 'semantic', hasProfile: true, hasContentKeywords: false, semanticRanking: ranking, jobProfileId: 'rc' })
  assert.equal(d.verdict, 'mismatch'); assert.equal(d.threshold, null)
  assert.equal(decidePrecheck({ mode: 'semantic', hasProfile: true, hasContentKeywords: false, semantic: 0.3 }).verdict, 'skipped')
})

test('policyEvidenceReport: diagnostica a parole (non decide più), dice cosa manca', async () => {
  const { policyEvidenceReport, decidePrecheck, normalizeForPrecheck, REQUIRE_VALID_POLICY_DEFAULT } = await import('../src/services/polizzaPrecheck.js')
  assert.equal(REQUIRE_VALID_POLICY_DEFAULT, true)
  const dip = normalizeForPrecheck('Set informativo. Documento informativo precontrattuale. Il presente documento contiene informazioni sul prodotto assicurativo e sulla società; le condizioni complete sono nel contratto. ' + 'x'.repeat(40))
  const rep = policyEvidenceReport(dip)
  assert.equal(rep.ok, false)
  assert.ok(rep.missing.some((m) => /numero di polizza/.test(m)))
  // a pre-controllo spento e senza risposta sul contratto la regex non ferma nulla
  const d = decidePrecheck({ mode: 'off', hasProfile: true, hasPolicyEvidence: rep.ok, policyMissing: rep.missing, requireValidPolicy: true })
  assert.equal(d.verdict, 'skipped'); assert.ok(!d.setAside && !d.notValid)
  const ok = policyEvidenceReport(normalizeForPrecheck('Polizza n. 01469DAS00074 Contraente BOLCHINI MARGHERITA Massimale per sinistro 25.000,00 Premio lordo 244,00 ' + 'y'.repeat(30)))
  assert.equal(ok.ok, true); assert.deepEqual(ok.missing, [])
})

test('policyEvidenceReport: "Polizza n. 0146905119" della quietanza DAS è una voce di polizza', async () => {
  const { policyEvidenceReport, normalizeForPrecheck } = await import('../src/services/polizzaPrecheck.js')
  const q = normalizeForPrecheck('QUIETANZA DI PAGAMENTO DEL PREMIO Quietanza n. 693689027 Polizza n. 0146905119 Intestata a: ALZAIA NAV. PAVESE 104 CONDOMINIO Dal 31/01/26 al 31/01/27 Tutela Legale ESCLUSA 31.000,00 Premio netto Imposte Premio lordo € 615,25 € 130,75 € 746,00')
  const rep = policyEvidenceReport(q)
  assert.equal(rep.ok, true, rep.missing.join(' / '))
})
