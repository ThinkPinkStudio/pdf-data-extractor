// English DEMO catalogue (all invented), same shape as data.mjs, built around
// financial documents: a Dublin firm that services loan books and manages client
// portfolios has to rebuild its data from thousands of PDFs — mortgage files,
// business loan agreements, portfolio statements, vendor contracts, leases.
// Euro amounts in 1,234.56 format, dates DD/MM/YYYY. Used by generate-pdfs-en.mjs
// and, with DEMO_LANG=en, by seed.mjs and video.mjs.

export const DEMO_USER = 'emma.walsh@example.com'
export const TEAM = ['emma.walsh@example.com', 'david.connolly@example.com', 'sarah.gallagher@example.com']
const [, DAVID, SARAH] = TEAM

// ─── Fictional companies ──────────────────────────────────────────────────────
export const CLIENT = {
  name: 'Halden Finance Ltd',
  addr: ['3 Grand Canal Square', 'Dublin 2, D02 X576'],
  vat: 'IE6388047V',
}

export const CO = {
  harbour: { name: 'Harbour Bank DAC', addr: ['1 Harbour Plaza', 'Dublin 1, D01 K7W2'], vat: 'IE9356720K', color: [0.07, 0.27, 0.45], tag: 'Mortgages and business lending' },
  valuer: { name: 'Corrib Valuers Ltd', addr: ['8 Mill Street', 'Galway H91 T2K3'], vat: 'IE3518440H', color: [0.2, 0.36, 0.25], tag: 'Chartered surveyors · residential valuation' },
  brightwood: { name: 'Brightwood Interiors Ltd', addr: ['Unit 18, Weavers Park', 'Dublin 12, D12 X2K7'], vat: 'IE1204831T', color: [0.27, 0.3, 0.36], tag: 'Payroll processed by Liffey Payroll Services' },
  nordwave: { name: 'Nordwave Digital Ltd', addr: ['44 Grand Canal Quay', 'Dublin 2, D02 R590'], vat: 'IE1204830T', color: [0.16, 0.2, 0.42], tag: 'Software, cloud and digital services' },
  liffey: { name: 'Liffey Weaving Mills Ltd', addr: ['Mill Lane', 'Kilkenny R95 YD76'], vat: 'IE2741690B', color: [0.33, 0.24, 0.14], tag: 'Upholstery fabrics since 1962' },
  atlantic: { name: 'Atlantic Securities Ltd', addr: ['22 Fitzwilliam Place', 'Dublin 2, D02 YH68'], vat: 'IE0655480D', color: [0.05, 0.32, 0.42], tag: 'Custody and brokerage' },
  meridian: { name: 'Meridian Data Services Ltd', addr: ['14 Harbour Road', 'Cork T12 HX93'], vat: 'IE9356721L', color: [0.12, 0.29, 0.33], tag: 'Market data feeds and secure hosting' },
  lee: { name: 'Lee Estates Ltd', addr: ['15 South Mall', 'Cork T12 F8P2'], vat: 'IE3980120M', color: [0.25, 0.25, 0.28], tag: '' },
}

// ─── Document profiles ────────────────────────────────────────────────────────
// Order matters for the bulk page: the first profile whose keyword starts a word
// of the folder path is proposed.
const F = (id, label, type, description) => ({ id, label, type, description, enabled: true, cells: [] })

export const PROFILES = [
  {
    id: 'prof_mutui',
    recognition: 'A residential mortgage file for one application: mortgage offer (and any revised offer), property valuation report, proof of income such as payslips.',
    name: 'Mortgage files',
    matchKeywords: 'mortgage',
    matchExcludeKeywords: 'withdrawn',
    contentKeywords: 'mortgage, loan amount, property, valuation',
    contentExcludeKeywords: 'curriculum',
    promptExtra: 'A file may hold several offers: the most recent offer always wins. Income comes from the latest payslip of each applicant.',
    fields: [
      F('m_borrower', 'Borrower(s)', 'text', 'Full name of each applicant, as on the offer.'),
      F('m_property', 'Property address', 'text', 'Address of the mortgaged property.'),
      F('m_price', 'Purchase price', 'number', 'Agreed purchase price of the property, in euro.'),
      F('m_valuation', 'Valuation', 'number', 'Market value stated in the most recent valuation report.'),
      F('m_loan', 'Loan amount', 'number', 'Amount offered by the lender in the most recent offer.'),
      F('m_ltv', 'Loan to value', 'percent', 'Loan amount divided by the valuation, as a percentage.'),
      F('m_ratetype', 'Rate type', 'enum', 'Fixed (and for how long), variable or tracker.'),
      F('m_rate', 'Interest rate', 'percent', 'Annual interest rate of the most recent offer.'),
      F('m_term', 'Term', 'text', 'Mortgage term in years.'),
      F('m_payment', 'Monthly repayment', 'number', 'Monthly repayment of the most recent offer.'),
      F('m_income', 'Net monthly income', 'number', 'Net pay from the most recent payslip of each applicant, summed.'),
      F('m_lender', 'Lender', 'text', 'Bank or lender issuing the offer.'),
      F('m_expiry', 'Offer valid until', 'date', 'Date the most recent offer expires.'),
    ],
  },
  {
    id: 'prof_prestiti',
    recognition: 'A business loan or facility agreement between a lender and a company, with any amendments, guarantees and financial statements attached.',
    name: 'Business loan agreements',
    matchKeywords: 'loan, facility',
    matchExcludeKeywords: '',
    contentKeywords: 'facility, borrower, interest, repayment',
    contentExcludeKeywords: '',
    promptExtra: 'Amendments change the original agreement: the most recent document wins.',
    fields: [
      F('b_borrower', 'Borrower', 'text', 'Company borrowing the money.'),
      F('b_lender', 'Lender', 'text', 'Bank or lender providing the facility.'),
      F('b_principal', 'Facility amount', 'number', 'Total amount of the facility, in euro.'),
      F('b_rate', 'Interest rate', 'text', 'Reference rate and margin currently applicable (e.g. "3M Euribor + 3.25%").'),
      F('b_sign', 'Signing date', 'date', 'Date the original agreement was signed.'),
      F('b_maturity', 'Final maturity', 'date', 'Final repayment date; take extensions in later amendments into account.'),
      F('b_repay', 'Repayment', 'text', 'Repayment profile: frequency and amortising or bullet.'),
      F('b_security', 'Security', 'text', 'Charges, guarantees and other security given to the lender.'),
      F('b_covenant', 'Financial covenants', 'text', 'Ratios the borrower must respect, with their current thresholds.'),
      F('b_purpose', 'Purpose', 'text', 'What the money is for.'),
      F('b_fee', 'Arrangement fee', 'number', 'One-off fee paid when the facility was arranged.'),
    ],
  },
  {
    id: 'prof_portafoglio',
    recognition: 'A periodic statement of an investment portfolio issued by a custodian or broker: client, account, holdings, asset allocation, income, fees and performance.',
    name: 'Portfolio statements',
    matchKeywords: 'portfolio, statement',
    matchExcludeKeywords: '',
    contentKeywords: 'portfolio, holdings, allocation, custodian',
    contentExcludeKeywords: '',
    promptExtra: 'Percentages with one decimal (58.0%).',
    fields: [
      F('s_client', 'Client', 'text', 'Name of the client or entity owning the portfolio.'),
      F('s_account', 'Account number', 'text', 'Portfolio account number.'),
      F('s_mandate', 'Mandate', 'enum', 'Investment mandate: conservative, balanced or growth.'),
      F('s_custodian', 'Custodian', 'text', 'Custodian or broker issuing the statement.'),
      F('s_date', 'Statement date', 'date', 'Valuation date of the statement.'),
      F('s_value', 'Portfolio value', 'number', 'Total market value of the portfolio at the statement date.'),
      F('s_cash', 'Cash', 'number', 'Cash balance held in the portfolio.'),
      F('s_equity', 'Equities', 'percent', 'Share of the portfolio invested in equities.'),
      F('s_bonds', 'Bonds', 'percent', 'Share of the portfolio invested in bonds.'),
      F('s_top', 'Largest holding', 'text', 'Name and weight of the largest single position.'),
      F('s_div', 'Dividends and coupons', 'number', 'Income received in the year to the statement date.'),
      F('s_fees', 'Fees', 'number', 'Management and custody fees charged in the year to the statement date.'),
      F('s_return', 'Return YTD', 'percent', 'Year-to-date performance net of fees.'),
      F('s_review', 'Next review', 'date', 'Date of the next portfolio review with the client.'),
    ],
  },
  {
    id: 'prof_fornitura',
    recognition: 'A contract, framework agreement or addendum for an ongoing supply of services: parties, subject, term, prices or price lists, payment, service levels and termination. Price lists and audit reports from the same vendor belong to the dossier.',
    name: 'Vendor contracts',
    matchKeywords: 'vendor, contract, framework',
    matchExcludeKeywords: 'draft',
    contentKeywords: 'agreement, services, term, termination',
    contentExcludeKeywords: '',
    promptExtra: 'The dossier may hold contract, addenda, price lists, reports and invoices: the value from the most recent document always wins.',
    fields: [
      F('c_forn', 'Vendor', 'text', 'Company name of the supplying party.'),
      F('c_piva', 'Vendor VAT no.', 'text', 'Vendor VAT registration number.'),
      F('c_ogg', 'Contract subject', 'text', 'Short description of the services supplied.'),
      F('c_stip', 'Signing date', 'date', 'Date the original contract was signed.'),
      F('c_scad', 'Contract end date', 'date', 'End of validity; take extensions from later addenda into account.'),
      F('c_rinn', 'Auto-renewal', 'boolean', 'Yes/No and how often it renews tacitly.'),
      F('c_prea', 'Termination notice', 'text', 'Days or months of notice required to terminate.'),
      F('c_val', 'Estimated annual value', 'number', 'Expected yearly value in euro.'),
      F('c_pag', 'Payment terms', 'text', 'Payment method and terms currently in force.'),
      F('c_pen', 'Service level penalty', 'text', 'Service credits or penalties if the service level is missed.'),
      F('c_list', 'Price list increase', 'text', 'Price change in the latest price list and its start date.'),
      F('c_audit', 'Latest audit result', 'text', 'Outcome and score of the latest vendor audit.'),
      F('c_iso', 'ISO 27001 expiry', 'date', 'Expiry date of the vendor information-security certificate.'),
      F('c_foro', 'Jurisdiction', 'text', 'Courts with jurisdiction over disputes.'),
      F('c_ref', 'Vendor contact', 'text', 'Name of the account manager given.'),
      F('c_fatt', 'Latest invoice', 'text', 'Number and total of the most recent invoice in the dossier.'),
    ],
  },
  {
    id: 'prof_locazione',
    recognition: 'A lease of office or commercial premises between landlord and tenant: address and land registry details, rent, term, security deposit, stamp duty.',
    name: 'Office leases',
    matchKeywords: 'lease, propert, rent',
    matchExcludeKeywords: '',
    contentKeywords: 'landlord, tenant, rent',
    contentExcludeKeywords: '',
    promptExtra: '',
    fields: [
      F('l_loc', 'Landlord', 'text', 'Owner letting the premises.'),
      F('l_cond', 'Tenant', 'text', 'Party renting the premises.'),
      F('l_imm', 'Premises address', 'text', 'Street, number and town of the leased premises.'),
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
    id: 'prof_fatture',
    recognition: 'An invoice (or credit note) issued by a supplier to the company: invoice number and date, supplier and customer with VAT numbers, lines with net amount, VAT and total due.',
    name: 'Supplier invoices',
    matchKeywords: 'invoice',
    matchExcludeKeywords: 'drafts, cancelled',
    contentKeywords: 'invoice, net amount, VAT, total due',
    contentExcludeKeywords: 'curriculum',
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
]

export const profileById = Object.fromEntries(PROFILES.map((p) => [p.id, p]))

// Single-document Extractor profiles (labels only: the model goes by the name).
export const GENERIC_PROFILES = PROFILES.map((p) => ({
  id: 'g_' + p.id,
  name: p.name,
  fields: p.fields.map((f) => ({ id: 'g_' + f.id, label: f.label, description: f.description, type: f.type, enabled: true })),
}))

// ─── PDF documents (generated by generate-pdfs-en.mjs) ────────────────────────
export const FILES = {
  offer1: 'Mortgage_offer_Harbour-Bank_2026-08-03.pdf',
  offer2: 'Mortgage_offer_REVISED_Harbour-Bank_2026-09-28.pdf',
  valuation: 'Valuation_report_14-Oak-Park_Galway.pdf',
  payslipA: 'Payslip_09-2026_Byrne-Aoife.pdf',
  payslipB: 'Payslip_09-2026_Kelly-Sean.pdf',
  facility: 'Facility_agreement_Liffey-Weaving-Mills_2024.pdf',
  amendment: 'Amendment_01_2026_Liffey-Weaving-Mills.pdf',
  statement: 'Statement_Q3-2026_Client-0142.pdf',
  quadro: 'Framework_services_agreement_2024.pdf',
  addendum: 'Addendum_01_2025.pdf',
  listino: 'Price_list_2026.pdf',
  audit: 'Vendor_security_audit_2026.pdf',
  ftMeridian: 'INV-2026-0418_Meridian-Data-Services.pdf',
  ftNordwave: 'INV-0093-2026_Nordwave-Digital.pdf',
  locazione: 'Lease_Cork-branch_8-Patrick-Street.pdf',
  cv: 'CV_Claire-Lambert.pdf',
}

// Folder tree for the "Bulk folder" page (written by generate-pdfs-en.mjs).
export const BULK_ROOT = 'Client_Files_2026'
export const BULK_TREE = {
  'Mortgages/2026-10/Byrne_Kelly_Galway': [FILES.offer1, FILES.valuation, FILES.payslipA, FILES.payslipB, FILES.offer2],
  'Mortgages/2026-10/Withdrawn/Collins_Cork': [FILES.offer1],
  'Business_loans/Liffey_Weaving_Mills': [FILES.facility, FILES.amendment],
  'Portfolios/Q3-2026/Client_0142_Fitzgerald': [FILES.statement],
  'Vendors/Meridian_Data_Services': [FILES.quadro, FILES.addendum, FILES.listino, FILES.audit, FILES.ftMeridian],
  'Invoices_payable/2026-09/Nordwave_Digital': [FILES.ftNordwave],
  'Property/Lease_Cork_branch': [FILES.locazione],
  'HR/Applications': [FILES.cv],
  '_drafts/Old_scans': [FILES.ftNordwave],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const v = (valore, file, page = 1) => ({ valore, data_validita: null, fonte: file ? { file, page } : undefined })
// 1,234.56 (ICU in Node does not group 4-digit thousands consistently).
export const eur = (n) => {
  const [i, d] = (Math.round(n * 100) / 100).toFixed(2).split('.')
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + d
}
const pct = (n) => `${(Math.round(n * 10) / 10).toFixed(1)}%`
const num = (s) => Number(String(s).replace(/,/g, ''))
export const VAT_RATE = 23
// Annuity repayment of a mortgage (annual rate in %, term in years).
export const monthlyPayment = (loan, rate, years) => {
  const r = rate / 1200
  return (loan * r) / (1 - Math.pow(1 + r, -years * 12))
}
function prng(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296) }
const pad = (n) => String(n).padStart(2, '0')

// ─── Mortgage files ───────────────────────────────────────────────────────────
// The showcase file (Byrne & Kelly) has real PDFs: first offer, valuation, two
// payslips and a revised offer that supersedes the first one.
export const SHOWCASE = {
  borrowers: 'Aoife Byrne & Seán Kelly',
  home: ['27 Seapoint Promenade', 'Galway H91 C4D2'],
  property: '14 Oak Park, Knocknacarra, Galway H91 K2E8',
  price: 425000, valuation: 420000, loan: 336000, term: 30, lender: CO.harbour.name,
  offer1: { date: '03/08/2026', ref: 'HB-M-2026-08841', rate: 3.95, rateType: 'Fixed 3 years, then variable', aprc: '4.12%', validUntil: '03/11/2026' },
  offer2: { date: '28/09/2026', ref: 'HB-M-2026-08841/R1', rate: 3.7, rateType: 'Fixed 5 years, then variable', aprc: '3.86%', validUntil: '28/12/2026' },
  valuationDate: '22/07/2026',
  // net pay from the two payslips (3,214.57 + 2,968.40)
  income: 6182.97,
}

const S = SHOWCASE
const showcaseState = (offer, file) => ({
  m_borrower: v(S.borrowers, file), m_property: v(S.property, FILES.valuation, 1), m_price: v(eur(S.price), file),
  m_valuation: v(eur(S.valuation), FILES.valuation, 2), m_loan: v(eur(S.loan), file), m_ltv: v(pct((S.loan / S.valuation) * 100), file),
  m_ratetype: v(offer.rateType, file), m_rate: v(`${offer.rate.toFixed(2)}%`, file), m_term: v(`${S.term} years`, file),
  m_payment: v(eur(monthlyPayment(S.loan, offer.rate, S.term)), file), m_income: v(eur(S.income), FILES.payslipB),
  m_lender: v(S.lender, file), m_expiry: v(offer.validUntil, file),
})
const flat = (state) => Object.fromEntries(Object.entries(state).map(([k, e]) => [k, e.valore]))

const MORTGAGES = [
  ['Collins · Cork', 'Andrew Collins', '7 Lee View, Douglas, Cork T12 R8X4', 365000, 370000, 292000, 'Fixed 3 years, then variable', 3.95, 30, 'Shannon Home Loans DAC', 4120.0, '15/12/2026'],
  ['Murphy & Nolan · Dublin 6', 'Ciara Murphy & Tom Nolan', '22 Grosvenor Road, Rathgar, Dublin 6 D06 F3K8', 690000, 680000, 544000, 'Variable', 4.25, 35, 'Atlantic Building Society', 9850.0, '20/01/2027'],
  ['O’Brien · Limerick', 'Niall O’Brien', '3 Ennis Road, Limerick V94 X2P1', 298000, 300000, 268200, 'Fixed 4 years, then variable', 3.85, 30, CO.harbour.name, 3980.0, '05/01/2027'],
  ['Walsh · Kilkenny', 'Gráinne Walsh', '11 Castle Gardens, Kilkenny R95 E7D2', 340000, 335000, 268000, 'Fixed 3 years, then variable', 3.9, 25, 'Liffey Mutual Society', 4410.0, '30/12/2026'],
  ['Doyle & Ryan · Dublin 15', 'Simon Doyle & Kate Ryan', '45 Ongar Village, Dublin 15 D15 P2R6', 455000, 450000, 405000, 'Fixed 5 years, then variable', 3.65, 30, 'Shannon Home Loans DAC', 7020.0, '12/01/2027'],
  ['Fitzpatrick · Waterford', 'Owen Fitzpatrick', '9 Mall Lane, Waterford X91 K8T1', 260000, 262000, 208000, 'Variable', 4.35, 30, 'Atlantic Building Society', 3560.0, '18/12/2026'],
  ['Kavanagh · Wexford', 'Róisín Kavanagh', '2 Harbour View, Wexford Y35 H9P4', 310000, 305000, 244000, 'Fixed 3 years, then variable', 3.95, 30, CO.harbour.name, 4050.0, '22/12/2026'],
  ['Hughes · Sligo', 'Declan Hughes', '17 Strandhill Road, Sligo F91 W3C6', 245000, 250000, 196000, 'Fixed 4 years, then variable', 3.8, 25, 'Liffey Mutual Society', 3320.0, '09/01/2027'],
  ['Moran & Quinn · Athlone', 'Aisling Moran & Peter Quinn', '5 Retreat Heights, Athlone N37 A6X9', 385000, 380000, 304000, 'Fixed 5 years, then variable', 3.7, 30, CO.harbour.name, 6240.0, '03/01/2027'],
].map(([dossier, borrowers, property, price, valuation, loan, rateType, rate, term, lender, income, expiry]) => {
  const slug = dossier.split(' · ')[0].replace(/[^A-Za-z]+/g, '-').replace(/-$/, '')
  const offer = `Mortgage_offer_${lender.split(' ')[0]}_${slug}.pdf`
  const val = `Valuation_report_${slug}.pdf`
  const slip = `Payslip_09-2026_${slug}.pdf`
  return {
    dossier, profileId: 'prof_mutui', files: [offer, val, slip],
    state: {
      m_borrower: v(borrowers, offer), m_property: v(property, val), m_price: v(eur(price), offer), m_valuation: v(eur(valuation), val, 2),
      m_loan: v(eur(loan), offer), m_ltv: v(pct((loan / valuation) * 100), offer), m_ratetype: v(rateType, offer), m_rate: v(`${rate.toFixed(2)}%`, offer),
      m_term: v(`${term} years`, offer), m_payment: v(eur(monthlyPayment(loan, rate, term)), offer), m_income: v(eur(income), slip),
      m_lender: v(lender, offer), m_expiry: v(expiry, offer),
    },
  }
})

// Out-of-place document in the mortgage batch: the relevance check stops it.
const MISMATCH = {
  dossier: 'Misc documents (to sort)',
  error: 'Content not relevant to the "Mortgage files" profile — detected: curriculum vitae (experience, education, skills). Check the profile or press "Proceed anyway".',
  precheck: {
    verdict: 'mismatch', mode: 'keywords', score: 0.0, threshold: 0.25, reason: 'no profile keyword in the content',
    missing: ['mortgage', 'loan amount', 'property', 'valuation'], detected: { type: 'curriculum vitae', keywords: ['experience', 'education', 'skills'] },
    suggestion: { id: 'prof_cv', name: 'Candidate CVs' },
    summary: 'No word of the «Mortgage files» profile in the text; the content looks like «Candidate CVs». The job stays on hold until you choose: change profile or «Proceed anyway».',
  },
}

// ─── Business loans ───────────────────────────────────────────────────────────
export const FACILITY = {
  ref: 'HB-B-2024-0312', date: '15/03/2024', principal: 750000, margin: '3.25%', marginNew: '2.95%',
  maturity: '15/03/2029', maturityNew: '15/03/2031', amendDate: '10/06/2026', fee: 7500,
  purpose: 'Purchase and installation of two jacquard looms',
  security: 'First-ranking charge over the Kilkenny mill; directors’ guarantees up to €200,000',
  covenants: 'Net debt/EBITDA ≤ 3.0x; interest cover ≥ 4.0x',
  covenantsNew: 'Net debt/EBITDA ≤ 3.5x until 31/12/2027; interest cover ≥ 4.0x',
}
const loan = (dossier, files, o) => {
  const [agr] = files
  return {
    dossier, profileId: 'prof_prestiti', files,
    state: {
      b_borrower: v(o.borrower, agr), b_lender: v(o.lender, agr), b_principal: v(eur(o.principal), agr), b_rate: v(o.rate, agr),
      b_sign: v(o.sign, agr), b_maturity: v(o.maturity, agr, 2), b_repay: v(o.repay, agr), b_security: v(o.security, agr, 2),
      b_covenant: v(o.covenant, agr, 2), b_purpose: v(o.purpose, agr), b_fee: v(eur(o.fee), agr),
    },
  }
}
const LOANS = [
  loan('Corrib Hardware & Sons', ['Facility_agreement_Corrib-Hardware_2023.pdf', 'Annual_accounts_2025_Corrib-Hardware.pdf'], {
    borrower: 'Corrib Hardware & Sons', lender: CO.harbour.name, principal: 250000, rate: '3M Euribor + 3.50%', sign: '12/06/2023', maturity: '12/06/2028',
    repay: 'Monthly, amortising', security: 'Charge over the Galway premises', covenant: 'Net debt/EBITDA ≤ 3.0x', purpose: 'Refit of the retail premises', fee: 2500,
  }),
  loan('Midland Powder Coating', ['Loan_agreement_Midland-Powder-Coating_2025.pdf', 'Guarantee_Midland-Powder-Coating.pdf'], {
    borrower: 'Midland Powder Coating Ltd', lender: 'Shannon Commercial Finance DAC', principal: 480000, rate: '6M Euribor + 2.90%', sign: '03/02/2025', maturity: '03/02/2032',
    repay: 'Quarterly, amortising after a 12-month grace period', security: 'Chattel mortgage over the coating line; parent guarantee', covenant: 'Debt service cover ≥ 1.25x', purpose: 'New powder coating line', fee: 4800,
  }),
  loan('Lakeside Packaging', ['Facility_agreement_Lakeside-Packaging_2024.pdf', 'Amendment_01_2025_Lakeside-Packaging.pdf'], {
    borrower: 'Lakeside Packaging Ltd', lender: CO.harbour.name, principal: 320000, rate: '3M Euribor + 3.10%', sign: '20/09/2024', maturity: '20/09/2029',
    repay: 'Quarterly, amortising', security: 'Floating charge over stock and receivables', covenant: 'Net debt/EBITDA ≤ 2.75x', purpose: 'Working capital and warehouse racking', fee: 3200,
  }),
  {
    dossier: 'Liffey Weaving Mills', profileId: 'prof_prestiti', status: 'running',
    files: [FILES.facility, FILES.amendment, 'Guarantee_Liffey-Weaving-Mills.pdf', 'Annual_accounts_2025_Liffey-Weaving-Mills.pdf'],
    progress: { docIndex: 2, docTotal: 4, pageIndex: 2, pageTotal: 5, docName: 'Guarantee_Liffey-Weaving-Mills.pdf', totalPagesProcessed: 6 },
    state: {
      b_borrower: v(CO.liffey.name, FILES.facility), b_lender: v(CO.harbour.name, FILES.facility), b_principal: v(eur(FACILITY.principal), FILES.facility),
      b_rate: v(`3M Euribor + ${FACILITY.marginNew}`, FILES.amendment), b_maturity: v(FACILITY.maturityNew, FILES.amendment),
    },
  },
  { dossier: 'Three Valleys Logistics', profileId: 'prof_prestiti', status: 'queued', files: ['Facility_agreement_Three-Valleys_2022.pdf', 'Annual_accounts_2025_Three-Valleys.pdf'], state: {} },
]

// ─── Portfolio statements ─────────────────────────────────────────────────────
const CUSTODIANS = [CO.atlantic.name, 'Harbour Custody Services', 'Northstar Trust DAC', 'Shannon Wealth Custody DAC']
const MANDATES = ['Balanced', 'Growth', 'Conservative']
const HOLDINGS = ['Global Equity Index Fund', 'Euro Government Bond Fund', 'MSCI World ETF', 'Euro Corporate Bond Fund', 'Global Technology Fund', 'Irish Equity Fund']
const CLIENTS = [
  ['0142', 'Fitzgerald', 'Mary & John Fitzgerald'], ['0155', 'O’Neill', 'Eoin O’Neill'], ['0163', 'Brennan', 'Brennan Family Trust'],
  ['0171', 'Daly', 'Patricia Daly'], ['0187', 'McCarthy', 'McCarthy Holdings Ltd'], ['0192', 'Lynch', 'Fergal Lynch'],
  ['0204', 'Farrell', 'Siobhán Farrell'], ['0219', 'Power', 'Power & Sons Pension Scheme'], ['0226', 'Keane', 'Laura Keane'],
  ['0238', 'Duffy', 'Duffy Family Office'], ['0241', 'Reilly', 'Conor Reilly'], ['0257', 'Healy', 'Healy Charitable Trust'],
  ['0263', 'Barry', 'Mark & Ann Barry'], ['0270', 'Coleman', 'Coleman Medical Partners'], ['0284', 'Sheehan', 'Úna Sheehan'],
  ['0291', 'Dunne', 'Dunne Farm Pension Plan'],
]
// The Q3 2026 statement of client 0142 is the sample PDF.
export const STATEMENT = {
  client: 'Mary & John Fitzgerald', account: 'HF-0142', custodian: CO.atlantic.name, date: '30/09/2026', mandate: 'Balanced',
  value: 1284350, cash: 64210, equity: 744923, bonds: 436679, alternatives: 38538,
  top: [['Global Equity Index Fund', 159259], ['Euro Government Bond Fund', 138710], ['MSCI World ETF', 123298], ['Euro Corporate Bond Fund', 104032], ['Global Technology Fund', 79630]],
  dividends: 9842.17, mgmtFee: 2640.88, custodyFee: 570, ret: 6.8, review: '15/11/2026',
}

function statement(key, client, period) {
  const file = period.file || `Statement_${period.tag}_Client-${client.id}.pdf`
  const s = period.values
  return {
    dossier: `Client ${client.id} · ${client.surname} · ${period.tag.replace('-', ' ')}`, profileId: 'prof_portafoglio', files: [file],
    state: {
      s_client: v(client.name, file), s_account: v(`HF-${client.id}`, file), s_mandate: v(client.mandate, file), s_custodian: v(client.custodian, file), s_date: v(period.date, file),
      s_value: v(eur(s.value), file), s_cash: v(eur(s.cash), file), s_equity: v(pct(s.equityPct), file), s_bonds: v(pct(s.bondPct), file),
      s_top: v(s.top, file), s_div: v(eur(s.div), file), s_fees: v(eur(s.fees), file), s_return: v(pct(s.ret), file), s_review: v(s.review, file),
    },
  }
}

// Year-end statements 2024–2025 and Q3 2026 for each client (deterministic).
function portfolios() {
  const rnd = prng(2026)
  const archive = []
  const q3 = []
  CLIENTS.forEach(([id, surname, name], i) => {
    const client = { id, surname, name, custodian: CUSTODIANS[i % CUSTODIANS.length], mandate: MANDATES[i % MANDATES.length] }
    const equityPct = 40 + Math.round(rnd() * 35)
    const cashPct = 2 + Math.round(rnd() * 5)
    const altPct = Math.round(rnd() * 4)
    let value = 320000 + rnd() * 2300000
    const yearValues = (ret, months, date, review) => {
      value *= 1 + ret / 100
      const top = `${HOLDINGS[Math.floor(rnd() * HOLDINGS.length)]} · ${pct(6 + rnd() * 8)}`
      return {
        value, cash: (value * cashPct) / 100, equityPct, bondPct: 100 - equityPct - cashPct - altPct, top,
        div: value * (0.016 + rnd() * 0.01) * (months / 12), fees: value * (0.0055 + rnd() * 0.003) * (months / 12), ret, review,
      }
    }
    for (const year of [2024, 2025]) {
      const ret = year === 2024 ? 6 + rnd() * 6 : 3 + rnd() * 6
      archive.push(statement('a', client, { tag: `${year}`, date: `31/12/${year}`, values: yearValues(ret, 12, `31/12/${year}`, `${pad(10 + Math.floor(rnd() * 18))}/0${2 + Math.floor(rnd() * 3)}/${year + 1}`) }))
    }
    const reviewDay = new Date(Date.UTC(2026, 10, 1) + Math.floor(rnd() * 85) * 86400000)
    const review = `${pad(reviewDay.getUTCDate())}/${pad(reviewDay.getUTCMonth() + 1)}/${reviewDay.getUTCFullYear()}`
    const values = yearValues(2 + rnd() * 6, 9, '30/09/2026', review)
    if (id === '0142') {
      const st = STATEMENT
      Object.assign(values, {
        value: st.value, cash: st.cash, equityPct: (st.equity / st.value) * 100, bondPct: (st.bonds / st.value) * 100,
        top: `${st.top[0][0]} · ${pct((st.top[0][1] / st.value) * 100)}`, div: st.dividends, fees: st.mgmtFee + st.custodyFee, ret: st.ret, review: st.review,
      })
      client.custodian = st.custodian
    }
    q3.push(statement('q', client, { tag: 'Q3-2026', date: '30/09/2026', values, file: id === '0142' ? FILES.statement : undefined }))
  })
  return { archive, q3 }
}
const PORTFOLIOS = portfolios()

// ─── Vendor contracts, invoices, leases ───────────────────────────────────────
export const VENDOR = {
  files: [FILES.quadro, FILES.addendum, FILES.listino, FILES.audit, FILES.ftMeridian],
  state: {
    c_forn: v(CO.meridian.name, FILES.quadro, 1), c_piva: v(CO.meridian.vat, FILES.quadro, 1),
    c_ogg: v('Real-time market data feeds and secure hosting', FILES.quadro, 1), c_stip: v('15/01/2024', FILES.quadro, 1),
    c_scad: v('31/12/2027', FILES.addendum, 1), c_rinn: v('Yes, yearly (tacit)', FILES.quadro, 2), c_prea: v('90 days', FILES.quadro, 2),
    c_val: v('150,000.00', FILES.addendum, 1), c_pag: v('Bank transfer, 90 days end of month', FILES.addendum, 1),
    c_pen: v('Service credits up to 25% of the monthly fee', FILES.quadro, 2), c_list: v('+3.8% from 01/01/2026', FILES.listino, 1),
    c_audit: v('Compliant · 92/100', FILES.audit, 1), c_iso: v('18/05/2028', FILES.audit, 1), c_foro: v('Courts of Ireland (Cork)', FILES.quadro, 2),
    c_ref: v('Paul Reid', FILES.quadro, 2), c_fatt: v('INV 2026/0418 · €7,097.10', FILES.ftMeridian, 1),
  },
}

const inv = (o) => {
  const net = num(o.imp)
  const iva = Math.round(net * VAT_RATE) / 100
  return { ...o, iva: eur(iva), tot: eur(net + iva) }
}
const INVOICES = [
  inv({ dossier: 'Meridian Data Services', file: FILES.ftMeridian, num: 'INV 2026/0418', data: '12/09/2026', forn: CO.meridian.name, piva: CO.meridian.vat, imp: '5,770.00', scad: '30/11/2026', mod: 'Bank transfer', iban: 'IE29AIBK93115212345678', oda: 'PO-2026-311 of 28/08/2026' }),
  inv({ dossier: 'Nordwave Digital', file: FILES.ftNordwave, num: '0093/2026', data: '01/10/2026', forn: CO.nordwave.name, piva: CO.nordwave.vat, imp: '2,010.00', scad: '31/10/2026', mod: 'Bank transfer', iban: 'IE64IRCE92050112345678', oda: 'Agreement NW-2025-018' }),
  inv({ dossier: 'Corrib Facilities', file: 'Invoice_1182_Corrib-Facilities.pdf', num: '1182', data: '30/09/2026', forn: 'Corrib Facilities Ltd', piva: 'IE2215870R', imp: '1,840.00', scad: '30/10/2026', mod: 'Direct debit', iban: '', oda: '' }),
  inv({ dossier: 'Shannon Print & Post', file: 'SI-2026-0772_Shannon-Print-Post.pdf', num: 'SI-2026-0772', data: '21/09/2026', forn: 'Shannon Print & Post Ltd', piva: 'IE3362710F', imp: '626.27', scad: '21/10/2026', mod: 'Bank transfer', iban: 'IE12BOFI90001712345678', oda: 'PO-2026-329 of 09/09/2026' }),
  inv({ dossier: 'Lakeside Office Supplies', file: 'Invoice_2026-219_Lakeside-Office.pdf', num: '2026/219', data: '24/09/2026', forn: 'Lakeside Office Supplies Ltd', piva: 'IE4119350S', imp: '418.95', scad: '24/10/2026', mod: 'Card', iban: '', oda: '' }),
  inv({ dossier: 'Atlantic Couriers', file: 'Invoice_1543_Atlantic-Couriers.pdf', num: '1543', data: '29/09/2026', forn: 'Atlantic Couriers Ltd', piva: 'IE1947260C', imp: '312.40', scad: '29/10/2026', mod: 'Direct debit', iban: '', oda: '' }),
]
const invoiceState = (i) => {
  const f = i.file
  return {
    f_num: v(i.num, f), f_data: v(i.data, f), f_forn: v(i.forn, f), f_piva: v(i.piva, f), f_cli: v(CLIENT.name, f),
    f_imp: v(i.imp, f), f_iva: v(i.iva, f), f_tot: v(i.tot, f), f_scad: v(i.scad, f), f_mod: v(i.mod, f),
    f_iban: i.iban ? v(i.iban, f) : v(null), f_oda: i.oda ? v(i.oda, f) : v(null),
  }
}

export const LEASE = {
  landlord: CO.lee.name, premises: '2nd floor, 8 Patrick Street, Cork T12 W8X1', folio: 'Folio CK45512L · office', start: '01/03/2026', end: '28/02/2032',
  rent: 26400, instalment: 2200, deposit: 6600, indexation: 'CPI, yearly from the 2nd year', notice: '6 months (registered post or email)', stamp: 'Revenue stamp duty ID 4821-3T, 14/03/2026',
}
const LEASES = [
  { dossier: 'Cork branch · 8 Patrick Street', file: FILES.locazione, loc: LEASE.landlord, imm: LEASE.premises, cat: LEASE.folio, dec: LEASE.start, scad: LEASE.end, can: eur(LEASE.rent), rata: `${eur(LEASE.instalment)} monthly in advance`, dep: eur(LEASE.deposit), istat: LEASE.indexation, prea: LEASE.notice, reg: LEASE.stamp },
  { dossier: 'Galway branch · Eyre Square', file: 'Lease_Galway-branch_Eyre-Square.pdf', loc: 'Hillcrest Property Ltd', imm: '15 Eyre Square, Galway H91 F2X4', cat: 'Folio GY21874F · office', dec: '01/09/2023', scad: '31/08/2029', can: '31,200.00', rata: '7,800.00 quarterly in advance', dep: '7,800.00', istat: 'CPI, yearly', prea: '6 months', reg: 'Revenue stamp duty ID 9310-3T, 22/09/2023' },
  { dossier: 'Limerick branch · O’Connell Street', file: 'Lease_Limerick-branch_OConnell-Street.pdf', loc: 'Shannonside Properties Ltd', imm: '112 O’Connell Street, Limerick V94 E2P7', cat: 'Folio LK22103F · office', dec: '15/01/2025', scad: '14/01/2031', can: '22,800.00', rata: '1,900.00 monthly in advance', dep: '5,700.00', istat: 'CPI, yearly', prea: '12 months', reg: 'Revenue stamp duty ID 1188-3T, 30/01/2025' },
].map((l) => ({
  dossier: l.dossier, profileId: 'prof_locazione', files: [l.file],
  state: {
    l_loc: v(l.loc, l.file), l_cond: v(CLIENT.name, l.file), l_imm: v(l.imm, l.file), l_cat: v(l.cat, l.file), l_dec: v(l.dec, l.file), l_scad: v(l.scad, l.file),
    l_can: v(l.can, l.file), l_rata: v(l.rata, l.file), l_dep: v(l.dep, l.file, 2), l_istat: v(l.istat, l.file, 2), l_prea: v(l.prea, l.file, 2), l_reg: v(l.reg, l.file, 2),
  },
}))
const LEASE_ERROR = { dossier: 'Archive store Naas · 1998 scan', profileId: 'prof_locazione', files: ['Lease_archive-store_Naas_scan.pdf'], status: 'error', error: 'OCR: text unreadable on 4/4 pages (72 dpi scan). Upload a scan of at least 200 dpi.' }

export const CV = {
  name: 'Claire Lambert', role: 'Senior Credit Risk Analyst', employer: CO.harbour.name, email: 'claire.lambert@example.org', phone: '+353 87 000 1234', city: 'Dublin',
  years: '8', degree: 'MSc in Finance', skills: 'Credit modelling, IFRS 9, loan-book due diligence, Python, SQL, Power BI', languages: 'French C1, Spanish B2', notice: '30 days’ notice',
}

// ─── Seed texts (job logs, relevance checks) ──────────────────────────────────
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
    prof_mutui: 'mortgage file (offer, valuation, payslips)', prof_prestiti: 'business loan agreement', prof_portafoglio: 'portfolio statement',
    prof_fornitura: 'vendor contract with attachments', prof_locazione: 'office lease', prof_fatture: 'supplier invoice', prof_cv: 'curriculum vitae',
  },
  okReason: 'profile keywords found in the content',
  okSummary: (n, profile) => `The text contains ${n}/${n} words of the «${profile}» profile: extraction goes ahead.`,
}

export const SETTINGS_TEXT = {
  qdrantCollection: 'documents_demo',
  polizzaPromptExtra: 'Amounts always in 1,234.56 format and dates DD/MM/YYYY.\nIf a value is not written in the document leave the field empty: better empty than invented.\nWith several documents, the value from the most recent document wins.',
  polizzaVerificaCampi: 'Loan amount, Interest rate, Valuation',
  bulkExcludedFolderNames: '_drafts, Old_scans',
  bulkExcludeKeywords: 'withdrawn',
  language: 'en',
}

// ─── Seed plan: batches and single extractions (read by seed.mjs) ─────────────
const HOUR = 3600
const DAY = 24 * HOUR
const MORTGAGE_DOSSIER = 'Byrne & Kelly · 14 Oak Park, Galway'
const mortgageFiles = [FILES.offer1, FILES.valuation, FILES.payslipA, FILES.payslipB, FILES.offer2]

export const PLAN = {
  activeProfileId: 'prof_fatture',
  batches: [
    {
      key: 'mortgages', label: 'Mortgage files · October 2026', email: DEMO_USER, ago: 5 * HOUR, step: 160,
      jobs: [
        { dossier: 'Byrne & Kelly · Galway', profileId: 'prof_mutui', files: mortgageFiles, state: showcaseState(S.offer2, FILES.offer2) },
        ...MORTGAGES,
        { dossier: MISMATCH.dossier, profileId: 'prof_mutui', files: [FILES.cv], status: 'mismatch', error: MISMATCH.error, precheck: MISMATCH.precheck },
      ],
    },
    { key: 'loans', label: 'Business loans · Q4 2026 review', email: DAVID, ago: 3 * HOUR, step: 300, jobs: LOANS },
    { key: 'portQ3', label: 'Portfolio statements · Q3 2026', email: SARAH, ago: DAY + 4 * HOUR, step: 45, jobs: PORTFOLIOS.q3 },
    {
      key: 'invoices', label: 'Supplier invoices · September 2026', email: DEMO_USER, ago: 2 * DAY + 5 * HOUR, step: 140,
      jobs: INVOICES.map((i) => ({ dossier: i.dossier, profileId: 'prof_fatture', files: [i.file], state: invoiceState(i) })),
    },
    { key: 'leases', label: 'Office leases · branches', email: DEMO_USER, ago: 6 * DAY + 7 * HOUR, step: 200, jobs: [...LEASES, LEASE_ERROR] },
    { key: 'portArchive', label: 'Portfolio statements · 2024–2025', email: SARAH, ago: 12 * DAY + 3 * HOUR, step: 40, jobs: PORTFOLIOS.archive },
  ],
  singles: [
    {
      key: 'mortgage', email: DEMO_USER, dossier: MORTGAGE_DOSSIER, profileId: 'prof_mutui', files: mortgageFiles,
      state: showcaseState(S.offer2, FILES.offer2), ago: 50 * 60,
      runs: [{ ago: 4 * DAY, summary: 'First run before the revised offer arrived: initial offer of 03/08/2026 only.', values: flat(showcaseState(S.offer1, FILES.offer1)) }],
    },
    { key: 'vendor', email: DAVID, dossier: 'Vendor · Meridian Data Services', profileId: 'prof_fornitura', files: VENDOR.files, state: VENDOR.state, ago: 26 * HOUR },
    {
      key: 'cv', email: SARAH, dossier: 'Application · Credit Risk Analyst', profileId: 'prof_cv', files: [FILES.cv], ago: 5 * HOUR,
      state: {
        v_nome: v(CV.name, FILES.cv), v_ruolo: v(`${CV.role} — ${CV.employer}`, FILES.cv), v_email: v(CV.email, FILES.cv), v_tel: v(CV.phone, FILES.cv),
        v_citta: v(CV.city, FILES.cv), v_anni: v(CV.years, FILES.cv), v_studio: v(CV.degree, FILES.cv), v_skill: v(CV.skills, FILES.cv),
        v_lingue: v(CV.languages, FILES.cv), v_disp: v(CV.notice, FILES.cv),
      },
    },
  ],
}

// ─── Single Extractor history (sessions restorable with «Open») ───────────────
const OFFER_CHAT = [
  { role: 'user', content: 'When does the fixed rate end, and what happens after?' },
  { role: 'assistant', content: 'The rate of 3.70% is fixed for 5 years from drawdown. After that the loan moves to the lender’s standard variable rate, currently 4.40% (section 3).' },
  { role: 'user', content: 'Is there an early repayment charge?' },
  { role: 'assistant', content: 'Only during the fixed period: repaying early may trigger a breakage charge calculated on the remaining fixed term (condition 3). No charge applies once the loan is on the variable rate.' },
]
const FACILITY_CHAT = [
  { role: 'user', content: 'When does the facility mature?' },
  { role: 'assistant', content: 'The final maturity date is 15/03/2029 (clause 6). Repayments are quarterly and the facility amortises fully by that date (clause 5).' },
  { role: 'user', content: 'What financial covenants does the borrower have?' },
  { role: 'assistant', content: 'Two, tested quarterly on the last twelve months (clause 9):\n• Net debt/EBITDA ≤ 3.0x\n• Interest cover ≥ 4.0x\nA breach is an event of default unless waived in writing by the lender.' },
  { role: 'user', content: 'What security does the bank hold?' },
  { role: 'assistant', content: 'A first-ranking legal charge over the Kilkenny mill, plus personal guarantees from the directors limited to €200,000 (clause 8).' },
]
const LEASE_CHAT = [
  { role: 'user', content: 'By when must we give notice to leave at the end of the first term?' },
  { role: 'assistant', content: 'The first term ends on 28/02/2032. The tenant may break the lease with 6 months’ notice by registered post or email (clause 4): the notice must arrive by 31/08/2031.' },
  { role: 'user', content: 'How much do we pay per month, rent plus service charge?' },
  { role: 'assistant', content: 'Rent: €2,200.00 per month (€26,400.00 a year, monthly in advance by the 5th).\nService charge: flat €150.00 per month payable by the tenant (clause 7).\nMonthly total: €2,350.00, plus CPI indexation from the second year.' },
]
export const SESSIONS = (H, D) => [
  { file: FILES.offer2, pages: 1, ago: 35 * 60, chat: OFFER_CHAT,
    fields: [['Borrower(s)', S.borrowers], ['Property address', S.property], ['Purchase price', eur(S.price)], ['Loan amount', eur(S.loan)], ['Loan to value', pct((S.loan / S.valuation) * 100)], ['Rate type', S.offer2.rateType], ['Interest rate', `${S.offer2.rate.toFixed(2)}%`], ['Term', `${S.term} years`], ['Monthly repayment', eur(monthlyPayment(S.loan, S.offer2.rate, S.term))], ['Lender', S.lender], ['Offer valid until', S.offer2.validUntil]] },
  { file: FILES.facility, pages: 2, ago: 3 * H, chat: FACILITY_CHAT,
    fields: [['Borrower', CO.liffey.name], ['Lender', CO.harbour.name], ['Facility amount', eur(FACILITY.principal)], ['Interest rate', `3M Euribor + ${FACILITY.margin}`], ['Signing date', FACILITY.date], ['Final maturity', FACILITY.maturity], ['Repayment', 'Quarterly, amortising'], ['Security', FACILITY.security], ['Financial covenants', FACILITY.covenants], ['Purpose', FACILITY.purpose], ['Arrangement fee', eur(FACILITY.fee)]] },
  { file: FILES.statement, pages: 1, ago: 22 * H, chat: [],
    fields: [['Client', STATEMENT.client], ['Account number', STATEMENT.account], ['Mandate', STATEMENT.mandate], ['Custodian', STATEMENT.custodian], ['Statement date', STATEMENT.date], ['Portfolio value', eur(STATEMENT.value)], ['Cash', eur(STATEMENT.cash)], ['Equities', pct((STATEMENT.equity / STATEMENT.value) * 100)], ['Bonds', pct((STATEMENT.bonds / STATEMENT.value) * 100)], ['Dividends and coupons', eur(STATEMENT.dividends)], ['Fees', eur(STATEMENT.mgmtFee + STATEMENT.custodyFee)], ['Return YTD', pct(STATEMENT.ret)], ['Next review', STATEMENT.review]] },
  { file: FILES.valuation, pages: 2, ago: 2 * D, chat: [],
    fields: [['Property address', S.property], ['Valuation', eur(S.valuation)], ['Valuation date', S.valuationDate], ['Valuer', CO.valuer.name]] },
  { file: FILES.payslipA, pages: 1, ago: 2 * D + 5 * H, chat: [],
    fields: [['Employee', 'Aoife Byrne'], ['Employer', CO.brightwood.name], ['Pay period', 'September 2026'], ['Gross pay', '3,921.60'], ['Net pay', '3,214.57']] },
  { file: FILES.locazione, pages: 2, ago: 3 * D, chat: LEASE_CHAT,
    fields: [['Landlord', LEASE.landlord], ['Tenant', CLIENT.name], ['Premises address', LEASE.premises], ['Start date', LEASE.start], ['First term end', LEASE.end], ['Annual rent', eur(LEASE.rent)], ['Security deposit', eur(LEASE.deposit)], ['Break notice', LEASE.notice]] },
  { file: FILES.cv, pages: 1, ago: 5 * D, chat: [],
    fields: [['Candidate', CV.name], ['Current role', CV.role], ['Email', CV.email], ['City', CV.city], ['Years of experience', CV.years], ['Highest qualification', CV.degree], ['Key skills', CV.skills], ['Languages', CV.languages]] },
]

// ─── Video direction (video.mjs): which batches, dossiers and fields to show ──
const fieldOf = (profileId, fieldId) => [profileId, fieldId]
export const FILM = {
  batches: { decision: 'mortgages', running: 'loans', archive: 'portArchive', latest: 'portQ3', errors: 'leases' },
  singles: { dossier: 'mortgage', history: 'mortgage' },
  decision: { firstRow: 'Byrne & Kelly · Galway', valueField: fieldOf('prof_mutui', 'm_loan'), relevanceWord: 'mortgage', mismatch: MISMATCH.dossier, suggestion: MISMATCH.precheck.suggestion.name },
  runningRows: ['Corrib Hardware & Sons', 'Liffey Weaving Mills', 'Three Valleys Logistics'],
  dossierFields: [fieldOf('prof_mutui', 'm_rate'), fieldOf('prof_mutui', 'm_valuation')],
  historyFields: [fieldOf('prof_mutui', 'm_rate'), fieldOf('prof_mutui', 'm_payment')],
  errorRow: LEASE_ERROR.dossier,
  skippedFolder: 'Withdrawn',
  summary: {
    name: 'Client portfolios · 2024–2026', batches: ['portArchive', 'portQ3'], dateField: fieldOf('prof_portafoglio', 's_date'),
    groupFieldId: 's_custodian', newName: 'Assets under management 2024–2026',
  },
  profiles: {
    hover: ['prof_mutui', 'prof_prestiti', 'prof_portafoglio', 'prof_fornitura', 'prof_locazione'],
    apply: 'prof_mutui', describe: ['m_income', 'm_ltv', 'm_rate'],
    extractorFile: FILES.offer2, extractorField: fieldOf('prof_mutui', 'm_rate'),
    chatFile: FILES.facility, chatHover: ['Net debt/EBITDA ≤ 3.0x', 'first-ranking legal charge'],
  },
  text: {
    profilesList: 'One profile per document type: mortgages, loans, portfolios, contracts…',
    sameEngine: 'The same engine reads mortgage offers…',
    chatToo: '…and loan agreements — and answers questions about the text',
    groupBy: 'Make it yours — for example, group by custodian',
    skipped: 'Drafts and withdrawn applications stay out — by rules you set',
  },
}
