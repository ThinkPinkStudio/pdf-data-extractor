// [flag etichettariga] (06/10/2026) Schede DAS Drive (P03, P04, P12): il
// Frazionamento finiva «Rata Successiva», un pezzo dell'etichetta della riga
// «PREMIO RATA SUCCESSIVA» della tabella dei premi; nella stessa scheda
// «Annuale» sta sotto l'intestazione FRAZIONAMENTO. Dopo il merge (la stessa
// regola nello Stadio A.7 spostava la cascata: P04 date, P12 tipologia).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rowPieceLayoutValue } from '../src/services/polizzaService.js'
import { distinctiveHeadTokens } from '../src/services/polizzaValidation.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields
const byLabel = (label) => TL.find((f) => String(f.label).trim() === label)
const tok = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((t) => t.length >= 4)
const DISTINCT = distinctiveHeadTokens(TL, tok)
const fraz = byLabel('Frazionamento')

// Righe della griglia pdf.js di «Polizza Das In Movimento (2).pdf» p.3 (P03).
const CARD = [
  '             DATI CONTRATTUALI',
  '             DECORRENZA   SCADENZA      FRAZIONAMENTO      SCADENZA 1^ QUIETANZA CONVENZIONE',
  '             30/06/2025   31/12/2026    Annuale             31/12/2025       DAS DRIVE',
  '             PREMIO TOTALE                                    NETTO IMPONIBILE INTERESSE DI  DIRITTI       IMPOSTE     PREMIO LORDO',
  '                                                                             FRAZIONAMENTO',
  '             PREMIO ALLA FIRMA                                   12,44          0,00          0,00          1,56         14,00',
  '             PREMIO RATA SUCCESSIVA                              24,88          0,00          0,00          3,12         28,00',
].join('\n')
const FILE = 'BESA/FN527EA/Polizza Das In Movimento (2).pdf'

test('etichettariga: «Rata Successiva» dalla riga dei premi → «Annuale» sotto FRAZIONAMENTO', () => {
  const best = { [fraz.id]: { valore: 'Rata Successiva', file: FILE, page: 1 } }
  const out = rowPieceLayoutValue(best, TL, [{ name: FILE, spatialPages: [CARD] }], DISTINCT)
  assert.deepEqual(out.map((s) => [s.field.label.trim(), s.prima, s.valore, s.etichetta]), [['Frazionamento', 'Rata Successiva', 'Annuale', 'FRAZIONAMENTO']])
})

test('etichettariga: coppia «etichetta: valore» e valore già giusto non si toccano; senza intestazione il valore resta', () => {
  // P19 Allianz: «Periodicità di pagamento: Annuale … 602,00» è una coppia, non l'etichetta di una riga di premi
  const allianz = 'Premio\nPeriodicità di pagamento: Annuale               Premio lordo alla Firma: Euro 602,00\nScadenza prossima rata: 31/12/2023'
  const cert = 'Scadenza annua:               31/12/2023\nFrazionamento del premio:     Annuale\nMassimale R.C. pattuito:      10.000.000 euro'
  const docs = [{ name: 'POLIZZA 2.pdf', spatialPages: [allianz] }, { name: 'CERTIFICATO.pdf', spatialPages: [cert] }]
  assert.deepEqual(rowPieceLayoutValue({ [fraz.id]: { valore: 'Annuale', file: 'POLIZZA 2.pdf', page: 1 } }, TL, docs, DISTINCT), [])
  // pezzo dell'etichetta ma nessuna intestazione che nomini il campo: resta com'è
  const noHeader = CARD.split('\n').slice(3).join('\n')
  assert.deepEqual(rowPieceLayoutValue({ [fraz.id]: { valore: 'Rata Successiva', file: FILE, page: 1 } }, TL, [{ name: FILE, spatialPages: [noHeader] }], DISTINCT), [])
})

test('etichettariga: mai per scelte chiuse né per elenchi', () => {
  const page = 'GARANZIE PRESCELTE              TUTELA LEGALE   IMPOSTE   PREMIO LORDO\nDifesa Condominio - ed.2019     159,99          34,00     193,99'
  const tip = { ...byLabel('Tipologia tutela legale'), description: 'Tipologia della copertura di tutela legale: la categoria prevalente, una tra Azienda, Professionista/Studio professionale, Auto/Circolazione, Condominio, Altra tipologia.' }
  const gar = byLabel('Garanzie scelte/operanti')
  const fields = TL.map((f) => (f.id === tip.id ? tip : f))
  const best = { [tip.id]: { valore: 'Condominio', file: 'S.pdf', page: 1 }, [gar.id]: { valore: 'Difesa Condominio', file: 'S.pdf', page: 1 } }
  assert.deepEqual(rowPieceLayoutValue(best, fields, [{ name: 'S.pdf', spatialPages: [page] }], distinctiveHeadTokens(fields, tok)), [])
})

test('testolettere: «1°» come Frazionamento → il candidato con lettere più votato; senza candidati → vuoto', async () => {
  const { letterlessTextValues } = await import('../src/services/polizzaService.js')
  const log = { [fraz.id]: [{ valore: '1°', affinity: 0.5 }, { valore: 'ANNUALE', affinity: 0.4 }, { valore: 'Annuale', affinity: 0.45 }, { valore: 'ANNUALE', affinity: 0.41 }, { valore: 'semestrali', affinity: 0.6 }] }
  const out = letterlessTextValues({ [fraz.id]: { valore: '1°' } }, TL, log)
  assert.deepEqual(out.map((s) => [s.field.label.trim(), s.prima, s.valore, s.voti]), [['Frazionamento', '1°', 'Annuale', 3]])
  assert.deepEqual(letterlessTextValues({ [fraz.id]: { valore: '1°' } }, TL, {}).map((s) => s.valore), [null])
  // un numero di polizza fatto di sole cifre non è un TESTO per la sua descrizione
  const num = byLabel('N° Polizza')
  assert.deepEqual(letterlessTextValues({ [num.id]: { valore: '283618616' } }, TL, {}), [])
})

test('titolovoce: Parametro vuoto → la voce sotto «PARAMETRI TARIFFA ATTIVATI»; un titolo che non sta in fila nella descrizione no', async () => {
  const { titledItemValue } = await import('../src/services/polizzaService.js')
  const PARAM = "Parametro su cui si calcola o si regola il premio: il NOME del parametro dichiarato in polizza, come TESTO (es. Retribuzioni, Fatturato, N° addetti, Unità immobiliari), cioè la voce della scheda di polizza (tabella rischi assicurati, parametri di tariffa attivati, clausola di regolazione) a cui è associato un valore dichiarato (un importo o un numero). Vuoto se la polizza non dichiara alcun parametro."
  const fields = TL.map((f) => (String(f.label).trim() === 'Parametro regolazione' ? { ...f, description: PARAM } : f))
  const par = fields.find((f) => String(f.label).trim() === 'Parametro regolazione')
  const page = 'MASSIMALE PER SINISTRO EURO   26.000,00\nPARAMETRI TARIFFA ATTIVATI\nX  Unità Immobiliari                                   : 52\nIl Contraente esprime il proprio consenso'
  const out = titledItemValue({}, fields, [{ name: 'CIRO MENOTTI 21.pdf', spatialPages: [page] }])
  assert.deepEqual(out.map((s) => [s.field.id === par.id, s.valore, s.titolo]), [[true, 'Unità Immobiliari', 'PARAMETRI TARIFFA ATTIVATI']])
  // campo già pieno: niente
  assert.deepEqual(titledItemValue({ [par.id]: { valore: 'Fatturato' } }, fields, [{ name: 'X.pdf', spatialPages: [page] }]), [])
  // «polizza   polizza» (stessa parola due volte) non è un titolo della descrizione
  const cond = 'polizza                            polizza\nse indicati in 12 mesi'
  assert.deepEqual(titledItemValue({}, fields, [{ name: 'C.pdf', spatialPages: [cond] }]), [])
})

test('etichettamodulo: campo di testo vuoto dal valore sotto l\'etichetta di modulo con una parola distintiva della testa (P06)', async () => {
  const { formLabelFill } = await import('../src/services/polizzaService.js')
  const F = [
    { id: 'att', label: 'Attività assicurata', enabled: true, description: "Attività assicurata: il settore o tipo di attività del contraente/assicurato che è oggetto della copertura (es. Servizi vari, Condominio). È un TESTO che descrive l'attività, non un importo né una data." },
    { id: 'con', label: 'Contraente', enabled: true, description: 'Nome o ragione sociale del contraente: il soggetto che stipula la polizza.' },
    { id: 'ind', label: 'Indirizzo', enabled: true, description: 'Indirizzo completo di domicilio o sede legale del contraente: via, numero civico, CAP, città.' },
  ]
  const page = [
    'COGNOME, NOME, RAGIONE SOCIALE                          CODICE FISCALE / PARTITA IVA',
    'BESA ING SANTANGELO S.P.A.                              13251900158',
    'SETTORE ATTIVITÀ                     FORMA GIURIDICA',
    'Servizi vari                         S.p.A.',
  ].join('\n')
  const docs = [{ name: 'Polizza.pdf', spatialPages: [page] }]
  assert.deepEqual(formLabelFill({}, F, docs).map((s) => [s.field.id, s.valore, s.etichetta]), [
    ['att', 'Servizi vari', 'SETTORE ATTIVITÀ'],
    ['con', 'BESA ING SANTANGELO S.P.A.', 'COGNOME, NOME, RAGIONE SOCIALE'],
  ])
  // campo già pieno: non si tocca
  assert.deepEqual(formLabelFill({ att: { valore: 'Condominio' }, con: { valore: 'BESA' } }, F, docs), [])
})
