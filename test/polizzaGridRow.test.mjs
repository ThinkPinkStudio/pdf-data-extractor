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
// Descrizioni v4 del profilo in produzione per i campi del premio e la franchigia.
const V4 = {
  'Interessi di frazionamento': "Interessi di frazionamento della tutela legale: l'importo (in euro) aggiunto al premio annuo della tutela legale se il pagamento è rateizzato (es. 0,00, 2,48, 3,01), sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale. È un importo con due decimali; se è stampato a zero riporta '0,00'. Se per la tutela legale la voce non è stampata, lascia vuoto: non calcolarla. NON il contributo al Servizio Sanitario Nazionale, NON un valore di altre sezioni o garanzie della polizza.",
  Diritti: "Diritti della tutela legale: l'importo (in euro) dei diritti (di emissione, di quietanza) sul premio annuo della tutela legale, sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale (es. 0,00, 2,48, 19,30). È un importo con due decimali; se è stampato a zero riporta '0,00'. Se per la tutela legale la voce non è stampata, lascia vuoto: non calcolarla.",
  Imposte: "Imposte sul premio annuo della tutela legale: l'importo (in euro) delle imposte sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale (es. 19,30, 44,69, 110,11). È un importo con due decimali. Per un prodotto di sola tutela legale sono le imposte del premio annuo del contratto; in una polizza con più sezioni sono le imposte della SEZIONE tutela legale, se stampate. NON le imposte dell'intero contratto con le altre sezioni, NON il premio lordo né l'imponibile.",
  'Premio imponibile tutela legale': "Premio imponibile (netto) ANNUO della tutela legale: la base imponibile del premio della tutela legale per un'annualità, al netto di imposte, diritti e interessi, come stampata nel documento. È un importo con due decimali (es. 207,83, 501,30, 757,82).",
  'Franchigia generica o minima': "Franchigia della tutela legale: l'importo (in euro) che resta a carico dell'assicurato per ogni sinistro di tutela legale, indicato esplicitamente come franchigia nella scheda o nella sezione tutela legale della polizza (es. 200,00, 1.000,00). NON sono franchigie della tutela legale quelle di altre garanzie o sezioni della polizza (incendio, eventi atmosferici, acqua condotta, kasko, furto, cristalli), NON i limiti tipo anticipo spese penale doloso, NON i massimali né i premi. Se la tutela legale non ha una franchigia indicata, lascia il campo vuoto.",
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

test('includedComponentFields: il lordo «comprensivo di imposte, diritti e interessi» comprende quei tre campi', async () => {
  const { includedComponentFields } = await import('../src/services/polizzaService.js')
  const got = includedComponentFields(F('Premio lordo totale tutela legale'), TL).map((f) => f.label.trim()).sort()
  assert.deepEqual(got, ['Diritti', 'Imposte', 'Interessi di frazionamento'])
  assert.deepEqual(includedComponentFields(F('Imposte'), TL), [])
})

test('includedComponentsRowFix: il lordo della tabella senza diritti passa alla riga che porta diritti e imponibile', async () => {
  const { includedComponentsRowFix } = await import('../src/services/polizzaService.js')
  const file = 'MONZA 293 CONDOMINIO.pdf'
  const docs = [{ name: file, spatialPages: [DAS] }]
  const best = {
    [F('Premio imponibile tutela legale').id]: entry('147,62', file),
    [F('Diritti').id]: entry('2,48', file),
    [F('Imposte').id]: entry('31,37', file),
    [F('Premio lordo totale tutela legale').id]: entry('178,99', file),
  }
  const out = includedComponentsRowFix(best, TL, docs)
  assert.deepEqual(out.map((s) => [s.field.label.trim(), s.prima, s.valore, s.riga]), [['Premio lordo totale tutela legale', '178,99', '182,00', 'PREMIO RATA SUCCESSIVA']])
  // diritti nulli o assenti: niente
  assert.equal(includedComponentsRowFix({ ...best, [F('Diritti').id]: entry('0,00', file) }, TL, docs).length, 0)
  const noDir = { ...best }; delete noDir[F('Diritti').id]
  assert.equal(includedComponentsRowFix(noDir, TL, docs).length, 0)
  // lordo già nella riga con i diritti: niente
  assert.equal(includedComponentsRowFix({ ...best, [F('Premio lordo totale tutela legale').id]: entry('182,00', file) }, TL, docs).length, 0)
})

test('riepilogoMismatches: il lordo «comprensivo» delle imposte segue il riepilogo dell\'imponibile (legame transitivo)', async () => {
  const { riepilogoMismatches } = await import('../src/services/polizzaService.js')
  const POL = '       SEZIONE TUTELA LEGALE\n                  Prima rata        € 616,64        Imponibile annuo       € 616,64'
  const TOT = '   PREMIO DI RATA      IMPONIBILE €      IMPOSTE €      TOTALE €\n                         3.112,52          687,48       3.800,00'
  const docs = [{ name: 'polizza.pdf', spatialPages: [POL, TOT] }]
  const best = {
    [F('Premio imponibile tutela legale').id]: entry('616,64', 'polizza.pdf', 1),
    [F('Premio lordo totale tutela legale').id]: entry('3.800,00', 'polizza.pdf', 2),
  }
  assert.deepEqual(riepilogoMismatches(best, TL, docs).map((s) => [s.field.label.trim(), s.anchor.label.trim()]), [['Premio lordo totale tutela legale', 'Premio imponibile tutela legale']])
})

test('riepilogoMismatches: per valore — la scheda che stampa lo stesso imponibile del rinnovo tiene i suoi diritti 0,00', async () => {
  const { riepilogoMismatches } = await import('../src/services/polizzaService.js')
  // DAS COI (P11): rata 2026 senza diritti; scheda con la stessa riga 24,88 · 0,00 · 0,00 · 3,12 · 28,00
  const QUI = '        Premio netto      Imposte              Premio lordo\n        €  24,88          €  3,12              € 28,00'
  const SCH = '      PREMIO TOTALE      NETTO IMPONIBILE INTERESSE DI  DIRITTI       IMPOSTE     PREMIO LORDO\n      PREMIO ALLA FIRMA            24,88          0,00          0,00          3,12         28,00'
  const docs = [{ name: 'rata2026.pdf', spatialPages: [QUI] }, { name: 'scheda.pdf', spatialPages: [SCH] }]
  const best = {
    [F('Premio imponibile tutela legale').id]: entry('24,88', 'rata2026.pdf'),
    [F('Diritti').id]: entry('0,00', 'scheda.pdf'),
  }
  assert.equal(riepilogoMismatches(best, TL, docs).length, 0)
  // DAS VERRO (P43): la scheda 2020 ha un altro imponibile → i suoi diritti sono di un periodo superato
  const SCH20 = '      PREMIO TOTALE      NETTO IMPONIBILE   DIRITTO   IMPOSTE   PREMIO LORDO\n      PREMIO RATA INIZIALE        142,45        2,48     31,31        176,24'
  const QUI26 = '        Premio netto      Imposte              Premio lordo\n        €  147,62          €  31,38              € 179,00'
  const docs2 = [{ name: 'rinnovo2026.pdf', spatialPages: [QUI26] }, { name: 'scheda2020.pdf', spatialPages: [SCH20] }]
  const best2 = { [F('Premio imponibile tutela legale').id]: entry('147,62', 'rinnovo2026.pdf'), [F('Diritti').id]: entry('2,48', 'scheda2020.pdf') }
  assert.deepEqual(riepilogoMismatches(best2, TL, docs2).map((s) => s.field.label.trim()), ['Diritti'])
})

test('anchorByElimination: l\'imponibile vuoto è l\'unico importo libero della riga di imposte e lordo (Allianz)', async () => {
  const { anchorByElimination } = await import('../src/services/polizzaService.js')
  const file = 'POLIZZA GV474DJ.pdf'
  const docs = [{ name: file, spatialPages: [ALLIANZ] }]
  const best = {
    [F('Imposte').id]: entry('2,02', file),
    [F('Premio lordo totale tutela legale').id]: entry('18,19', file),
  }
  assert.deepEqual(anchorByElimination(best, TL, docs).map((s) => [s.field.label.trim(), s.valore, s.riga]), [['Premio imponibile tutela legale', '16,17', 'Tutela Giudiziaria']])
  // imponibile già estratto: niente
  assert.equal(anchorByElimination({ ...best, [F('Premio imponibile tutela legale').id]: entry('16,17', file) }, TL, docs).length, 0)
  // senza un secondo valore estratto nella riga: niente (la riga non è provata)
  assert.equal(anchorByElimination({ [F('Imposte').id]: entry('2,02', file) }, TL, docs).length, 0)
  // riga RCA: due importi liberi (788,71 e 82,81) → niente
  const rca = { [F('Imposte').id]: entry('126,19', file), [F('Premio lordo totale tutela legale').id]: entry('997,71', file) }
  assert.equal(anchorByElimination(rca, TL, docs).length, 0)
})

test('jobProfileFor: il profilo del job, o quello con più id in comune (profili clonati)', async () => {
  const { jobProfileFor } = await import('../src/services/polizzaService.js')
  const tl3 = { id: 'tl3', name: 'Tutela Legale 3', fields: TL }
  const rctop = { id: 'rctop', name: 'RCTOP', fields: TL.slice(0, 16) } // clonato: 16 id in comune
  const copia = { id: 'copia', name: 'TL3 prova', enabled: false, fields: TL }
  const settings = { polizzaProfiles: [rctop, tl3, copia] }
  assert.equal(jobProfileFor(settings, TL)?.id, 'tl3') // prima era RCTOP, il primo con un id in comune
  assert.equal(jobProfileFor({ ...settings, polizzaJobProfileId: 'copia' }, TL)?.id, 'copia')
  assert.equal(jobProfileFor({ polizzaProfiles: [rctop] }, [{ id: 'altro' }]), null)
})

test('coverRowFromGrid: valore letto da un altro documento (certificato) → riga della copertura nella polizza', () => {
  const docs = [{ name: 'CERTIFICATO.pdf', spatialPages: ['   Premio lordo annuo complessivo   740,50\n   Imposte   88,16'] }, { name: 'POLIZZA.pdf', spatialPages: [ALLIANZ.replace('274,56', '88,16')] }]
  const best = { [F('Imposte').id]: entry('88,16', 'CERTIFICATO.pdf') }
  const out = coverRowFromGrid(best, TL, docs, COVER)
  assert.deepEqual(out.map((s) => [s.valore, s.file, s.riga]), [['2,02', 'POLIZZA.pdf', 'Tutela Giudiziaria']])
})

test('unprintedRowItems: diritti e interessi letti in colonne che non li nominano (Allianz) → da svuotare', async () => {
  const { unprintedRowItems } = await import('../src/services/polizzaService.js')
  const file = 'POLIZZA GV474DJ.pdf'
  const docs = [{ name: file, spatialPages: [ALLIANZ] }]
  // diritti = «Importo prima rata» della riga Tutela Giudiziaria, interessi = «Contributo SSN» della RCA
  const best = {
    [F('Diritti').id]: entry('16,17', file),
    [F('Interessi di frazionamento').id]: entry('82,81', file),
    [F('Imposte').id]: entry('2,02', file),
  }
  assert.deepEqual(unprintedRowItems(best, TL, docs).map((s) => [s.field.label.trim(), s.valore]).sort(), [
    ['Diritti', '16,17'],
    ['Interessi di frazionamento', '82,81'],
  ])
  // le imposte sotto «Imposta Importo» sono nominate dall'intestazione: restano
  assert.equal(unprintedRowItems({ [F('Imposte').id]: entry('2,02', file) }, TL, docs).length, 0)
  // un valore che si ritrova anche fuori dalle tabelle («Diritti: 16,17») resta
  const docs2 = [{ name: file, spatialPages: [ALLIANZ + '\n          Diritti di emissione:   16,17'] }]
  assert.equal(unprintedRowItems({ [F('Diritti').id]: entry('16,17', file) }, TL, docs2).length, 0)
})

test('unprintedRowItems: la cella sotto l\'intestazione che nomina il campo resta; gli zeri non si giudicano', async () => {
  const { unprintedRowItems } = await import('../src/services/polizzaService.js')
  const file = 'MONZA 293 CONDOMINIO.pdf'
  const docs = [{ name: file, spatialPages: [DAS] }]
  // 2,48 sotto DIRITTO: nominato
  assert.equal(unprintedRowItems({ [F('Diritti').id]: entry('2,48', file) }, TL, docs).length, 0)
  // 0,00 sotto FRAZIONAMENTO o sotto colonne del prodotto: uno zero stampato è un dato, non si giudica
  assert.equal(unprintedRowItems({ [F('Diritti').id]: entry('0,00', file), [F('Interessi di frazionamento').id]: entry('0,00', file) }, TL, docs).length, 0)
  // l'imponibile non è legato a un riepilogo: mai giudicato
  assert.equal(unprintedRowItems({ [F('Premio imponibile tutela legale').id]: entry('147,62', file) }, TL, docs).length, 0)
})

// Appendice di rinnovo Vittoria «Con Te Condomini» (RAMAZZINI 2, pag. 4).
const VITTORIA = [
  '       SEZIONE DANNI DA ACQUA CONDOTTA',
  '            Somma Assicurata                         € 1.000 per sinistro e € 3.000 per anno assicurativo',
  '            Valore Immobile                          € 7.344.937,94',
  '            Franchigia                               300',
  '         CONDUTTURE INTERRATE                                                             Imponibile annuo        € 288,71',
  '            Franchigia                               300',
  '       SEZIONE TUTELA LEGALE',
  '                  Prima rata         € 379,96       Rate successive              € 379,96 Imponibile annuo        € 379,96',
  '         TUTELA LEGALE                                                                    Imponibile annuo        € 379,96',
  '            Somma Assicurata                         € 20.000,00',
].join('\n')

test('otherSectionAmounts: la franchigia della SEZIONE DANNI DA ACQUA CONDOTTA non è della tutela legale', async () => {
  const { otherSectionAmounts } = await import('../src/services/polizzaService.js')
  const file = 'RAMAZZINI APPENDICE DI RINNOVO.pdf'
  const docs = [{ name: file, spatialPages: [VITTORIA] }]
  assert.deepEqual(otherSectionAmounts({ [F('Franchigia generica o minima').id]: entry('300', file) }, TL, docs, COVER).map((s) => [s.field.label.trim(), s.valore, s.sezione]),
    [['Franchigia generica o minima', '300', 'SEZIONE DANNI DA ACQUA CONDOTTA']])
  // l'imponibile della SEZIONE TUTELA LEGALE resta
  assert.equal(otherSectionAmounts({ [F('Premio imponibile tutela legale').id]: entry('379,96', file) }, TL, docs, COVER).length, 0)
  // senza una sezione intestata alla copertura nel documento: niente (prodotto di sola tutela legale)
  const noTl = [{ name: file, spatialPages: [VITTORIA.split('\n').slice(0, 6).join('\n')] }]
  assert.equal(otherSectionAmounts({ [F('Franchigia generica o minima').id]: entry('300', file) }, TL, noTl, COVER).length, 0)
  // senza il nome della copertura (profilo senza «Come riconoscerla»): niente
  assert.equal(otherSectionAmounts({ [F('Franchigia generica o minima').id]: entry('300', file) }, TL, docs, []).length, 0)
  // un valore che compare anche nella sezione della copertura resta
  const both = [{ name: file, spatialPages: [VITTORIA + '\n            Franchigia                               300'] }]
  assert.equal(otherSectionAmounts({ [F('Franchigia generica o minima').id]: entry('300', file) }, TL, both, COVER).length, 0)
})

test('componentsOverGross: imposte del contratto oltre il lordo della tutela legale che le comprende → vuote (Unipol P01)', async () => {
  const { componentsOverGross } = await import('../src/services/polizzaService.js')
  const best = {
    [F('Premio lordo totale tutela legale').id]: entry('21,37', 'POLIZZA.pdf', 4),
    [F('Imposte').id]: entry('108,51', 'POLIZZA.pdf', 7),
    [F('Diritti').id]: entry('2,48', 'POLIZZA.pdf', 7),
  }
  assert.deepEqual(componentsOverGross(best, TL).map((s) => [s.field.label.trim(), s.valore, s.lordoValore]), [['Imposte', '108,51', '21,37']])
  // imposte sotto il lordo: niente
  assert.equal(componentsOverGross({ ...best, [F('Imposte').id]: entry('3,81', 'POLIZZA.pdf', 4) }, TL).length, 0)
  // senza lordo: niente
  assert.equal(componentsOverGross({ [F('Imposte').id]: entry('108,51', 'POLIZZA.pdf', 7) }, TL).length, 0)
})

test('coverSectionAmounts: l\'imponibile della prima riga della SEZIONE TUTELA LEGALE, non della quietanza del contratto (Vittoria P44)', async () => {
  const { coverSectionAmounts } = await import('../src/services/polizzaService.js')
  const POL = [
    '       SEZIONE DANNI DA ACQUA CONDOTTA',
    '                  Prima rata         € 597,61       Rate successive              € 597,61  Imponibile annuo        € 597,61',
    '         ACQUA CONDOTTA                                                                    Imponibile annuo        € 152,86',
    '       SEZIONE TUTELA LEGALE IN',
    '                  Prima rata         € 343,86       Rate successive              € 343,86  Imponibile annuo        € 343,86',
    '         TUTELA LEGALE                                                                     Imponibile annuo         € 91,35',
    '         VERTENZE CON CONDOMINI E CONDUTTORI-CASI ILLIMITATI                               Imponibile annuo        € 199,66',
    '            - Garanzia Pacchetto Acqua Condotta franchigia di € 200,00',
  ].join('\n')
  const docs = [{ name: 'polizza.pdf', spatialPages: ['', '', '', POL] }, { name: 'quietanza.pdf', spatialPages: ['   2075,07     424,93     2500'] }]
  const best = { [F('Premio imponibile tutela legale').id]: entry('2075,07', 'quietanza.pdf') }
  assert.deepEqual(coverSectionAmounts(best, TL, docs, COVER).map((s) => [s.field.label.trim(), s.prima, s.valore, s.page, s.etichetta]),
    [['Premio imponibile tutela legale', '2075,07', '343,86', 4, 'Imponibile annuo']])
  // valore già giusto: niente
  assert.equal(coverSectionAmounts({ [F('Premio imponibile tutela legale').id]: entry('343,86', 'polizza.pdf', 4) }, TL, docs, COVER).length, 0)
  // solo la prima riga della sezione: la «franchigia di € 200,00» delle clausole sotto non conta
  assert.equal(coverSectionAmounts({}, TL, docs, COVER).filter((s) => /Franchigia/.test(s.field.label)).length, 0)
  // senza il nome della copertura: niente
  assert.equal(coverSectionAmounts(best, TL, docs, []).length, 0)
})

test('detailedRiepilogo: il «Premio netto» della quietanza comprende i diritti della scheda con le stesse imposte e lo stesso lordo (GOLDONI P30)', async () => {
  const { detailedRiepilogo } = await import('../src/services/polizzaService.js')
  const QUI = [
    '        Premio netto      Imposte              Premio lordo',
    '        €  162,47          €  34,53              € 197,00',
  ].join('\n')
  const SCH = [
    '   PREMIO TOTALE                                 FRAZIONAMENTO   NETTO IMPONIBILE     RIMBORSO          DIRITTO        IMPOSTE       PREMIO LORDO',
    '   PREMIO RATA INIZIALE                                     0,00           159,99             0,00            2,48           34,53          197,00',
    '   PREMIO RATA SUCCESSIVA                                   0,00           159,99                             2,48           34,53          197,00',
  ].join('\n')
  const docs = [{ name: 'rinnovo 2026.pdf', spatialPages: [QUI] }, { name: 'scheda.pdf', spatialPages: [SCH] }]
  const best = {
    [F('Premio imponibile tutela legale').id]: entry('162,47', 'rinnovo 2026.pdf'),
    [F('Imposte').id]: entry('34,53', 'rinnovo 2026.pdf'),
    [F('Premio lordo totale tutela legale').id]: entry('197,00', 'rinnovo 2026.pdf'),
  }
  assert.deepEqual(detailedRiepilogo(best, TL, docs).map((s) => [s.field.label.trim(), s.prima, s.valore]).sort(), [
    ['Diritti', '', '2,48'],
    ['Interessi di frazionamento', '', '0,00'],
    ['Premio imponibile tutela legale', '162,47', '159,99'],
  ])
  // la somma non torna (imponibile diverso): niente
  assert.equal(detailedRiepilogo({ ...best, [F('Premio imponibile tutela legale').id]: entry('170,00', 'rinnovo 2026.pdf') }, TL, docs).length, 0)
  // un solo valore del riepilogo in comune (lordo diverso): niente
  assert.equal(detailedRiepilogo({ ...best, [F('Premio lordo totale tutela legale').id]: entry('214,00', 'rinnovo 2026.pdf') }, TL, docs).length, 0)
  // imponibile già quello della scheda: niente
  assert.equal(detailedRiepilogo({ ...best, [F('Premio imponibile tutela legale').id]: entry('159,99', 'scheda.pdf') }, TL, docs).length, 0)
})

test('coherentPremiumRow: le imposte della riga dove imponibile + voci = lordo, non della riga della garanzia (LAMBRATE P32)', async () => {
  const { coherentPremiumRow } = await import('../src/services/polizzaService.js')
  const SCH = [
    '                                                                                       TUTELA      PERDITE     ASSISTENZA    IMPOSTE     PREMIO',
    '                                                                                       LEGALE     PECUNIARIE                              LORDO',
    '     Difesa Condominio - ed.2019                                                         220,20                                  46,79      266,99',
    '            Segue Elenco Rischi                                    PREMIO ANNUO          220,20         0,00         0,00        46,79      266,99',
    '   PREMIO TOTALE                                 FRAZIONAMENTO   NETTO IMPONIBILE     RIMBORSO          DIRITTO        IMPOSTE       PREMIO LORDO',
    '   PREMIO RATA INIZIALE                                     0,00           148,64             0,00            2,48           32,12          183,24',
    '   PREMIO RATA SUCCESSIVA                                   0,00           220,20                             2,48           47,32          270,00',
  ].join('\n')
  const file = 'LAMBRATE 24 CONDOMINIO.pdf'
  const docs = [{ name: file, spatialPages: [SCH] }]
  const best = {
    [F('Premio imponibile tutela legale').id]: entry('220,20', file),
    [F('Imposte').id]: entry('46,79', file),
    [F('Diritti').id]: entry('2,48', file),
    [F('Premio lordo totale tutela legale').id]: entry('270,00', file),
  }
  assert.deepEqual(coherentPremiumRow(best, TL, docs).map((s) => [s.field.label.trim(), s.prima, s.valore, s.riga]), [['Imposte', '46,79', '47,32', 'PREMIO RATA SUCCESSIVA']])
  // le voci vuote non si riempiono qui
  const { [F('Diritti').id]: _d, ...noDiritti } = best
  assert.ok(!coherentPremiumRow(noDiritti, TL, docs).some((s) => s.field.label.trim() === 'Diritti'))
  // lordo della riga della garanzia (266,99): la riga coerente è quella, imposte 46,79 invariate
  assert.equal(coherentPremiumRow({ ...best, [F('Premio lordo totale tutela legale').id]: entry('266,99', file) }, TL, docs).length, 0)
})

test('coverColumnGuarantees: le garanzie scelte sono le righe col premio nella colonna TUTELA LEGALE, non le frasi delle condizioni (P27)', async () => {
  const { coverColumnGuarantees } = await import('../src/services/polizzaService.js')
  const LIST = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields.map((f) => (String(f.label).trim() === 'Garanzie scelte/operanti'
    ? { ...f, description: "Elenco dei nomi delle garanzie di tutela legale scelte/operanti: i nomi delle garanzie acquistate, come stampati." }
    : String(f.label).trim() === 'Garanzie non operanti' ? { ...f, description: "Elenco dei nomi delle garanzie di tutela legale NON attivate/operanti: i nomi stampati." } : f))
  const G = (label) => LIST.find((f) => String(f.label).trim() === label)
  const AGR = [
    '     GARANZIE PRESCELTE',
    '                                                                                       TUTELA      PERDITE     ASSISTENZA    IMPOSTE     PREMIO',
    '                                                                                       LEGALE     PECUNIARIE                              LORDO',
    '     Difesa Condominio                                                                   431,81                                  91,76      523,57',
    '     Recupero Quote Cond.4 Casi                                                          270,86                                  57,56      328,42',
    '            Segue Elenco Rischi                                    PREMIO ANNUO          702,67         0,00         0,00       149,32      851,99',
  ].join('\n')
  const docs = [{ name: 'AGRIPPA 12 CONDOMINIO.pdf', spatialPages: [AGR] }]
  const best = { [G('Garanzie scelte/operanti').id]: entry('Difesa Legale nel caso in cui le Persone Assicurate siano sottoposte a procedimento penale', 'AGRIPPA 12 CONDOMINIO.pdf', 5) }
  assert.deepEqual(coverColumnGuarantees(best, LIST, docs, COVER).map((s) => [s.field.label.trim(), s.valore]), [['Garanzie scelte/operanti', 'Difesa Condominio, Recupero Quote Cond.4 Casi']])
  // valore che nomina già una garanzia della colonna: resta
  assert.equal(coverColumnGuarantees({ [G('Garanzie scelte/operanti').id]: entry('Difesa Condominio', 'x.pdf') }, LIST, docs, COVER).length, 0)
  // mai l'elenco delle garanzie NON operanti
  assert.ok(!coverColumnGuarantees({}, LIST, docs, COVER).some((s) => /non operanti/i.test(s.field.label)))
})
