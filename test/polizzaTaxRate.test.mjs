// [flag aliquota] (06/10/2026) Polizze auto Allianz (P09 COI GV474DJ, P14
// FERRARA FR601AK): la tabella «Coperture | Importo prima rata (1) | Aliquota
// Imposta | Importo Imposte | Contributo SSN | Importo lordo alla firma» ha
// l'intestazione su due righe e la griglia fonde la seconda in una cella sola
// («prima rata (1) Imposta Importo Imposte SSN»): le colonne non distinguono
// l'imponibile dalle imposte. La riga sì: 16,17 × 12,50% = 2,02 e 16,17 + 2,02
// = 18,19, il lordo già estratto.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { taxRateRow } from '../src/services/polizzaService.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
// Descrizioni del profilo in produzione (06/10/2026) per i campi del premio.
const PROD = {
  Imposte: "Imposte sul premio annuo della tutela legale: l'importo (in euro) delle imposte sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale (es. 19,30, 44,69, 110,11). È un importo con due decimali.",
  Diritti: "Diritti della tutela legale: l'importo (in euro) dei diritti (di emissione, di quietanza) sul premio annuo della tutela legale, sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale (es. 0,00, 2,48, 19,30). È un importo con due decimali.",
  'Interessi di frazionamento': "Interessi di frazionamento della tutela legale: l'importo (in euro) aggiunto al premio annuo della tutela legale se il pagamento è rateizzato (es. 0,00, 2,48, 3,01), sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale.",
  'Premio imponibile tutela legale': "Premio imponibile (netto) ANNUO della tutela legale: la base imponibile del premio della tutela legale per un'annualità, al netto di imposte, diritti e interessi, come stampata nel documento. È un importo con due decimali (es. 207,83, 501,30, 757,82).",
  'Premio lordo totale tutela legale': "Premio lordo ANNUO della tutela legale: l'importo (in euro) comprensivo di imposte, diritti e interessi che il contraente paga per un'annualità di tutela legale, come stampato nel documento (es. 255,00, 611,41, 918,86).",
}
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields.map((f) => (PROD[String(f.label).trim()] ? { ...f, description: PROD[String(f.label).trim()] } : f))
const byLabel = (label) => TL.find((f) => String(f.label).trim() === label)

// Righe della griglia pdf.js di POLIZZA GV474DJ.pdf p.10 (P09).
const PAGE = [
  '                                                              Importo      Aliquota               Contributo    Importo lordo',
  '                 Coperture                                    prima rata (1) Imposta Importo Imposte SSN        alla firma',
  "                 Responsabilita' Civile Auto                    788,71       16,00%   126,19         82,81        997,71",
  '                 Tutela Giudiziaria                              16,17       12,50%     2,02                      18,19',
  '                 Incendio, Furto, Kasko, Quota Garanzie ...   1.029,91       13,50%   139,04                    1.168,95',
  '                 Assistenza                                      45,00       10,00%     4,50                      49,50',
  '                 Totali                                       1.900,63                274,56         82,81      2.258,00',
].join('\n')
const FILE = 'BESA/COI TECHNOLOGY  GV474DJ/POLIZZA GV474DJ.pdf'
const docs = [{ name: FILE, spatialPages: ['', PAGE] }]

const imp = byLabel('Premio imponibile tutela legale'), tax = byLabel('Imposte'), gross = byLabel('Premio lordo totale tutela legale')

test('aliquota: netto, aliquota e imposta della riga del lordo → imponibile e imposte vuoti', () => {
  const best = { [gross.id]: { valore: '18,19', file: FILE, page: 2 } }
  const out = taxRateRow(best, TL, docs)
  assert.deepEqual(out.map((s) => [s.field.label.trim(), s.valore, s.riga, s.page]), [
    ['Premio imponibile tutela legale', '16,17', 'Tutela Giudiziaria', 2],
    ['Imposte', '2,02', 'Tutela Giudiziaria', 2],
  ])
})

test('aliquota: un campo già pieno con lo stesso valore resta, l\'altro si riempie; con un valore diverso niente', () => {
  const same = { [gross.id]: { valore: '18,19', file: FILE, page: 2 }, [tax.id]: { valore: '2,02', file: FILE, page: 2 } }
  assert.deepEqual(taxRateRow(same, TL, docs).map((s) => [s.field.label.trim(), s.valore]), [['Premio imponibile tutela legale', '16,17']])
  const other = { [gross.id]: { valore: '18,19', file: FILE, page: 2 }, [imp.id]: { valore: '18,00', file: FILE, page: 2 } }
  assert.deepEqual(taxRateRow(other, TL, docs), [])
})

test('aliquota: niente senza la percentuale, se la somma non torna, o se il lordo è quello del contratto', () => {
  const noPct = [{ name: FILE, spatialPages: [PAGE.replace('12,50%', '      ')] }]
  assert.deepEqual(taxRateRow({ [gross.id]: { valore: '18,19', file: FILE, page: 1 } }, TL, noPct), [])
  const badSum = [{ name: FILE, spatialPages: [PAGE.replace('18,19', '18,20')] }]
  assert.deepEqual(taxRateRow({ [gross.id]: { valore: '18,20', file: FILE, page: 1 } }, TL, badSum), [])
  // «Totali»: 1.900,63 + 274,56 ≠ 2.258,00 (c'è il contributo SSN) e nessuna aliquota nella riga
  assert.deepEqual(taxRateRow({ [gross.id]: { valore: '2.258,00', file: FILE, page: 2 } }, TL, docs), [])
})
