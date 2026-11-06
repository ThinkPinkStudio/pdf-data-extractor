/**
 * Anagrafiche RSM: regole pure (web/lib/rsm/rules.js). I numeri attesi delle
 * promozioni sono quelli del file del cliente (Stato di rischio RSM 2026):
 * 5.086 / 1,025 × 275/365 = 3.738,46 di rimborso, 9.146 × 9/12 = 6.859,50
 * di entrata a mesi.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normDate, daysBetween, days360, decodeCf, surnameCode, nameCode, checkPerson,
  defaultProgramConfig, computeMember, statusAt, decorrenza, previewPromotion,
  parseCommunicationRows, prepareCommunication, buildErrorMail, buildEml,
  parseStatoWorkbook, normCategory, tariffsFromWorkbook, workbookYear,
} from '../web/lib/rsm/rules.js'

function cfg2026() {
  const c = defaultProgramConfig(2026)
  const t = Object.fromEntries(c.categories.map((x) => [x.key, x]))
  t.dirigenti.tariffs = { titolare: 9146, quiescente: 10123 }
  t.funzionari.tariffs = { titolare: 5086, quiescente: 6554 }
  t.impiegati.tariffs = { titolare: 1348, coniuge: 646, figlio: 558 }
  t.dirigenti.policy = '11341612'; t.funzionari.policy = '11341765'; t.impiegati.policy = '11341763'
  return c
}

test('date: Excel, gg/mm/aa, seriale, 30/360', () => {
  assert.equal(normDate('01/04/2026'), '2026-04-01')
  assert.equal(normDate('4.10.26', 2026), '2026-10-04')
  assert.equal(normDate('16/12/68', 2026), '1968-12-16')
  assert.equal(normDate(46023), '2026-01-01')
  assert.equal(normDate(new Date(2026, 6, 13)), '2026-07-13')
  assert.equal(normDate('31/02/2026'), null)
  assert.equal(daysBetween('2026-04-01', '2027-01-01'), 275)
  assert.equal(days360('2026-04-01', '2027-01-01'), 270)
})

test('codice fiscale: decodifica, controllo, omocodia', () => {
  const d = decodeCf('RSSMRA85T10A562S', 2026)
  assert.equal(d.valid, true)
  assert.equal(d.checkOk, true)
  assert.equal(d.birthDate, '1985-12-10')
  assert.equal(d.sex, 'M')
  assert.equal(decodeCf('RSSMRA85T10A562T').checkOk, false)
  // omocodia: 5 → R nella cifra del giorno (le lettere sostituiscono le cifre)
  const omo = decodeCf('RSSMRA85T1LA562V', 2026)
  assert.equal(omo.valid, true)
  assert.equal(omo.birthDate, '1985-12-10')
  // donna: giorno + 40
  assert.equal(decodeCf('BNCLRA90A41F205I', 2026).sex, 'F')
  assert.equal(decodeCf('BNCLRA90A41F205I', 2026).birthDate, '1990-01-01')
})

test('codici di cognome e nome', () => {
  assert.equal(surnameCode('Rossi'), 'RSS')
  assert.equal(nameCode('Mario'), 'MRA')
  assert.equal(nameCode('Gianfranco'), 'GFR') // ≥4 consonanti: 1ª, 3ª, 4ª
  assert.equal(surnameCode("D'Isabella"), 'DSB')
  assert.equal(surnameCode('Fo'), 'FOX')
  assert.equal(nameCode('Filippo Biagio'), 'FPP')
})

test('controlli persona: nome, cognome, data di nascita', () => {
  const ok = checkPerson({ cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA85T10A562S', birthDate: '1985-12-10' }, 2026)
  assert.deepEqual(ok.issues, [])
  const wrongName = checkPerson({ cognome: 'PORTA', nome: 'ANDREA', cf: 'RSSMRA85T10A562S' }, 2026)
  assert.ok(wrongName.issues.some((i) => i.code === 'cf-cognome'))
  assert.ok(wrongName.issues.some((i) => i.code === 'cf-nome'))
  assert.equal(wrongName.birthDate, '1985-12-10', 'data ricavata dal codice fiscale')
  const swapped = checkPerson({ cognome: 'MARIO', nome: 'ROSSI', cf: 'RSSMRA85T10A562S' }, 2026)
  assert.deepEqual(swapped.issues.filter((i) => i.level === 'error').map((i) => i.code), ['cf-invertiti'])
  const wrongBirth = checkPerson({ cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA85T10A562S', birthDate: '1985-10-12' }, 2026)
  assert.deepEqual(wrongBirth.issues.map((i) => i.code), ['nascita'])
})

test('premi: nucleo, persona, semestre, quota associativa', () => {
  const c = cfg2026()
  const base = { entryKind: 'inclusione', exitDate: null, exitKind: null, quiescente: false }
  assert.equal(computeMember(c, { ...base, category: 'dirigenti', legame: 'TI', entryKind: 'iniziale', entryDate: '2026-01-01' }).dovuto, 9156)
  assert.equal(computeMember(c, { ...base, category: 'dirigenti', legame: 'TI', quiescente: true, entryKind: 'iniziale', entryDate: '2026-01-01' }).dovuto, 10133)
  assert.equal(computeMember(c, { ...base, category: 'dirigenti', legame: 'CO', entryDate: '2026-01-01' }).dovuto, 0)
  // 2° semestre: 50% (file: Funzionari 13/07 → 2.553,00; Impiegati coniuge 01/09 → 323,00)
  assert.equal(computeMember(c, { ...base, category: 'funzionari', legame: 'TI', entryDate: '2026-07-13' }).dovuto, 2553)
  assert.equal(computeMember(c, { ...base, category: 'impiegati', legame: 'CO', entryDate: '2026-09-01' }).dovuto, 323)
  assert.equal(computeMember(c, { ...base, category: 'impiegati', legame: 'FI', entryDate: '2026-09-15' }).dovuto, 279)
  // 30/06 incluso nel 1° semestre
  assert.equal(computeMember(c, { ...base, category: 'impiegati', legame: 'TI', entryDate: '2026-06-30' }).dovuto, 1358)
  assert.equal(computeMember(c, { ...base, category: 'impiegati', legame: 'TI', entryDate: '2026-07-01' }).dovuto, 684)
})

test('promozione: rimborso netto a giorni, entrata a giorni o a mesi', () => {
  const c = cfg2026()
  const nucleus = [
    { cf: 'A', legame: 'TI', category: 'funzionari', entryKind: 'iniziale', entryDate: '2026-01-01', quiescente: false },
    { cf: 'B', legame: 'CO', category: 'funzionari', entryKind: 'iniziale', entryDate: '2026-01-01', quiescente: false },
    { cf: 'C', legame: 'FI', category: 'funzionari', entryKind: 'iniziale', entryDate: '2026-01-01', quiescente: false },
  ]
  const p = previewPromotion(c, nucleus, 'dirigenti', '2026-04-01')
  assert.equal(p.rimborso, 3738.46, 'un rimborso per nucleo, come nel file del cliente')
  assert.equal(p.dovuto, 6900.82) // 9.146 × 275/365 + 10
  c.rules.prorata = 'mesi'
  assert.equal(previewPromotion(c, nucleus, 'dirigenti', '2026-04-01').dovuto, 6869.5) // come il file
  // Impiegati (a persona): ogni membro ha il suo rimborso
  c.rules.prorata = 'giorni'
  const imp = nucleus.map((m) => ({ ...m, category: 'impiegati' }))
  const q = previewPromotion(c, imp, 'funzionari', '2026-03-01')
  assert.equal(q.exits.filter((e) => e.calc.rimborso > 0).length, 3)
})

test('stato a una data: cessazione coperta fino a fine anno, promozione fuori', () => {
  const c = cfg2026()
  const ces = { entryDate: '2026-01-01', exitDate: '2026-10-04', exitKind: 'cessazione' }
  assert.equal(statusAt(c, ces, '2026-09-01'), 'attivo')
  assert.equal(statusAt(c, ces, '2026-11-01'), 'cessazione')
  assert.equal(statusAt(c, ces, '2027-01-01'), 'uscito')
  assert.equal(statusAt(c, { entryDate: '2026-01-01', exitDate: '2026-04-01', exitKind: 'promozione' }, '2026-04-01'), 'promosso')
  assert.equal(statusAt(c, { entryDate: '2026-10-26' }, '2026-10-01'), 'futuro')
})

test('decorrenza: entro 30 giorni la data richiesta, poi la comunicazione, forzata vince', () => {
  const c = cfg2026()
  assert.deepEqual(decorrenza(c, '2026-03-01', '2026-03-31', null), { date: '2026-03-01', reason: 'richiesta' })
  assert.deepEqual(decorrenza(c, '2026-03-01', '2026-04-15', null), { date: '2026-04-15', reason: 'tardiva' })
  assert.deepEqual(decorrenza(c, '2026-03-01', '2026-04-15', '2026-03-01'), { date: '2026-03-01', reason: 'forzata' })
})

test('file di comunicazione: intestazione, legenda, eredità dal titolare, controlli, mail', () => {
  const c = cfg2026()
  const rows = [
    ["SOCIETA' DI APPARTENENZA", 'CATEGORIA', 'AZIONE', 'NUMERO POLIZZA', 'COGNOME', 'NOME', 'DATA DI NASCITA', 'C.F. ASSICURATO', 'C.F.TITOLARE', 'LEGAME', 'A CARICO SI/ NO', 'DATA ENTRATA', 'NOTE'],
    ['Crédit Agricole Vita', 'IMPIEGATI', 'N', '11341763', 'Rossi', 'Mario', '10/12/1985', null, 'RSSMRA85T10A562S', 'TI', null, '01/10/2026', ''],
    ['Crédit Agricole Vita', null, 'N', '', 'Bianchi', 'Laura', '01/01/1990', 'BNCLRA90A41F205I', 'RSSMRA85T10A562S', 'CO ', 'No', null, ''],
    ['Crédit Agricole Vita', 'IMPIEGATI', 'N', '11341763', 'Porta', 'Andrea', null, 'VRDGPP70A01H501S', 'VRDGPP70A01H501S', 'TI', null, '26/10/2026', ''],
    ['Crédit Agricole Vita', null, null, '', null, null, null, null, null, null, null, null, ''],
    ['AZIONE'], ['N', 'Nuova entrata'], ['LEGAME'], ['TI', 'Titolare di polizza'],
  ]
  const parsed = parseCommunicationRows(rows, 2026)
  assert.equal(parsed.rows.length, 3, 'righe vuote e legenda saltate')
  const prep = prepareCommunication(c, parsed.rows, [], '2026-10-05')
  assert.equal(prep[0].member.cf, 'RSSMRA85T10A562S', 'il titolare senza C.F. assicurato prende quello del titolare')
  assert.equal(prep[0].calc.dovuto, 684)
  assert.equal(prep[1].member.category, 'impiegati', 'categoria ereditata dal titolare')
  assert.equal(prep[1].member.entryDate, '2026-10-01', 'data ereditata dal titolare')
  assert.equal(prep[1].calc.dovuto, 323)
  assert.equal(prep[0].hasError, false)
  assert.equal(prep[1].hasError, false)
  assert.equal(prep[2].hasError, true)
  const mail = buildErrorMail({ fileName: 'teste.xlsx', receivedOn: '2026-10-27', rows: prep, to: 'hr@example.com', cc: 'a@example.com' })
  assert.equal(mail.count, 1)
  assert.match(mail.body, /PORTA ANDREA \(riga 4\)/)
  assert.match(mail.body, /Le altre 2 righe del file sono state registrate/)
  const eml = buildEml(mail)
  assert.match(eml, /^To: hr@example.com\r\nCc: a@example.com\r\n/)
  assert.match(eml, /X-Unsent: 1/)
})

test('categorie dal testo del cliente', () => {
  const c = cfg2026()
  assert.deepEqual(normCategory('DIRIGENTI QUIESCENTI', c.categories), { key: 'dirigenti', quiescente: true })
  assert.deepEqual(normCategory('IMPIEGATO', c.categories), { key: 'impiegati', quiescente: false })
  assert.deepEqual(normCategory('Funzionario', c.categories), { key: 'funzionari', quiescente: false })
})

test('stato di rischio: fogli al 01/01, variazioni, promozioni legate', () => {
  const c = cfg2026()
  const head = ['AZIENDA', 'CATEGORIA', 'CONVENZIONE', 'CODICE PRODOTTO', 'NR. POLIZZA', 'COGNOME', 'NOME', 'DATA DI NASCITA', " ETA' ", 'SESSO', 'C.F. FAMILIARE', 'C.F. CAPO NUCLEO', 'TITOLARE NUCLEO', 'LEGAME', 'DATA ENTRATA', ' PREMIO ANNUO ', ' Q. A. ', ' TOTALE ', ' QUIESCENTE ']
  const varHead = ['AZIENDA', 'CATEGORIA', 'CONVENZIONE', 'CODICE PRODOTTO', 'NR. POLIZZA', 'COGNOME', 'NOME', 'DATA DI NASCITA', "ETA'", 'C.F. ASSICURATO', 'C.F. TITOLARE', 'NUCLEO', 'LEGAME', 'DATA ENTRATA', 'DATA USCITA', 'RATEO LORDO', 'QUOTA ASSOCIATIVA', 'RATEO COMPLESSIVO', 'RIMBORSO', 'AZIONE', 'PROMOZIONE', 'NOTE']
  const sheets = {
    DIRIGENTI: [head],
    'Variazioni DIRIGENTI': [[null, 'C.A. Vita'], varHead,
      ['C.A. VITA', 'DIRIGENTI', '90/01', '8637', '11341612', 'ROSSI', 'MARIO', null, 0, 'RSSMRA85T10A562S', 'RSSMRA85T10A562S', null, 'TI', '01/04/2026', null, 0, 0, 0, 0, ' ENTRATA ', 'SI'],
      ['C.A. VITA', '', '90/01', '8637', '11341612', 'BIANCHI', 'LAURA', null, 0, 'BNCLRA90A41F205I', 'RSSMRA85T10A562S', 'ROSSI MARIO', 'CO', '01/04/2026', null, 0, 0, 0, 0, ' ENTRATA ', 'SI']],
    FUNZIONARI: [head,
      ['C.A. VITA', 'FUNZIONARI', '90/01', '8636', '11341765', 'ROSSI', 'MARIO', null, 0, 'M', 'RSSMRA85T10A562S', 'RSSMRA85T10A562S', ' ', 'TI', '01/01/2026', 0, 0, 0, ' NO '],
      ['C.A. VITA', '', '90/01', '8636', '11341765', 'BIANCHI', 'LAURA', null, 0, 'F', 'BNCLRA90A41F205I', 'RSSMRA85T10A562S', 'ROSSI MARIO', 'CO', '01/01/2026', 0, 0, 0, ' NO ']],
    'Variazioni FUNZIONARI': [[null, 'C.A. Vita'], varHead,
      ['C.A. VITA', 'FUNZIONARI', '90/01', '8636', '11341765', 'ROSSI', 'MARIO', null, 0, 'RSSMRA85T10A562S', 'RSSMRA85T10A562S', null, 'TI', null, '01/04/2026', 0, 0, 0, 0, ' USCITA ', 'SI'],
      ['C.A. VITA', '', '90/01', '8636', '11341765', 'BIANCHI', 'LAURA', null, 0, 'BNCLRA90A41F205I', 'RSSMRA85T10A562S', 'ROSSI MARIO', 'CO', null, '01/04/2026', 0, 0, 0, 0, ' USCITA ', 'SI']],
  }
  const { members, warnings } = parseStatoWorkbook(c, sheets)
  assert.equal(members.length, 4)
  const out = members.find((m) => m.category === 'funzionari' && m.legame === 'TI')
  const inn = members.find((m) => m.category === 'dirigenti' && m.legame === 'TI')
  assert.equal(out.exitKind, 'promozione')
  assert.equal(inn.entryKind, 'promozione')
  assert.equal(out.promotionId, inn.promotionId)
  assert.equal(new Set(members.map((m) => m.promotionId)).size, 1, 'una promozione per nucleo')
  assert.equal(computeMember(c, out).rimborso, 3738.46)
  assert.ok(warnings.length === 0, warnings.join('\n'))
})

test('import: promozione non segnata = anomalia da risolvere, mai indovinata', () => {
  const c = cfg2026()
  const head = ['AZIENDA', 'CATEGORIA', 'CONVENZIONE', 'CODICE PRODOTTO', 'NR. POLIZZA', 'COGNOME', 'NOME', 'DATA DI NASCITA', " ETA' ", 'SESSO', 'C.F. FAMILIARE', 'C.F. CAPO NUCLEO', 'TITOLARE NUCLEO', 'LEGAME', 'DATA ENTRATA']
  const varHead = ['AZIENDA', 'CATEGORIA', 'CONVENZIONE', 'CODICE PRODOTTO', 'NR. POLIZZA', 'COGNOME', 'NOME', 'DATA DI NASCITA', "ETA'", 'C.F. ASSICURATO', 'C.F. TITOLARE', 'NUCLEO', 'LEGAME', 'DATA ENTRATA', 'DATA USCITA', 'RATEO LORDO', 'QUOTA ASSOCIATIVA', 'RATEO COMPLESSIVO', 'RIMBORSO', 'AZIONE', 'PROMOZIONE', 'NOTE']
  const sheets = () => ({
    IMPIEGATI: [head,
      ['C.A. VITA', 'IMPIEGATI', '', '', '', 'ROSSI', 'MARIO', null, 0, 'M', 'RSSMRA85T10A562S', 'RSSMRA85T10A562S', '', 'TI', '01/01/2026'],
      ['C.A. VITA', '', '', '', '', 'BIANCHI', 'LAURA', null, 0, 'F', 'BNCLRA90A41F205I', 'RSSMRA85T10A562S', '', 'CO', '01/01/2026'],
      ['C.A. VITA', 'IMPIEGATI', '', '', '', 'VERDI', 'GIUSEPPE', null, 0, 'M', 'VRDGPP70A01H501S', 'VRDGPP70A01H501S', '', 'TI', '01/01/2026']],
    'Variazioni IMPIEGATI': [[null], varHead,
      // il cliente ha dimenticato PROMOZIONE = SI sulle uscite del nucleo
      ['C.A. VITA', 'IMPIEGATO', '', '', '', 'ROSSI', 'MARIO', null, 0, 'RSSMRA85T10A562S', 'RSSMRA85T10A562S', null, 'TI', null, '01/03/2026', 0, 0, 0, 0, ' USCITA ', 'NO', 'ESCLUSO DAL 01/03/2026 PASSAGGIO IN POL. FUNZIONARI'],
      ['C.A. VITA', '', '', '', '', 'BIANCHI', 'LAURA', null, 0, 'BNCLRA90A41F205I', 'RSSMRA85T10A562S', null, 'CO', null, '01/03/2026', 0, 0, 0, 0, ' USCITA ', 'NO'],
      // uscita con PROMOZIONE = SI ma nessuna entrata altrove
      ['C.A. VITA', 'IMPIEGATO', '', '', '', 'VERDI', 'GIUSEPPE', null, 0, 'VRDGPP70A01H501S', 'VRDGPP70A01H501S', null, 'TI', null, '31/05/2026', 0, 0, 0, 0, ' USCITA ', 'SI']],
    FUNZIONARI: [head],
    'Variazioni FUNZIONARI': [[null], varHead,
      ['C.A. VITA', 'FUNZIONARI', '', '', '', 'ROSSI', 'MARIO', null, 0, 'RSSMRA85T10A562S', 'RSSMRA85T10A562S', null, 'TI', '01/03/2026', null, 0, 0, 0, 0, ' ENTRATA ', 'SI'],
      ['C.A. VITA', '', '', '', '', 'BIANCHI', 'LAURA', null, 0, 'BNCLRA90A41F205I', 'RSSMRA85T10A562S', null, 'CO', '01/03/2026', null, 0, 0, 0, 0, ' ENTRATA ', 'SI']],
  })
  const first = parseStatoWorkbook(c, sheets())
  assert.deepEqual(first.anomalies.map((a) => a.type).sort(), ['non-segnata', 'senza-entrata'])
  const nonSeg = first.anomalies.find((a) => a.type === 'non-segnata')
  assert.equal(nonSeg.people.length, 2, 'un\'anomalia per nucleo')
  assert.match(nonSeg.text, /l'uscita da Impiegati non è segnata/)
  assert.equal(nonSeg.suggest, 'promozione', 'proposta dalla nota del file')
  assert.equal(first.anomalies.find((a) => a.type === 'senza-entrata').suggest, null, 'senza nota nessuna proposta')
  const senza = first.anomalies.find((a) => a.type === 'senza-entrata')

  const asPromo = parseStatoWorkbook(c, sheets(), { [nonSeg.key]: 'promozione', [senza.key]: 'cessazione' })
  assert.ok(asPromo.anomalies.every((a) => a.choice))
  const out = asPromo.members.find((m) => m.category === 'impiegati' && m.cf === 'RSSMRA85T10A562S')
  const inn = asPromo.members.find((m) => m.category === 'funzionari' && m.cf === 'RSSMRA85T10A562S')
  assert.equal(out.exitKind, 'promozione')
  assert.equal(out.promotionId, inn.promotionId)
  assert.ok(computeMember(c, out).rimborso > 0, 'impiegati: rimborso pro-rata per persona')
  assert.equal(asPromo.members.find((m) => m.cf === 'VRDGPP70A01H501S').exitKind, 'cessazione')

  const separate = parseStatoWorkbook(c, sheets(), { [nonSeg.key]: 'separati', [senza.key]: 'promozione' })
  assert.equal(separate.members.find((m) => m.category === 'impiegati' && m.cf === 'RSSMRA85T10A562S').exitKind, 'cessazione')
  assert.equal(separate.members.find((m) => m.category === 'funzionari' && m.cf === 'RSSMRA85T10A562S').entryKind, 'inclusione')
})

test('variazioni: inclusione di chi è già in un\'altra categoria = promozione da registrare, non nella mail', () => {
  const c = cfg2026()
  const existing = [{ id: 'm1', category: 'impiegati', cf: 'RSSMRA85T10A562S', cfTitolare: 'RSSMRA85T10A562S', legame: 'TI', entryKind: 'iniziale', entryDate: '2026-01-01', exitDate: null, exitKind: null }]
  const rows = [
    ['COGNOME', 'NOME', 'C.F. ASSICURATO', 'C.F.TITOLARE', 'LEGAME', 'CATEGORIA', 'DATA ENTRATA'],
    ['Rossi', 'Mario', 'RSSMRA85T10A562S', 'RSSMRA85T10A562S', 'TI', 'FUNZIONARI', '01/09/2026'],
  ]
  const prep = prepareCommunication(c, parseCommunicationRows(rows, 2026).rows, existing, '2026-09-05')
  const issue = prep[0].issues.find((i) => i.code === 'altra-categoria')
  assert.ok(issue && prep[0].hasError)
  assert.deepEqual(issue.promote, { memberId: 'm1', to: 'funzionari', date: '2026-09-01' })
  assert.equal(buildErrorMail({ fileName: 'x.xlsx', rows: prep }).count, 0, 'errore interno: niente mail')
})

test('tariffe e polizze lette dal file dello stato di rischio', () => {
  const c = defaultProgramConfig(2026)
  const head = ['AZIENDA', 'CATEGORIA', 'CONVENZIONE', 'CODICE PRODOTTO', 'NR. POLIZZA', 'COGNOME', 'NOME', 'DATA DI NASCITA', 'C.F. FAMILIARE', 'C.F. CAPO NUCLEO', 'LEGAME']
  const sheets = {
    IMPIEGATI: [head,
      ['C.A. VITA', 'IMPIEGATI', '90/01', '8635', '11341763', 'ROSSI', 'MARIO', null, 'RSSMRA85T10A562S', 'RSSMRA85T10A562S', 'TI'],
      ['C.A. VITA', 'IMPIEGATI', '90/02', '8635', '11341763', 'VERDI', 'GIUSEPPE', null, 'VRDGPP70A01H501S', 'VRDGPP70A01H501S', 'TI'],
      [], ['IMPIEGATI', 2, 1348], ['CONIUGI/CONVIVENTI', 1, 646], ['FIGLI', 0, 558]],
    DIRIGENTI: [head, ['DIRIGENTI', 13, 9146], ['DIRIGENTI QUIESCENTI', 1, 10123]],
    'Variazioni IMPIEGATI': [[null, 'C.A. Vita', null, null, null, 'Regolazione', 'Premio']],
  }
  assert.deepEqual(tariffsFromWorkbook(c, sheets), {
    impiegati: { tariffs: { titolare: 1348, coniuge: 646, figlio: 558 }, policy: '11341763' },
    dirigenti: { tariffs: { titolare: 9146, quiescente: 10123 }, policy: '' },
  })
})

test('anno di polizza letto dal file, prima di avere un programma', () => {
  const varHead = ['AZIENDA', 'CATEGORIA', 'COGNOME', 'NOME', 'C.F. ASSICURATO', 'C.F. TITOLARE', 'LEGAME', 'DATA ENTRATA', 'DATA USCITA']
  // intestazione «Regolazione Premio 1/1/26 – 1/1/27» sopra le colonne
  assert.equal(workbookYear({ 'Variazioni IMPIEGATI': [[null, 'C.A. Vita', 'Regolazione', 'Premio', new Date(2026, 0, 1), '-', new Date(2027, 0, 1)], varHead] }), 2026)
  // senza intestazione: l'anno più frequente delle variazioni
  assert.equal(workbookYear({ 'Variazioni FUNZIONARI': [varHead,
    ['C.A. VITA', '', 'ROSSI', 'MARIO', 'RSSMRA85T10A562S', 'RSSMRA85T10A562S', 'TI', '01/03/2027', null],
    ['C.A. VITA', '', 'VERDI', 'GIUSEPPE', 'VRDGPP70A01H501S', 'VRDGPP70A01H501S', 'TI', '01/09/2027', null]] }), 2027)
  assert.equal(workbookYear({ Foglio1: [['niente']] }), null)
})
