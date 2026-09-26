import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { extractPolicyNumbers, extractPolicyNumbersFromPages, fiscalNumbers, normalizePolicyNumber, planReconcile, planSplitByOrigin } from '../src/services/policyReconcile.js'

test('extractPolicyNumbers: numeri dopo l\'etichetta di polizza, forma canonica', () => {
  assert.deepEqual(extractPolicyNumbers('Polizza n. 01469DAS00040 — Contraente BESA'), ['1469DAS00040'])
  assert.deepEqual(extractPolicyNumbers('N. POLIZZA 212.044.0000902142'), ['2120440000902142'])
  assert.deepEqual(extractPolicyNumbers('Polizza N° 00556129374'), ['556129374'])
  assert.deepEqual(extractPolicyNumbers('numero di polizza: M16214347'), ['M16214347'])
  assert.deepEqual(extractPolicyNumbers('Polizza n. 1 del modello 2122'), [], 'meno di 5 cifre non è un numero di polizza')
  assert.deepEqual(extractPolicyNumbers('Premio lordo 1.234,56 — P.IVA 01234567890'), [], 'senza etichetta di polizza nessun numero')
  assert.equal(normalizePolicyNumber('00556129374'), normalizePolicyNumber('556129374'))
})

const D = (id, path, files) => ({ id, path, files: files.map((numbers, idx) => ({ idx, numbers })) })

test('planReconcile: pezzi della stessa polizza in cartella e sottocartella → un dossier, nella madre', () => {
  // BESA TUT. LEGALE PENALE AZIENDA: madre = polizza firmata (scansione, dopo OCR), regolazione, set informativo; figlia /POLIZZA
  const parent = D('p', 'G/BESA SPA/TL PENALE', [['1469DAS00040'], ['1469DAS00040'], []])
  const child = D('c', 'G/BESA SPA/TL PENALE/POLIZZA', [['1469DAS00040'], ['1469DAS00040'], []])
  const plan = planReconcile([child, parent])
  assert.equal(plan.length, 1)
  assert.equal(plan[0].target, 'p', 'si unisce nella cartella dal percorso più corto')
  assert.deepEqual(plan[0].moves, [{ from: 'c', all: true, idxs: [0, 1, 2] }], 'anche il set informativo senza numero segue la sua polizza')
})

test('planReconcile: un contenitore di polizze diverse non viene assorbito; si sposta solo il file col numero', () => {
  // COI TECHNOLOGY SRL: 3 file sciolti di polizze diverse (uno col numero della TL auto) + sottocartelle
  const root = D('root', 'G/COI', [['1469DAS00082'], ['538588834'], []])
  const tl = D('tl', 'G/COI/FL519YE TUTELA LEGALE AUTO', [['1469DAS00082'], [], ['1469DAS00082']])
  const auto = D('auto', 'G/COI/FL518YE', [['538588834'], ['538588834']])
  const other = D('oth', 'G/COI/GV474DJ', [['1469DAS00033'], []])
  const plan = planReconcile([root, tl, auto, other])
  const byTarget = Object.fromEntries(plan.map((p) => [p.target, p]))
  assert.deepEqual(byTarget.tl.moves, [{ from: 'root', all: false, idxs: [0] }])
  assert.deepEqual(byTarget.auto.moves, [{ from: 'root', all: false, idxs: [1] }])
  assert.ok(!byTarget.root, 'il contenitore non diventa mai la destinazione')
  assert.ok(!plan.some((p) => p.moves.some((m) => m.from === 'oth')), 'una polizza senza numeri in comune resta com\'è')
})

test('planReconcile: cartelle doppie della stessa polizza si uniscono; senza numeri nessuna unione', () => {
  const a = D('a', 'G/COI/COI RC Prodotti', [['47555509']])
  const b = D('b', 'G/COI/RC PRODOTTI', [['47555509']])
  const costa = D('costa', 'C/COSTA 1A COND', [[]])
  const costaTl = D('costaTl', 'C/COSTA 1A COND/TUT. LEGALE', [[]])
  const plan = planReconcile([a, b, costa, costaTl])
  assert.equal(plan.length, 1)
  assert.equal(plan[0].target, 'a', 'a parità di profondità vince il primo caricato')
  assert.deepEqual(plan[0].moves, [{ from: 'b', all: true, idxs: [0] }])
})

test('planReconcile: catena appendice → polizza → quietanza con numeri diversi ma collegati', () => {
  const x = D('x', 'G/P', [['111111', '222222']])
  const y = D('y', 'G/P/APP', [['222222']])
  const z = D('z', 'G/Q', [['111111']])
  const plan = planReconcile([x, y, z])
  assert.equal(plan.length, 1)
  assert.equal(plan[0].target, 'x')
  assert.deepEqual(plan[0].moves.map((m) => m.from).sort(), ['y', 'z'])
  assert.deepEqual(plan[0].numbers, ['111111', '222222'])
})

test('extractPolicyNumbersFromPages: numero sotto l\'etichetta nei moduli; mai la polizza sostituita', () => {
  const unipol = [
    '         COD.AGENZIA COD.SUBAG.    RAMO / NUMERO POLIZZA        AGENZIA',
    '          1/85112     101          30/210502137                  CANALE    BROKER',
  ].join('\n')
  assert.deepEqual(extractPolicyNumbersFromPages([unipol]), ['30210502137'])
  const das = [
    '      Polizza Nr.                     Nr. Polizza Sostituita          Agenzia di',
    '      0146905088                      0146900001                      MILANO',
  ].join('\n')
  assert.deepEqual(extractPolicyNumbersFromPages([das]), ['146905088'], 'la colonna «Sostituita» è un\'altra polizza')
  assert.deepEqual(extractPolicyNumbersFromPages(['Polizza n. 01469DAS00040   Contraente BESA']), ['1469DAS00040'])
  assert.deepEqual(extractPolicyNumbersFromPages(['Polizza Nr.        Agenzia\n                   MILANO']), [], 'sotto l\'etichetta nessun numero')
})

test('numeri: kerning riattaccato, stessa polizza col ramo davanti, colonna più vicina alla parola «polizza»', () => {
  assert.deepEqual(extractPolicyNumbers('Polizza n. 01469DAS000 40     App. UW / 2024'), ['1469DAS00040'])
  assert.deepEqual(extractPolicyNumbers('Polizza n. 123456 del 2024'), ['123456'])
  const header = [
    '          COD. AG. COD. SUBAG. RAMO NR. POLIZZA PRODOTTO               NUMERO ARCHIVIO',
    '           1/85112   101     30        210502137           9050                     179075035',
  ].join('\n')
  assert.deepEqual(extractPolicyNumbersFromPages([header]), ['210502137'], 'non il codice agenzia 1/85112')
  const a = D('a', 'B/GT724FH', [['30210502137'], []])
  const b = D('b', 'B/GT724FH/POLIZZA', [['30210502137'], ['210502137'], ['210502137']])
  const plan = planReconcile([b, a])
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0].moves, [{ from: 'b', all: true, idxs: [0, 1, 2] }], 'col ramo davanti è la stessa polizza: il dossier resta UNA posizione')
})

test('cartella senza numeri con UNA polizza sotto ne fa parte e le dà il nome; con due polizze sotto resta com\'è', () => {
  const parent = D('p', 'G/COI/TL PENALE', [[]])
  const child = D('c', 'G/COI/TL PENALE/POLIZZA', [['1469DAS00039'], ['1469DAS00039'], []])
  const plan = planReconcile([parent, child])
  assert.equal(plan.length, 1)
  assert.equal(plan[0].target, 'c')
  assert.equal(plan[0].name, 'G/COI/TL PENALE', 'il dossier unito prende il nome della cartella madre')
  assert.deepEqual(plan[0].moves, [{ from: 'p', all: true, idxs: [0] }])
  const client = D('cl', 'G/RUZZA', [[], []])
  const v1 = D('v1', 'G/RUZZA/ET103PP', [['111111111']])
  const v2 = D('v2', 'G/RUZZA/FD611EL', [['222222222']])
  assert.deepEqual(planReconcile([client, v1, v2]), [], 'due polizze sotto: il contenitore resta com\'è')
})

test('codice fiscale di persona e numeri etichettati come P.IVA/C.F. non sono numeri di polizza', () => {
  assert.equal(normalizePolicyNumber('RZZFBA62T30F205P'), '', 'CF di persona')
  assert.equal(normalizePolicyNumber('RZZFBAQ2T3LF205P'), '', 'CF con omocodia')
  assert.equal(normalizePolicyNumber('01469DAS00040'), '1469DAS00040', 'i numeri veri restano')
  assert.deepEqual(extractPolicyNumbers('Polizza n. RZZFBA62T30F205P'), [])
  // RUZZA FABIO, infortuni conducente: CF nella cella della polizza, numero vero sotto
  const page = 'Polizza n. 46094755   Contraente RUZZA FABIO\nPolizza n. 01234567890\nPARTITA IVA: 01234567890'
  assert.deepEqual(extractPolicyNumbersFromPages([page]), ['46094755'], 'la P.IVA etichettata cade anche vicino a «polizza»')
  assert.deepEqual([...fiscalNumbers('P.IVA/C.F. 13251900158 — Codice fiscale RZZFBA62T30F205P')].sort(), ['13251900158', 'RZZFBA62T30F205P'])
  // Due persone con lo stesso CF nei moduli di polizze diverse: nessuna unione
  const a = D('a', 'G/RUZZA/INF CONDUCENTE', [['46094755']])
  const b = D('b', 'G/RUZZA/ET103PP', [['539295277']])
  assert.deepEqual(planReconcile([a, b]), [])
})

test('cartella senza numeri: la copia di una polizza di FUORI archiviata sotto di lei non conta', () => {
  // BESA CAT NAT: «PREMENUGO/COPIE FIRMATE» ha la polizza di Settala (EXM16548705),
  // «PREMENUGO/POLIZZA» la sua (EXM16536864); la cartella madre e «PREMENUGO»
  // hanno solo scansioni senza numero.
  const settala = D('s', 'G/BESA/SETTALA CAT NAT/SETTALA/POLIZZA', [['EXM16548705'], []])
  const settalaFirm = D('sf', 'G/BESA/SETTALA CAT NAT/SETTALA/COPIE FIRMATE', [['EXM16548705'], []])
  const top = D('t', 'G/BESA/PREMENUGO CAT NAT', [[]])
  const mid = D('m', 'G/BESA/PREMENUGO CAT NAT/PREMENUGO', [[]])
  const firm = D('f', 'G/BESA/PREMENUGO CAT NAT/PREMENUGO/COPIE FIRMATE', [['EXM16548705'], []])
  const pol = D('p', 'G/BESA/PREMENUGO CAT NAT/PREMENUGO/POLIZZA', [['EXM16536864'], []])
  const plan = planReconcile([settala, settalaFirm, top, mid, firm, pol])
  const prem = plan.find((x) => x.target === 'p')
  assert.ok(prem, 'Premenugo diventa un dossier solo')
  assert.equal(prem.name, 'G/BESA/PREMENUGO CAT NAT')
  assert.deepEqual(prem.moves.map((m) => m.from).sort(), ['m', 't'])
  const sett = plan.find((x) => x.numbers.includes('EXM16548705'))
  assert.ok(sett.moves.some((m) => m.from === 'f'), 'la copia di Settala torna a Settala')
  // Senza una polizza «di casa» sotto (tutte di fuori) la cartella resta com'è
  const lone = D('l', 'G/X', [[]])
  const stray = D('y', 'G/X/COPIA', [['EXM16548705']])
  const home = D('h', 'G/Y', [['EXM16548705']])
  const plan2 = planReconcile([home, lone, stray])
  assert.ok(!plan2.some((x) => x.moves.some((m) => m.from === 'l')))
})

test('frammento di numero (testa comune a più polizze) non unisce polizze diverse', () => {
  // CONDOMINI 26/09: l'OCR delle copie firmate Vittoria lascia «212044» (la testa
  // di «212.044.0000902030»): COLAUTTI, RAMAZZINI e LIPPI finivano in un dossier.
  const colautti = D('c', 'G/COLAUTTI/COLAUTTI MIRABELLO', [['2120440000902058'], ['212044']])
  const ramazzini = D('r', 'G/RAMAZZINI 2 COND/RAMAZZINI 2', [['2120440000902030'], ['212044']])
  const lippi = D('l', 'G/LIPPI 19 COND/LIPPI 19 CONDOMINIO', [['2120440000902206'], ['212044']])
  assert.deepEqual(planReconcile([colautti, ramazzini, lippi]), [])
  // Anche due dossier col SOLO frammento non si legano se nel batch c'è il numero intero
  const a = D('a', 'G/A', [['212044']])
  const b = D('b', 'G/B', [['212044']])
  assert.deepEqual(planReconcile([a, b, D('x', 'G/X', [['2120440000902030']])]), [])
  // Stessa polizza col numero intero in due cartelle: l'unione resta
  const r2 = D('r2', 'G/RAMAZZINI 2 COND/RAMAZZINI 2/POLIZZA', [['2120440000902030'], ['212044']])
  const plan = planReconcile([ramazzini, r2])
  assert.equal(plan.length, 1)
  assert.equal(plan[0].target, 'r')
  // Numero con UNA cifra in più (appendice): numeri distinti, nessun frammento
  assert.deepEqual(planReconcile([D('p', 'G/P', [['1469DAS00040']]), D('q', 'G/Q', [['1469DAS000401']])]), [])
})

test('extractPolicyNumbersFromPages: etichetta spezzata dall\'OCR in due celle, numero a destra o sotto', () => {
  // COSTA 1A (Unipol scansionata): «NUMERO   POLIZZA   1/63317/48/165043362»
  const ocr = ['7264   Polizza\nNUMERO   POLIZZA   1/63317/48/165043362\nNumero  fabbricati   1']
  assert.deepEqual(extractPolicyNumbersFromPages(ocr), ['16331748165043362'])
  // Stessa etichetta spezzata, numero nella riga sotto, colonna di «POLIZZA»
  const below = ['NUMERO   POLIZZA   DATA EMISSIONE\n         M16181009   22/05/2025']
  assert.deepEqual(extractPolicyNumbersFromPages(below), ['M16181009'])
  // «Polizza» senza parola del numero accanto: a destra non si legge nulla
  assert.deepEqual(extractPolicyNumbersFromPages(['Tipo   Polizza   123456789']), [])
  // «n. polizze» con un conteggio corto a destra: non è un numero di polizza
  assert.deepEqual(extractPolicyNumbersFromPages(['N.   polizze   3']), [])
})

test('planSplitByOrigin: i file tornano nelle cartelle da cui sono stati caricati', () => {
  // COSTA 1A: la Unipol della cartella madre e la DAS di «TUT. LEGALE» unite
  const f = (idx, rel_path) => ({ idx, rel_path })
  const costa = planSplitByOrigin('C/COSTA 1A COND', [f(0, 'C/COSTA 1A COND/TUT. LEGALE/DAS.pdf'), f(1, 'C/COSTA 1A COND/polizza 2018.pdf')])
  assert.deepEqual(costa, { home: 'C/COSTA 1A COND', keep: [1], groups: [{ folder: 'C/COSTA 1A COND/TUT. LEGALE', idxs: [0] }] })
  // Tre cartelle: resta quella col nome del dossier, le altre si separano
  const col = planSplitByOrigin('C/COLAUTTI/M', [f(0, 'C/COLAUTTI/M/a.pdf'), f(1, 'C/RAMAZZINI/R/b.pdf'), f(2, 'C/RAMAZZINI/R/c.pdf'), f(3, 'C/COLAUTTI/M/RINNOVO/d.pdf'), f(4, 'C/LIPPI/L/e.pdf')])
  assert.deepEqual(col.keep, [0])
  assert.deepEqual(col.groups.map((g) => [g.folder, g.idxs]), [['C/COLAUTTI/M/RINNOVO', [3]], ['C/LIPPI/L', [4]], ['C/RAMAZZINI/R', [1, 2]]])
  // Una sola cartella, o percorsi mancanti: niente da separare; i senza percorso restano
  assert.deepEqual(planSplitByOrigin('C/X', [f(0, 'C/X/a.pdf'), f(1, 'C/X/b.pdf')]).groups, [])
  assert.deepEqual(planSplitByOrigin('C/X', [f(0, null), f(1, 'C/X/b.pdf'), f(2, 'C/Y/c.pdf')]), { home: 'C/X', keep: [0, 1], groups: [{ folder: 'C/Y', idxs: [2] }] })
  // Nome del dossier che non è una delle cartelle: resta la più numerosa
  assert.deepEqual(planSplitByOrigin('C/Z', [f(0, 'C/A/a.pdf'), f(1, 'C/B/b.pdf'), f(2, 'C/B/c.pdf')]).keep, [1, 2])
})
