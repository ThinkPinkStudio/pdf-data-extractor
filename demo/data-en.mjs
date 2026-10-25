// English DEMO catalogue (all invented), same shape as data.mjs: an Irish
// furniture retailer, euro amounts in 1,234.56 format, dates DD/MM/YYYY. Used by
// generate-pdfs-en.mjs and, with DEMO_LANG=en, by seed.mjs and video.mjs.

export const DEMO_USER = 'emma.walsh@example.com'
export const TEAM = ['emma.walsh@example.com', 'david.connolly@example.com', 'sarah.gallagher@example.com']
const [, DAVID, SARAH] = TEAM

// ─── Fictional companies ──────────────────────────────────────────────────────
export const CLIENT = {
  name: 'Brightwood Interiors Ltd',
  addr: ['Unit 18, Weavers Park', 'Dublin 12, D12 X2K7'],
  vat: 'IE6388047V',
}

export const CO = {
  meridiane: { name: 'Meridian Metalworks Ltd', addr: ['14 Harbour Road', 'Cork T12 HX93'], vat: 'IE9356720K', color: [0.12, 0.29, 0.33], tag: 'Precision metal fabrication' },
  trevalli: { name: 'Three Valleys Logistics Ltd', addr: ['Ballymount Industrial Estate', 'Dublin 24, D24 E5W2'], vat: 'IE3518440H', color: [0.45, 0.13, 0.16], tag: 'Freight and contract logistics' },
  nordwave: { name: 'Nordwave Digital Ltd', addr: ['44 Grand Canal Quay', 'Dublin 2, D02 R590'], vat: 'IE1204830T', color: [0.16, 0.2, 0.42], tag: 'Software, cloud and digital services' },
  brera: { name: 'Liffey Weaving Mills Ltd', addr: ['Mill Lane', 'Kilkenny R95 YD76'], vat: 'IE2741690B', color: [0.33, 0.24, 0.14], tag: 'Upholstery fabrics since 1962' },
  alba: { name: 'Alba Consulting Ltd', addr: ['21 Merrion Square', 'Dublin 2, D02 VK51'], vat: 'IE2077340L', color: [0.2, 0.36, 0.25], tag: 'Operations and process consulting' },
  colle: { name: 'Hillcrest Property Ltd', addr: ['15 Eyre Square', 'Galway H91 F2X4'], vat: 'IE3980120M', color: [0.25, 0.25, 0.28], tag: '' },
  energia: { name: 'Lumen Energy Ltd', addr: ['210 Airside Business Park', 'Swords, Co. Dublin K67 P6Y2'], vat: 'IE0655480D', color: [0.05, 0.42, 0.47], tag: 'Electricity and gas for business' },
}

// ─── Document profiles ────────────────────────────────────────────────────────
// Same field ids as the Italian catalogue: they key rolling_state/sources.
const F = (id, label, type, description) => ({ id, label, type, description, enabled: true, cells: [] })

export const PROFILES = [
  {
    id: 'prof_fatture',
    recognition: 'An invoice (or credit note) issued by a supplier to the company: invoice number and date, supplier and customer with VAT numbers, lines with net amount, VAT and total due.',
    name: 'Supplier invoices',
    matchKeywords: 'invoice',
    matchExcludeKeywords: 'drafts, cancelled',
    contentKeywords: 'invoice, net amount, VAT, total due',
    contentExcludeKeywords: 'curriculum, quotation',
    promptExtra: 'Amounts in 1,234.56 format. If the invoice has several VAT rates, return the total VAT.',
    fields: [
      F('f_num', 'Invoice number', 'text', 'Document identifier exactly as printed (e.g. "INV 2026/0418").'),
      F('f_data', 'Issue date', 'date', 'Invoice issue date, format DD/MM/YYYY.'),
      F('f_forn', 'Supplier', 'text', 'Company name of whoever ISSUES the invoice.'),
      F('f_piva', 'Supplier VAT no.', 'text', 'Supplier VAT registration number as printed (e.g. IE1234567T).'),
      F('f_cli', 'Customer', 'text', 'Company name of the invoice recipient.'),
      F('f_imp', 'Net amount', 'number', 'Total before VAT, in euro.'),
      F('f_iva', 'VAT amount', 'number', 'Total VAT amount (sum of all rates).'),
      F('f_tot', 'Invoice total', 'number', 'Total due, VAT included.'),
      F('f_scad', 'Payment due date', 'date', 'Date by which to pay; if only terms are given (e.g. "60 days EOM") work out the date.'),
      F('f_mod', 'Payment method', 'enum', 'Bank transfer, direct debit, card, cash, cheque.'),
      F('f_iban', 'IBAN', 'text', 'Supplier IBAN to pay into.'),
      F('f_oda', 'Purchase order ref.', 'text', 'Number and date of the purchase order quoted on the invoice, if any.'),
    ],
  },
  {
    id: 'prof_fornitura',
    recognition: 'A contract, framework agreement or addendum governing an ongoing supply of goods or services: parties, subject, term, prices or price lists, payment, penalties and termination. Price lists and audit reports from the same supplier belong to the dossier.',
    name: 'Supply contracts',
    matchKeywords: 'contract, framework, supplier',
    matchExcludeKeywords: 'draft',
    contentKeywords: 'agreement, supply, term, termination',
    contentExcludeKeywords: '',
    promptExtra: 'The dossier may hold contract, addenda, price lists, reports and invoices: the value from the most recent document always wins.',
    fields: [
      F('c_forn', 'Supplier', 'text', 'Company name of the supplying party.'),
      F('c_piva', 'Supplier VAT no.', 'text', 'Supplier VAT registration number.'),
      F('c_ogg', 'Contract subject', 'text', 'Short description of the goods/services supplied.'),
      F('c_stip', 'Signing date', 'date', 'Date the original contract was signed.'),
      F('c_scad', 'Contract end date', 'date', 'End of validity; take extensions from later addenda into account.'),
      F('c_rinn', 'Auto-renewal', 'boolean', 'Yes/No and how often it renews tacitly.'),
      F('c_prea', 'Termination notice', 'text', 'Days or months of notice required to terminate.'),
      F('c_val', 'Estimated annual value', 'number', 'Expected yearly volume/value in euro.'),
      F('c_pag', 'Payment terms', 'text', 'Payment method and terms currently in force.'),
      F('c_pen', 'Late delivery penalty', 'text', 'Penalty for late delivery (percentage and cap).'),
      F('c_list', 'Price list increase', 'text', 'Price change in the latest price list and its start date.'),
      F('c_audit', 'Latest audit result', 'text', 'Outcome and score of the latest quality audit/report.'),
      F('c_iso', 'ISO 9001 expiry', 'date', 'Expiry date of the supplier quality certificate.'),
      F('c_foro', 'Jurisdiction', 'text', 'Courts with jurisdiction over disputes.'),
      F('c_ref', 'Supplier contact', 'text', 'Name of the sales/technical contact given.'),
      F('c_fatt', 'Latest invoice', 'text', 'Number and total of the most recent invoice in the dossier.'),
    ],
  },
  {
    id: 'prof_locazione',
    recognition: 'A lease of a property (commercial or residential) between landlord and tenant: address and land registry details, rent, term, security deposit, stamp duty.',
    name: 'Commercial leases',
    matchKeywords: 'lease, propert, rent',
    matchExcludeKeywords: '',
    contentKeywords: 'landlord, tenant, rent',
    contentExcludeKeywords: '',
    promptExtra: '',
    fields: [
      F('l_loc', 'Landlord', 'text', 'Owner letting the property.'),
      F('l_cond', 'Tenant', 'text', 'Party renting the property.'),
      F('l_imm', 'Property address', 'text', 'Street, number and town of the leased property.'),
      F('l_cat', 'Land registry ref.', 'text', 'Folio number and property type.'),
      F('l_dec', 'Start date', 'date', 'Date the lease begins.'),
      F('l_scad', 'First term end', 'date', 'End date of the first contractual term.'),
      F('l_can', 'Annual rent', 'number', 'Yearly rent in euro, service charges excluded.'),
      F('l_rata', 'Instalments', 'text', 'Amount and frequency of payments (e.g. monthly in advance).'),
      F('l_dep', 'Security deposit', 'number', 'Security deposit amount in euro.'),
      F('l_istat', 'Rent indexation', 'text', 'How and when the rent is indexed (e.g. CPI).'),
      F('l_prea', 'Break notice', 'text', 'Notice the tenant must give to break the lease.'),
      F('l_reg', 'Stamp duty ref.', 'text', 'Revenue stamp duty reference and date.'),
    ],
  },
  {
    id: 'prof_ddt',
    recognition: 'A delivery note travelling with the goods: sender, consignee, delivery address, reason for transport, carrier, packages and weight. No prices or VAT.',
    name: 'Delivery notes',
    matchKeywords: 'delivery note, dispatch, transport',
    matchExcludeKeywords: '',
    contentKeywords: 'delivery note, carrier, packages',
    contentExcludeKeywords: '',
    promptExtra: '',
    fields: [
      F('d_num', 'Delivery note no.', 'text', 'Delivery note identifier.'),
      F('d_data', 'Delivery note date', 'date', 'Issue date of the delivery note.'),
      F('d_mitt', 'Sender', 'text', 'Company name of the sender.'),
      F('d_dest', 'Consignee', 'text', 'Company name of the consignee.'),
      F('d_luogo', 'Delivery address', 'text', 'Address where the goods are delivered.'),
      F('d_caus', 'Reason for transport', 'enum', 'Sale, processing, return, on approval…'),
      F('d_vett', 'Carrier', 'text', 'Haulier in charge.'),
      F('d_colli', 'Packages', 'number', 'Total number of packages shipped.'),
      F('d_peso', 'Gross weight (kg)', 'number', 'Total gross weight in kg.'),
      F('d_porto', 'Freight terms', 'enum', 'Prepaid, collect, prepaid and charged.'),
    ],
  },
  {
    id: 'prof_cedolini',
    recognition: 'A monthly payslip of an employee: pay period, earnings and deductions, net pay, pension and leave.',
    name: 'Payslips',
    matchKeywords: 'payslip, payroll',
    matchExcludeKeywords: '',
    contentKeywords: 'payslip, net pay, PRSI',
    contentExcludeKeywords: '',
    promptExtra: 'Never report health data or confidential notes that may appear on the payslip.',
    fields: [
      F('p_dip', 'Employee', 'text', 'Employee first and last name.'),
      F('p_cf', 'PPS number', 'text', 'Employee PPS number (7 digits + 1–2 letters).'),
      F('p_mese', 'Pay period', 'text', 'Month and year the pay refers to.'),
      F('p_liv', 'Role and grade', 'text', 'Job title and pay grade.'),
      F('p_ore', 'Hours worked', 'number', 'Number of ordinary hours worked in the month.'),
      F('p_lordo', 'Gross pay', 'number', 'Total gross pay for the month.'),
      F('p_netto', 'Net pay', 'number', 'Net amount paid to the employee.'),
      F('p_tfr', 'Employer pension contribution', 'number', 'Employer pension contribution for the period.'),
      F('p_ferie', 'Annual leave left (days)', 'number', 'Days of annual leave left at month end.'),
    ],
  },
  {
    id: 'prof_cv',
    recognition: 'A candidate’s curriculum vitae: contact details, work experience with dates, education, skills and languages.',
    name: 'Candidate CVs',
    matchKeywords: 'cv, application, resume, candidate',
    matchExcludeKeywords: '',
    contentKeywords: 'experience, education, skills',
    contentExcludeKeywords: 'invoice',
    promptExtra: 'Summarise skills in at most 6 comma-separated keywords.',
    fields: [
      F('v_nome', 'Candidate', 'text', 'First and last name.'),
      F('v_ruolo', 'Current role', 'text', 'Current or most recent position.'),
      F('v_email', 'Email', 'text', 'Contact email address.'),
      F('v_tel', 'Phone', 'text', 'Candidate phone number.'),
      F('v_citta', 'City', 'text', 'City of residence.'),
      F('v_anni', 'Years of experience', 'number', 'Years of experience in the role, worked out from the dates.'),
      F('v_studio', 'Highest qualification', 'text', 'Highest degree or qualification obtained.'),
      F('v_skill', 'Key skills', 'text', 'Main skills (max 6).'),
      F('v_lingue', 'Languages', 'text', 'Foreign languages and level.'),
      F('v_disp', 'Availability', 'text', 'Availability/notice period to start.'),
    ],
  },
  {
    id: 'prof_preventivi',
    recognition: 'A commercial quote or offer sent to the company: list of activities or products with prices, total, validity and terms.',
    name: 'Quotes and offers',
    matchKeywords: 'quote, offer, quotation',
    matchExcludeKeywords: '',
    contentKeywords: 'quote, offer, valid until',
    contentExcludeKeywords: '',
    promptExtra: '',
    fields: [
      F('o_num', 'Quote number', 'text', 'Quote identifier.'),
      F('o_data', 'Quote date', 'date', 'Date of the quote.'),
      F('o_forn', 'Supplier', 'text', 'Who makes the offer.'),
      F('o_ogg', 'Subject', 'text', 'Short description of the supply/project.'),
      F('o_imp', 'Net amount', 'number', 'Quote total excluding VAT.'),
      F('o_valid', 'Valid until', 'date', 'Expiry date of the offer.'),
      F('o_tempi', 'Delivery time', 'text', 'Delivery or completion time.'),
      F('o_pag', 'Payment terms', 'text', 'Proposed payment terms.'),
    ],
  },
  {
    id: 'prof_utenze',
    recognition: 'An electricity or gas bill: meter point (MPRN/GPRN), billing period, consumption, amount and due date.',
    name: 'Utility bills',
    matchKeywords: 'utilit, bill, electricity, energy, gas',
    matchExcludeKeywords: '',
    contentKeywords: 'MPRN, kWh, consumption',
    contentExcludeKeywords: '',
    promptExtra: '',
    fields: [
      F('u_forn', 'Supplier', 'text', 'Electricity/gas supplier.'),
      F('u_pod', 'MPRN / GPRN', 'text', 'Meter point reference number.'),
      F('u_inizio', 'Period start', 'date', 'First day of the billed consumption period.'),
      F('u_per', 'Billing period', 'text', 'Date range of the billed consumption.'),
      F('u_cons', 'Consumption (kWh)', 'number', 'kWh consumed in the period.'),
      F('u_pot', 'Contracted capacity (kVA)', 'number', 'Contracted capacity in kVA.'),
      F('u_tot', 'Total due', 'number', 'Total amount of the bill.'),
      F('u_scad', 'Due date', 'date', 'Payment due date.'),
    ],
  },
]

export const profileById = Object.fromEntries(PROFILES.map((p) => [p.id, p]))

// Single-document Extractor profiles (labels only: the model goes by the name).
export const GENERIC_PROFILES = PROFILES.map((p) => ({
  id: 'g_' + p.id,
  name: p.name,
  fields: p.fields.map((f) => ({ id: 'g_' + f.id, label: f.label, description: f.description, type: f.type, enabled: true })),
}))

// ─── PDF documents ────────────────────────────────────────────────────────────
export const FILES = {
  ftMeridiane: 'INV-2026-0418_Meridian-Metalworks.pdf',
  ftTrevalli: 'INV-1127-2026_Three-Valleys-Logistics.pdf',
  ftNordwave: 'INV-0093-2026_Nordwave-Digital.pdf',
  locazione: 'Lease_41-Dominick-Street_Galway.pdf',
  ddt: 'DN_2291_Liffey-Weaving-Mills.pdf',
  cedolino: 'Payslip_09-2026_Ferris-Luke.pdf',
  cv: 'CV_Claire-Lambert.pdf',
  preventivo: 'Quote_Q-2026-077_Alba-Consulting.pdf',
  bolletta: 'Electricity_bill_08-2026.pdf',
  quadro: 'Framework_supply_agreement_2024.pdf',
  addendum: 'Addendum_01_2025.pdf',
  listino: 'Price_list_2026.pdf',
  audit: 'Quality_audit_report_2026.pdf',
}

// Folder tree for the "Bulk folder" page (written by generate-pdfs-en.mjs).
export const BULK_ROOT = 'Document_Archive_2026'
export const BULK_TREE = {
  'Supplier_contracts/Meridian_Metalworks': [FILES.quadro, FILES.addendum, FILES.listino, FILES.audit, FILES.ftMeridiane],
  'Invoices_payable/2026-09/Three_Valleys_Logistics': [FILES.ftTrevalli],
  'Invoices_payable/2026-09/Nordwave_Digital': [FILES.ftNordwave],
  'Invoices_payable/2026-09/Cancelled/Nordwave_Digital': [FILES.ftNordwave],
  'Delivery_notes/2026-09/Liffey_Weaving_Mills': [FILES.ddt],
  'Property/Lease_41_Dominick_Street': [FILES.locazione],
  'Staff/Payslips_2026-09': [FILES.cedolino],
  'Staff/Applications': [FILES.cv],
  'Quotes/Alba_Consulting': [FILES.preventivo],
  'Utilities/HQ_electricity': [FILES.bolletta],
  '_drafts/Old_scans': [FILES.ftNordwave],
}

// ─── Extracted values (rolling_state = { id: { valore, fonte } }) ─────────────
const v = (valore, file, page = 1) => ({ valore, data_validita: null, fonte: file ? { file, page } : undefined })

// 1,234.56 (ICU in Node does not group 4-digit thousands consistently).
export const eur = (n) => {
  const [i, d] = (Math.round(n * 100) / 100).toFixed(2).split('.')
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + d
}
const num = (s) => Number(String(s).replace(/,/g, ''))
export const VAT_RATE = 23

export const DOSSIER_MERIDIANE = {
  files: [FILES.quadro, FILES.addendum, FILES.listino, FILES.audit, FILES.ftMeridiane],
  state: {
    c_forn: v(CO.meridiane.name, FILES.quadro, 1),
    c_piva: v(CO.meridiane.vat, FILES.quadro, 1),
    c_ogg: v('Supply of metal components for furniture', FILES.quadro, 1),
    c_stip: v('15/01/2024', FILES.quadro, 1),
    c_scad: v('31/12/2027', FILES.addendum, 1),
    c_rinn: v('Yes, yearly (tacit)', FILES.quadro, 2),
    c_prea: v('90 days', FILES.quadro, 2),
    c_val: v('150,000.00', FILES.addendum, 1),
    c_pag: v('Bank transfer, 90 days end of month', FILES.addendum, 1),
    c_pen: v('0.5% per working day, max 10%', FILES.quadro, 2),
    c_list: v('+3.8% from 01/01/2026', FILES.listino, 1),
    c_audit: v('Compliant · 92/100', FILES.audit, 1),
    c_iso: v('18/05/2028', FILES.audit, 1),
    c_foro: v('Courts of Ireland (Cork)', FILES.quadro, 2),
    c_ref: v('Paul Reid', FILES.quadro, 2),
    c_fatt: v('INV 2026/0418 · €7,097.10', FILES.ftMeridiane, 1),
  },
}

// September invoice batch (one folder per supplier). VAT and total from the net.
const inv = (o) => {
  const net = num(o.imp)
  const iva = Math.round(net * VAT_RATE) / 100
  return { ...o, iva: eur(iva), tot: eur(net + iva) }
}
export const INVOICES = [
  inv({ dossier: 'Meridian Metalworks', file: FILES.ftMeridiane, num: 'INV 2026/0418', data: '12/09/2026', forn: CO.meridiane.name, piva: CO.meridiane.vat, imp: '5,770.00', scad: '30/11/2026', mod: 'Bank transfer', iban: 'IE29AIBK93115212345678', oda: 'PO-2026-311 of 28/08/2026' }),
  inv({ dossier: 'Three Valleys Logistics', file: FILES.ftTrevalli, num: '1127/2026', data: '30/09/2026', forn: CO.trevalli.name, piva: CO.trevalli.vat, imp: '2,433.53', scad: '31/10/2026', mod: 'Direct debit', iban: '', oda: '' }),
  inv({ dossier: 'Nordwave Digital', file: FILES.ftNordwave, num: '0093/2026', data: '01/10/2026', forn: CO.nordwave.name, piva: CO.nordwave.vat, imp: '2,010.00', scad: '31/10/2026', mod: 'Bank transfer', iban: 'IE64IRCE92050112345678', oda: 'SaaS agreement NW-2025-018' }),
  inv({ dossier: 'Shannon Electrical', file: 'Invoice_318-B_Shannon-Electrical.pdf', num: '318/B', data: '18/09/2026', forn: 'Shannon Electrical Supplies Ltd', piva: 'IE2215870R', imp: '1,053.11', scad: '18/10/2026', mod: 'Bank transfer', iban: 'IE12BOFI90001712345678', oda: 'PO-2026-329 of 09/09/2026' }),
  inv({ dossier: 'Lakeside Packaging', file: 'SI-2026-0772_Lakeside-Packaging.pdf', num: 'SI-2026-0772', data: '21/09/2026', forn: 'Lakeside Packaging Ltd', piva: 'IE3362710F', imp: '526.27', scad: '31/10/2026', mod: 'Direct debit', iban: '', oda: '' }),
  inv({ dossier: 'Midland Powder Coating', file: 'Invoice_2026-219_Midland-Powder-Coating.pdf', num: '2026/219', data: '24/09/2026', forn: 'Midland Powder Coating Ltd', piva: 'IE4119350S', imp: '3,600.00', scad: '30/11/2026', mod: 'Bank transfer', iban: 'IE87AIBK93208612345678', oda: 'PO-2026-305 of 21/08/2026' }),
  inv({ dossier: 'Corrib Hardware & Sons', file: 'Invoice_1543_Corrib-Hardware.pdf', num: '1543', data: '26/09/2026', forn: 'Corrib Hardware & Sons', piva: 'IE1947260C', imp: '318.95', scad: '26/09/2026', mod: 'Card', iban: '', oda: '' }),
  inv({ dossier: 'Liffey Weaving Mills', file: 'Invoice_26-01984_Liffey-Weaving-Mills.pdf', num: '26/01984', data: '29/09/2026', forn: CO.brera.name, piva: CO.brera.vat, imp: '9,195.82', scad: '30/11/2026', mod: 'Bank transfer', iban: 'IE33BOFI90583812345067', oda: 'PO-2026-298 of 12/08/2026' }),
]

export function invoiceState(i) {
  const f = i.file
  return {
    f_num: v(i.num, f, 1), f_data: v(i.data, f, 1), f_forn: v(i.forn, f, 1), f_piva: v(i.piva, f, 1),
    f_cli: v(CLIENT.name, f, 1), f_imp: v(i.imp, f, 1), f_iva: v(i.iva, f, 1), f_tot: v(i.tot, f, 1),
    f_scad: v(i.scad, f, 1), f_mod: v(i.mod, f, 1), f_iban: i.iban ? v(i.iban, f, 1) : v(null), f_oda: i.oda ? v(i.oda, f, 1) : v(null),
  }
}

// [employee, PPS, role, hours, gross, net, employer pension (5%), leave days]
export const PAYSLIPS = [
  ['Luke Ferris', '8813402TA', 'Sales associate · Grade 4', '163', '2,767.20', '2,214.57', '138.36', '11.5'],
  ['Aoife Byrne', '9152237WA', 'Showroom designer · Grade 3', '163', '2,941.35', '2,322.05', '147.07', '8'],
  ['Andrew Collins', '8509112PA', 'Operations manager · Grade 1', '163', '4,120.00', '3,061.40', '206.00', '14'],
  ['Ellie Page', '9501618WA', 'Customer service · Grade 5', '122', '1,604.88', '1,411.12', '80.24', '6.5'],
  ['Matthew Ryan', '9022745CA', 'Sales associate · Grade 4', '163', '2,689.40', '2,160.10', '134.47', '9'],
  ['Fiona Moore', '8704519NA', 'Purchasing lead · Grade 2', '163', '3,312.60', '2,560.33', '165.63', '12'],
  ['Simon Doyle', '9303118YA', 'Warehouse operative · Grade 4', '163', '2,702.10', '2,169.82', '135.11', '3'],
  ['Niamh Kelly', '8918544FA', 'Showroom designer · Grade 3', '163', '2,958.45', '2,333.47', '147.92', '15.5'],
  ['Paul Brennan', '8211390HA', 'Delivery driver · Grade 6', '163', '1,968.30', '1,690.18', '98.42', '10'],
]
export const PAY_PERIOD = 'September 2026'
export const payslipFile = (name) => `Payslip_09-2026_${name.split(' ').reverse().join('-')}.pdf`

export function payslipState(row, fileName) {
  const [dip, cf, liv, ore, lordo, netto, tfr, ferie] = row
  return {
    p_dip: v(dip, fileName), p_cf: v(cf, fileName), p_mese: v(PAY_PERIOD, fileName), p_liv: v(liv, fileName),
    p_ore: v(ore, fileName), p_lordo: v(lordo, fileName), p_netto: v(netto, fileName), p_tfr: v(tfr, fileName), p_ferie: v(ferie, fileName),
  }
}

export const LEASES = [
  { dossier: 'Showroom 41 Dominick Street · Galway', file: FILES.locazione, loc: CO.colle.name, imm: '41 Dominick Street Lower, Galway H91 X8C3', cat: 'Folio GY21874F · retail unit', dec: '01/03/2026', scad: '28/02/2032', can: '26,400.00', rata: '2,200.00 monthly in advance', dep: '6,600.00', istat: 'CPI, yearly from the 2nd year', prea: '6 months (registered post or email)', reg: 'Revenue stamp duty ID 4821-3T, 14/03/2026' },
  { dossier: 'Store 8 Patrick Street · Cork', file: 'Lease_8-Patrick-Street_Cork.pdf', loc: 'Lee Estates Ltd', imm: '8 Patrick Street, Cork T12 W8X1', cat: 'Folio CK45512L · retail unit', dec: '01/09/2023', scad: '31/08/2029', can: '31,200.00', rata: '7,800.00 quarterly in advance', dep: '7,800.00', istat: 'CPI, yearly', prea: '6 months', reg: 'Revenue stamp duty ID 9310-3T, 22/09/2023' },
  { dossier: 'Store 112 O’Connell Street · Limerick', file: 'Lease_112-OConnell-Street_Limerick.pdf', loc: 'Shannonside Properties Ltd', imm: '112 O’Connell Street, Limerick V94 E2P7', cat: 'Folio LK22103F · retail unit', dec: '15/01/2025', scad: '14/01/2031', can: '22,800.00', rata: '1,900.00 monthly in advance', dep: '5,700.00', istat: 'CPI, yearly', prea: '12 months', reg: 'Revenue stamp duty ID 1188-3T, 30/01/2025' },
]

export function leaseState(l) {
  const f = l.file
  return {
    l_loc: v(l.loc, f, 1), l_cond: v(CLIENT.name, f, 1), l_imm: v(l.imm, f, 1), l_cat: v(l.cat, f, 1),
    l_dec: v(l.dec, f, 1), l_scad: v(l.scad, f, 1), l_can: v(l.can, f, 1), l_rata: v(l.rata, f, 1),
    l_dep: v(l.dep, f, 2), l_istat: v(l.istat, f, 2), l_prea: v(l.prea, f, 2), l_reg: v(l.reg, f, 2),
  }
}

const SAAS = 'SaaS_agreement_NW-2025-018.pdf'
const HAUL = 'Haulage_contract_2025.pdf'
export const SUPPLY_CONTRACTS = [
  { dossier: 'Meridian Metalworks', state: DOSSIER_MERIDIANE.state, files: DOSSIER_MERIDIANE.files, status: 'done' },
  {
    dossier: 'Nordwave Digital', status: 'done',
    files: [SAAS, 'SLA_schedule_B.pdf', FILES.ftNordwave],
    state: {
      c_forn: v(CO.nordwave.name, SAAS), c_piva: v(CO.nordwave.vat, SAAS),
      c_ogg: v('SaaS e-commerce platform, hosting and ongoing development', SAAS),
      c_stip: v('03/03/2025', SAAS), c_scad: v('02/03/2028', SAAS, 2),
      c_rinn: v('Yes, yearly (tacit)', SAAS, 2), c_prea: v('60 days', SAAS, 2),
      c_val: v('24,840.00', SAAS, 3), c_pag: v('Bank transfer, 30 days', FILES.ftNordwave),
      c_pen: v('Service credits if availability < 99.5%', 'SLA_schedule_B.pdf'), c_list: v(null), c_audit: v(null), c_iso: v(null),
      c_foro: v('Courts of Ireland (Dublin)', SAAS, 4), c_ref: v('Irene Sullivan', SAAS, 4),
      c_fatt: v('0093/2026 · €2,472.30', FILES.ftNordwave),
    },
  },
  {
    dossier: 'Three Valleys Logistics', status: 'done',
    files: [HAUL, 'Rate_card_2026.pdf', FILES.ftTrevalli, FILES.ddt],
    state: {
      c_forn: v(CO.trevalli.name, HAUL), c_piva: v(CO.trevalli.vat, HAUL),
      c_ogg: v('Groupage freight across Ireland and booked-slot deliveries', HAUL),
      c_stip: v('01/02/2025', HAUL), c_scad: v('31/01/2027', HAUL),
      c_rinn: v('No', HAUL, 2), c_prea: v('—', null), c_val: v('28,000.00', HAUL),
      c_pag: v('Direct debit, 30 days', FILES.ftTrevalli), c_pen: v('€50 per delivery outside the agreed window', HAUL, 2),
      c_list: v('Fuel surcharge 6.5% (Oct 2026)', 'Rate_card_2026.pdf'), c_audit: v(null), c_iso: v(null),
      c_foro: v('Courts of Ireland (Dublin)', HAUL, 3), c_ref: v('Mark Gallagher', HAUL, 3),
      c_fatt: v('1127/2026 · €2,993.24', FILES.ftTrevalli),
    },
  },
  {
    dossier: 'Liffey Weaving Mills', status: 'running',
    files: ['Framework_agreement_fabrics_2023.pdf', 'Extension_2026.pdf', 'Sample_price_list_AW26.pdf', 'Invoice_26-01984_Liffey-Weaving-Mills.pdf'],
    progress: { docIndex: 2, docTotal: 4, pageIndex: 3, pageTotal: 7, docName: 'Sample_price_list_AW26.pdf', totalPagesProcessed: 9 },
    state: {
      c_forn: v(CO.brera.name, 'Framework_agreement_fabrics_2023.pdf'), c_piva: v(CO.brera.vat, 'Framework_agreement_fabrics_2023.pdf'),
      c_ogg: v('Supply of upholstery and curtain fabrics', 'Framework_agreement_fabrics_2023.pdf'), c_stip: v('09/05/2023', 'Framework_agreement_fabrics_2023.pdf'),
      c_scad: v('31/12/2026', 'Extension_2026.pdf'),
    },
  },
  { dossier: 'Midland Powder Coating', status: 'queued', files: ['Toll_processing_contract_2024.pdf', 'Audit_report_2025.pdf'], state: {} },
]

export const MAIN_SESSION_CHAT = [
  { role: 'user', content: 'When is payment due and which IBAN should I pay into?' },
  { role: 'assistant', content: 'Invoice INV 2026/0418 is payable by bank transfer at 60 days end of month, so by 30/11/2026.\nIBAN given by the supplier: IE29 AIBK 9311 5212 3456 78.' },
  { role: 'user', content: 'Are there lines that don’t match purchase order PO-2026-311?' },
  { role: 'assistant', content: 'The order quoted is PO-2026-311 of 28/08/2026. Besides the product lines, the invoice has two extra items:\n• Laser cutting to customer drawing — €1,150.00\n• Transport and packaging — €180.00\nCheck they were in the order: the rest (TV-80 frames, ST-12 brackets, M10 feet) matches quantities and unit prices.' },
]

export const LEASE_CHAT = [
  { role: 'user', content: 'By when must I give notice if I want to leave at the end of the first term?' },
  { role: 'assistant', content: 'The first term ends on 28/02/2032. The tenant may break the lease with 6 months’ notice by registered post or email (clause 4): the notice must arrive by 31/08/2031.' },
  { role: 'user', content: 'How much do I pay per month, rent plus service charge?' },
  { role: 'assistant', content: 'Rent: €2,200.00 per month (€26,400.00 a year, monthly in advance by the 5th).\nService charge: flat €150.00 per month payable by the tenant (clause 7).\nMonthly total: €2,350.00, plus CPI indexation from the second year.' },
  { role: 'user', content: 'Does the security deposit earn interest?' },
  { role: 'assistant', content: 'Yes. The €6,600.00 deposit (three months’ rent) earns statutory interest, paid to the tenant at the end of each lease year (clause 6).' },
]

// ─── Multi-year archives for the Summaries (charts per year) ──────────────────
// Deterministic PRNG: re-seeding always gives the same numbers.
function prng(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296) }
const pad = (n) => String(n).padStart(2, '0')

// 2024–2025 invoices from the same suppliers (two per supplier a year).
export function archiveInvoices() {
  const rnd = prng(2024)
  const out = []
  const growth = { 2024: 0.82, 2025: 0.93 }
  for (const year of [2024, 2025]) {
    for (const [k, i] of INVOICES.entries()) {
      for (const half of [0, 1]) {
        const imp = num(i.imp) * growth[year] * (0.7 + rnd() * 0.6)
        const iva = Math.round(imp * VAT_RATE) / 100
        const month = half ? 7 + Math.floor(rnd() * 5) : 1 + Math.floor(rnd() * 5)
        const day = 3 + Math.floor(rnd() * 24)
        const dueMonth = month + 2 > 12 ? month - 10 : month + 2
        const dueYear = month + 2 > 12 ? year + 1 : year
        const n = `${String(100 + k * 37 + half * 211 + (year - 2024) * 503)}/${year}`
        out.push({
          ...i, dossier: `${i.dossier} · ${pad(month)}-${year}`, file: `Invoice_${n.replace('/', '-')}_${i.dossier.replace(/[^A-Za-z]+/g, '-')}.pdf`,
          num: n, data: `${pad(day)}/${pad(month)}/${year}`, imp: eur(imp), iva: eur(iva), tot: eur(imp + iva),
          scad: `${pad(Math.min(day, 28))}/${pad(dueMonth)}/${dueYear}`, oda: '',
        })
      }
    }
  }
  return out
}

// Monthly HQ electricity bills (Jan 2025 – Aug 2026), seasonal consumption.
export function monthlyBills() {
  const kwh = [5480, 5120, 4710, 4020, 3880, 4470, 5210, 4390, 4150, 4380, 4960, 5390]
  const out = []
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 8) break
      // August 2026 = the sample PDF bill (4640 kWh, €1,486.22).
      const aug26 = y === 2026 && m === 8
      const cons = aug26 ? 4640 : Math.round(kwh[m - 1] * (y === 2026 ? 0.94 : 1))
      const tot = aug26 ? 1486.22 : cons * (y === 2026 ? 0.3203 : 0.2961)
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      const dm = m === 12 ? 1 : m + 1
      const dy = m === 12 ? y + 1 : y
      out.push({
        dossier: `HQ electricity · ${pad(m)}-${y}`, file: aug26 ? FILES.bolletta : `Electricity_bill_${pad(m)}-${y}.pdf`,
        inizio: `01/${pad(m)}/${y}`, per: `01/${pad(m)}/${y} – ${last}/${pad(m)}/${y}`, cons: String(cons), tot: eur(tot), scad: `25/${pad(dm)}/${dy}`,
      })
    }
  }
  return out
}

export function billState(b) {
  const f = b.file
  return {
    u_forn: v(CO.energia.name, f), u_pod: v('10012345678', f), u_inizio: v(b.inizio, f), u_per: v(b.per, f),
    u_cons: v(b.cons, f), u_pot: v('30', f), u_tot: v(b.tot, f), u_scad: v(b.scad, f),
  }
}

// ─── Seed texts (job logs, relevance checks, batches, singles, history) ───────
export const TEXT = {
  singlesFolder: 'Single_extractions',
  log: {
    strategy: (profile) => `Strategy: full-coverage groups · model qwen2.5:7b-instruct · profile "${profile}"`,
    docs: (n, native, ocr) => `Documents: ${n} · native text ${native}, OCR ${ocr}`,
    cache: (hit, n) => `OCR cache: ${hit}/${n} documents reused (identical content already processed)`,
    precheck: 'Relevance pre-check [keywords]: ok (score 0.83) — profile keywords found in the content',
    stages: 'Stage A: seed from the most recent document · Stage B: focused groups (3 most recent + 3 most similar)',
    done: (n, total) => `Cross-field validation: ok · Extracted ${n}/${total} fields`,
    index: 'Vector index: 1 dossier indexed',
  },
  detected: {
    prof_fatture: 'supplier invoice', prof_fornitura: 'supply contract with attachments', prof_locazione: 'commercial lease',
    prof_ddt: 'delivery note', prof_cedolini: 'payslip', prof_cv: 'curriculum vitae', prof_preventivi: 'commercial quote', prof_utenze: 'electricity bill',
  },
  okReason: 'profile keywords found in the content',
  okSummary: (n, profile) => `The text contains ${n}/${n} words of the «${profile}» profile: extraction goes ahead.`,
}

export const BATCHES = {
  invoices: 'Supplier invoices · September 2026',
  contracts: 'Supplier contracts · 2027 renewals',
  payslips: 'Payslips · September 2026',
  leases: 'Leases · HQ and stores',
  archive: 'Supplier invoices · archive 2024–2025',
  bills: 'Utilities · electricity bills 2025–2026',
}

// Out-of-place document in the invoice batch: the relevance check stops it.
export const MISMATCH = {
  dossier: 'Misc documents (to sort)',
  error: 'Content not relevant to the "Supplier invoices" profile — detected: curriculum vitae (experience, education, skills). Check the profile or press "Proceed anyway".',
  precheck: {
    verdict: 'mismatch', mode: 'keywords', score: 0.0, threshold: 0.25, reason: 'no profile keyword in the content',
    missing: ['invoice', 'net amount', 'VAT', 'total due'], detected: { type: 'curriculum vitae', keywords: ['experience', 'education', 'skills'] },
    suggestion: { id: 'prof_cv', name: 'Candidate CVs' },
    summary: 'No word of the «Supplier invoices» profile in the text; the content looks like «Candidate CVs». The job stays on hold until you choose: change profile or «Proceed anyway».',
  },
}

export const LEASE_ERROR = {
  dossier: 'Warehouse Naas · 1998 scan',
  file: 'Lease_warehouse_Naas_scan.pdf',
  error: 'OCR: text unreadable on 4/4 pages (72 dpi scan). Upload a scan of at least 200 dpi.',
}

const at = (file, valore) => ({ valore, fonte: { file, page: 1 } })
export const SINGLES = {
  meridiane: {
    dossier: 'Supplier Meridian Metalworks',
    previous: {
      summary: 'First run on the framework agreement only: addendum and audit report uploaded later.',
      values: {
        c_forn: CO.meridiane.name, c_piva: CO.meridiane.vat, c_ogg: 'Supply of metal components for furniture', c_stip: '15/01/2024',
        c_scad: '31/12/2026', c_rinn: 'Yes, yearly (tacit)', c_prea: '90 days', c_val: '120,000.00', c_pag: 'Bank transfer, 60 days end of month',
        c_pen: '0.5% per working day, max 10%', c_foro: 'Courts of Ireland (Cork)', c_ref: 'Paul Reid',
      },
    },
  },
  cv: {
    email: SARAH, dossier: 'Application · UX Designer',
    state: {
      v_nome: at(FILES.cv, 'Claire Lambert'), v_ruolo: at(FILES.cv, 'Senior UX Designer — Nordwave Digital Ltd'),
      v_email: at(FILES.cv, 'claire.lambert@example.org'), v_tel: at(FILES.cv, '+353 87 000 1234'),
      v_citta: at(FILES.cv, 'Dublin'), v_anni: at(FILES.cv, '8'),
      v_studio: at(FILES.cv, 'MSc in Interaction Design'),
      v_skill: at(FILES.cv, 'Figma, design systems, user research, prototyping, accessibility, HTML/CSS'),
      v_lingue: at(FILES.cv, 'French C1, Spanish B2'), v_disp: at(FILES.cv, '30 days’ notice'),
    },
  },
  quote: {
    email: DEMO_USER, dossier: 'Archive digitisation quote',
    state: {
      o_num: at(FILES.preventivo, 'Q-2026-077'), o_data: at(FILES.preventivo, '06/10/2026'),
      o_forn: at(FILES.preventivo, CO.alba.name), o_ogg: at(FILES.preventivo, 'Document archive digitisation'),
      o_imp: at(FILES.preventivo, '7,500.00'), o_valid: at(FILES.preventivo, '05/11/2026'),
      o_tempi: at(FILES.preventivo, '6 weeks from order confirmation'), o_pag: at(FILES.preventivo, '30% on order, balance on acceptance'),
    },
  },
  energy: {
    email: DAVID, dossier: 'HQ electricity · August 2026',
    state: {
      u_forn: at(FILES.bolletta, CO.energia.name), u_pod: at(FILES.bolletta, '10012345678'),
      u_inizio: at(FILES.bolletta, '01/08/2026'), u_per: at(FILES.bolletta, '01/08/2026 – 31/08/2026'),
      u_cons: at(FILES.bolletta, '4640'), u_pot: at(FILES.bolletta, '30'), u_tot: at(FILES.bolletta, '1,486.22'),
      u_scad: at(FILES.bolletta, '25/09/2026'),
    },
  },
}

// Single Extractor history (sessions restorable with «Open»).
export const SESSIONS = (H, D) => [
  { file: FILES.ftMeridiane, pages: 1, ago: 35 * 60, chat: MAIN_SESSION_CHAT,
    fields: [['Invoice number', 'INV 2026/0418'], ['Issue date', '12/09/2026'], ['Supplier', CO.meridiane.name], ['Supplier VAT no.', CO.meridiane.vat], ['Customer', CLIENT.name], ['Net amount', '5,770.00'], ['VAT amount', '1,327.10'], ['Invoice total', '7,097.10'], ['Payment due date', '30/11/2026'], ['Payment method', 'Bank transfer'], ['IBAN', 'IE29AIBK93115212345678'], ['Purchase order ref.', 'PO-2026-311 of 28/08/2026']] },
  { file: FILES.locazione, pages: 2, ago: 3 * H, chat: LEASE_CHAT,
    fields: [['Landlord', CO.colle.name], ['Tenant', CLIENT.name], ['Property address', '41 Dominick Street Lower, Galway H91 X8C3'], ['Land registry ref.', 'Folio GY21874F · retail unit'], ['Start date', '01/03/2026'], ['First term end', '28/02/2032'], ['Annual rent', '26,400.00'], ['Instalments', '2,200.00 monthly in advance'], ['Security deposit', '6,600.00'], ['Rent indexation', 'CPI, yearly from the 2nd year'], ['Break notice', '6 months (registered post or email)'], ['Stamp duty ref.', 'Revenue stamp duty ID 4821-3T, 14/03/2026']] },
  { file: FILES.ddt, pages: 1, ago: 22 * H, chat: [],
    fields: [['Delivery note no.', '2291'], ['Delivery note date', '22/09/2026'], ['Sender', CO.brera.name], ['Consignee', CLIENT.name], ['Delivery address', 'Unit 18, Weavers Park, Dublin 12, D12 X2K7'], ['Reason for transport', 'Sale'], ['Carrier', CO.trevalli.name], ['Packages', '14'], ['Gross weight (kg)', '412'], ['Freight terms', 'Prepaid']] },
  { file: FILES.cedolino, pages: 1, ago: 2 * D, chat: [],
    fields: [['Employee', 'Luke Ferris'], ['PPS number', '8813402TA'], ['Pay period', 'September 2026'], ['Role and grade', 'Sales associate · Grade 4'], ['Hours worked', '163'], ['Gross pay', '2,767.20'], ['Net pay', '2,214.57'], ['Employer pension contribution', '138.36'], ['Annual leave left (days)', '11.5']] },
  { file: FILES.cv, pages: 1, ago: 2 * D + 5 * H, chat: [],
    fields: [['Candidate', 'Claire Lambert'], ['Current role', 'Senior UX Designer'], ['Email', 'claire.lambert@example.org'], ['Phone', '+353 87 000 1234'], ['City', 'Dublin'], ['Years of experience', '8'], ['Highest qualification', 'MSc in Interaction Design'], ['Key skills', 'Figma, design systems, user research, prototyping'], ['Languages', 'French C1, Spanish B2'], ['Availability', '30 days’ notice']] },
  { file: FILES.preventivo, pages: 1, ago: 3 * D, chat: [],
    fields: [['Quote number', 'Q-2026-077'], ['Quote date', '06/10/2026'], ['Supplier', CO.alba.name], ['Subject', 'Document archive digitisation'], ['Net amount', '7,500.00'], ['Valid until', '05/11/2026'], ['Delivery time', '6 weeks'], ['Payment terms', '30% on order, balance on acceptance']] },
  { file: FILES.bolletta, pages: 1, ago: 5 * D, chat: [],
    fields: [['Supplier', CO.energia.name], ['MPRN / GPRN', '10012345678'], ['Billing period', '01/08/2026 – 31/08/2026'], ['Consumption (kWh)', '4640'], ['Contracted capacity (kVA)', '30'], ['Total due', '1,486.22'], ['Due date', '25/09/2026']] },
]

export const SETTINGS_TEXT = {
  qdrantCollection: 'documents_demo',
  polizzaPromptExtra: 'Amounts always in 1,234.56 format and dates DD/MM/YYYY.\nIf a value is not written in the document leave the field empty: better empty than invented.\nWith several documents, the value from the most recent document wins.',
  polizzaVerificaCampi: 'Invoice total, Payment due date, IBAN',
  bulkExcludedFolderNames: '_drafts, Old_scans',
  bulkExcludeKeywords: 'cancelled',
  language: 'en',
}

// Summaries created through the app API by capture.mjs / video.mjs.
export const SUMMARY_NAMES = { invoices: 'Supplier invoices · 2024–2026', energy: 'HQ electricity · 2025–2026' }
