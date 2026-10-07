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

test('elenconegato: le garanzie NON operanti con voci di altre sezioni si svuotano; le garanzie scelte no', async () => {
  const { negativeListWithExcluded, negatedParenthesisItems } = await import('../src/services/polizzaService.js')
  // descrizioni del profilo in produzione (06/10/2026)
  const PROD = {
    'Garanzie non operanti': "Elenco dei nomi delle garanzie di tutela legale NON attivate/operanti: le garanzie del prodotto di tutela legale o della sezione tutela legale presenti nella scheda ma non scelte, come TESTO (es. Pacchetto difesa circolazione, Vertenze contrattuali), se la scheda le indica come non operanti o non scelte. Se la scheda elenca solo garanzie scelte (con premio), il campo resta VUOTO. NON le garanzie di altre sezioni della polizza (RCA, incendio, furto, kasko, infortuni), NON frasi delle condizioni o del set informativo, NON le garanzie operanti.",
    'Garanzie scelte/operanti': "Elenco dei nomi delle garanzie di tutela legale scelte/operanti: le garanzie attive del prodotto di tutela legale o della sezione tutela legale di una polizza più ampia, come TESTO (es. Tutela Legale, DAS Drive). Riporta i nomi delle garanzie ATTIVE di tutela legale, NON le garanzie di altre sezioni della polizza (RCA, incendio, furto, eventi naturali, cristalli, assistenza, infortuni), NON gli importi né le date.",
  }
  const fields = TL.map((f) => (PROD[String(f.label).trim()] ? { ...f, description: PROD[String(f.label).trim()] } : f))
  const non = fields.find((f) => String(f.label).trim() === 'Garanzie non operanti')
  const sce = fields.find((f) => String(f.label).trim() === 'Garanzie scelte/operanti')
  assert.ok(negatedParenthesisItems(non.description).includes('kasko'))
  const best = {
    [non.id]: { valore: 'Incendio, Salvaspese, Eventi Naturali, Kasko Collisione, Cristalli, Assistenza, Tutela Legale' },
    [sce.id]: { valore: 'Assistenza Welfare, Tutela Legale Pacchetto Base, Pacchetto sicurezza privacy e cyber' },
  }
  const out = negativeListWithExcluded(best, fields)
  assert.deepEqual(out.map((s) => [s.field.label.trim(), s.voci]), [['Garanzie non operanti', ['Incendio', 'Kasko Collisione']]])
  assert.deepEqual(negativeListWithExcluded({ [non.id]: { valore: 'USA e Canada, Vertenze contrattuali' } }, fields), [])
})

test('pivapiede: la P.IVA DAS sta solo nelle righe societarie della griglia (P34); quella del contraente nel blocco anagrafico no', async () => {
  const { isInsurerFooterPIva } = await import('../src/services/polizzaValidation.js')
  const grid = [
    'Contraente / Assicurato (Ragione / Denominazione Sociale) Partita Iva/Codice Fiscale Codice Categoria               Professione/Attività',
    'LIVRAGHI 1/A CONDOMINIO                                                            CONDOMINIO                       CONDOMINIO',
    'dasdifesalegale@pec.das.it - www.das.it   Partita IVA 01333550323 - CCIAA VR - REA n.98740 Società soggetta alla direzione e coordinamento di Assicurazioni Generali S.p.A.',
  ].join('\n')
  assert.equal(isInsurerFooterPIva(grid, '01333550323'), true)
  const withOwn = grid.replace('LIVRAGHI 1/A CONDOMINIO                                                            CONDOMINIO', 'LIVRAGHI 1/A CONDOMINIO              97312860154                                   CONDOMINIO')
  assert.equal(isInsurerFooterPIva(withOwn, '97312860154'), false)
})

test('esplicita: una franchigia mai accanto alla parola «franchigia» si svuota (P08), una in colonna FRANCHIGIA resta', async () => {
  const { explicitLabelValues } = await import('../src/services/polizzaService.js')
  const F = {
    id: 'fr', label: 'Franchigia generica o minima', enabled: true,
    description: "Franchigia della tutela legale: l'importo (in euro) che resta a carico dell'assicurato per ogni sinistro di tutela legale, indicato esplicitamente come franchigia nella scheda o nella sezione tutela legale della polizza (es. 200,00, 1.000,00). NON sono franchigie della tutela legale quelle di altre garanzie o sezioni della polizza (incendio, eventi atmosferici, acqua condotta, kasko, furto, cristalli), NON i limiti tipo anticipo spese penale doloso, NON i massimali né i premi. Se la tutela legale non ha una franchigia indicata, lascia il campo vuoto.",
  }
  const setInf = { name: 'Set Informativo.pdf', spatialPages: ['3.1.1 La garanzia non vale:', 'a) se il valore economico della controversia è inferiore a 500,00 euro;'] }
  assert.deepEqual(explicitLabelValues({ fr: { valore: '500,00', file: 'Set Informativo.pdf', page: 1 } }, [F], [setInf]).map((s) => s.valore), ['500,00'])
  const table = { name: 'pestalozza.pdf', spatialPages: ['Garanzia                    Massimale       Franchigia', 'Tutela Legale               30.000,00       250', 'Ricorso terzi               1.000.000,00'] }
  assert.deepEqual(explicitLabelValues({ fr: { valore: '250', file: 'pestalozza.pdf', page: 1 } }, [F], [table]), [])
  // valore che non si ritrova nel testo: resta
  assert.deepEqual(explicitLabelValues({ fr: { valore: '777,00', file: 'x.pdf', page: 1 } }, [F], [setInf]), [])
})
