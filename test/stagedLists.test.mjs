import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { listItems, findListSource } from '../src/services/polizzaService.js'
import { normForMatch } from '../src/services/polizzaValidation.js'

const doc = (name, pages) => ({ name, pages, normPages: pages.map((p) => normForMatch(p)) })

test('listItems: solo elenchi «voce; voce» con voci vere', () => {
  assert.deepEqual(listItems('Perdita documenti; Privacy e GDPR; Interruzione attività'), ['Perdita documenti', 'Privacy e GDPR', 'Interruzione attività'])
  assert.deepEqual(listItems('Perdita documenti'), [])
  assert.deepEqual(listItems('RC; XY'), [], 'voci troppo corte')
})

test('findListSource: la pagina con più voci, tra quelle della chiamata', () => {
  const a = doc('A', ['4. Esclusioni: danni da inquinamento; attività di sindaco', 'Condizioni: perdita documenti'])
  const b = doc('B', ['Estensioni operanti: perdita documenti, privacy e GDPR, interruzione attività'])
  const src = findListSource([a, b], 'Perdita documenti; Privacy e GDPR; Interruzione attività')
  assert.equal(src.file, 'B'); assert.equal(src.page, 1)
  const callPages = new Map([['A', new Set([1, 2])]])
  assert.equal(findListSource([a, b], 'Perdita documenti; Privacy e GDPR; Interruzione attività', null, callPages), null, 'B fuori dalla chiamata, A ha una voce sola')
})
