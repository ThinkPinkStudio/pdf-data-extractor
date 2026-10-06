// [flag gemelli] (06/10/2026) Massimale annuo copiato dal massimale per sinistro.
// Allianz P14: «Massimale euro 15.000,00 per sinistro» finiva anche nel
// «Massimale per anno»; P15: il massimale R.C.A. «in caso di sinistro» su tutti e
// due. Nelle verità dei 45 fascicoli TL l'annuo non è mai uguale al per sinistro
// («illimitato» o vuoto); dove il documento dice «per sinistro e per anno» i due
// valori restano.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { twinCopyAmounts } from '../src/services/polizzaService.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields
const byLabel = (label) => TL.find((f) => String(f.label).trim() === label)
const sin = byLabel('Massimale per sinistro tutela legale'), anno = byLabel('Massimale per anno tutela legale')
const run = (page, v = '15.000,00') => {
  const docs = [{ name: 'P.pdf', spatialPages: [page] }]
  return twinCopyAmounts({ [sin.id]: { valore: v, file: 'P.pdf', page: 1 }, [anno.id]: { valore: v, file: 'P.pdf', page: 1 } }, TL, docs)
    .map((s) => [s.field.label.trim(), s.valore, s.gemello.label.trim()])
}

test('gemelli: il valore sta solo accanto a «per sinistro» → l\'annuo è una copia', () => {
  assert.deepEqual(run('n   Tutela Legale\nn   Massimale euro 15.000,00 per sinistro'), [['Massimale per anno tutela legale', '15.000,00', 'Massimale per sinistro tutela legale']])
  // l'etichetta sulla riga sopra (senza importi) conta
  assert.deepEqual(run('n   Massimale R.C. pattuito - in caso di sinistro:\n    limite di: 10.000.000,00 euro per danni a persone', '10.000.000,00').map((x) => x[0]), ['Massimale per anno tutela legale'])
})

test('gemelli: «per sinistro e per anno», righe senza le parole, riga sopra con un suo importo → niente', () => {
  assert.deepEqual(run('Massimale per sinistro e per anno: € 15.000,00'), [])
  assert.deepEqual(run('Somma Assicurata   € 15.000,00'), [])
  // «Imponibile annuo € 397,09» è la riga di un altro importo, non l'etichetta del massimale
  assert.deepEqual(run('TUTELA LEGALE   Imponibile annuo   € 397,09\nSomma Assicurata   € 15.000,00'), [])
  // valori diversi: nessun gemello
  const docs = [{ name: 'P.pdf', spatialPages: ['Massimale euro 15.000,00 per sinistro, 30.000,00 per anno'] }]
  assert.deepEqual(twinCopyAmounts({ [sin.id]: { valore: '15.000,00', file: 'P.pdf', page: 1 }, [anno.id]: { valore: '30.000,00', file: 'P.pdf', page: 1 } }, TL, docs), [])
})

test('gemelli: il valore sta solo accanto a «per anno» → il per sinistro è la copia', () => {
  assert.deepEqual(run('Limite annuo di indennizzo € 15.000,00 per anno assicurativo').map((x) => x[0]), ['Massimale per sinistro tutela legale'])
})
