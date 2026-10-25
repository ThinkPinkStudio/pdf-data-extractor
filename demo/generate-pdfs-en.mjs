// English DEMO PDFs (all invented) in demo/pdfs-en/ and the folder tree for the
// "Bulk folder" page in demo/bulk-en/. Same layout engine as the Italian ones.
//   node demo/generate-pdfs-en.mjs
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CO, CLIENT, FILES, BULK_ROOT, BULK_TREE, eur, VAT_RATE } from './data-en.mjs'
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

// ─── Generic invoice ──────────────────────────────────────────────────────────
async function invoice({ file, co, num, date, items, payment, iban, notes = [], extraMeta = [] }) {
  const ctx = await makeDoc({ title: `Invoice ${num}`, author: co.name, color: co.color })
  head(ctx, co, 'INVOICE', `no. ${num} of ${date}`)
  const half = (A4[0] - 2 * M - 16) / 2
  const y0 = ctx.y
  box(ctx, M, half, 'Supplier', [co.name, ...co.addr, `VAT ${co.vat}`])
  ctx.y = y0
  const h = box(ctx, M + half + 16, half, 'Customer', [CLIENT.name, ...CLIENT.addr, `VAT ${CLIENT.vat}`])
  ctx.y = y0 - h - 14
  metaRow(ctx, [['Number', num], ['Date', date], ...extraMeta])
  const rows = items.map(([d, q, u, p]) => [d, q, u, eur(p), eur(q * p)])
  table(ctx, [{ t: 'DESCRIPTION', w: 0.5 }, { t: 'QTY', w: 0.1, a: 'right' }, { t: 'UNIT', w: 0.08 }, { t: 'PRICE', w: 0.15, a: 'right' }, { t: 'AMOUNT', w: 0.17, a: 'right' }], rows)
  const imp = items.reduce((s, [, q, , p]) => s + q * p, 0)
  const iva = Math.round(imp * VAT_RATE) / 100
  const yT = ctx.y
  totals(ctx, [['Net amount', '€' + eur(imp)], [`VAT ${VAT_RATE}%`, '€' + eur(iva)], ['INVOICE TOTAL', '€' + eur(imp + iva), true]])
  const yAfter = ctx.y
  ctx.y = yT
  const pw = A4[0] - 2 * M - 240
  const lines = [`Method: ${payment.mode}`, `Terms: ${payment.terms}`, `Due date: ${payment.due}`]
  if (iban) lines.push(`IBAN: ${iban}`)
  box(ctx, M, pw, 'Payment', lines)
  ctx.y = Math.min(yAfter, ctx.y - 22 - lines.length * 13 - 6) - 8
  for (const n of notes) para(ctx, n, { size: 8.5, color: GREY })
  foot(ctx, `${co.name} · ${co.addr.join(', ')} · ${DEMO}`)
  return save(ctx, file)
}

// ─── Documents ────────────────────────────────────────────────────────────────
await invoice({
  file: FILES.ftMeridiane, co: CO.meridiane, num: 'INV 2026/0418', date: '12/09/2026',
  extraMeta: [['Order ref.', 'PO-2026-311 · 28/08/2026'], ['Customer code', 'C-0187']],
  items: [
    ['Powder-coated steel frame model TV-80, graphite finish', 40, 'pcs', 86.5],
    ['Stainless steel mounting bracket ST-12', 250, 'pcs', 2.4],
    ['Adjustable M10 foot with non-slip base', 400, 'pcs', 0.95],
    ['Laser cutting to customer drawing (dwg. BW-2207)', 1, 'svc', 1150],
    ['Transport and packaging', 1, 'svc', 180],
  ],
  payment: { mode: 'Bank transfer', terms: '60 days end of month', due: '30/11/2026' },
  iban: 'IE29 AIBK 9311 5212 3456 78',
  notes: ['Goods delivered with delivery note no. 1874 of 10/09/2026.', 'Late payment interest applies under the European Communities (Late Payment in Commercial Transactions) Regulations 2012.'],
})

await invoice({
  file: FILES.ftTrevalli, co: CO.trevalli, num: '1127/2026', date: '30/09/2026',
  extraMeta: [['Period', 'September 2026'], ['Contract', 'HC-2025-04']],
  items: [
    ['Groupage shipments across Ireland (14 shipments, detail attached)', 14, 'ship', 145],
    ['Booked-slot deliveries with tail lift', 3, 'drop', 85],
    ['Fuel surcharge 6.5% on transport services', 1, 'svc', 148.53],
  ],
  payment: { mode: 'Direct debit (SEPA)', terms: '30 days from invoice', due: '31/10/2026' },
  notes: ['Collected by SEPA direct debit from the account on the customer mandate.'],
})

await invoice({
  file: FILES.ftNordwave, co: CO.nordwave, num: '0093/2026', date: '01/10/2026',
  extraMeta: [['Contract', 'NW-2025-018'], ['Service month', 'October 2026']],
  items: [
    ['E-commerce platform subscription — Business plan (October 2026)', 1, 'month', 890],
    ['Managed cloud hosting, daily backup and 24/7 monitoring', 1, 'month', 340],
    ['Ongoing development: product configurator (tickets #4471, #4489)', 12, 'hrs', 65],
  ],
  payment: { mode: 'Bank transfer', terms: '30 days from invoice', due: '31/10/2026' },
  iban: 'IE64 IRCE 9205 0112 3456 78',
})

// Commercial lease (2 pages)
{
  const co = CO.colle
  const ctx = await makeDoc({ title: 'Commercial lease', author: co.name, color: [0.22, 0.24, 0.3] })
  rect(ctx, 0, A4[1] - 8, A4[0], 8, { fill: ctx.color })
  ctx.y = A4[1] - 60
  text(ctx, 'LEASE OF COMMERCIAL PREMISES', M, ctx.y, { size: 15, font: ctx.bold, align: 'center', width: A4[0] - 2 * M })
  ctx.y -= 18
  text(ctx, 'Retail unit — 41 Dominick Street Lower, Galway', M, ctx.y, { size: 9, font: ctx.ital, color: GREY, align: 'center', width: A4[0] - 2 * M })
  ctx.y -= 30
  para(ctx, 'THIS LEASE is made between:')
  para(ctx, `${co.name}, registered office ${co.addr.join(', ')}, VAT ${co.vat}, represented by its director George Whelan (the "Landlord")`, { x: M + 16, width: A4[0] - 2 * M - 16 })
  para(ctx, 'and', { x: M + 16 })
  para(ctx, `${CLIENT.name}, registered office ${CLIENT.addr.join(', ')}, VAT ${CLIENT.vat}, represented by its managing director Rachel Carmody (the "Tenant")`, { x: M + 16, width: A4[0] - 2 * M - 16 })
  para(ctx, 'and the parties agree as follows.')
  const cl = [
    ['Clause 1 — Premises', 'The Landlord lets to the Tenant the ground-floor retail unit at 41 Dominick Street Lower, Galway H91 X8C3, of approximately 210 sq m with two shop windows, registered on Folio GY21874F (retail unit).'],
    ['Clause 2 — Permitted use', 'The premises may be used only as a showroom for the display and sale of furniture and home accessories. Any change of use requires the Landlord’s prior written consent.'],
    ['Clause 3 — Term', 'The lease runs for 6 (six) years from 01/03/2026, with the first term ending on 28/02/2032. Unless terminated as provided by law, it renews for a further 6 years.'],
    ['Clause 4 — Tenant break option', 'The Tenant may terminate this lease at any time by giving at least 6 (six) months’ notice by registered post or email.'],
    ['Clause 5 — Rent', 'The annual rent is €26,400.00 (twenty-six thousand four hundred euro), payable in 12 equal monthly instalments of €2,200.00 in advance by the 5th of each month by bank transfer. From the second year the rent is indexed yearly to the Consumer Price Index (CPI) published by the CSO.'],
  ]
  for (const [h, b] of cl) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  const cl2 = [
    ['Clause 6 — Security deposit', 'As security for its obligations the Tenant pays the Landlord €6,600.00 (six thousand six hundred euro), equal to three months’ rent. The deposit cannot be set against rent and earns statutory interest, paid to the Tenant at the end of each lease year.'],
    ['Clause 7 — Service charge', 'The Tenant pays the ordinary service charge, set at a flat €150.00 per month, subject to a yearly reconciliation against the accounts approved by the management company.'],
    ['Clause 8 — Repairs and alterations', 'Minor repairs are the Tenant’s responsibility. Improvements and alterations require the Landlord’s prior written consent and remain with the premises without compensation.'],
    ['Clause 9 — Stamp duty', 'This lease was stamped with the Revenue Commissioners on 14/03/2026, stamp duty ID 4821-3T. Stamp duty is shared equally between the parties.'],
    ['Clause 10 — Governing law', 'This lease is governed by Irish law and the courts of Galway have exclusive jurisdiction over any dispute.'],
  ]
  for (const [h, b] of cl2) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  para(ctx, 'Read, confirmed and signed. Galway, 20/02/2026', { size: 9.5 })
  signatures(ctx, `Landlord — ${co.name}`, `Tenant — ${CLIENT.name}`)
  foot(ctx, `Lease 41 Dominick Street, Galway · ${DEMO}`)
  await save(ctx, FILES.locazione)
}

// Delivery note
{
  const co = CO.brera
  const ctx = await makeDoc({ title: 'Delivery note 2291', author: co.name, color: co.color })
  head(ctx, co, 'DELIVERY NOTE', 'no. 2291 of 22/09/2026')
  const half = (A4[0] - 2 * M - 16) / 2
  const y0 = ctx.y
  box(ctx, M, half, 'Consignee', [CLIENT.name, ...CLIENT.addr, `VAT ${CLIENT.vat}`])
  ctx.y = y0
  const h = box(ctx, M + half + 16, half, 'Delivery address', ['Brightwood warehouse', 'Unit 18, Weavers Park', 'Dublin 12, D12 X2K7', 'Goods in: 8:00–12:30'])
  ctx.y = y0 - h - 14
  metaRow(ctx, [['Reason', 'Sale'], ['Freight', 'Prepaid'], ['Carrier', CO.trevalli.name], ['Collected', '22/09/2026 10:30']])
  table(ctx, [{ t: 'CODE', w: 0.14 }, { t: 'DESCRIPTION', w: 0.5 }, { t: 'PKGS', w: 0.1, a: 'right' }, { t: 'UNIT', w: 0.08 }, { t: 'QUANTITY', w: 0.18, a: 'right' }], [
    ['BOU-140-IV', 'Ivory bouclé fabric, 140 cm wide, 520 g/m²', '6', 'm', '180.00'],
    ['CRD-140-NB', 'Navy corduroy velvet, 140 cm wide', '4', 'm', '95.00'],
    ['LIN-150-SD', 'Washed linen, sand, 150 cm wide', '4', 'm', '120.00'],
  ])
  metaRow(ctx, [['Packages', '14'], ['Packaging', 'Rolls on pallet'], ['Gross weight', '412 kg'], ['Net weight', '386 kg']])
  para(ctx, 'Notes: call ahead on 01 000 0000 (Mr Burke) before delivery. Goods travel at the buyer’s risk.', { size: 8.5, color: GREY })
  signatures(ctx, 'Driver signature', 'Consignee signature')
  foot(ctx, `${co.name} · ${DEMO}`)
  await save(ctx, FILES.ddt)
}

// Payslip
{
  const co = { name: CLIENT.name, addr: CLIENT.addr, vat: CLIENT.vat, color: [0.27, 0.3, 0.36], tag: 'Payroll processed by Liffey Payroll Services' }
  const ctx = await makeDoc({ title: 'Payslip September 2026', author: co.name, color: co.color })
  head(ctx, co, 'PAYSLIP', 'Pay period: September 2026')
  metaRow(ctx, [['Employee', 'Luke Ferris'], ['Employee no.', '0047'], ['PPS number', '8813402TA'], ['Start date', '01/04/2019']])
  metaRow(ctx, [['Role', 'Sales associate'], ['Grade', '4'], ['Tax basis', 'Cumulative'], ['Hours worked', '163']])
  table(ctx, [{ t: 'ITEM', w: 0.46 }, { t: 'BASIS', w: 0.18, a: 'right' }, { t: 'EARNINGS', w: 0.18, a: 'right' }, { t: 'DEDUCTIONS', w: 0.18, a: 'right' }], [
    ['Basic pay', '163 h × 15.20', '2,477.60', ''],
    ['Overtime (time and a half)', '8 h × 22.80', '182.40', ''],
    ['Sales commission', '', '107.20', ''],
    ['PAYE income tax', '', '', '375.75'],
    ['USC', '', '', '63.42'],
    ['PRSI (employee, class A1)', '4.1%', '', '113.46'],
  ])
  totals(ctx, [['Gross pay', '€2,767.20'], ['Total deductions', '€552.63'], ['NET PAY', '€2,214.57', true]])
  metaRow(ctx, [['Employer pension contribution', '€138.36'], ['Annual leave left', '11.5 days'], ['Payment', 'Bank transfer']])
  foot(ctx, 'Demo payslip — person and company are invented')
  await save(ctx, FILES.cedolino)
}

// CV
{
  const ctx = await makeDoc({ title: 'CV Claire Lambert', author: 'Claire Lambert', color: [0.36, 0.22, 0.42] })
  rect(ctx, 0, A4[1] - 130, A4[0], 130, { fill: [0.36, 0.22, 0.42] })
  text(ctx, 'Claire Lambert', M, A4[1] - 66, { size: 24, font: ctx.bold, color: [1, 1, 1] })
  text(ctx, 'Senior UX / UI Designer', M, A4[1] - 88, { size: 12, color: [0.92, 0.88, 0.95] })
  text(ctx, 'Dublin · claire.lambert@example.org · +353 87 000 1234 · Availability: 30 days’ notice', M, A4[1] - 110, { size: 9, color: [0.92, 0.88, 0.95] })
  ctx.y = A4[1] - 150
  heading(ctx, 'Profile')
  para(ctx, 'Designer with 8 years’ experience on B2B digital products and e-commerce. I cover the whole process: user research, information architecture, prototyping and design systems, working closely with engineering and marketing.', { size: 9.5 })
  heading(ctx, 'Experience')
  const exp = [
    ['2021 — today', `Senior UX Designer — ${CO.nordwave.name}, Dublin`, 'Owner of the company design system (120+ components); checkout redesign with +18% conversion; mentoring 3 junior designers.'],
    ['2018 — 2021', 'UI Designer — Pixelriver Studio, Galway', 'Interfaces for back-office software and mobile apps; moderated usability tests; interactive prototypes for sales pitches.'],
    ['2017 — 2018', 'Visual Design Intern — Lantern Agency, Dublin', 'Digital campaign assets, landing pages and newsletters.'],
  ]
  for (const [p, r, d] of exp) {
    ensure(ctx, 50)
    text(ctx, p, M, ctx.y - 10, { size: 9, font: ctx.bold, color: GREY })
    text(ctx, r, M + 90, ctx.y - 10, { size: 10, font: ctx.bold })
    ctx.y -= 16
    para(ctx, d, { x: M + 90, width: A4[0] - 2 * M - 90, size: 9.5 })
  }
  heading(ctx, 'Education')
  para(ctx, '2017 — MSc in Interaction Design, first-class honours', { size: 9.5 })
  para(ctx, '2015 — BA in Industrial Design', { size: 9.5 })
  heading(ctx, 'Skills')
  para(ctx, 'Figma · Design systems · User research · Prototyping · Accessibility (WCAG 2.2) · HTML/CSS · Co-design workshops', { size: 9.5 })
  heading(ctx, 'Languages')
  para(ctx, 'English native · French C1 (DALF) · Spanish B2', { size: 9.5 })
  ctx.y -= 10
  para(ctx, 'I consent to the processing of my personal data under Regulation (EU) 2016/679 (GDPR).', { size: 7.5, color: GREY })
  foot(ctx, 'Demo CV — invented person')
  await save(ctx, FILES.cv)
}

// Quote
{
  const co = CO.alba
  const ctx = await makeDoc({ title: 'Quote Q-2026-077', author: co.name, color: co.color })
  head(ctx, co, 'QUOTE', 'no. Q-2026-077 of 06/10/2026')
  const half = (A4[0] - 2 * M - 16) / 2
  const y0 = ctx.y
  const h = box(ctx, M, half, 'To', [CLIENT.name, ...CLIENT.addr, 'Attn. Rachel Carmody'])
  ctx.y = y0
  box(ctx, M + half + 16, half, 'Subject', ['Document archive digitisation', 'Automatic data extraction from', 'invoices, contracts and delivery notes'])
  ctx.y = y0 - h - 14
  table(ctx, [{ t: 'ACTIVITY', w: 0.52 }, { t: 'DAYS', w: 0.1, a: 'right' }, { t: 'RATE', w: 0.18, a: 'right' }, { t: 'AMOUNT', w: 0.2, a: 'right' }], [
    ['Analysis of document flows and fields to extract', '3', '650.00', '1,950.00'],
    ['Set-up of document profiles and Excel mappings', '5', '650.00', '3,250.00'],
    ['Training for the accounts team', '2', '550.00', '1,100.00'],
    ['Post go-live support (3 months, fixed fee)', '—', '—', '1,200.00'],
  ])
  totals(ctx, [['Net amount', '€7,500.00'], [`VAT ${VAT_RATE}%`, '€1,725.00'], ['QUOTE TOTAL', '€9,225.00', true]])
  heading(ctx, 'Terms')
  para(ctx, '• Valid for 30 days, until 05/11/2026.\n• Delivery: 6 weeks from order confirmation.\n• Payment: 30% on order, balance on acceptance, bank transfer at 30 days.\n• Travel outside Dublin is excluded and quoted separately.', { size: 9.5 })
  signatures(ctx, co.name, 'Accepted — stamp and signature')
  foot(ctx, `${co.name} · ${DEMO}`)
  await save(ctx, FILES.preventivo)
}

// Electricity bill
{
  const co = CO.energia
  const ctx = await makeDoc({ title: 'Electricity bill August 2026', author: co.name, color: co.color })
  head(ctx, co, 'ELECTRICITY BILL', 'Invoice no. 2026-0081734 of 05/09/2026')
  metaRow(ctx, [['Total due', '€1,486.22'], ['Due date', '25/09/2026'], ['Billing period', '01/08 – 31/08/2026']])
  metaRow(ctx, [['Account holder', CLIENT.name], ['MPRN', '10012345678'], ['Contracted capacity', '30 kVA']])
  table(ctx, [{ t: 'RATE', w: 0.4 }, { t: 'CONSUMPTION KWH', w: 0.3, a: 'right' }, { t: 'AMOUNT', w: 0.3, a: 'right' }], [
    ['Day rate (08:00–23:00)', '2,140', '612.47'], ['Peak rate (17:00–19:00)', '1,380', '362.90'], ['Night rate (23:00–08:00)', '1,120', '263.15'],
  ])
  totals(ctx, [['Energy charges', '€1,238.52'], ['Standing charge', '€62.40'], ['PSO levy and network', '€62.58'], ['VAT 9% (on €1,363.50)', '€122.72'], ['TOTAL', '€1,486.22', true]])
  para(ctx, 'Total consumption in the period: 4,640 kWh. Paid by SEPA direct debit from the account on file.', { size: 9, color: GREY })
  foot(ctx, `${co.name} · ${DEMO}`)
  await save(ctx, FILES.bolletta)
}

// Meridian Metalworks supplier dossier: framework agreement, addendum, price list, audit
{
  const co = CO.meridiane
  const ctx = await makeDoc({ title: 'Framework supply agreement', author: co.name, color: co.color })
  head(ctx, co, 'FRAMEWORK AGREEMENT', 'for supply no. FA-2024-007')
  para(ctx, `Between ${co.name} (VAT ${co.vat}), the "Supplier", and ${CLIENT.name} (VAT ${CLIENT.vat}), the "Customer", it is agreed as follows. Signing date: 15/01/2024.`, { size: 9.5 })
  const arts = [
    ['1. Subject', 'This agreement governs the supply of metal components for furniture (frames, brackets, small parts and machining to drawing) under the purchase orders issued by the Customer.'],
    ['2. Term and renewal', 'The agreement runs from 15/01/2024 to 31/12/2026 and renews tacitly from year to year, unless terminated with 90 days’ notice by registered email.'],
    ['3. Volumes', 'The estimated annual volume is €120,000.00. The figure is indicative and not binding on the Customer.'],
    ['4. Prices', 'Prices are those of the price list in force on the order date. Price list changes must be notified at least 60 days in advance.'],
    ['5. Payment', 'Bank transfer at 60 days end of month from the invoice date.'],
    ['6. Delivery and penalties', 'For late delivery against the confirmed date the Supplier pays a penalty of 0.5% of the order value for each working day of delay, up to a maximum of 10%.'],
    ['7. Quality', 'The Supplier keeps an ISO 9001 certified quality management system and accepts yearly audits by the Customer.'],
    ['8. Contacts', 'For the Supplier: Paul Reid (sales manager). For the Customer: purchasing office.'],
    ['9. Jurisdiction', 'This agreement is governed by Irish law; the courts of Cork have exclusive jurisdiction.'],
  ]
  for (const [h, b] of arts) { heading(ctx, h, { size: 10 }); para(ctx, b, { size: 9.5 }) }
  signatures(ctx, 'The Supplier', 'The Customer')
  foot(ctx, `${co.name} · Framework agreement FA-2024-007 · ${DEMO}`)
  await save(ctx, FILES.quadro)

  const a = await makeDoc({ title: 'Addendum 01', author: co.name, color: co.color })
  head(a, co, 'ADDENDUM NO. 1', 'to framework agreement FA-2024-007 · 10/06/2025')
  para(a, 'The parties, represented as above, agree to amend the framework agreement as follows; everything not expressly amended remains unchanged.', { size: 9.5 })
  for (const [h, b] of [
    ['Art. 2 — Term', 'The end date of the agreement is extended to 31/12/2027, with the same renewal and notice terms.'],
    ['Art. 3 — Volumes', 'The estimated annual volume is updated to €150,000.00 following the opening of the new stores.'],
    ['Art. 5 — Payment', 'Payment terms are extended to 90 days end of month from the invoice date, by bank transfer.'],
  ]) { heading(a, h, { size: 10 }); para(a, b, { size: 9.5 }) }
  signatures(a, 'The Supplier', 'The Customer')
  foot(a, `${co.name} · Addendum 01/2025 · ${DEMO}`)
  await save(a, FILES.addendum)

  const l = await makeDoc({ title: 'Price list 2026', author: co.name, color: co.color })
  head(l, co, 'PRICE LIST 2026', 'valid from 01/01/2026')
  para(l, 'Average increase over the 2025 price list: +3.8% (steel and energy costs). Prices in euro, VAT excluded, ex works.', { size: 9.5 })
  table(l, [{ t: 'CODE', w: 0.16 }, { t: 'ITEM', w: 0.5 }, { t: '2025', w: 0.17, a: 'right' }, { t: '2026', w: 0.17, a: 'right' }], [
    ['TV-80', 'Powder-coated steel frame 80 cm', '83.30', '86.50'], ['TV-120', 'Powder-coated steel frame 120 cm', '104.10', '108.00'],
    ['ST-12', 'Stainless steel mounting bracket', '2.31', '2.40'], ['PR-M10', 'Adjustable M10 foot', '0.92', '0.95'],
    ['LAS-H', 'Laser cutting, hourly rate', '92.00', '95.00'], ['PWD-M2', 'Powder coating per m²', '14.40', '14.90'],
  ])
  foot(l, `${co.name} · Price list 2026 · ${DEMO}`)
  await save(l, FILES.listino)

  const v = await makeDoc({ title: 'Quality audit report 2026', author: CLIENT.name, color: [0.2, 0.36, 0.25] })
  head(v, { ...co, name: CLIENT.name, addr: CLIENT.addr, vat: CLIENT.vat, color: [0.2, 0.36, 0.25], tag: 'Quality and Purchasing' }, 'AUDIT REPORT', `Supplier: ${co.name}`)
  metaRow(v, [['Audit date', '03/07/2026'], ['Result', 'Compliant'], ['Score', '92 / 100'], ['Auditor', 'S. Gallagher']])
  table(v, [{ t: 'AREA', w: 0.5 }, { t: 'SCORE', w: 0.2, a: 'right' }, { t: 'NOTES', w: 0.3 }], [
    ['Order handling and deliveries', '18 / 20', 'On time 96%'], ['Incoming quality control', '19 / 20', '—'],
    ['Batch traceability', '17 / 20', 'Improve labels'], ['Health, safety and environment', '19 / 20', '—'], ['Documentation', '19 / 20', '—'],
  ])
  para(v, 'ISO 9001:2015 certificate no. IE-4471-Q issued by an accredited body, valid until 18/05/2028. Next audit due by July 2027.', { size: 9.5 })
  foot(v, `Audit report · ${DEMO}`)
  await save(v, FILES.audit)
}

// ─── Folder tree for the "Bulk folder" page ───────────────────────────────────
writeBulkTree(join(here, 'bulk-en'), BULK_ROOT, BULK_TREE, OUT)
console.log('PDFs written to', OUT)
