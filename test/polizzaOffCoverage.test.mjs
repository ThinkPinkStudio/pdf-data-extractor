// [flag paginecopertura] (07/10/2026) Allianz P09/P15: il massimale R.C.A.
// («Massimale R.C. pattuito - in caso di sinistro: limite di: 10.000.000,00»)
// finiva nel massimale della tutela legale; la sua pagina non nomina mai la
// copertura, il «massimale convenuto di euro 15.000,00 per singolo evento» sta
// nella pagina della Tutela Giudiziaria. ITAS P35: imposte del contratto intero.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { offCoverageAmounts } from '../src/services/polizzaService.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields.map((f) => (String(f.label).trim() === 'Massimale per sinistro tutela legale'
  ? { ...f, description: "Massimale per sinistro: l'importo massimo (in euro) che la compagnia paga per ogni singolo sinistro/evento coperto dalla garanzia tutela legale. È un importo (es. 20.000, 21.000,00)." }
  : f))
const sin = TL.find((f) => String(f.label).trim() === 'Massimale per sinistro tutela legale')
const COVER = [['tutela', 'legale'], ['tutela', 'giudiziaria']]
const RCA = 'Forma tariffaria: Bonus/Malus autovetture\nn  Massimale R.C. pattuito - in caso di sinistro:\n   limite di: 10.000.000,00 euro per danni a persone indipendentemente dal numero delle vittime'
const TG = 'Tutela Giudiziaria\nArticolo 1 - OGGETTO DELL\'ASSICURAZIONE\nL\'Impresa altresì assicura, nei limiti del massimale convenuto di euro 15.000,00 per\nsingolo evento, gli oneri relativi alla assistenza stragiudiziale e giudiziale.'
const docs = [{ name: 'POLIZZA PISAPIA.pdf', spatialPages: [RCA, TG] }]

test('paginecopertura: il massimale R.C.A. non sta in nessuna pagina della copertura → candidato della pagina Tutela Giudiziaria', () => {
  const best = { [sin.id]: { valore: '10.000.000,00', file: 'POLIZZA PISAPIA.pdf', page: 1 } }
  const log = { [sin.id]: [{ valore: '10.000.000,00', file: 'POLIZZA PISAPIA.pdf', page: 1, affinity: 0.5 }, { valore: '15.000,00', file: 'POLIZZA PISAPIA.pdf', page: 2, affinity: 0.48 }] }
  const out = offCoverageAmounts(best, TL, docs, COVER, log)
  assert.deepEqual(out.map((s) => [s.field.label.trim(), s.prima, s.valore, s.voti]), [['Massimale per sinistro tutela legale', '10.000.000,00', '15.000,00', 1]])
  // senza candidati in una pagina della copertura: vuoto
  assert.deepEqual(offCoverageAmounts(best, TL, docs, COVER, {}).map((s) => s.valore), [null])
})

test('paginecopertura: il valore che sta anche in una pagina della copertura resta; senza pagine della copertura non si giudica', () => {
  const best = { [sin.id]: { valore: '15.000,00', file: 'POLIZZA PISAPIA.pdf', page: 2 } }
  assert.deepEqual(offCoverageAmounts(best, TL, docs, COVER, {}), [])
  const onlyRca = [{ name: 'POLIZZA PISAPIA.pdf', spatialPages: [RCA] }]
  assert.deepEqual(offCoverageAmounts({ [sin.id]: { valore: '10.000.000,00', file: 'POLIZZA PISAPIA.pdf', page: 1 } }, TL, onlyRca, COVER, {}), [])
  // intestazione di colonna spezzata «TUTELA» / «LEGALE» (schede DAS condominio) = pagina della copertura
  const das = ['GARANZIE PRESCELTE                   TUTELA       IMPOSTE   PREMIO LORDO', '                                     LEGALE', 'Difesa Condominio - ed.2019          159,99       34,00     193,99', 'MASSIMALE PER SINISTRO EURO   31.000,00'].join('\n')
  const dasDocs = [{ name: 'S.pdf', spatialPages: [das, 'Condizioni di assicurazione tutela legale'] }]
  assert.deepEqual(offCoverageAmounts({ [sin.id]: { valore: '31.000,00', file: 'S.pdf', page: 1 } }, TL, dasDocs, COVER, {}), [])
})
