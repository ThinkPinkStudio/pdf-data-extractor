// [flag rigagriglia] Lettura deterministica della GRIGLIA dopo il merge (05/10/2026):
// (1) un importo della copertura letto nella riga dei totali passa alla riga
// della copertura nella stessa colonna (Allianz «Totali» → «Tutela
// Giudiziaria»); (2) i campi vuoti che la descrizione lega alla «stessa riga»
// del premio prendono la cella sotto l'intestazione che li nomina (DAS:
// interessi 0,00 sotto FRAZIONAMENTO). Righe copiate dalle griglie pdf.js vere.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { completeRowFromGrid, coverRowFromGrid, gridHeaderAbove, gridAmountTokens, gridRowLabel } from '../src/services/polizzaService.js'
import { engineFlag, KNOWN_FLAGS } from '../src/services/engineFlags.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
// Descrizioni v4 del profilo in produzione per i campi del premio.
const V4 = {
  'Interessi di frazionamento': "Interessi di frazionamento della tutela legale: l'importo (in euro) aggiunto al premio annuo della tutela legale se il pagamento è rateizzato (es. 0,00, 2,48, 3,01), sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale. È un importo con due decimali; se è stampato a zero riporta '0,00'. Se per la tutela legale la voce non è stampata, lascia vuoto: non calcolarla. NON il contributo al Servizio Sanitario Nazionale, NON un valore di altre sezioni o garanzie della polizza.",
  Diritti: "Diritti della tutela legale: l'importo (in euro) dei diritti (di emissione, di quietanza) sul premio annuo della tutela legale, sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale (es. 0,00, 2,48, 19,30). È un importo con due decimali; se è stampato a zero riporta '0,00'. Se per la tutela legale la voce non è stampata, lascia vuoto: non calcolarla.",
  Imposte: "Imposte sul premio annuo della tutela legale: l'importo (in euro) delle imposte sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale (es. 19,30, 44,69, 110,11). È un importo con due decimali. Per un prodotto di sola tutela legale sono le imposte del premio annuo del contratto; in una polizza con più sezioni sono le imposte della SEZIONE tutela legale, se stampate. NON le imposte dell'intero contratto con le altre sezioni, NON il premio lordo né l'imponibile.",
  'Premio imponibile tutela legale': "Premio imponibile (netto) ANNUO della tutela legale: la base imponibile del premio della tutela legale per un'annualità, al netto di imposte, diritti e interessi, come stampata nel documento. È un importo con due decimali (es. 207,83, 501,30, 757,82).",
  'Premio lordo totale tutela legale': "Premio lordo ANNUO della tutela legale: l'importo (in euro) comprensivo di imposte, diritti e interessi che il contraente paga per un'annualità di tutela legale, come stampato nel documento (es. 255,00, 611,41, 918,86). Per un prodotto di sola tutela legale è il premio lordo annuo del contratto; in una polizza con più sezioni è il lordo della SEZIONE tutela legale, se stampato. NON il lordo dell'intero contratto con le altre sezioni, NON una rata frazionata.",
}
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields.map((f) => (V4[String(f.label).trim()] ? { ...f, description: V4[String(f.label).trim()] } : f))
const F = (label) => TL.find((f) => String(f.label).trim() === label)
const COVER = [['tutela', 'legale'], ['tutela', 'giudiziaria']]
const entry = (valore, file, page = 1) => ({ valore, file, page })

// Scheda DAS Difesa Condominio (MONZA 293, pag. 1).
const DAS = [
  '     GARANZIE PRESCELTE',
  '                                                                                       TUTELA      PERDITE     ASSISTENZA    IMPOSTE     PREMIO',
  '                                                                                       LEGALE     PECUNIARIE                              LORDO',
  '     Difesa Condominio - ed.2019                                                         147,62                                  31,37      178,99',
  '            Segue Elenco Rischi                                    PREMIO ANNUO          147,62         0,00         0,00        31,37      178,99',
  '      PARAMETRI TARIFFA ATTIVATI',
  '   codice civile: artt. 1892 (Dichiarazioni inesatte e reticenze con dolo o colpa grave), 1893 (Dichiarazioni inesatte e reticenze senza dolo o colpa grave).',
  '   PREMIO TOTALE                                 FRAZIONAMENTO   NETTO IMPONIBILE     RIMBORSO          DIRITTO        IMPOSTE       PREMIO LORDO',
  '   PREMIO RATA INIZIALE                                     0,00            75,04             0,00            2,48           16,48           94,00',
  '   PREMIO RATA SUCCESSIVA                                   0,00           147,62                             2,48           31,90          182,00',
].join('\n')

test('gridHeaderAbove: l\'intestazione è la cella che si sovrappone di più, su più righe se serve', () => {
  const lines = DAS.split('\n')
  const i = lines.findIndex((l) => l.includes('PREMIO RATA SUCCESSIVA'))
  const [zero, imp, dir] = gridAmountTokens(lines[i])
  assert.equal(gridHeaderAbove(lines, i, zero.a, zero.b), 'FRAZIONAMENTO')
  assert.equal(gridHeaderAbove(lines, i, imp.a, imp.b), 'NETTO IMPONIBILE')
  assert.equal(gridHeaderAbove(lines, i, dir.a, dir.b), 'DIRITTO')
  const k = lines.findIndex((l) => l.includes('Difesa Condominio - ed.2019'))
  const lordo = gridAmountTokens(lines[k]).at(-1)
  assert.equal(gridHeaderAbove(lines, k, lordo.a, lordo.b), 'PREMIO LORDO')
  assert.equal(gridRowLabel(lines[k]), 'Difesa Condominio - ed.2019')
  assert.deepEqual(gridAmountTokens('Tutela Giudiziaria   16,17   12,50%   2,02   18,19').map((t) => t.text), ['16,17', '2,02', '18,19'])
})

test('completeRowFromGrid: gli interessi 0,00 sotto FRAZIONAMENTO della riga che porta i premi estratti', () => {
  const file = 'MONZA 293 CONDOMINIO.pdf'
  const docs = [{ name: file, spatialPages: [DAS] }]
  const best = {
    [F('Premio imponibile tutela legale').id]: entry('147,62', file),
    [F('Diritti').id]: entry('2,48', file),
    [F('Imposte').id]: entry('31,37', file),
    [F('Premio lordo totale tutela legale').id]: entry('178,99', file),
  }
  const out = completeRowFromGrid(best, TL, docs)
  assert.deepEqual(out.map((s) => [s.field.label.trim(), s.valore, s.riga, s.colonna]), [['Interessi di frazionamento', '0,00', 'PREMIO RATA SUCCESSIVA', 'FRAZIONAMENTO']])
  // un campo già estratto non si tocca
  assert.equal(completeRowFromGrid({ ...best, [F('Interessi di frazionamento').id]: entry('3,01', file) }, TL, docs).length, 0)
  // con un solo valore estratto nella riga, nessuna riga del premio
  const one = { [F('Diritti').id]: entry('2,48', file) }
  assert.equal(completeRowFromGrid(one, TL, docs).length, 0)
  // valori di un'altra pagina: niente
  const other = Object.fromEntries(Object.entries(best).map(([k, e]) => [k, { ...e, page: 2 }]))
  assert.equal(completeRowFromGrid(other, TL, docs).length, 0)
})

test('completeRowFromGrid: solo i campi che la descrizione lega alla «stessa riga»', () => {
  const file = 'MONZA 293 CONDOMINIO.pdf'
  const docs = [{ name: file, spatialPages: [DAS] }]
  const best = {
    [F('Interessi di frazionamento').id]: entry('0,00', file),
    [F('Diritti').id]: entry('2,48', file),
    [F('Imposte').id]: entry('31,90', file),
  }
  // l'imponibile non è legato alla «stessa riga» dalla sua descrizione: resta vuoto
  assert.equal(completeRowFromGrid(best, TL, docs).filter((s) => s.field.label.trim() === 'Premio imponibile tutela legale').length, 0)
})

// Polizza auto Allianz (COI TECHNOLOGY GV474DJ, pag. 10).
const ALLIANZ = [
  '          Prospetto di liquidazione fiscale dell\'importo alla firma (importi espressi in Euro)',
  '                                                       Importo      Aliquota               Contributo    Importo lordo',
  '          Coperture                                    prima rata (1) Imposta Importo Imposte SSN        alla firma',
  '          Responsabilita\' Civile Auto                    788,71       16,00%   126,19         82,81        997,71',
  '          Tutela Giudiziaria                              16,17       12,50%     2,02                      18,19',
  '          Incendio, Furto, Kasko, Quota Garanzie ...   1.029,91       13,50%   139,04                    1.168,95',
  '          Quota Garanzie Aggiuntive                       20,84       13,50%     2,81                      23,65',
  '          Assistenza                                      45,00       10,00%     4,50                      49,50',
  '          Totali                                       1.900,63                274,56         82,81      2.258,00',
].join('\n')

test('coverRowFromGrid: imposte e lordo dei «Totali» passano alla riga «Tutela Giudiziaria» della stessa colonna', () => {
  const file = 'POLIZZA GV474DJ.pdf'
  const docs = [{ name: file, spatialPages: [ALLIANZ] }]
  const best = {
    [F('Imposte').id]: entry('274,56', file),
    [F('Premio lordo totale tutela legale').id]: entry('2.258,00', file),
  }
  const out = coverRowFromGrid(best, TL, docs, COVER)
  assert.deepEqual(out.map((s) => [s.field.label.trim(), s.prima, s.valore, s.da, s.riga]).sort(), [
    ['Imposte', '274,56', '2,02', 'Totali', 'Tutela Giudiziaria'],
    ['Premio lordo totale tutela legale', '2.258,00', '18,19', 'Totali', 'Tutela Giudiziaria'],
  ])
  // senza il nome della copertura (profilo senza «Come riconoscerla»): niente
  assert.equal(coverRowFromGrid(best, TL, docs, []).length, 0)
  // un valore già nella riga della copertura non si sposta
  assert.equal(coverRowFromGrid({ [F('Imposte').id]: entry('2,02', file) }, TL, docs, COVER).length, 0)
})

test('coverRowFromGrid: mai nella colonna di un altro campo, mai per un prodotto con pacchetti di tutela legale', () => {
  // Unipol (BERTOLOTTI): la colonna della riga «Tutela legale» è «Premio lordo
  // annuo»: il lordo passa a 21,37, le imposte no (la colonna è del lordo).
  const UNIPOL = [
    '         Garanzia                              Massimale          Franchigia        Premio lordo annuo',
    '                                           Somma Assicurata        Scoperto        (comprensivo delle riduzioni)',
    '        Incendio                                  € 9.400,00          //                       € 22,56',
    '        Furto e Rapina                            € 9.400,00      € 200,00 - 10 %             € 144,54',
    '        Eventi naturali Base                      € 9.400,00      € 200,00 - 10 %             € 201,03',
    '        Cristalli Riparazione Libera                                                           € 42,46',
    '        Assistenza "Completa"                                                                  € 48,58',
    '        Tutela legale                              € 20.000                                    € 21,37',
    '        Garanzie accessorie - R.C.A. \'\'Extra\'\'                                                  € 9,08',
    '         TOTALE DA PAGARE',
    '         Premio netto                                                                         € 758,58',
    '         Imposte                                                                              € 108,51',
    '         Totale alla firma                                                                    € 900,00',
  ].join('\n')
  const file = 'POLIZZA.pdf'
  const docs = [{ name: file, spatialPages: [UNIPOL] }]
  const best = {
    [F('Imposte').id]: entry('108,51', file),
    [F('Premio lordo totale tutela legale').id]: entry('900,00', file),
  }
  const out = coverRowFromGrid(best, TL, docs, COVER)
  assert.deepEqual(out.map((s) => [s.field.label.trim(), s.valore]), [['Premio lordo totale tutela legale', '21,37']])
  // Prodotto DAS con pacchetti: «Tutela Legale Pacchetto Base» non è la riga
  // della copertura (altre parole nell'etichetta): il totale del contratto resta.
  const DASPKG = [
    '                                                   PREMIO LORDO',
    '   Tutela Legale Pacchetto Base                       240,00',
    '   Assistenza Welfare                                  30,00',
    '   Pacchetto sicurezza privacy e cyber                 60,00',
    '   TOTALE                                             330,00',
  ].join('\n')
  const b2 = { [F('Premio lordo totale tutela legale').id]: entry('330,00', 'das.pdf') }
  assert.equal(coverRowFromGrid(b2, TL, [{ name: 'das.pdf', spatialPages: [DASPKG] }], COVER).length, 0)
})

test('coverRowFromGrid: il premio della SEZIONE della copertura non scende sulla sua prima garanzia', () => {
  // Vittoria (BOIARDO, pag. 3): 757,82 è l'imponibile della sezione, sotto il
  // titolo «SEZIONE TUTELA LEGALE»; «TUTELA LEGALE … 249,06» è una sua garanzia.
  const VITT = [
    '         GELO                                                                             Imponibile annuo       € 140,47',
    '         CONDUTTURE INTERRATE                                                             Imponibile annuo       € 144,53',
    '         INTASAMENTO GRONDE E PLUVIALI                                                    Imponibile annuo        € 42,56',
    '       SEZIONE TUTELA LEGALE',
    '                  Prima rata        € 757,82        Rate successive             € 757,82  Imponibile annuo       € 757,82',
    '         TUTELA LEGALE                                                                    Imponibile annuo       € 249,06',
    '            Somma Assicurata                         € 30.000,00',
    '         VERTENZE CON CONDOMINI E RECUPERO SPESE CONDOMINIALI                             Imponibile annuo       € 508,76',
  ].join('\n')
  const best = { [F('Premio imponibile tutela legale').id]: entry('757,82', 'boiardo.pdf', 1) }
  assert.equal(coverRowFromGrid(best, TL, [{ name: 'boiardo.pdf', spatialPages: [VITT] }], COVER).length, 0)
})

test('flag rigagriglia: acceso di default (misura offline del 05/10: +19 −1 su 41 posizioni), spegnibile', () => {
  assert.ok('rigagriglia' in KNOWN_FLAGS)
  assert.equal(engineFlag({}, 'rigagriglia'), true)
  assert.equal(engineFlag({ polizzaEngineFlags: '-rigagriglia' }, 'rigagriglia'), false)
})

test('riepilogoAnchorField: diritti, interessi e imposte sono legati all\'imponibile; imponibile e lordo a nessuno', async () => {
  const { riepilogoAnchorField } = await import('../src/services/polizzaService.js')
  const imp = F('Premio imponibile tutela legale')
  assert.equal(riepilogoAnchorField(F('Diritti'), TL)?.id, imp.id)
  assert.equal(riepilogoAnchorField(F('Interessi di frazionamento'), TL)?.id, imp.id)
  assert.equal(riepilogoAnchorField(F('Imposte'), TL)?.id, imp.id)
  assert.equal(riepilogoAnchorField(imp, TL), null)
  assert.equal(riepilogoAnchorField(F('Premio lordo totale tutela legale'), TL), null)
})

test('riepilogoMismatches: imposte di un altro documento rispetto all\'imponibile legato → da svuotare; stessa pagina o valore non ritrovato → niente', async () => {
  const { riepilogoMismatches } = await import('../src/services/polizzaService.js')
  const POL = '       SEZIONE TUTELA LEGALE\n                  Prima rata        € 616,64        Imponibile annuo       € 616,64'
  const QUI = '   PREMIO DI RATA      IMPONIBILE €      IMPOSTE €      TOTALE €\n                         3.112,52          687,48       3.800,00'
  const docs = [{ name: 'polizza.pdf', spatialPages: [POL] }, { name: 'quietanza.pdf', spatialPages: [QUI] }]
  const best = {
    [F('Premio imponibile tutela legale').id]: entry('616,64', 'polizza.pdf'),
    [F('Imposte').id]: entry('687,48', 'quietanza.pdf'),
  }
  assert.deepEqual(riepilogoMismatches(best, TL, docs).map((s) => [s.field.label.trim(), s.valore]), [['Imposte', '687,48']])
  // imponibile e imposte nella stessa pagina: niente
  const same = { [F('Premio imponibile tutela legale').id]: entry('3.112,52', 'quietanza.pdf'), [F('Imposte').id]: entry('687,48', 'quietanza.pdf') }
  assert.equal(riepilogoMismatches(same, TL, docs).length, 0)
  // valore non ritrovato nella griglia (scansione illeggibile): non si giudica
  const ghost = { [F('Premio imponibile tutela legale').id]: entry('616,64', 'polizza.pdf'), [F('Imposte').id]: entry('99,99', 'quietanza.pdf') }
  assert.equal(riepilogoMismatches(ghost, TL, docs).length, 0)
})

test('validateCrossFields: diritti uguali alle imposte si svuotano solo con componentiImposte', async () => {
  const { validateCrossFields } = await import('../src/services/polizzaValidation.js')
  const mk = () => ({ [F('Diritti').id]: { valore: '424,93' }, [F('Imposte').id]: { valore: '424,93' } })
  const off = mk(); validateCrossFields(off, TL, {})
  assert.ok(F('Diritti').id in off)
  const on = mk(); validateCrossFields(on, TL, { componentiImposte: true })
  assert.ok(!(F('Diritti').id in on))
  assert.ok(F('Imposte').id in on)
})
