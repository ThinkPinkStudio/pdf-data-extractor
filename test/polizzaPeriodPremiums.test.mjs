// [flag periodopremi] (08/10/2026) CASORETTO P26: la decorrenza estratta è il
// rinnovo del 30/04/2026 (lettera del broker con le rate in scadenza: «i
// documenti sono tutti uguali», correzione dell'utente), ma lordo e voci del
// riepilogo venivano dalla scheda del 2020 (147,62 / 0,00 / 2,48 / 31,90 /
// 182,00). Le descrizioni chiedono date e premi del periodo PIÙ RECENTE.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { supersededPeriodPremiums } from '../src/services/polizzaService.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
// Descrizioni del profilo in produzione (07/10/2026).
const PROD = {
  Decorrenza: "Data di decorrenza della polizza: la data (giorno/mese/anno) da cui inizia la copertura del periodo PIÙ RECENTE (es. 04/06/2025, 27/04/2020): la data accanto a 'DECORRENZA' nel frontespizio, oppure il 'Dal' della quietanza di rinnovo più recente se ce n'è una (es. 'Dal 16/12/25 al 16/12/26' → 16/12/2025). È la data di INIZIO del periodo di copertura, NON la data di emissione del documento, NON la data di firma del profilo cliente o del questionario, NON la data di scadenza né la scadenza della prima quietanza.",
  Scadenza: "Data di scadenza della polizza: la data (giorno/mese/anno) in cui termina la copertura del periodo PIÙ RECENTE (es. 31/12/2022, 30/09/2021): la data accanto a 'SCADENZA' nel frontespizio, oppure l''al' della quietanza di rinnovo più recente se ce n'è una (es. 'Dal 16/12/25 al 16/12/26' → 16/12/2026). È la data di FINE del periodo di copertura, NON la 'scadenza 1^ quietanza' o di una rata, NON la data di emissione né la decorrenza.",
  Imposte: "Imposte sul premio annuo della tutela legale: l'importo (in euro) delle imposte sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale (es. 19,30, 44,69, 110,11). È un importo con due decimali.",
  Diritti: "Diritti della tutela legale: l'importo (in euro) dei diritti (di emissione, di quietanza) sul premio annuo della tutela legale, sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale (es. 0,00, 2,48, 19,30). È un importo con due decimali.",
  'Interessi di frazionamento': "Interessi di frazionamento della tutela legale: l'importo (in euro) aggiunto al premio annuo della tutela legale se il pagamento è rateizzato (es. 0,00, 2,48, 3,01), sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale.",
  'Premio imponibile tutela legale': "Premio imponibile (netto) ANNUO della tutela legale: la base imponibile del premio della tutela legale per un'annualità, al netto di imposte, diritti e interessi, come stampata nel documento. È un importo con due decimali (es. 207,83, 501,30, 757,82). Se il documento riporta la rata iniziale (o alla firma) e il premio annuo (o la rata annuale successiva), prendi il premio ANNUO; con più periodi, quello del periodo più recente. Non calcolarlo: se non è stampato lascia vuoto.",
  'Premio lordo totale tutela legale': "Premio lordo ANNUO della tutela legale: l'importo (in euro) comprensivo di imposte, diritti e interessi che il contraente paga per un'annualità di tutela legale, come stampato nel documento (es. 255,00, 611,41, 918,86). Se il documento riporta la rata iniziale (o alla firma) e il premio annuo (o la rata annuale successiva), prendi il premio ANNUO; con più periodi, quello del periodo più recente. NON il lordo dell'intero contratto con le altre sezioni, NON una rata frazionata. Non calcolarlo: se non è stampato lascia vuoto.",
}
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields.map((f) => (PROD[String(f.label).trim()] ? { ...f, description: PROD[String(f.label).trim()] } : f))
const byLabel = (label) => TL.find((f) => String(f.label).trim() === label)

const SCHEDA = 'CASORETTO 30A COND/TUT. LEGALE/CASORETTO 30-A CONDOMINIO.pdf'
const LETTERA = 'CASORETTO 30A COND/GLOB. FABBRICATI/ESTRATTO CONTO.pdf'
const schedaPage = [
  'Polizza Nr.   0146905087   MILANO   CA2019/DCO',
  'Decorrenza   Scadenza   Frazionamento   Scadenza 1a Quietanza',
  '30/04/2020   30/04/2021   ANNUALE   30/04/2021',
  'PREMIO TOTALE   NETTO IMPONIBILE   INTERESSI   DIRITTI   IMPOSTE   PREMIO LORDO',
  'PREMIO ALLA FIRMA   147,62   0,00   2,48   31,90   182,00',
].join('\n')
const letteraPage = [
  '       Tortona, 24/04/2026',
  '       ELENCO POLIZZE IN SCADENZA',
  '             Tipo Titolo                           N° Polizza    Scadenza Rata  Importo',
  '                             D.A.S. S.p.A. di ASS.NI',
  '                                                  0146905087',
  '                                 GERENZA',
  '          Quietanza Di Rinnovo                                    30/04/2026     214,00',
  '                               TUTELA LEGALE',
  '                               CONDOMINIO',
  '                             VITTORIA AG. CELIA    Emittenda',
  '             Sostituzione                                         30/04/2026    3.400,00',
  '                              Globale fabbricati',
  '        Totale Importo da versare: 3.614,00',
].join('\n')
const docs = [{ name: SCHEDA, spatialPages: [schedaPage] }, { name: LETTERA, spatialPages: [letteraPage] }]
const L = (label) => byLabel(label).id
const base = () => ({
  [L('N° Polizza')]: { valore: '0146905087', file: LETTERA, page: 1 },
  [L('Decorrenza')]: { valore: '30/04/2026', file: LETTERA, page: 1 },
  [L('Premio imponibile tutela legale')]: { valore: '147,62', file: SCHEDA, page: 1 },
  [L('Interessi di frazionamento')]: { valore: '0,00', file: SCHEDA, page: 1 },
  [L('Diritti')]: { valore: '2,48', file: SCHEDA, page: 1 },
  [L('Imposte')]: { valore: '31,90', file: SCHEDA, page: 1 },
  [L('Premio lordo totale tutela legale')]: { valore: '182,00', file: SCHEDA, page: 1 },
})

test('periodopremi: lordo del rinnovo dalla riga della decorrenza, voci del periodo superato vuote (P26)', () => {
  const out = supersededPeriodPremiums(base(), TL, docs)
  assert.deepEqual(out.map((s) => [s.field.label.trim(), s.valore]).sort(), [
    ['Diritti', null], ['Imposte', null], ['Interessi di frazionamento', null],
    ['Premio imponibile tutela legale', null], ['Premio lordo totale tutela legale', '214,00'],
  ])
})

test('periodopremi: niente se il documento nuovo stampa lo stesso lordo, se la decorrenza è del documento vecchio o se la riga non ha importi', () => {
  // stesso premio stampato anche nel documento nuovo (GOLDONI P30)
  const same = [{ name: SCHEDA, spatialPages: [schedaPage] }, { name: LETTERA, spatialPages: [letteraPage.replace('214,00', '182,00')] }]
  assert.deepEqual(supersededPeriodPremiums(base(), TL, same), [])
  // decorrenza dalla scheda: un solo periodo
  const b = base(); b[L('Decorrenza')] = { valore: '30/04/2020', file: SCHEDA, page: 1 }
  assert.deepEqual(supersededPeriodPremiums(b, TL, docs), [])
  // riga della decorrenza senza importi (appendice di sospensione, P17)
  const noAmt = [{ name: SCHEDA, spatialPages: [schedaPage] }, { name: LETTERA, spatialPages: ['Effetto appendice 30/04/2026 ore 24.00\nPremio netto   € 0,00'] }]
  assert.deepEqual(supersededPeriodPremiums(base(), TL, noAmt), [])
  // due polizze con la stessa data e nessun numero estratto: ambiguo
  const nonum = base(); delete nonum[L('N° Polizza')]
  assert.deepEqual(supersededPeriodPremiums(nonum, TL, docs), [])
})
