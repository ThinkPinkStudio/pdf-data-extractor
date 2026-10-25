// English DEMO PDFs (all invented) in demo/pdfs-en/ and the folder tree for the
// "Bulk folder" page in demo/bulk-en/: mortgage file, business loan, portfolio
// statement, vendor dossier, invoice, office lease, CV. Same layout engine as the
// Italian ones.
//   node demo/generate-pdfs-en.mjs
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CO, CLIENT, FILES, BULK_ROOT, BULK_TREE, eur, VAT_RATE, monthlyPayment, SHOWCASE, FACILITY, STATEMENT, LEASE, CV,
} from './data-en.mjs'
import {
  A4, M, GREY, makeDoc, text, para, rect, ensure, letterhead, box, metaRow, table, totals, heading, footers,
  signatures, save as saveIn, writeBulkTree,
} from './pdf-layout.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'pdfs-en')
const save = (ctx, name) => saveIn(ctx, OUT, name)
const head = (ctx, co, title, subtitle) => letterhead(ctx, co, title, subtitle, { tax: `VAT ${co.vat}` })
const foot = (ctx, left) => footers(ctx, left, (i, n) => `Page ${i} of ${n}`)
const DEMO = 'Demo document generated for presentation — fictitious data'
const half = (A4[0] - 2 * M - 16) / 2
// Two boxes side by side; returns with ctx.y below the taller one.
function boxes(ctx, [t1, l1], [t2, l2]) {
  const y0 = ctx.y
  const h1 = box(ctx, M, half, t1, l1)
  ctx.y = y0
  const h2 = box(ctx, M + half + 16, half, t2, l2)
  ctx.y = y0 - Math.max(h1, h2) - 14
}
const S = SHOWCASE

// ─── Mortgage file (Byrne & Kelly) ────────────────────────────────────────────
async function mortgageOffer(file, offer, revised) {
  const co = CO.harbour
  const ctx = await makeDoc({ title: `${revised ? 'Revised mortgage offer' : 'Mortgage offer'} ${offer.ref}`, author: co.name, color: co.color })
  head(ctx, co, revised ? 'REVISED MORTGAGE OFFER' : 'MORTGAGE OFFER', `ref. ${offer.ref} · ${offer.date}`)
  boxes(ctx, ['Borrowers', [S.borrowers, ...S.home]], ['Property', ['14 Oak Park, Knocknacarra', 'Galway H91 K2E8', 'Semi-detached house · 128 m²']])
  metaRow(ctx, [['Offer date', offer.date], ['Valid until', offer.validUntil], ['Product', revised ? 'Green Fixed 5' : 'Fixed 3'], ['Repayment', 'Capital and interest']])
  const pay = monthlyPayment(S.loan, offer.rate, S.term)
  table(ctx, [{ t: 'LOAN DETAILS', w: 0.55 }, { t: '', w: 0.45, a: 'right' }], [
    ['Purchase price', '€' + eur(S.price)],
    ['Valuation (report of ' + S.valuationDate + ')', '€' + eur(S.valuation)],
    ['Loan amount', '€' + eur(S.loan)],
    ['Loan to value', ((S.loan / S.valuation) * 100).toFixed(1) + '%'],
    ['Term', `${S.term} years (${S.term * 12} monthly repayments)`],
    ['Rate type', offer.rateType],
    ['Interest rate', offer.rate.toFixed(2) + '%'],
    ['APRC', offer.aprc],
    ['Monthly repayment', '€' + eur(pay)],
    ['Total amount repayable', '€' + eur(pay * S.term * 12)],
  ])
  heading(ctx, 'Conditions', { size: 10 })
  const conds = [
    `1. This offer is valid until ${offer.validUntil}. The loan must be drawn down by that date.`,
    '2. The loan is subject to a first legal charge over the property and to a satisfactory title report.',
    '3. During the fixed period an early repayment may give rise to a breakage charge, calculated on the remaining fixed term. After the fixed period the standard variable rate applies (currently 4.40%).',
    '4. Income verified from the latest payslips of both applicants.',
  ]
  if (revised) conds.push(`5. This revised offer replaces the offer ref. ${S.offer1.ref} dated ${S.offer1.date}, which is withdrawn.`)
  para(ctx, conds.join('\n'), { size: 9.5 })
  signatures(ctx, `For ${co.name}`, 'Accepted by the borrowers')
  foot(ctx, `${co.name} · Regulated lender · ${DEMO}`)
  return save(ctx, file)
}
await mortgageOffer(FILES.offer1, S.offer1, false)
await mortgageOffer(FILES.offer2, S.offer2, true)

// Valuation report (market value on page 2)
{
  const co = CO.valuer
  const ctx = await makeDoc({ title: 'Valuation report 14 Oak Park', author: co.name, color: co.color })
  head(ctx, co, 'VALUATION REPORT', `ref. CV-2026-1187 · ${S.valuationDate}`)
  boxes(ctx, ['Instructed by', [S.lender, 'Mortgage underwriting', 'Applicants: ' + S.borrowers]], ['Property', ['14 Oak Park, Knocknacarra', 'Galway H91 K2E8', 'Inspected on ' + S.valuationDate]])
  heading(ctx, '1. Description', { size: 10 })
  para(ctx, 'Two-storey semi-detached house built in 2004, 128 m² gross internal floor area, three bedrooms, two bathrooms, private rear garden and off-street parking for two cars. Building Energy Rating B2. Good condition throughout; kitchen refitted in 2021.', { size: 9.5 })
  heading(ctx, '2. Comparable sales', { size: 10 })
  table(ctx, [{ t: 'ADDRESS', w: 0.5 }, { t: 'DATE', w: 0.2 }, { t: 'FLOOR AREA', w: 0.12, a: 'right' }, { t: 'PRICE', w: 0.18, a: 'right' }], [
    ['9 Oak Park, Knocknacarra', '04/2026', '124 m²', '€412,000'], ['31 Ard Ri Grove, Knocknacarra', '02/2026', '131 m²', '€428,500'], ['6 Cimin Mor, Knocknacarra', '11/2025', '126 m²', '€405,000'],
  ])
  heading(ctx, '3. Services and title', { size: 10 })
  para(ctx, 'Mains water, drainage, electricity and gas connected. Freehold title, no adverse planning matters noted. No evidence of subsidence or structural defects at the time of inspection.', { size: 9.5 })
  ctx.newPage()
  ctx.y = A4[1] - M - 10
  heading(ctx, '4. Valuation', { size: 12 })
  metaRow(ctx, [['Market value', '€' + eur(S.valuation)], ['Valuation date', S.valuationDate], ['Reinstatement cost', '€310,000.00']])
  para(ctx, 'In our opinion the market value of the freehold interest in the property, with vacant possession, as at the valuation date is €420,000.00 (four hundred and twenty thousand euro). The property is suitable security for mortgage lending.', { size: 9.5 })
  para(ctx, 'This report is addressed to the lender for mortgage purposes only and may not be relied upon by any other party.', { size: 8.5, color: GREY })
  signatures(ctx, `${co.name} — chartered surveyor`, 'Date: ' + S.valuationDate)
  foot(ctx, `${co.name} · ${DEMO}`)
  await save(ctx, FILES.valuation)
}

// Payslips of the two applicants
async function payslip({ file, employer, name, empNo, pps, start, role, lines, gross, deductions, net }) {
  const co = { ...employer, color: [0.27, 0.3, 0.36] }
  const ctx = await makeDoc({ title: `Payslip September 2026 ${name}`, author: co.name, color: co.color })
  head(ctx, co, 'PAYSLIP', 'Pay period: September 2026')
  metaRow(ctx, [['Employee', name], ['Employee no.', empNo], ['PPS number', pps], ['Start date', start]])
  metaRow(ctx, [['Role', role], ['Tax basis', 'Cumulative'], ['Pay frequency', 'Monthly'], ['Payment', 'Bank transfer']])
  table(ctx, [{ t: 'ITEM', w: 0.46 }, { t: 'BASIS', w: 0.18, a: 'right' }, { t: 'EARNINGS', w: 0.18, a: 'right' }, { t: 'DEDUCTIONS', w: 0.18, a: 'right' }], lines)
  totals(ctx, [['Gross pay', '€' + gross], ['Total deductions', '€' + deductions], ['NET PAY', '€' + net, true]])
  foot(ctx, 'Demo payslip — person and company are invented')
  return save(ctx, file)
}
await payslip({
  file: FILES.payslipA, employer: CO.brightwood, name: 'Aoife Byrne', empNo: '0112', pps: '9152237WA', start: '01/02/2018', role: 'Showroom designer',
  lines: [['Basic pay', '163 h × 22.80', '3,716.40', ''], ['Overtime (time and a half)', '6 h × 34.20', '205.20', ''], ['PAYE income tax', '', '', '482.93'], ['USC', '', '', '63.31'], ['PRSI (employee, class A1)', '4.1%', '', '160.79']],
  gross: '3,921.60', deductions: '707.03', net: '3,214.57',
})
await payslip({
  file: FILES.payslipB, employer: CO.nordwave, name: 'Seán Kelly', empNo: '0457', pps: '8813402TA', start: '06/09/2021', role: 'Software engineer',
  lines: [['Basic pay', '163 h × 21.50', '3,504.50', ''], ['On-call allowance', '', '120.00', ''], ['PAYE income tax', '', '', '448.10'], ['USC', '', '', '59.40'], ['PRSI (employee, class A1)', '4.1%', '', '148.60']],
  gross: '3,624.50', deductions: '656.10', net: '2,968.40',
})

// ─── Business loan (Liffey Weaving Mills) ─────────────────────────────────────
{
  const co = CO.harbour
  const ctx = await makeDoc({ title: `Facility agreement ${FACILITY.ref}`, author: co.name, color: co.color })
  head(ctx, co, 'FACILITY AGREEMENT', `ref. ${FACILITY.ref} · ${FACILITY.date}`)
  boxes(ctx, ['Lender', [co.name, ...co.addr]], ['Borrower', [CO.liffey.name, ...CO.liffey.addr, `VAT ${CO.liffey.vat}`]])
  const clauses = [
    ['1. Facility', `The Lender makes available to the Borrower a term loan facility of €${eur(FACILITY.principal)} (seven hundred and fifty thousand euro).`],
    ['2. Purpose', `${FACILITY.purpose} at the Borrower’s mill in Kilkenny.`],
    ['3. Drawdown', 'The facility may be drawn in up to three tranches within six months of the date of this agreement.'],
    ['4. Interest', `Interest accrues at three-month Euribor plus a margin of ${FACILITY.margin} per annum, with Euribor floored at zero, payable quarterly in arrears.`],
    ['5. Repayment', 'The facility is repaid in twenty equal quarterly instalments of principal, the first falling due three months after the first drawdown.'],
  ]
  for (const [h, b] of clauses) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  ctx.newPage()
  ctx.y = A4[1] - M - 10
  const clauses2 = [
    ['6. Final maturity', `All amounts outstanding must be repaid in full on ${FACILITY.maturity}.`],
    ['7. Fees', `An arrangement fee of €${eur(FACILITY.fee)} (1% of the facility) is payable on signing.`],
    ['8. Security', 'A first-ranking legal charge over the Borrower’s mill at Mill Lane, Kilkenny, and personal guarantees from the directors limited to €200,000 in aggregate.'],
    ['9. Financial covenants', 'Tested quarterly on the last twelve months: (a) net debt to EBITDA not exceeding 3.0x; (b) interest cover of at least 4.0x. A breach is an event of default unless waived in writing by the Lender.'],
    ['10. Governing law', 'This agreement is governed by the laws of Ireland and the Irish courts have exclusive jurisdiction.'],
  ]
  for (const [h, b] of clauses2) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  signatures(ctx, `For ${co.name}`, `For ${CO.liffey.name}`)
  foot(ctx, `${co.name} · Facility ${FACILITY.ref} · ${DEMO}`)
  await save(ctx, FILES.facility)

  const a = await makeDoc({ title: 'Amendment no. 1', author: co.name, color: co.color })
  head(a, co, 'AMENDMENT NO. 1', `to facility ${FACILITY.ref} · ${FACILITY.amendDate}`)
  para(a, 'The parties agree to amend the facility agreement as follows; everything not expressly amended remains in force.', { size: 9.5 })
  for (const [h, b] of [
    ['Clause 4 — Interest', `With effect from the next interest period the margin is reduced to ${FACILITY.marginNew} per annum.`],
    ['Clause 6 — Final maturity', `The final maturity date is extended to ${FACILITY.maturityNew}; the remaining instalments are re-profiled accordingly.`],
    ['Clause 9 — Financial covenants', 'Until 31/12/2027 the net debt to EBITDA ratio may not exceed 3.5x; thereafter 3.0x. Interest cover remains at least 4.0x.'],
  ]) { heading(a, h, { size: 10 }); para(a, b, { size: 9.5 }) }
  signatures(a, `For ${co.name}`, `For ${CO.liffey.name}`)
  foot(a, `${co.name} · Amendment 01/2026 · ${DEMO}`)
  await save(a, FILES.amendment)
}

// ─── Portfolio statement (client 0142, Q3 2026) ───────────────────────────────
{
  const st = STATEMENT
  const co = CO.atlantic
  const ctx = await makeDoc({ title: `Portfolio statement ${st.account} Q3 2026`, author: co.name, color: co.color })
  head(ctx, co, 'PORTFOLIO STATEMENT', `Quarter ended ${st.date}`)
  metaRow(ctx, [['Client', st.client], ['Account', st.account], ['Mandate', st.mandate], ['Adviser', CLIENT.name]])
  metaRow(ctx, [['Portfolio value', '€' + eur(st.value)], ['Return YTD', `+${st.ret.toFixed(1)}%`], ['Statement date', st.date], ['Next review', st.review]])
  const share = (x) => ((x / st.value) * 100).toFixed(1) + '%'
  heading(ctx, 'Asset allocation', { size: 10 })
  table(ctx, [{ t: 'ASSET CLASS', w: 0.5 }, { t: 'WEIGHT', w: 0.2, a: 'right' }, { t: 'MARKET VALUE', w: 0.3, a: 'right' }], [
    ['Equities', share(st.equity), '€' + eur(st.equity)], ['Bonds', share(st.bonds), '€' + eur(st.bonds)],
    ['Cash', share(st.cash), '€' + eur(st.cash)], ['Alternatives', share(st.alternatives), '€' + eur(st.alternatives)],
  ])
  heading(ctx, 'Largest holdings', { size: 10 })
  table(ctx, [{ t: 'HOLDING', w: 0.5 }, { t: 'WEIGHT', w: 0.2, a: 'right' }, { t: 'MARKET VALUE', w: 0.3, a: 'right' }], st.top.map(([n, x]) => [n, share(x), '€' + eur(x)]))
  heading(ctx, 'Income and charges (year to date)', { size: 10 })
  totals(ctx, [['Dividends and coupons', '€' + eur(st.dividends)], ['Management fee (0.65% p.a.)', '€' + eur(st.mgmtFee)], ['Custody fee', '€' + eur(st.custodyFee)], ['TOTAL FEES', '€' + eur(st.mgmtFee + st.custodyFee), true]])
  para(ctx, 'Values are based on closing prices at the statement date. Past performance is not a reliable guide to future returns.', { size: 8.5, color: GREY })
  foot(ctx, `${co.name} · Custodian · ${DEMO}`)
  await save(ctx, FILES.statement)
}

// ─── Vendor dossier: Meridian Data Services ───────────────────────────────────
async function invoice({ file, co, num, date, items, payment, iban, notes = [], extraMeta = [] }) {
  const ctx = await makeDoc({ title: `Invoice ${num}`, author: co.name, color: co.color })
  head(ctx, co, 'INVOICE', `no. ${num} of ${date}`)
  boxes(ctx, ['Supplier', [co.name, ...co.addr, `VAT ${co.vat}`]], ['Customer', [CLIENT.name, ...CLIENT.addr, `VAT ${CLIENT.vat}`]])
  metaRow(ctx, [['Number', num], ['Date', date], ...extraMeta])
  table(ctx, [{ t: 'DESCRIPTION', w: 0.5 }, { t: 'QTY', w: 0.1, a: 'right' }, { t: 'UNIT', w: 0.08 }, { t: 'PRICE', w: 0.15, a: 'right' }, { t: 'AMOUNT', w: 0.17, a: 'right' }],
    items.map(([d, q, u, p]) => [d, q, u, eur(p), eur(q * p)]))
  const imp = items.reduce((s, [, q, , p]) => s + q * p, 0)
  const iva = Math.round(imp * VAT_RATE) / 100
  const yT = ctx.y
  totals(ctx, [['Net amount', '€' + eur(imp)], [`VAT ${VAT_RATE}%`, '€' + eur(iva)], ['INVOICE TOTAL', '€' + eur(imp + iva), true]])
  const yAfter = ctx.y
  ctx.y = yT
  const lines = [`Method: ${payment.mode}`, `Terms: ${payment.terms}`, `Due date: ${payment.due}`]
  if (iban) lines.push(`IBAN: ${iban}`)
  box(ctx, M, A4[0] - 2 * M - 240, 'Payment', lines)
  ctx.y = Math.min(yAfter, ctx.y - 22 - lines.length * 13 - 6) - 8
  for (const n of notes) para(ctx, n, { size: 8.5, color: GREY })
  foot(ctx, `${co.name} · ${co.addr.join(', ')} · ${DEMO}`)
  return save(ctx, file)
}
{
  const co = CO.meridian
  const ctx = await makeDoc({ title: 'Framework services agreement', author: co.name, color: co.color })
  head(ctx, co, 'FRAMEWORK AGREEMENT', 'for services no. FA-2024-007')
  para(ctx, `Between ${co.name} (VAT ${co.vat}), the "Vendor", and ${CLIENT.name} (VAT ${CLIENT.vat}), the "Customer", it is agreed as follows. Signing date: 15/01/2024.`, { size: 9.5 })
  const arts = [
    ['1. Subject', 'Real-time market data feeds (Euronext and London Stock Exchange), historical data extraction and secure hosting on dedicated nodes, as ordered by the Customer.'],
    ['2. Term and renewal', 'The agreement runs from 15/01/2024 to 31/12/2026 and renews tacitly from year to year, unless terminated with 90 days’ notice by registered email.'],
    ['3. Volumes', 'The estimated annual value is €120,000.00. The figure is indicative and not binding on the Customer.'],
    ['4. Prices', 'Prices are those of the price list in force on the order date. Price changes must be notified at least 60 days in advance.'],
    ['5. Payment', 'Bank transfer at 60 days end of month from the invoice date.'],
  ]
  for (const [h, b] of arts) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  ctx.newPage()
  ctx.y = A4[1] - M - 10
  const arts2 = [
    ['6. Service levels', 'Availability of at least 99.9% per month. For each 0.1% below target the Vendor grants a service credit of 5% of the monthly fee, up to 25%.'],
    ['7. Information security', 'The Vendor keeps an ISO 27001 certified management system and accepts a yearly security audit by the Customer.'],
    ['8. Contacts', 'For the Vendor: Paul Reid (account manager). For the Customer: operations office.'],
    ['9. Jurisdiction', 'This agreement is governed by Irish law; the courts of Cork have exclusive jurisdiction.'],
  ]
  for (const [h, b] of arts2) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  signatures(ctx, 'The Vendor', 'The Customer')
  foot(ctx, `${co.name} · Framework agreement FA-2024-007 · ${DEMO}`)
  await save(ctx, FILES.quadro)

  const a = await makeDoc({ title: 'Addendum 01', author: co.name, color: co.color })
  head(a, co, 'ADDENDUM NO. 1', 'to framework agreement FA-2024-007 · 10/06/2025')
  para(a, 'The parties, represented as above, agree to amend the framework agreement as follows; everything not expressly amended remains unchanged.', { size: 9.5 })
  for (const [h, b] of [
    ['Art. 2 — Term', 'The end date of the agreement is extended to 31/12/2027, with the same renewal and notice terms.'],
    ['Art. 3 — Volumes', 'The estimated annual value is updated to €150,000.00 following the addition of the Frankfurt data feed.'],
    ['Art. 5 — Payment', 'Payment terms are extended to 90 days end of month from the invoice date, by bank transfer.'],
  ]) { heading(a, h, { size: 10 }); para(a, b, { size: 9.5 }) }
  signatures(a, 'The Vendor', 'The Customer')
  foot(a, `${co.name} · Addendum 01/2025 · ${DEMO}`)
  await save(a, FILES.addendum)

  const l = await makeDoc({ title: 'Price list 2026', author: co.name, color: co.color })
  head(l, co, 'PRICE LIST 2026', 'valid from 01/01/2026')
  para(l, 'Average increase over the 2025 price list: +3.8% (exchange licence fees and energy). Prices in euro, VAT excluded, per month unless stated.', { size: 9.5 })
  table(l, [{ t: 'CODE', w: 0.16 }, { t: 'SERVICE', w: 0.5 }, { t: '2025', w: 0.17, a: 'right' }, { t: '2026', w: 0.17, a: 'right' }], [
    ['RT-ENX', 'Real-time feed — Euronext', '1,350.00', '1,400.00'], ['RT-LSE', 'Real-time feed — LSE', '1,010.00', '1,050.00'],
    ['HIST-H', 'Historical data extraction, per hour', '91.50', '95.00'], ['HOST-N', 'Dedicated hosting node', '655.00', '680.00'],
    ['SUP-G', 'Support plan Gold', '790.00', '820.00'],
  ])
  foot(l, `${co.name} · Price list 2026 · ${DEMO}`)
  await save(l, FILES.listino)

  const s = await makeDoc({ title: 'Vendor security audit 2026', author: CLIENT.name, color: [0.2, 0.36, 0.25] })
  head(s, { ...CLIENT, color: [0.2, 0.36, 0.25], tag: 'Operations and vendor risk' }, 'VENDOR AUDIT', `Vendor: ${co.name}`)
  metaRow(s, [['Audit date', '03/07/2026'], ['Result', 'Compliant'], ['Score', '92 / 100'], ['Auditor', 'S. Gallagher']])
  table(s, [{ t: 'AREA', w: 0.5 }, { t: 'SCORE', w: 0.2, a: 'right' }, { t: 'NOTES', w: 0.3 }], [
    ['Access control', '19 / 20', '—'], ['Availability and backups', '18 / 20', 'Uptime 99.94%'], ['Incident management', '17 / 20', 'Shorten notification time'],
    ['Data protection (GDPR)', '19 / 20', '—'], ['Documentation', '19 / 20', '—'],
  ])
  para(s, 'ISO 27001:2022 certificate no. IE-4471-S issued by an accredited body, valid until 18/05/2028. Next audit due by July 2027.', { size: 9.5 })
  foot(s, `Vendor audit · ${DEMO}`)
  await save(s, FILES.audit)
}

await invoice({
  file: FILES.ftMeridian, co: CO.meridian, num: 'INV 2026/0418', date: '12/09/2026',
  extraMeta: [['Order ref.', 'PO-2026-311 · 28/08/2026'], ['Contract', 'FA-2024-007']],
  items: [
    ['Real-time market data feed — Euronext & LSE (September 2026)', 1, 'month', 2450],
    ['Dedicated hosting node', 2, 'node', 680],
    ['Historical data extraction (ticket MD-2291)', 12, 'hrs', 95],
    ['Support plan Gold (September 2026)', 1, 'month', 820],
  ],
  payment: { mode: 'Bank transfer', terms: '90 days end of month', due: '30/11/2026' },
  iban: 'IE29 AIBK 9311 5212 3456 78',
})
await invoice({
  file: FILES.ftNordwave, co: CO.nordwave, num: '0093/2026', date: '01/10/2026',
  extraMeta: [['Agreement', 'NW-2025-018'], ['Service month', 'October 2026']],
  items: [
    ['Client portal subscription — Business plan (October 2026)', 1, 'month', 890],
    ['Managed cloud hosting, daily backup and 24/7 monitoring', 1, 'month', 340],
    ['Development: secure document upload (tickets #4471, #4489)', 12, 'hrs', 65],
  ],
  payment: { mode: 'Bank transfer', terms: '30 days from invoice', due: '31/10/2026' },
  iban: 'IE64 IRCE 9205 0112 3456 78',
})

// ─── Office lease (Cork branch, 2 pages) ──────────────────────────────────────
{
  const co = CO.lee
  const ctx = await makeDoc({ title: 'Office lease Cork', author: co.name, color: [0.22, 0.24, 0.3] })
  rect(ctx, 0, A4[1] - 8, A4[0], 8, { fill: ctx.color })
  ctx.y = A4[1] - 60
  text(ctx, 'LEASE OF OFFICE PREMISES', M, ctx.y, { size: 15, font: ctx.bold, align: 'center', width: A4[0] - 2 * M })
  ctx.y -= 18
  text(ctx, LEASE.premises, M, ctx.y, { size: 9, font: ctx.ital, color: GREY, align: 'center', width: A4[0] - 2 * M })
  ctx.y -= 30
  para(ctx, 'THIS LEASE is made between:')
  para(ctx, `${co.name}, registered office ${co.addr.join(', ')}, VAT ${co.vat}, represented by its director George Whelan (the "Landlord")`, { x: M + 16, width: A4[0] - 2 * M - 16 })
  para(ctx, 'and', { x: M + 16 })
  para(ctx, `${CLIENT.name}, registered office ${CLIENT.addr.join(', ')}, VAT ${CLIENT.vat}, represented by its managing director Rachel Carmody (the "Tenant")`, { x: M + 16, width: A4[0] - 2 * M - 16 })
  const cl = [
    ['Clause 1 — Premises', `The Landlord lets to the Tenant the office suite on the ${LEASE.premises}, of approximately 210 sq m, registered on ${LEASE.folio}.`],
    ['Clause 2 — Permitted use', 'The premises may be used only as offices for financial services. Any change of use requires the Landlord’s prior written consent.'],
    ['Clause 3 — Term', `The lease runs for 6 (six) years from ${LEASE.start}, with the first term ending on ${LEASE.end}.`],
    ['Clause 4 — Tenant break option', 'The Tenant may terminate this lease at any time by giving at least 6 (six) months’ notice by registered post or email.'],
    ['Clause 5 — Rent', `The annual rent is €${eur(LEASE.rent)}, payable in 12 monthly instalments of €${eur(LEASE.instalment)} in advance by the 5th of each month. From the second year the rent is indexed yearly to the Consumer Price Index (CPI).`],
  ]
  for (const [h, b] of cl) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  ctx.newPage()
  ctx.y = A4[1] - M - 10
  const cl2 = [
    ['Clause 6 — Security deposit', `The Tenant pays the Landlord €${eur(LEASE.deposit)}, equal to three months’ rent, as security. The deposit earns statutory interest, paid to the Tenant at the end of each lease year.`],
    ['Clause 7 — Service charge', 'The Tenant pays a flat service charge of €150.00 per month, subject to a yearly reconciliation.'],
    ['Clause 8 — Stamp duty', `This lease was stamped with the Revenue Commissioners on 14/03/2026, stamp duty ID 4821-3T.`],
    ['Clause 9 — Governing law', 'This lease is governed by Irish law and the courts of Cork have exclusive jurisdiction.'],
  ]
  for (const [h, b] of cl2) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  signatures(ctx, `Landlord — ${co.name}`, `Tenant — ${CLIENT.name}`)
  foot(ctx, `Lease 8 Patrick Street, Cork · ${DEMO}`)
  await save(ctx, FILES.locazione)
}

// ─── CV ───────────────────────────────────────────────────────────────────────
{
  const ctx = await makeDoc({ title: `CV ${CV.name}`, author: CV.name, color: [0.36, 0.22, 0.42] })
  rect(ctx, 0, A4[1] - 130, A4[0], 130, { fill: [0.36, 0.22, 0.42] })
  text(ctx, CV.name, M, A4[1] - 66, { size: 24, font: ctx.bold, color: [1, 1, 1] })
  text(ctx, CV.role, M, A4[1] - 88, { size: 12, color: [0.92, 0.88, 0.95] })
  text(ctx, `${CV.city} · ${CV.email} · ${CV.phone} · Availability: ${CV.notice}`, M, A4[1] - 110, { size: 9, color: [0.92, 0.88, 0.95] })
  ctx.y = A4[1] - 150
  heading(ctx, 'Profile')
  para(ctx, 'Credit risk analyst with 8 years’ experience in mortgage and SME lending. I build and validate credit models, run loan-book due diligence and turn messy loan files into reliable data for reporting.', { size: 9.5 })
  heading(ctx, 'Experience')
  const exp = [
    ['2021 — today', `${CV.role} — ${CV.employer}, Dublin`, 'IFRS 9 staging and expected-loss models for a €2bn mortgage book; due diligence on two portfolio acquisitions; automation of loan-tape checks.'],
    ['2018 — 2021', 'Credit Analyst — Liffey Mutual Society, Dublin', 'Underwriting of residential and buy-to-let mortgages; affordability and stress testing.'],
    ['2017 — 2018', 'Graduate Analyst — Atlantic Securities Ltd, Dublin', 'Portfolio reporting and performance attribution.'],
  ]
  for (const [p, r, d] of exp) {
    ensure(ctx, 50)
    text(ctx, p, M, ctx.y - 10, { size: 9, font: ctx.bold, color: GREY })
    text(ctx, r, M + 90, ctx.y - 10, { size: 10, font: ctx.bold })
    ctx.y -= 16
    para(ctx, d, { x: M + 90, width: A4[0] - 2 * M - 90, size: 9.5 })
  }
  heading(ctx, 'Education')
  para(ctx, `2017 — ${CV.degree}, first-class honours\n2016 — BSc in Economics and Mathematics`, { size: 9.5 })
  heading(ctx, 'Skills')
  para(ctx, CV.skills.replace(/, /g, ' · '), { size: 9.5 })
  heading(ctx, 'Languages')
  para(ctx, 'English native · French C1 (DALF) · Spanish B2', { size: 9.5 })
  ctx.y -= 10
  para(ctx, 'I consent to the processing of my personal data under Regulation (EU) 2016/679 (GDPR).', { size: 7.5, color: GREY })
  foot(ctx, 'Demo CV — invented person')
  await save(ctx, FILES.cv)
}

// ─── Folder tree for the "Bulk folder" page ───────────────────────────────────
writeBulkTree(join(here, 'bulk-en'), BULK_ROOT, BULK_TREE, OUT)
console.log('PDFs written to', OUT)
