// [flag fuocopolizza] Estrazione sui soli documenti della polizza provata dalla
// pertinenza (05/10/2026, BESA FN527EA: cartella del veicolo con la polizza auto
// Allianz 539642021 e la DAS Drive 1469DAS00076 di tutela legale; l'estrazione
// prendeva compagnia, numero e massimale dall'Allianz).
import test from 'node:test'
import assert from 'node:assert/strict'
import { focusOnProofPolicy, nearSameNumber } from '../src/services/policyReconcile.js'
import { engineFlag, KNOWN_FLAGS } from '../src/services/engineFlags.js'

const doc = (numbers, text = '') => ({ numbers, pages: [text] })

test('focusOnProofPolicy: fuori i documenti con soli numeri di un\'altra polizza; restano quelli senza numero', () => {
  const files = [
    doc(['539642021'], 'CERTIFICATO'),           // Allianz
    doc([], 'COPIA DIREZIONE FIRMATA'),           // scansione senza numero letto
    doc(['1469DAS00076'], 'POLIZZA N. 01469DAS00076'), // DAS: documento della prova
    doc(['539642021'], 'POLIZZA FN527EA'),        // Allianz
    doc([], 'Set Informativo'),                   // senza numero
  ]
  const f = focusOnProofPolicy(files, 2)
  assert.deepEqual(f.keep, [false, true, true, false, true])
  assert.deepEqual(f.excluded.map((x) => x.index), [0, 3])
})

test('focusOnProofPolicy: varianti dello stesso numero (OCR, decorazioni) e frammenti corti non escludono nulla', () => {
  const files = [
    doc(['207008647']),
    doc(['207008687']),          // una cifra letta male dall'OCR
    doc(['30207008647']),        // ramo davanti
    doc(['12022']),              // solo un frammento: conta come senza numero
  ]
  assert.deepEqual(focusOnProofPolicy(files, 0).keep, [true, true, true, true])
  // ITAS MEDA: le copie firmate scansionate leggono anche un frammento «12022»
  const meda = [doc(['M16181009']), doc(['M16181009', '12022']), doc(['12022'])]
  assert.deepEqual(focusOnProofPolicy(meda, 0).keep, [true, true, true])
  assert.equal(nearSameNumber('207008687', '207008647'), true)
  assert.equal(nearSameNumber('539642021', '1469DAS00076'), false)
})

test('focusOnProofPolicy: senza numero nel documento della prova non si esclude nulla', () => {
  const f = focusOnProofPolicy([doc([]), doc(['539642021'])], 0)
  assert.deepEqual(f.keep, [true, true])
  assert.equal(f.excluded.length, 0)
})

test('flag fuocopolizza: conosciuto, spento di default', () => {
  assert.ok('fuocopolizza' in KNOWN_FLAGS)
  assert.equal(engineFlag({}, 'fuocopolizza'), false)
})
