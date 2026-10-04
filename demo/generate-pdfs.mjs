// Genera i PDF DEMO (tutti inventati) in demo/pdfs/ e l'albero di cartelle per
// la pagina "Cartella bulk" in demo/bulk/. Usa pdf-lib di web/node_modules.
//   node demo/generate-pdfs.mjs
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CO, CLIENT, FILES } from './data.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', 'web', 'package.json'))
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')

const OUT = join(here, 'pdfs')
mkdirSync(OUT, { recursive: true })

const A4 = [595.28, 841.89]
const M = 48 // margine

// ─── Mini motore di impaginazione ──────────────────────────────────────────────
async function makeDoc(meta) {
  const pdf = await PDFDocument.create()
  pdf.setTitle(meta.title || '')
  pdf.setAuthor(meta.author || '')
  pdf.setCreationDate(new Date('2026-09-30T10:00:00Z'))
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const ctx = { pdf, font, bold, ital, pages: [], page: null, y: 0, color: meta.color || [0.2, 0.2, 0.2] }
  ctx.newPage = () => { ctx.page = pdf.addPage(A4); ctx.pages.push(ctx.page); ctx.y = A4[1] - M; return ctx.page }
  ctx.newPage()
  return ctx
}

const C = (arr) => rgb(arr[0], arr[1], arr[2])
const GREY = [0.42, 0.42, 0.45]
const DARK = [0.1, 0.1, 0.12]
const LINE = [0.82, 0.83, 0.86]

function text(ctx, s, x, y, { size = 10, font = ctx.font, color = DARK, align = 'left', width = 0 } = {}) {
  let dx = x
  if (align !== 'left') {
    const w = font.widthOfTextAtSize(s, size)
    dx = align === 'right' ? x + width - w : x + (width - w) / 2
  }
  ctx.page.drawText(s, { x: dx, y, size, font, color: C(color) })
}

function wrap(font, s, size, maxW) {
  const out = []
  for (const para of String(s).split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word
      if (font.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = word } else line = t
    }
    out.push(line)
  }
  return out
}

function ensure(ctx, h) { if (ctx.y - h < M + 30) ctx.newPage() }

function para(ctx, s, { size = 10, font = ctx.font, color = DARK, x = M, width = A4[0] - 2 * M, gap = 4, lh = 1.38 } = {}) {
  const lines = wrap(font, s, size, width)
  for (const l of lines) { ensure(ctx, size * lh); text(ctx, l, x, ctx.y - size, { size, font, color }); ctx.y -= size * lh }
  ctx.y -= gap
}

function hr(ctx, { color = LINE, thick = 0.8, x1 = M, x2 = A4[0] - M } = {}) {
  ctx.page.drawLine({ start: { x: x1, y: ctx.y }, end: { x: x2, y: ctx.y }, thickness: thick, color: C(color) })
}

function rect(ctx, x, y, w, h, { fill, border, thick = 0.8 } = {}) {
  ctx.page.drawRectangle({ x, y, width: w, height: h, color: fill ? C(fill) : undefined, borderColor: border ? C(border) : undefined, borderWidth: border ? thick : 0 })
}

function tint(c, k) { return c.map((x) => x + (1 - x) * k) }

// Carta intestata: banda colorata, nome, indirizzo, P.IVA; titolo documento a destra.
function letterhead(ctx, co, title, subtitle) {
  const c = co.color || ctx.color
  rect(ctx, 0, A4[1] - 8, A4[0], 8, { fill: c })
  // marchio: quadrato con iniziali
  const initials = co.name.split(' ').filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join('')
  rect(ctx, M, A4[1] - 84, 40, 40, { fill: c })
  text(ctx, initials, M, A4[1] - 70, { size: 16, font: ctx.bold, color: [1, 1, 1], align: 'center', width: 40 })
  text(ctx, co.name, M + 52, A4[1] - 56, { size: 14, font: ctx.bold, color: c })
  if (co.tag) text(ctx, co.tag, M + 52, A4[1] - 70, { size: 8.5, font: ctx.ital, color: GREY })
  text(ctx, `${co.addr.join(' · ')} · P.IVA ${co.piva}`, M + 52, A4[1] - 82, { size: 8, color: GREY })
  const right = A4[0] - M
  text(ctx, title, right - 220, A4[1] - 56, { size: 16, font: ctx.bold, color: DARK, align: 'right', width: 220 })
  if (subtitle) text(ctx, subtitle, right - 220, A4[1] - 72, { size: 9.5, color: GREY, align: 'right', width: 220 })
  ctx.y = A4[1] - 108
}

// Box con titolo e righe chiave/valore.
function box(ctx, x, w, title, lines, { h } = {}) {
  const lh = 13
  const height = h || 22 + lines.length * lh + 6
  rect(ctx, x, ctx.y - height, w, height, { border: LINE, fill: [0.985, 0.985, 0.99] })
  text(ctx, title.toUpperCase(), x + 10, ctx.y - 14, { size: 7.5, font: ctx.bold, color: GREY })
  lines.forEach((l, i) => {
    const isFirst = i === 0
    text(ctx, l, x + 10, ctx.y - 30 - i * lh, { size: isFirst ? 10 : 9, font: isFirst ? ctx.bold : ctx.font })
  })
  return height
}

function metaRow(ctx, pairs) {
  const w = (A4[0] - 2 * M) / pairs.length
  rect(ctx, M, ctx.y - 34, A4[0] - 2 * M, 34, { fill: tint(ctx.color, 0.9) })
  pairs.forEach(([k, val], i) => {
    text(ctx, k.toUpperCase(), M + 10 + i * w, ctx.y - 13, { size: 7, font: ctx.bold, color: GREY })
    let size = 9.5
    while (size > 6.5 && ctx.bold.widthOfTextAtSize(val, size) > w - 16) size -= 0.5
    text(ctx, val, M + 10 + i * w, ctx.y - 27, { size, font: ctx.bold })
  })
  ctx.y -= 46
}

// Tabella: cols = [{ t, w, a }] (w frazione della larghezza utile).
function table(ctx, cols, rows, { size = 9, head = true } = {}) {
  const W = A4[0] - 2 * M
  const xs = []; let acc = M
  for (const c of cols) { xs.push(acc); acc += c.w * W }
  const pad = 6
  if (head) {
    rect(ctx, M, ctx.y - 20, W, 20, { fill: ctx.color })
    cols.forEach((c, i) => text(ctx, c.t, xs[i] + pad, ctx.y - 13.5, { size: 7.5, font: ctx.bold, color: [1, 1, 1], align: c.a || 'left', width: c.w * W - 2 * pad }))
    ctx.y -= 20
  }
  rows.forEach((r, ri) => {
    const wrapped = r.map((cell, i) => wrap(ctx.font, String(cell), size, cols[i].w * W - 2 * pad))
    const nl = Math.max(...wrapped.map((x) => x.length))
    const h = nl * (size + 3) + 9
    ensure(ctx, h)
    if (ri % 2 === 1) rect(ctx, M, ctx.y - h, W, h, { fill: [0.975, 0.975, 0.98] })
    wrapped.forEach((lines, i) => lines.forEach((l, li) => text(ctx, l, xs[i] + pad, ctx.y - 6 - size - li * (size + 3), { size, align: cols[i].a || 'left', width: cols[i].w * W - 2 * pad })))
    ctx.y -= h
    hr(ctx, { color: LINE, thick: 0.5 })
  })
  ctx.y -= 10
}

function totals(ctx, rows) {
  const w = 220; const x = A4[0] - M - w
  rows.forEach(([k, val, strong], i) => {
    const h = strong ? 26 : 18
    if (strong) rect(ctx, x, ctx.y - h, w, h, { fill: ctx.color })
    const col = strong ? [1, 1, 1] : DARK
    text(ctx, k, x + 10, ctx.y - (strong ? 17 : 12.5), { size: strong ? 10.5 : 9, font: strong ? ctx.bold : ctx.font, color: col })
    text(ctx, val, x + 10, ctx.y - (strong ? 17 : 12.5), { size: strong ? 11 : 9, font: ctx.bold, color: col, align: 'right', width: w - 20 })
    ctx.y -= h
    if (!strong && i < rows.length - 1) hr(ctx, { x1: x, x2: x + w, thick: 0.4 })
  })
  ctx.y -= 12
}

function heading(ctx, s, { size = 11 } = {}) {
  ensure(ctx, size + 14)
  ctx.y -= 6
  text(ctx, s, M, ctx.y - size, { size, font: ctx.bold, color: ctx.color })
  ctx.y -= size + 8
}

function footers(ctx, left) {
  ctx.pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 40 }, end: { x: A4[0] - M, y: 40 }, thickness: 0.5, color: C(LINE) })
    p.drawText(left, { x: M, y: 28, size: 7, font: ctx.font, color: C(GREY) })
    const s = `Pagina ${i + 1} di ${ctx.pages.length}`
    p.drawText(s, { x: A4[0] - M - ctx.font.widthOfTextAtSize(s, 7), y: 28, size: 7, font: ctx.font, color: C(GREY) })
  })
}

function signatures(ctx, a, b) {
  ensure(ctx, 70)
  ctx.y -= 26
  const w = (A4[0] - 2 * M - 40) / 2
  ;[[a, M], [b, M + w + 40]].forEach(([label, x]) => {
    ctx.page.drawLine({ start: { x, y: ctx.y - 24 }, end: { x: x + w, y: ctx.y - 24 }, thickness: 0.6, color: C(GREY) })
    text(ctx, label, x, ctx.y - 36, { size: 8.5, color: GREY })
  })
  ctx.y -= 50
}

async function save(ctx, name) {
  const bytes = await ctx.pdf.save()
  writeFileSync(join(OUT, name), bytes)
  return name
}

// Formato italiano 1.234,56 (l'ICU di Node non raggruppa le migliaia a 4 cifre).
const eur = (n) => {
  const [i, d] = (Math.round(n * 100) / 100).toFixed(2).split('.')
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d
}

// ─── Fattura generica ──────────────────────────────────────────────────────────
async function invoice({ file, co, num, date, items, ivaRate = 22, payment, iban, notes = [], extraMeta = [] }) {
  const ctx = await makeDoc({ title: `Fattura ${num}`, author: co.name, color: co.color })
  letterhead(ctx, co, 'FATTURA', `n. ${num} del ${date}`)
  const half = (A4[0] - 2 * M - 16) / 2
  const y0 = ctx.y
  box(ctx, M, half, 'Cedente / prestatore', [co.name, ...co.addr, `P.IVA ${co.piva}`])
  ctx.y = y0
  const h = box(ctx, M + half + 16, half, 'Cessionario / committente', [CLIENT.name, ...CLIENT.addr, `P.IVA ${CLIENT.piva}`])
  ctx.y = y0 - h - 14
  metaRow(ctx, [['Numero', num], ['Data', date], ...extraMeta])
  const rows = items.map(([d, q, u, p]) => [d, q, u, eur(p), eur(q * p)])
  table(ctx, [{ t: 'DESCRIZIONE', w: 0.5 }, { t: 'Q.TÀ', w: 0.1, a: 'right' }, { t: 'U.M.', w: 0.08 }, { t: 'PREZZO', w: 0.15, a: 'right' }, { t: 'IMPORTO', w: 0.17, a: 'right' }], rows)
  const imp = items.reduce((s, [, q, , p]) => s + q * p, 0)
  const iva = Math.round(imp * ivaRate) / 100
  const yT = ctx.y
  totals(ctx, [['Imponibile', eur(imp) + ' €'], [`IVA ${ivaRate}%`, eur(iva) + ' €'], ['TOTALE DOCUMENTO', eur(imp + iva) + ' €', true]])
  const yAfter = ctx.y
  ctx.y = yT
  const pw = A4[0] - 2 * M - 240
  const lines = [`Modalità: ${payment.mode}`, `Termini: ${payment.terms}`, `Scadenza: ${payment.due}`]
  if (iban) lines.push(`IBAN: ${iban}`)
  box(ctx, M, pw, 'Pagamento', lines)
  ctx.y = Math.min(yAfter, ctx.y - 22 - lines.length * 13 - 6) - 8
  for (const n of notes) para(ctx, n, { size: 8.5, color: GREY })
  footers(ctx, `${co.name} · ${co.addr.join(', ')} · Documento demo generato per presentazione — dati fittizi`)
  return save(ctx, file)
}

// ─── Documenti ─────────────────────────────────────────────────────────────────
await invoice({
  file: FILES.ftMeridiane, co: CO.meridiane, num: 'FT 2026/0418', date: '12/09/2026',
  extraMeta: [['Rif. ordine', 'ODA-2026-311 · 28/08/2026'], ['Cod. cliente', 'C-0187']],
  items: [
    ['Telaio in acciaio verniciato mod. TV-80, finitura grafite', 40, 'pz', 86.5],
    ['Staffa di fissaggio inox ST-12', 250, 'pz', 2.4],
    ['Piedino regolabile M10 con base antiscivolo', 400, 'pz', 0.95],
    ['Lavorazione taglio laser su disegno cliente (dis. VL-2207)', 1, 'srv', 1150],
    ['Trasporto e imballo', 1, 'srv', 180],
  ],
  payment: { mode: 'Bonifico bancario', terms: '60 gg d.f.f.m.', due: '30/11/2026' },
  iban: 'IT60 X054 2811 1010 0000 0123 456',
  notes: ['Merce consegnata con DDT n. 1874 del 10/09/2026. Contributo ambientale CONAI assolto ove dovuto.', 'In caso di ritardato pagamento si applicano gli interessi di mora ai sensi del D.Lgs. 231/2002.'],
})

await invoice({
  file: FILES.ftTrevalli, co: CO.trevalli, num: '1127/2026', date: '30/09/2026',
  extraMeta: [['Periodo', 'Settembre 2026'], ['Contratto', 'TR-2025-04']],
  items: [
    ['Spedizioni groupage Nord Italia (14 spedizioni, dettaglio in allegato)', 14, 'sped', 145],
    ['Consegne su appuntamento con sponda idraulica', 3, 'cons', 85],
    ['Fuel surcharge 6,5% su servizi di trasporto', 1, 'srv', 148.53],
  ],
  payment: { mode: 'Ricevuta bancaria (RiBa)', terms: '30 gg d.f.', due: '31/10/2026' },
  notes: ['Appoggio RiBa: banca indicata in anagrafica cliente.'],
})

await invoice({
  file: FILES.ftNordwave, co: CO.nordwave, num: '0093/2026', date: '01/10/2026',
  extraMeta: [['Contratto', 'NW-2025-018'], ['Competenza', 'Ottobre 2026']],
  items: [
    ['Canone piattaforma e-commerce — piano Business (ottobre 2026)', 1, 'mese', 890],
    ['Hosting cloud managed, backup giornaliero e monitoraggio 24/7', 1, 'mese', 340],
    ['Sviluppo evolutivo: configuratore prodotti (ticket #4471, #4489)', 12, 'ore', 65],
  ],
  payment: { mode: 'Bonifico bancario', terms: '30 gg d.f.', due: '31/10/2026' },
  iban: 'IT02 L123 4512 3451 2345 6789 012',
})

// Contratto di locazione commerciale (2 pagine)
{
  const co = CO.colle
  const ctx = await makeDoc({ title: 'Contratto di locazione ad uso commerciale', author: co.name, color: [0.22, 0.24, 0.3] })
  rect(ctx, 0, A4[1] - 8, A4[0], 8, { fill: ctx.color })
  ctx.y = A4[1] - 60
  text(ctx, 'CONTRATTO DI LOCAZIONE AD USO NON ABITATIVO', M, ctx.y, { size: 15, font: ctx.bold, align: 'center', width: A4[0] - 2 * M })
  ctx.y -= 18
  text(ctx, '(Legge 27 luglio 1978, n. 392 — artt. 27 e seguenti)', M, ctx.y, { size: 9, font: ctx.ital, color: GREY, align: 'center', width: A4[0] - 2 * M })
  ctx.y -= 30
  para(ctx, 'Con la presente scrittura privata, da valere ad ogni effetto di legge, tra:')
  para(ctx, `${co.name}, con sede in ${co.addr.join(', ')}, P.IVA ${co.piva}, in persona del legale rappresentante Giorgio Valsecchi (di seguito "Locatore")`, { x: M + 16, width: A4[0] - 2 * M - 16 })
  para(ctx, 'e', { x: M + 16 })
  para(ctx, `${CLIENT.name}, con sede in ${CLIENT.addr.join(', ')}, P.IVA ${CLIENT.piva}, in persona dell'amministratore unico Roberta Carminati (di seguito "Conduttore")`, { x: M + 16, width: A4[0] - 2 * M - 16 })
  para(ctx, 'si conviene e si stipula quanto segue.')
  const arts = [
    ['Art. 1 — Oggetto', 'Il Locatore concede in locazione al Conduttore, che accetta, il locale commerciale posto al piano terra dell\'immobile sito in Via Garibaldi 41, 24122 Bergamo (BG), della superficie di circa 210 mq, con due vetrine su strada, identificato al Catasto Fabbricati al Foglio 34, mappale 1187, subalterno 5, categoria C/1.'],
    ['Art. 2 — Destinazione', 'L\'immobile è destinato esclusivamente ad uso showroom ed esposizione e vendita di arredi e complementi. È vietato il mutamento di destinazione senza il consenso scritto del Locatore.'],
    ['Art. 3 — Durata', 'La locazione ha durata di anni 6 (sei) con decorrenza dal 01/03/2026 e prima scadenza al 28/02/2032. Alla scadenza il contratto si rinnova tacitamente per ulteriori 6 anni, salvo disdetta ai sensi di legge.'],
    ['Art. 4 — Recesso del Conduttore', 'Il Conduttore ha facoltà di recedere in qualsiasi momento dal contratto con preavviso di almeno 6 (sei) mesi, da comunicarsi a mezzo PEC o lettera raccomandata A/R.'],
    ['Art. 5 — Canone', 'Il canone annuo è convenuto in € 26.400,00 (ventiseimilaquattrocento/00), da corrispondersi in 12 rate mensili anticipate di € 2.200,00 ciascuna entro il giorno 5 di ogni mese mediante bonifico bancario. Il canone sarà aggiornato annualmente, a partire dal secondo anno, nella misura del 75% della variazione ISTAT dei prezzi al consumo per le famiglie di operai e impiegati.'],
  ]
  for (const [h, b] of arts) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  const arts2 = [
    ['Art. 6 — Deposito cauzionale', 'A garanzia delle obbligazioni assunte, il Conduttore versa al Locatore la somma di € 6.600,00 (seimilaseicento/00), pari a tre mensilità del canone, non imputabile in conto canoni e produttiva di interessi legali che saranno corrisposti al Conduttore al termine di ogni anno di locazione.'],
    ['Art. 7 — Oneri accessori', 'Sono a carico del Conduttore le spese condominiali ordinarie, determinate forfettariamente in € 150,00 mensili, salvo conguaglio annuale sulla base del rendiconto approvato dall\'assemblea.'],
    ['Art. 8 — Manutenzione e migliorie', 'Le riparazioni di piccola manutenzione sono a carico del Conduttore. Eventuali migliorie e addizioni richiedono il preventivo consenso scritto del Locatore e resteranno acquisite all\'immobile senza diritto a indennità.'],
    ['Art. 9 — Registrazione', 'Il presente contratto è stato registrato presso l\'Agenzia delle Entrate, Ufficio Territoriale di Bergamo, in data 14/03/2026 al n. 4821 serie 3T. Le spese di registrazione sono ripartite in parti uguali tra le parti.'],
    ['Art. 10 — Foro competente', 'Per ogni controversia relativa al presente contratto è competente in via esclusiva il Foro di Bergamo.'],
  ]
  for (const [h, b] of arts2) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  para(ctx, 'Letto, confermato e sottoscritto. Bergamo, 20/02/2026', { size: 9.5 })
  signatures(ctx, 'Il Locatore — Immobiliare Colle Aperto S.r.l.', 'Il Conduttore — Verdeluce Arredamenti S.r.l.')
  footers(ctx, 'Contratto di locazione Via Garibaldi 41, Bergamo · Documento demo — dati fittizi')
  await save(ctx, FILES.locazione)
}

// DDT
{
  const co = CO.brera
  const ctx = await makeDoc({ title: 'DDT 2291', author: co.name, color: co.color })
  letterhead(ctx, co, 'DOCUMENTO DI TRASPORTO', 'D.P.R. 472/1996 · n. 2291 del 22/09/2026')
  const half = (A4[0] - 2 * M - 16) / 2
  const y0 = ctx.y
  box(ctx, M, half, 'Destinatario', [CLIENT.name, ...CLIENT.addr, `P.IVA ${CLIENT.piva}`])
  ctx.y = y0
  const h = box(ctx, M + half + 16, half, 'Luogo di destinazione', ['Magazzino Verdeluce', 'Via dei Tessitori 18', '24126 Bergamo (BG)', 'Ricevimento merci: 8:00–12:30'])
  ctx.y = y0 - h - 14
  metaRow(ctx, [['Causale', 'Vendita'], ['Porto', 'Franco'], ['Vettore', 'Logistica Tre Valli S.r.l.'], ['Ritiro', '22/09/2026 10:30']])
  table(ctx, [{ t: 'CODICE', w: 0.14 }, { t: 'DESCRIZIONE', w: 0.5 }, { t: 'COLLI', w: 0.1, a: 'right' }, { t: 'U.M.', w: 0.08 }, { t: 'QUANTITÀ', w: 0.18, a: 'right' }], [
    ['BOU-140-AV', 'Tessuto bouclé avorio, altezza 140 cm, 520 g/m²', '6', 'm', '180,00'],
    ['VCB-140-BN', 'Velluto a coste blu notte, altezza 140 cm', '4', 'm', '95,00'],
    ['LIN-150-SB', 'Lino lavato color sabbia, altezza 150 cm', '4', 'm', '120,00'],
  ])
  metaRow(ctx, [['Numero colli', '14'], ['Aspetto esteriore', 'Rotoli su bancale'], ['Peso lordo', '412 kg'], ['Peso netto', '386 kg']])
  para(ctx, 'Annotazioni: consegna con preavviso telefonico al n. 035 000 0000 (sig. Bonfanti). Merce viaggiante a rischio del committente.', { size: 8.5, color: GREY })
  signatures(ctx, 'Firma del conducente', 'Firma del destinatario')
  footers(ctx, `${co.name} · Documento demo — dati fittizi`)
  await save(ctx, FILES.ddt)
}

// Cedolino
{
  const co = { name: CLIENT.name, addr: CLIENT.addr, piva: CLIENT.piva, color: [0.27, 0.3, 0.36], tag: 'Elaborazione paghe a cura di Studio Paghe Orobico' }
  const ctx = await makeDoc({ title: 'Cedolino settembre 2026', author: co.name, color: co.color })
  letterhead(ctx, co, 'CEDOLINO PAGA', 'Periodo: Settembre 2026')
  metaRow(ctx, [['Dipendente', 'Luca Ferraris'], ['Matricola', '0047'], ['Codice fiscale', 'FRRLCU88C14A794K'], ['Assunzione', '01/04/2019']])
  metaRow(ctx, [['Qualifica', 'Impiegato'], ['Livello', '4°'], ['CCNL', 'Commercio Terziario'], ['Ore ordinarie', '168']])
  table(ctx, [{ t: 'VOCE', w: 0.46 }, { t: 'RIFERIMENTO', w: 0.18, a: 'right' }, { t: 'COMPETENZE', w: 0.18, a: 'right' }, { t: 'TRATTENUTE', w: 0.18, a: 'right' }], [
    ['Paga base', '168 h', '1.884,00', ''],
    ['Contingenza', '', '524,00', ''],
    ['Scatti di anzianità (2)', '', '64,00', ''],
    ['Superminimo individuale', '', '150,00', ''],
    ['Straordinario feriale 15%', '8 h', '145,20', ''],
    ['Contributi IVS a carico dipendente', '9,19%', '', '254,31'],
    ['Ritenuta IRPEF', '', '', '412,77'],
    ['Addizionale regionale e comunale', '', '', '46,10'],
  ])
  totals(ctx, [['Totale competenze', '2.767,20 €'], ['Totale trattenute', '713,18 €'], ['NETTO IN BUSTA', '2.054,02 €', true]])
  metaRow(ctx, [['TFR maturato nel mese', '204,98 €'], ['Ferie residue', '11,5 gg'], ['Permessi residui', '22 h'], ['Accredito', 'Bonifico']])
  footers(ctx, 'Cedolino demo — dati di persona e azienda inventati')
  await save(ctx, FILES.cedolino)
}

// CV
{
  const ctx = await makeDoc({ title: 'CV Chiara Lombardi', author: 'Chiara Lombardi', color: [0.36, 0.22, 0.42] })
  rect(ctx, 0, A4[1] - 130, A4[0], 130, { fill: [0.36, 0.22, 0.42] })
  text(ctx, 'Chiara Lombardi', M, A4[1] - 66, { size: 24, font: ctx.bold, color: [1, 1, 1] })
  text(ctx, 'Senior UX / UI Designer', M, A4[1] - 88, { size: 12, color: [0.92, 0.88, 0.95] })
  text(ctx, 'Milano · chiara.lombardi@example.org · +39 347 000 1234 · Disponibilità: 30 giorni di preavviso', M, A4[1] - 110, { size: 9, color: [0.92, 0.88, 0.95] })
  ctx.y = A4[1] - 150
  heading(ctx, 'Profilo')
  para(ctx, 'Designer con 8 anni di esperienza su prodotti digitali B2B ed e-commerce. Mi occupo dell\'intero processo: ricerca con gli utenti, architettura dell\'informazione, prototipazione e design system, lavorando a stretto contatto con sviluppo e marketing.', { size: 9.5 })
  heading(ctx, 'Esperienze')
  const exp = [
    ['2021 — oggi', 'Senior UX Designer — Nordwave Digital S.r.l., Milano', 'Responsabile del design system aziendale (120+ componenti); riprogettazione del checkout con +18% di conversione; coordinamento di 3 designer junior.'],
    ['2018 — 2021', 'UI Designer — Studio Pixelfiume, Bergamo', 'Interfacce per gestionali e app mobile; test di usabilità moderati; prototipi interattivi per pitch commerciali.'],
    ['2017 — 2018', 'Stage Visual Designer — Agenzia Lanterna, Milano', 'Materiali di campagna digitale, landing page e newsletter.'],
  ]
  for (const [p, r, d] of exp) {
    ensure(ctx, 50)
    text(ctx, p, M, ctx.y - 10, { size: 9, font: ctx.bold, color: GREY })
    text(ctx, r, M + 90, ctx.y - 10, { size: 10, font: ctx.bold })
    ctx.y -= 16
    para(ctx, d, { x: M + 90, width: A4[0] - 2 * M - 90, size: 9.5 })
  }
  heading(ctx, 'Formazione')
  para(ctx, '2017 — Laurea Magistrale in Design della Comunicazione, 110/110 e lode', { size: 9.5 })
  para(ctx, '2015 — Laurea Triennale in Disegno Industriale', { size: 9.5 })
  heading(ctx, 'Competenze')
  para(ctx, 'Figma · Design system · User research · Prototipazione · Accessibilità (WCAG 2.2) · HTML/CSS · Workshop di co-design', { size: 9.5 })
  heading(ctx, 'Lingue')
  para(ctx, 'Inglese C1 (IELTS 7.5) · Spagnolo B2 · Italiano madrelingua', { size: 9.5 })
  ctx.y -= 10
  para(ctx, 'Autorizzo il trattamento dei miei dati personali ai sensi del Regolamento UE 2016/679 (GDPR).', { size: 7.5, color: GREY })
  footers(ctx, 'Curriculum demo — persona inventata')
  await save(ctx, FILES.cv)
}

// Preventivo
{
  const co = CO.alba
  const ctx = await makeDoc({ title: 'Preventivo PR-2026-077', author: co.name, color: co.color })
  letterhead(ctx, co, 'OFFERTA', 'n. PR-2026-077 del 06/10/2026')
  const half = (A4[0] - 2 * M - 16) / 2
  const y0 = ctx.y
  const h = box(ctx, M, half, 'Spett.le', [CLIENT.name, ...CLIENT.addr, 'c.a. Roberta Carminati'])
  ctx.y = y0
  box(ctx, M + half + 16, half, 'Oggetto', ['Digitalizzazione archivio documentale', 'Estrazione automatica dati da', 'fatture, contratti e DDT'])
  ctx.y = y0 - h - 14
  table(ctx, [{ t: 'ATTIVITÀ', w: 0.52 }, { t: 'GG', w: 0.1, a: 'right' }, { t: 'TARIFFA', w: 0.18, a: 'right' }, { t: 'IMPORTO', w: 0.2, a: 'right' }], [
    ['Analisi dei flussi documentali e dei campi da estrarre', '3', '650,00', '1.950,00'],
    ['Configurazione profili documento e mappature Excel', '5', '650,00', '3.250,00'],
    ['Formazione del personale amministrativo', '2', '550,00', '1.100,00'],
    ['Supporto post go-live (3 mesi, forfait)', '—', '—', '1.200,00'],
  ])
  totals(ctx, [['Imponibile', '7.500,00 €'], ['IVA 22%', '1.650,00 €'], ['TOTALE OFFERTA', '9.150,00 €', true]])
  heading(ctx, 'Condizioni')
  para(ctx, '• Validità dell\'offerta: 30 giorni, fino al 05/11/2026.\n• Tempi di realizzazione: 6 settimane dalla conferma d\'ordine.\n• Pagamento: 30% all\'ordine, saldo a collaudo positivo, bonifico 30 gg d.f.\n• Le trasferte fuori provincia sono escluse e verranno quotate a parte.', { size: 9.5 })
  signatures(ctx, 'Studio Alba Consulting S.r.l.', 'Per accettazione — timbro e firma')
  footers(ctx, `${co.name} · Documento demo — dati fittizi`)
  await save(ctx, FILES.preventivo)
}

// Bolletta
{
  const co = CO.energia
  const ctx = await makeDoc({ title: 'Bolletta agosto 2026', author: co.name, color: co.color })
  letterhead(ctx, co, 'BOLLETTA LUCE', 'Fattura n. 2026-0081734 del 05/09/2026')
  metaRow(ctx, [['Totale da pagare', '1.486,22 €'], ['Scadenza', '25/09/2026'], ['Periodo', '01/08 – 31/08/2026']])
  metaRow(ctx, [['Intestatario', CLIENT.name], ['POD', 'IT001E00012345'], ['Potenza impegnata', '30 kW']])
  table(ctx, [{ t: 'FASCIA', w: 0.4 }, { t: 'CONSUMO KWH', w: 0.3, a: 'right' }, { t: 'IMPORTO', w: 0.3, a: 'right' }], [
    ['F1 — ore di punta', '2.140', '612,47'], ['F2 — ore intermedie', '1.380', '362,90'], ['F3 — ore fuori punta', '1.120', '263,15'],
  ])
  totals(ctx, [['Spesa materia energia', '1.238,52 €'], ['Trasporto e oneri', '—'], ['IVA 22% (su imponibile 1.218,21)', '268,01 €'], ['TOTALE', '1.486,22 €', true]])
  para(ctx, 'Consumo complessivo del periodo: 4.640 kWh. Pagamento con addebito SEPA sul conto indicato in anagrafica.', { size: 9, color: GREY })
  footers(ctx, `${co.name} · Documento demo — dati fittizi`)
  await save(ctx, FILES.bolletta)
}

// Fascicolo fornitore Officine Meridiane: contratto quadro, addendum, listino, audit
{
  const co = CO.meridiane
  const ctx = await makeDoc({ title: 'Contratto quadro di fornitura', author: co.name, color: co.color })
  letterhead(ctx, co, 'CONTRATTO QUADRO', 'di fornitura n. CQ-2024-007')
  para(ctx, `Tra ${co.name} (P.IVA ${co.piva}), di seguito "Fornitore", e ${CLIENT.name} (P.IVA ${CLIENT.piva}), di seguito "Cliente", si conviene quanto segue. Data di stipula: 15/01/2024.`, { size: 9.5 })
  const arts = [
    ['1. Oggetto', 'Il presente contratto disciplina la fornitura di componenti metallici per arredo (telai, staffe, minuteria e lavorazioni su disegno) secondo gli ordini d\'acquisto emessi dal Cliente.'],
    ['2. Durata e rinnovo', 'Il contratto ha durata dal 15/01/2024 al 31/12/2026 e si rinnova tacitamente di anno in anno, salvo disdetta da comunicarsi con preavviso di 90 giorni a mezzo PEC.'],
    ['3. Volumi', 'Il volume annuo stimato è pari a € 120.000,00. Il dato è indicativo e non vincolante per il Cliente.'],
    ['4. Prezzi', 'I prezzi sono quelli del listino in vigore alla data dell\'ordine. Le variazioni di listino devono essere comunicate con almeno 60 giorni di anticipo.'],
    ['5. Pagamenti', 'Bonifico bancario a 60 giorni data fattura fine mese.'],
    ['6. Consegne e penali', 'In caso di ritardo nella consegna rispetto alla data confermata, il Fornitore riconosce una penale pari allo 0,5% del valore dell\'ordine per ogni giorno lavorativo di ritardo, fino a un massimo del 10%.'],
    ['7. Qualità', 'Il Fornitore mantiene un sistema di gestione qualità certificato ISO 9001 e si sottopone ad audit annuali da parte del Cliente.'],
    ['8. Referenti', 'Per il Fornitore: Ing. Paolo Re (responsabile commerciale). Per il Cliente: ufficio acquisti.'],
    ['9. Foro competente', 'Per qualsiasi controversia è competente in via esclusiva il Foro di Milano.'],
  ]
  for (const [h, b] of arts) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  signatures(ctx, 'Il Fornitore', 'Il Cliente')
  footers(ctx, `${co.name} · Contratto quadro CQ-2024-007 · Documento demo — dati fittizi`)
  await save(ctx, FILES.quadro)

  const a = await makeDoc({ title: 'Addendum 01', author: co.name, color: co.color })
  letterhead(a, co, 'ADDENDUM N. 1', 'al contratto quadro CQ-2024-007 · 10/06/2025')
  para(a, 'Le parti, come sopra rappresentate, convengono di modificare il contratto quadro come segue, fermo restando tutto quanto non espressamente modificato.', { size: 9.5 })
  for (const [h, b] of [
    ['Art. 2 — Durata', 'La scadenza del contratto è prorogata al 31/12/2027, con le medesime condizioni di rinnovo e preavviso.'],
    ['Art. 3 — Volumi', 'Il volume annuo stimato è aggiornato a € 150.000,00 a seguito dell\'apertura dei nuovi punti vendita.'],
    ['Art. 5 — Pagamenti', 'I termini di pagamento sono portati a 90 giorni data fattura fine mese, tramite bonifico bancario.'],
  ]) { heading(a, h, { size: 10 }); para(a, b, { size: 9.5 }) }
  signatures(a, 'Il Fornitore', 'Il Cliente')
  footers(a, `${co.name} · Addendum 01/2025 · Documento demo — dati fittizi`)
  await save(a, FILES.addendum)

  const l = await makeDoc({ title: 'Listino 2026', author: co.name, color: co.color })
  letterhead(l, co, 'LISTINO PREZZI 2026', 'valido dal 01/01/2026')
  para(l, 'Aumento medio rispetto al listino 2025: +3,8% (adeguamento costo acciaio e energia). Prezzi in euro, IVA esclusa, franco nostro stabilimento.', { size: 9.5 })
  table(l, [{ t: 'CODICE', w: 0.16 }, { t: 'ARTICOLO', w: 0.5 }, { t: '2025', w: 0.17, a: 'right' }, { t: '2026', w: 0.17, a: 'right' }], [
    ['TV-80', 'Telaio acciaio verniciato 80 cm', '83,30', '86,50'], ['TV-120', 'Telaio acciaio verniciato 120 cm', '104,10', '108,00'],
    ['ST-12', 'Staffa di fissaggio inox', '2,31', '2,40'], ['PR-M10', 'Piedino regolabile M10', '0,92', '0,95'],
    ['LAS-H', 'Taglio laser, tariffa oraria', '92,00', '95,00'], ['VRN-M2', 'Verniciatura a polvere al m²', '14,40', '14,90'],
  ])
  footers(l, `${co.name} · Listino 2026 · Documento demo — dati fittizi`)
  await save(l, FILES.listino)

  const v = await makeDoc({ title: 'Verbale audit qualità 2026', author: CLIENT.name, color: [0.2, 0.36, 0.25] })
  letterhead(v, { ...co, name: CLIENT.name, addr: CLIENT.addr, piva: CLIENT.piva, color: [0.2, 0.36, 0.25], tag: 'Ufficio Qualità e Acquisti' }, 'VERBALE DI AUDIT', 'Fornitore: Officine Meridiane S.r.l.')
  metaRow(v, [['Data audit', '03/07/2026'], ['Esito', 'Conforme'], ['Punteggio', '92 / 100'], ['Auditor', 'S. Galli']])
  table(v, [{ t: 'AREA', w: 0.5 }, { t: 'PUNTEGGIO', w: 0.2, a: 'right' }, { t: 'NOTE', w: 0.3 }], [
    ['Gestione ordini e consegne', '18 / 20', 'Puntualità 96%'], ['Controllo qualità in accettazione', '19 / 20', '—'],
    ['Tracciabilità lotti', '17 / 20', 'Migliorare etichette'], ['Sicurezza e ambiente', '19 / 20', '—'], ['Documentazione', '19 / 20', '—'],
  ])
  para(v, 'Certificazione ISO 9001:2015 n. IT-4471-Q rilasciata da ente accreditato, valida fino al 18/05/2028. Prossimo audit previsto entro luglio 2027.', { size: 9.5 })
  footers(v, 'Verbale di audit · Documento demo — dati fittizi')
  await save(v, FILES.audit)
}

// ─── Albero cartelle per la pagina "Cartella bulk" ─────────────────────────────
const BULK = join(here, 'bulk', 'Archivio_Documenti_2026')
rmSync(join(here, 'bulk'), { recursive: true, force: true })
const tree = {
  'Contratti_fornitori/Officine_Meridiane': [FILES.quadro, FILES.addendum, FILES.listino, FILES.audit, FILES.ftMeridiane],
  'Fatture_passive/2026-09/Logistica_Tre_Valli': [FILES.ftTrevalli],
  'Fatture_passive/2026-09/Nordwave_Digital': [FILES.ftNordwave],
  'Fatture_passive/2026-09/Annullate/Nordwave_Digital': [FILES.ftNordwave],
  'DDT/2026-09/Tessitura_Brera_Nova': [FILES.ddt],
  'Immobili/Locazione_Via_Garibaldi_41': [FILES.locazione],
  'Personale/Cedolini_2026-09': [FILES.cedolino],
  'Personale/Candidature': [FILES.cv],
  'Offerte/Studio_Alba': [FILES.preventivo],
  'Utenze/Energia_sede': [FILES.bolletta],
  '_bozze/Vecchie_scansioni': [FILES.ftNordwave],
}
for (const [dir, files] of Object.entries(tree)) {
  mkdirSync(join(BULK, dir), { recursive: true })
  for (const f of files) copyFileSync(join(OUT, f), join(BULK, dir, f))
}
console.log('PDF generati in', OUT)
