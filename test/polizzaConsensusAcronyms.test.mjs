// [flag acronimi] Consenso: varianti dello stesso nome con la SIGLA espansa
// (08/10/2026, P22 ARENA: «D.A.S. Difesa Automobilistica Sinistri» e «DAS
// S.p.A.» un voto ciascuno, vinceva «HELVETIA VITA» col suo voto).
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickConsensusCandidate } from '../src/services/polizzaService.js'

const c = (valore, affinity = 0.45) => ({ valore, affinity, srcDate: '01/01/2025', file: 'a.pdf' })

test('acronimi: la sigla e il nome esteso sommano i voti e battono il corrente', () => {
  const cur = c('HELVETIA VITA', 0.48)
  const cands = [cur, c('D.A.S. Difesa Automobilistica Sinistri S.p.A.', 0.46), c('DAS S.p.A.', 0.44)]
  assert.equal(pickConsensusCandidate(cur, cands, { tierBlind: true }).changed, false)
  const r = pickConsensusCandidate(cur, cands, { tierBlind: true, acronyms: true })
  assert.equal(r.changed, true)
  assert.match(r.cand.valore, /D\.?A\.?S/)
  assert.equal(r.votes, 2)
})

test('acronimi: senza una sigla espansa nessun raggruppamento (Allianz / Allianz Viva)', () => {
  const cur = c('Allianz Viva S.p.A.', 0.5)
  const cands = [cur, c('Allianz S.p.A.'), c('Allianz Next S.p.A.')]
  const r = pickConsensusCandidate(cur, cands, { tierBlind: true, acronyms: true })
  assert.equal(r.changed, false)
})

// Parole distintive (08/10/2026): le citazioni dentro una clausola NEGATA sono
// etichette di ciò che il campo NON è, non parole del campo.
import { distinctiveHeadTokens } from '../src/services/polizzaValidation.js'
test('distinctiveHeadTokens: le citazioni negate non diventano parole distintive', () => {
  const fields = [
    { id: 'a', description: "Attività assicurata: il settore di attività dell'impresa. NON è il valore accanto a 'Professione', 'Veicolo'." },
    { id: 'd', description: "Data di decorrenza della polizza: la data accanto a 'DECORRENZA', oppure il 'Dal' della quietanza." },
    { id: 'x', description: 'Premio lordo: importo.' },
  ]
  const d = distinctiveHeadTokens(fields)
  assert.ok(!d.get('a').includes('professione') && !d.get('a').includes('veicolo'))
  assert.ok(d.get('d').includes('decorrenza') && d.get('d').includes('dal'))
})
