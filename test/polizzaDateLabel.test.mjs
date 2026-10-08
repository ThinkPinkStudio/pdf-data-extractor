// [flag etichettadata] Una data sotto un'etichetta che nomina il campo meno di
// un'altra data della stessa pagina (08/10/2026, P17 Unipol: atto di sospensione).
import test from 'node:test'
import assert from 'node:assert/strict'
import { betterLabelledDates } from '../src/services/polizzaService.js'

const SCAD = { id: 's', label: 'X', description: 'Data di scadenza della polizza: la data (giorno/mese/anno) in cui termina la copertura del periodo PIÙ RECENTE (es. 31/12/2022). NON la data di emissione.' }
const DEC = { id: 'd', label: 'Y', description: 'Data di decorrenza della polizza: la data da cui inizia la copertura (es. 04/06/2025).' }
const page = [
  '  RUZZA FABIO                         EA 26813                N° Appendice 3',
  '                                                              Effetto appendice 24/04/2026 ore 24.00',
  '                                                              Scadenza Sospensione 11/08/2026 ore 24.00',
  '                                                              Scadenza Polizza 20/03/2027',
  '                                                              1° quietanza da emettere 20/03/2027',
].join('\n')
const docs = [{ name: 'sosp.pdf', spatialPages: [page] }]

test('etichettadata: «Scadenza Sospensione» → «Scadenza Polizza» della stessa pagina', () => {
  const best = { s: { valore: '11/08/2026', file: 'sosp.pdf', page: 1 }, d: { valore: '24/04/2026', file: 'sosp.pdf', page: 1 } }
  const out = betterLabelledDates(best, [SCAD, DEC], docs)
  assert.equal(out.length, 1)
  assert.equal(out[0].field.id, 's')
  assert.equal(out[0].valore, '20/03/2027')
  assert.equal(out[0].etichetta, 'Scadenza Polizza')
})

test('etichettadata: il valore già sotto l\'etichetta migliore resta; senza etichetta sulla pagina non decide', () => {
  assert.equal(betterLabelledDates({ s: { valore: '20/03/2027', file: 'sosp.pdf', page: 1 } }, [SCAD], docs).length, 0)
  // il valore non compare etichettato nella pagina: si ignora da dove l'ha letto il modello
  assert.equal(betterLabelledDates({ s: { valore: '31/10/2022', file: 'sosp.pdf', page: 1 } }, [SCAD], docs).length, 0)
})

test('etichettadata: mai verso una data impossibile né tra due alternative pari', () => {
  const p2 = ['DECORRENZA 31/09/2022', 'Rata dal 31/10/2022'].join('\n')
  assert.equal(betterLabelledDates({ d: { valore: '31/10/2022', file: 'a.pdf', page: 1 } }, [DEC], [{ name: 'a.pdf', spatialPages: [p2] }]).length, 0)
  const p3 = ['Decorrenza 01/01/2025', 'Decorrenza 01/02/2025', 'Effetto 05/05/2025'].join('\n')
  assert.equal(betterLabelledDates({ d: { valore: '05/05/2025', file: 'b.pdf', page: 1 } }, [DEC], [{ name: 'b.pdf', spatialPages: [p3] }]).length, 0)
})
