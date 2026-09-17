// Casi del motore di Portafoglio Compare (web/lib/compare/engine.ts).
// Non si lancia da solo: lo esegue compareEngine.test.mjs con
// --experimental-strip-types, perché il modulo è TypeScript.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const e = await import(pathToFileURL(join(here, '..', 'web', 'lib', 'compare', 'engine.ts')).href)

const IGN = e.parseIgnoreWords('srl, s.r.l., spa, s.p.a., snc, srls, sas')

test('similarity: tratti di lettere consecutive sul nome più lungo', () => {
  assert.equal(e.similarity('ANTONIO GIUSEPPE MARIA', 'GIUSEPPE MARIA', 4, IGN), 65)
  assert.equal(e.similarity('RC NAPOLI TRASPORTI', 'F1 TRASPORTI', 4, IGN), 53)
  assert.equal(e.similarity('A. GIOVANGOSINO', 'G. GIOVANGOSINO', 4, IGN), 92)
  assert.equal(e.similarity('Rossi Mario', 'MARIO ROSSI', 4, IGN), 100)
  assert.ok(e.similarity('AMATO MONICA', 'Buonamano Monica', 4, IGN) < 50)
  assert.ok(e.similarity('ANCONETANI VALERIA', 'Basile Valeria', 4, IGN) < 50)
  // pezzi più corti di n non contano
  assert.equal(e.similarity('AMA', 'BUONAMANO', 4), 0)
  // parole ignorate tolte prima
  assert.equal(e.similarity('Bianchi srl', 'BIANCHI S.R.L.', 4, IGN), 100)
})

test('normalise: Solo lettere senza accenti né maiuscole', () => {
  assert.equal(e.normalise('Nicolò D\'Alì 12', 'letters_only'), 'NICOLODALI')
  assert.equal(e.TRANSFORM_OPTIONS.find((o) => o.value === 'letters_only').label, 'Solo lettere')
})

const key = (col) => e.normaliseKey({ label: '', columnA: col, columnB: col, enabled: true, transform: 'none' })
const fuzzy = { enabled: true, minOverlap: 4, ignoreWords: 'srl', broadEnabled: false, thresholdLow: 50, thresholdHigh: 80 }

test('compare: soglie → scartate / da verificare / accettate', () => {
  const A = [{ Cliente: 'ANTONIO GIUSEPPE MARIA' }, { Cliente: 'AMATO MONICA' }, { Cliente: 'A. GIOVANGOSINO' }, { Cliente: 'ESATTO' }]
  const B = [{ Cliente: 'GIUSEPPE MARIA' }, { Cliente: 'BUONAMANO MONICA' }, { Cliente: 'G. GIOVANGOSINO' }, { Cliente: 'ESATTO' }]
  const r = e.compare(A, B, [key('Cliente')], fuzzy)
  assert.deepEqual(r.fuzzy.map((p) => [p.rowA.Cliente, p.score]), [['ANTONIO GIUSEPPE MARIA', 65]])
  assert.deepEqual(r.accepted.map((p) => [p.rowA.Cliente, p.score]), [['A. GIOVANGOSINO', 92]])
  assert.deepEqual(r.onlyA.map((x) => x.Cliente), ['AMATO MONICA'])
  assert.deepEqual(r.onlyB.map((x) => x.Cliente), ['BUONAMANO MONICA'])
})

test('compare: fuzzy spento → nessuna coppia', () => {
  const r = e.compare([{ C: 'MARIO ROSSI' }], [{ C: 'ROSSI MARIO' }], [key('C')], { ...fuzzy, enabled: false })
  assert.equal(r.fuzzy.length + r.accepted.length, 0)
  assert.equal(r.onlyA.length, 1)
})

test('abbinamento al candidato PIÙ simile, non al primo', () => {
  const A = [{ C: 'TRASPORTI VERDI' }]
  const B = [{ C: 'TRASPORTI ROSSI' }, { C: 'TRASPORTI VERDI SNC' }]
  const r = e.compare(A, B, [key('C')], { ...fuzzy, ignoreWords: '' })
  const all = [...r.fuzzy, ...r.accepted]
  assert.equal(all.length, 1)
  assert.equal(all[0].rowB.C, 'TRASPORTI VERDI SNC')
})

test('passata ampia: colonne diverse, ignora valori solo numerici', () => {
  const A = [{ Cliente: 'ALY AUTOTRASPORTI', Importo: '1000000' }]
  const B = [{ 'Descrizione Cliente': 'Aly Autotrasporti', Premio: '1000000' }, { 'Descrizione Cliente': 'Zeta', Premio: '1000000' }]
  const r = e.compare(A, B, [key('Numero Polizza')], { ...fuzzy, broadEnabled: true, broadMinOverlap: 6 })
  assert.equal(r.accepted.length, 1)
  assert.equal(r.accepted[0].kind, 'broad')
  assert.equal(r.accepted[0].rowB['Descrizione Cliente'], 'Aly Autotrasporti')
})

test('runEqualByKeys: uguale su almeno una chiave + fuzzy sui non trovati', () => {
  const keys = [key('Polizza'), key('Cliente')]
  const A = [{ Polizza: '1', Cliente: 'X' }, { Polizza: '9', Cliente: 'ROSSI MARIO' }, { Polizza: '7', Cliente: 'NESSUNO QUI' }, { Polizza: '8', Cliente: 'ANTONIO GIUSEPPE MARIA' }]
  const B = [{ Polizza: '1', Cliente: 'Y' }, { Polizza: '2', Cliente: 'mario rossi' }, { Polizza: '3', Cliente: 'GIUSEPPE MARIA' }]
  const r = e.runEqualByKeys(A, B, keys, { ...fuzzy, ignoreWords: '' })
  assert.deepEqual(r.rows.map((x) => x.matchCount), [1, 0, 0, 0])
  // nome invertito: non uguale, ma somiglianza 100% → accettata
  assert.equal(r.accepted.length + r.fuzzy.length, 2)
  assert.equal(r.fuzzy[0].rowA.Cliente, 'ANTONIO GIUSEPPE MARIA')
  assert.equal(r.accepted[0].rowA.Cliente, 'ROSSI MARIO')
})

test('chiavi: nome calcolato, forma esplicita A/B', () => {
  const k = e.normaliseKey({ label: 'vecchio', column: 'Targa', sheetA: 'Foglio2', sameColumn: true })
  assert.equal(k.columnA, 'Targa')
  assert.equal(k.columnB, 'Targa')
  assert.equal(k.sheetB, 'Foglio2')
  assert.equal(k.sameColumn, false)
  assert.equal(k.transform, 'letters_only')
  assert.equal(k.label, 'Targa - Foglio2 - Targa - Foglio2')
  assert.equal(e.keyLabel({ columnA: 'Cliente', columnB: 'Descrizione Cliente' }), 'Cliente - 1° foglio - Descrizione Cliente - 1° foglio')
})

test('profili: storico Comparazione e storico Confronto righe', () => {
  const base = e.defaultCompareConfig()
  const old = e.applyComparisonProfile(base, { matchKeys: [{ label: 'x', column: 'Polizza', transform: 'digits_only' }], fuzzyMinOverlap: 5 })
  assert.equal(old.matchKeys[0].columnB, 'Polizza')
  assert.equal(old.fuzzyMinOverlap, 5)
  assert.equal(old.fuzzyThresholdLow, 50)
  assert.equal(old.fuzzyThresholdHigh, 80)
  const rows = { bothMatchConditions: [
    { columnA: 'Cliente', columnB: 'Descrizione Cliente', mode: 'equals', transform: 'letters_only' },
    { columnA: 'Premio', columnB: 'Premio', mode: 'not_equals' },
  ], bothFilterConditions: [] }
  const conv = e.comparisonProfileFromRows(rows)
  assert.equal(conv.matchKeys.length, 1)
  assert.equal(conv.matchKeys[0].columnB, 'Descrizione Cliente')
  assert.equal(e.applyComparisonProfile(base, rows).matchKeys[0].columnA, 'Cliente')
  assert.equal(e.comparisonProfileFromRows({ bothMatchConditions: [{ columnA: 'a', columnB: 'b', mode: 'contains' }] }), null)
  assert.deepEqual(e.clampThresholds(90, 40), { low: 40, high: 90 })
})
