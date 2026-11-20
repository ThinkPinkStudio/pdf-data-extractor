import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { formFieldItems, textContentToBlocks, withFreshTextLayer } from '../src/services/pdfTextLayer.js'
import { buildSpatialPage } from '../src/services/ocrLayout.js'

const W = (o) => ({ subtype: 'Widget', annotationFlags: 4, ...o })

test('campi compilabili: testo, caselle e scelte come voci nella loro posizione; nascosti e pulsanti fuori', () => {
  const items = formFieldItems([
    W({ fieldType: 'Tx', fieldValue: 'MASTRANTONIO\rLORENZO', rect: [120, 700, 300, 714] }),
    W({ fieldType: 'Btn', checkBox: true, fieldValue: 'Yes', rect: [50, 600, 60, 610] }),
    W({ fieldType: 'Btn', checkBox: true, fieldValue: 'Off', rect: [80, 600, 90, 610] }),
    W({ fieldType: 'Btn', radioButton: true, fieldValue: 'NO', buttonValue: 'SI', rect: [50, 580, 60, 590] }),
    W({ fieldType: 'Btn', radioButton: true, fieldValue: 'NO', buttonValue: 'NO', rect: [80, 580, 90, 590] }),
    W({ fieldType: 'Ch', fieldValue: ['Annuale'], rect: [50, 560, 120, 570] }),
    W({ fieldType: 'Tx', fieldValue: 'nascosto', annotationFlags: 2, rect: [0, 0, 10, 10] }),
    W({ fieldType: 'Btn', pushButton: true, rect: [0, 0, 10, 10] }),
    W({ fieldType: 'Tx', fieldValue: '   ', rect: [0, 0, 10, 10] }),
    { subtype: 'Link', rect: [0, 0, 10, 10] },
  ])
  assert.deepEqual(items.map((i) => i.str), ['MASTRANTONIO LORENZO', '[X]', '[ ]', '[ ]', '[X]', 'Annuale'])
  assert.equal(items[0].transform[4], 121, 'x del campo')
})

test('campi compilabili: il valore sta sulla riga della sua etichetta nella griglia', () => {
  const H = 842
  const content = { items: [{ str: 'CONTRAENTE:', transform: [10, 0, 0, 10, 40, 700], width: 60 }] }
  const extra = formFieldItems([W({ fieldType: 'Tx', fieldValue: 'MASTRANTONIO LORENZO', rect: [120, 696, 300, 712] })])
  const grid = buildSpatialPage(textContentToBlocks({ items: [...content.items, ...extra] }, { pageHeight: H }))
  assert.match(grid, /CONTRAENTE:\s+MASTRANTONIO LORENZO/)
})

test('withFreshTextLayer: pagine digitali dal text layer di adesso, scansioni dalla cache', () => {
  assert.deepEqual(withFreshTextLayer(['vecchio', 'ocr p2', 'vecchio 3'], ['nuovo', '', 'nuovo 3']), ['nuovo', 'ocr p2', 'nuovo 3'])
  assert.deepEqual(withFreshTextLayer(['a', 'b'], ['x']), ['a', 'b'], 'conteggi diversi: invariato')
  assert.deepEqual(withFreshTextLayer(['a'], null), ['a'])
})
