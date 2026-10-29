// [flag coppietesto] Coppie etichetta→valore anche per i TESTI sotto
// l'intestazione di colonna, solo nella pertinenza (05/10/2026, DAS GOLDONI:
// «Tutela Legale  ESCLUSA  31.000,00» letta come esclusione della copertura;
// ESCLUSA sta sotto «Indicizzazione»).
import test from 'node:test'
import assert from 'node:assert/strict'
import { detectLabelValuePairs } from '../src/services/ocrLayout.js'
import { withPairs } from '../src/services/polizzaService.js'
import { engineFlag, KNOWN_FLAGS } from '../src/services/engineFlags.js'

const GOLDONI = [
  '         Dal 31/03/26 al 31/03/27    ANNUALE         01469',
  '         Descrizione                Indicizzazione   Massimale',
  '                                                                                                                        per',
  '         Tutela Legale              ESCLUSA          31.000,00',
  '                                                                                                                        il',
  '         Premio netto      Imposte             Premio lordo',
  '         € 162,47          € 34,53             €  197,00',
].join('\n')

test('detectLabelValuePairs text: ESCLUSA sotto Indicizzazione, saltando la scritta a margine', () => {
  const pairs = detectLabelValuePairs(GOLDONI, { text: true }).map((p) => `${p.label} → ${p.value}`)
  assert.ok(pairs.includes('Indicizzazione → ESCLUSA'), pairs.join(' | '))
  assert.ok(pairs.includes('Descrizione → Tutela Legale'), pairs.join(' | '))
  assert.ok(pairs.includes('Massimale → 31.000,00'), pairs.join(' | '))
  // senza l'opzione: nessuna coppia di testo
  const plain = detectLabelValuePairs(GOLDONI).map((p) => `${p.label} → ${p.value}`)
  assert.ok(!plain.includes('Indicizzazione → ESCLUSA'))
  // due righe di sole intestazioni non si abbinano tra loro
  const two = detectLabelValuePairs('   TUTELA      PERDITE     PREMIO\n   LEGALE      PECUNIARIE  LORDO\n', { text: true })
  assert.equal(two.length, 0)
})

test('withPairs: il testo delle coppie cambia solo con text', () => {
  assert.ok(withPairs(GOLDONI, { text: true }).includes('"Indicizzazione" → ESCLUSA'))
  assert.ok(!withPairs(GOLDONI).includes('"Indicizzazione" → ESCLUSA'))
})

test('flag coppietesto: acceso di default (prova del 06/10: GOLDONI estratta, nessun esito peggiorato)', () => {
  assert.ok('coppietesto' in KNOWN_FLAGS)
  assert.equal(engineFlag({}, 'coppietesto'), true)
})
