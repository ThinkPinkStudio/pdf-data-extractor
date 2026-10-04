// Catalogo dei dati DEMO (tutti inventati): aziende, documenti, profili, job e
// sessioni. Condiviso dal generatore di PDF e dal seed, così i valori "estratti"
// coincidono con quello che c'è scritto nei PDF di esempio.

export const DEMO_USER = 'marta.bianchi@example.com'
export const TEAM = ['marta.bianchi@example.com', 'davide.conti@example.com', 'sara.galli@example.com']

// ─── Aziende fittizie ──────────────────────────────────────────────────────────
export const CLIENT = {
  name: 'Verdeluce Arredamenti S.r.l.',
  addr: ['Via dei Tessitori 18', '24126 Bergamo (BG)'],
  piva: '04827310162',
  pec: 'amministrazione@pec.verdeluce-demo.it',
}

export const CO = {
  meridiane: { name: 'Officine Meridiane S.r.l.', addr: ['Via Leonardo da Vinci 112', '20054 Segrate (MI)'], piva: '09356720961', color: [0.12, 0.29, 0.33], tag: 'Lavorazioni metalliche di precisione' },
  trevalli: { name: 'Logistica Tre Valli S.r.l.', addr: ['Via Provinciale 7', '25065 Lumezzane (BS)'], piva: '03518440987', color: [0.45, 0.13, 0.16], tag: 'Trasporti e logistica conto terzi' },
  nordwave: { name: 'Nordwave Digital S.r.l.', addr: ['Corso Venezia 44', '20121 Milano (MI)'], piva: '11204830969', color: [0.16, 0.2, 0.42], tag: 'Software, cloud e servizi digitali' },
  brera: { name: 'Tessitura Brera Nova S.p.A.', addr: ['Via Monte Rosa 9', '22036 Erba (CO)'], piva: '02741690134', color: [0.33, 0.24, 0.14], tag: 'Tessuti per arredamento dal 1962' },
  alba: { name: 'Studio Alba Consulting S.r.l.', addr: ['Via Roma 21', '10121 Torino (TO)'], piva: '12077340015', color: [0.2, 0.36, 0.25], tag: 'Consulenza organizzativa e processi' },
  colle: { name: 'Immobiliare Colle Aperto S.r.l.', addr: ['Via XX Settembre 15', '24122 Bergamo (BG)'], piva: '03980120168', color: [0.25, 0.25, 0.28], tag: '' },
  energia: { name: 'Lumen Energia S.p.A.', addr: ['Viale Europa 210', '20090 Assago (MI)'], piva: '10655480963', color: [0.05, 0.42, 0.47], tag: 'Luce e gas per le imprese' },
}

// ─── Profili documento (pagina Fascicoli / Impostazioni) ─────────────────────
// id dei campi leggibili: sono i riferimenti di rolling_state/sources nei job.
const F = (id, label, type, description) => ({ id, label, type, description, enabled: true, cells: [] })

export const PROFILES = [
  {
    id: 'prof_fatture',
    name: 'Fatture fornitori',
    matchKeywords: 'fattur, passive',
    matchExcludeKeywords: 'bozze, annullate',
    contentKeywords: 'fattura, imponibile, IVA, totale documento',
    contentExcludeKeywords: 'curriculum, preventivo',
    promptExtra: 'Importi in formato italiano (1.234,56). Se la fattura ha più aliquote IVA restituisci il totale IVA.',
    fields: [
      F('f_num', 'Numero fattura', 'text', 'Numero progressivo del documento, così come stampato (es. "FT 2026/0418").'),
      F('f_data', 'Data emissione', 'date', 'Data di emissione della fattura, formato GG/MM/AAAA.'),
      F('f_forn', 'Fornitore', 'text', 'Ragione sociale di chi EMETTE la fattura (cedente/prestatore).'),
      F('f_piva', 'P.IVA fornitore', 'fiscal', 'Partita IVA del fornitore, 11 cifre senza prefisso IT.'),
      F('f_cli', 'Cliente', 'text', 'Ragione sociale del destinatario (cessionario/committente).'),
      F('f_imp', 'Imponibile', 'number', 'Totale imponibile prima dell’IVA, in euro.'),
      F('f_iva', 'Imposta', 'number', 'Importo totale dell’IVA (somma di tutte le aliquote).'),
      F('f_tot', 'Totale documento', 'number', 'Totale da pagare, IVA inclusa.'),
      F('f_scad', 'Scadenza pagamento', 'date', 'Data entro cui pagare; se indicata solo come "60 gg d.f.f.m." calcola la data.'),
      F('f_mod', 'Modalità di pagamento', 'enum', 'Bonifico, RiBa, RID/SDD, carta, contanti.'),
      F('f_iban', 'IBAN', 'text', 'IBAN del fornitore su cui effettuare il pagamento.'),
      F('f_oda', 'Riferimento ordine', 'text', 'Numero e data dell’ordine d’acquisto richiamato in fattura, se presente.'),
    ],
  },
  {
    id: 'prof_fornitura',
    name: 'Contratti di fornitura',
    matchKeywords: 'contratt, accordo quadro, fornitori',
    matchExcludeKeywords: 'bozza',
    contentKeywords: 'contratto, fornitura, durata, recesso',
    contentExcludeKeywords: '',
    promptExtra: 'Il fascicolo può contenere contratto, addendum, listini, verbali e fatture: vince sempre il dato del documento più recente.',
    fields: [
      F('c_forn', 'Fornitore', 'text', 'Ragione sociale della controparte fornitrice.'),
      F('c_piva', 'P.IVA fornitore', 'fiscal', 'Partita IVA del fornitore, 11 cifre.'),
      F('c_ogg', 'Oggetto del contratto', 'text', 'Breve descrizione di beni/servizi forniti.'),
      F('c_stip', 'Data stipula', 'date', 'Data di firma del contratto originario.'),
      F('c_scad', 'Scadenza contratto', 'date', 'Data di fine validità; considera proroghe da addendum successivi.'),
      F('c_rinn', 'Rinnovo automatico', 'boolean', 'Sì/No e periodicità del rinnovo tacito.'),
      F('c_prea', 'Preavviso disdetta', 'text', 'Giorni o mesi di preavviso per la disdetta.'),
      F('c_val', 'Valore annuo stimato', 'number', 'Volume/valore annuo previsto in euro.'),
      F('c_pag', 'Condizioni di pagamento', 'text', 'Modalità e termini di pagamento in vigore.'),
      F('c_pen', 'Penale per ritardo', 'text', 'Penale per ritardata consegna (percentuale e massimale).'),
      F('c_list', 'Aumento listino', 'text', 'Variazione prezzi dell’ultimo listino e data di decorrenza.'),
      F('c_audit', 'Esito ultimo audit', 'text', 'Esito e punteggio dell’ultimo audit/verbale di qualità.'),
      F('c_iso', 'Scadenza certificazione ISO 9001', 'date', 'Data di scadenza del certificato di qualità del fornitore.'),
      F('c_foro', 'Foro competente', 'text', 'Tribunale competente per le controversie.'),
      F('c_ref', 'Referente fornitore', 'text', 'Nome del referente commerciale/tecnico indicato.'),
      F('c_fatt', 'Ultima fattura', 'text', 'Numero e totale della fattura più recente nel fascicolo.'),
    ],
  },
  {
    id: 'prof_locazione',
    name: 'Contratti di locazione',
    matchKeywords: 'locazion, immobili, affitt',
    matchExcludeKeywords: '',
    contentKeywords: 'locatore, conduttore, canone',
    contentExcludeKeywords: '',
    promptExtra: '',
    fields: [
      F('l_loc', 'Locatore', 'text', 'Proprietario che concede l’immobile in locazione.'),
      F('l_cond', 'Conduttore', 'text', 'Soggetto che prende in locazione l’immobile.'),
      F('l_imm', 'Indirizzo immobile', 'text', 'Via, civico e comune dell’immobile locato.'),
      F('l_cat', 'Dati catastali', 'text', 'Foglio, mappale, subalterno e categoria.'),
      F('l_dec', 'Decorrenza', 'date', 'Data di inizio della locazione.'),
      F('l_scad', 'Prima scadenza', 'date', 'Data di fine del primo periodo contrattuale.'),
      F('l_can', 'Canone annuo', 'number', 'Canone annuo in euro, escluse spese.'),
      F('l_rata', 'Rata e periodicità', 'text', 'Importo e cadenza delle rate (es. mensili anticipate).'),
      F('l_dep', 'Deposito cauzionale', 'number', 'Importo del deposito cauzionale in euro.'),
      F('l_istat', 'Aggiornamento ISTAT', 'percent', 'Percentuale di adeguamento ISTAT applicata.'),
      F('l_prea', 'Preavviso recesso', 'text', 'Preavviso richiesto al conduttore per il recesso.'),
      F('l_reg', 'Estremi registrazione', 'text', 'Ufficio, data e numero di registrazione del contratto.'),
    ],
  },
  {
    id: 'prof_ddt',
    name: 'Documenti di trasporto (DDT)',
    matchKeywords: 'ddt, bolle, trasporto',
    matchExcludeKeywords: '',
    contentKeywords: 'documento di trasporto, vettore, colli',
    contentExcludeKeywords: '',
    promptExtra: '',
    fields: [
      F('d_num', 'Numero DDT', 'text', 'Numero del documento di trasporto.'),
      F('d_data', 'Data DDT', 'date', 'Data di emissione del DDT.'),
      F('d_mitt', 'Mittente', 'text', 'Ragione sociale del mittente.'),
      F('d_dest', 'Destinatario', 'text', 'Ragione sociale del destinatario.'),
      F('d_luogo', 'Luogo di destinazione', 'text', 'Indirizzo di consegna della merce.'),
      F('d_caus', 'Causale trasporto', 'enum', 'Vendita, conto lavorazione, reso, conto visione…'),
      F('d_vett', 'Vettore', 'text', 'Trasportatore incaricato.'),
      F('d_colli', 'Numero colli', 'number', 'Totale colli spediti.'),
      F('d_peso', 'Peso lordo (kg)', 'number', 'Peso lordo complessivo in kg.'),
      F('d_porto', 'Porto', 'enum', 'Franco, assegnato, franco con addebito.'),
    ],
  },
  {
    id: 'prof_cedolini',
    name: 'Cedolini paga',
    matchKeywords: 'cedolin, buste paga, paghe',
    matchExcludeKeywords: '',
    contentKeywords: 'cedolino, netto in busta, TFR',
    contentExcludeKeywords: '',
    promptExtra: 'Non riportare mai dati sanitari o note riservate eventualmente presenti nel cedolino.',
    fields: [
      F('p_dip', 'Dipendente', 'text', 'Nome e cognome del lavoratore.'),
      F('p_cf', 'Codice fiscale', 'fiscal', 'Codice fiscale del dipendente (16 caratteri).'),
      F('p_mese', 'Periodo di paga', 'text', 'Mese e anno di competenza.'),
      F('p_liv', 'Livello e CCNL', 'text', 'Livello di inquadramento e contratto applicato.'),
      F('p_ore', 'Ore ordinarie', 'number', 'Ore ordinarie lavorate nel mese.'),
      F('p_lordo', 'Totale competenze', 'number', 'Retribuzione lorda complessiva del mese.'),
      F('p_netto', 'Netto in busta', 'number', 'Importo netto pagato al dipendente.'),
      F('p_tfr', 'TFR maturato nel mese', 'number', 'Quota TFR maturata nel periodo.'),
      F('p_ferie', 'Ferie residue (gg)', 'number', 'Giorni di ferie residui a fine mese.'),
    ],
  },
  {
    id: 'prof_cv',
    name: 'Curriculum candidati',
    matchKeywords: 'cv, candidature, curriculum',
    matchExcludeKeywords: '',
    contentKeywords: 'esperienze, formazione, competenze',
    contentExcludeKeywords: 'fattura',
    promptExtra: 'Riassumi le competenze in massimo 6 parole chiave separate da virgola.',
    fields: [
      F('v_nome', 'Candidato', 'text', 'Nome e cognome.'),
      F('v_ruolo', 'Ruolo attuale', 'text', 'Posizione ricoperta attualmente o più recente.'),
      F('v_email', 'Email', 'text', 'Indirizzo email di contatto.'),
      F('v_tel', 'Telefono', 'text', 'Numero di telefono.'),
      F('v_citta', 'Città', 'text', 'Città di residenza o domicilio.'),
      F('v_anni', 'Anni di esperienza', 'number', 'Anni di esperienza nel ruolo, calcolati dalle date.'),
      F('v_studio', 'Titolo di studio', 'text', 'Titolo di studio più alto conseguito.'),
      F('v_skill', 'Competenze chiave', 'text', 'Competenze principali (max 6).'),
      F('v_lingue', 'Lingue', 'text', 'Lingue straniere e livello.'),
      F('v_disp', 'Disponibilità', 'text', 'Disponibilità/preavviso per l’inserimento.'),
    ],
  },
  {
    id: 'prof_preventivi',
    name: 'Preventivi e offerte',
    matchKeywords: 'preventiv, offert',
    matchExcludeKeywords: '',
    contentKeywords: 'preventivo, offerta, validità',
    contentExcludeKeywords: '',
    promptExtra: '',
    fields: [
      F('o_num', 'Numero offerta', 'text', 'Numero/codice del preventivo.'),
      F('o_data', 'Data offerta', 'date', 'Data del preventivo.'),
      F('o_forn', 'Fornitore', 'text', 'Chi presenta l’offerta.'),
      F('o_ogg', 'Oggetto', 'text', 'Descrizione sintetica della fornitura/progetto.'),
      F('o_imp', 'Imponibile', 'number', 'Totale offerta IVA esclusa.'),
      F('o_valid', 'Valida fino al', 'date', 'Data di scadenza dell’offerta.'),
      F('o_tempi', 'Tempi di consegna', 'text', 'Tempi di consegna o di realizzazione.'),
      F('o_pag', 'Condizioni di pagamento', 'text', 'Termini di pagamento proposti.'),
    ],
  },
  {
    id: 'prof_utenze',
    name: 'Bollette e utenze',
    matchKeywords: 'utenze, bollett, energia, gas',
    matchExcludeKeywords: '',
    contentKeywords: 'POD, PDR, consumi, kWh',
    contentExcludeKeywords: '',
    promptExtra: '',
    fields: [
      F('u_forn', 'Fornitore', 'text', 'Società di vendita dell’energia/gas.'),
      F('u_pod', 'POD / PDR', 'text', 'Codice del punto di prelievo.'),
      F('u_per', 'Periodo di fatturazione', 'text', 'Intervallo di date dei consumi fatturati.'),
      F('u_cons', 'Consumo (kWh)', 'number', 'Consumo complessivo del periodo.'),
      F('u_pot', 'Potenza impegnata (kW)', 'number', 'Potenza contrattualmente impegnata.'),
      F('u_tot', 'Totale da pagare', 'number', 'Importo totale della bolletta.'),
      F('u_scad', 'Scadenza', 'date', 'Data di scadenza del pagamento.'),
    ],
  },
]

export const profileById = Object.fromEntries(PROFILES.map((p) => [p.id, p]))

// Profili dell'Estrattore singolo (solo etichette: il modello capisce dal nome).
export const GENERIC_PROFILES = PROFILES.map((p) => ({
  id: 'g_' + p.id,
  name: p.name,
  fields: p.fields.map((f) => ({ id: 'g_' + f.id, label: f.label, description: f.description, type: f.type, enabled: true })),
}))

// ─── Documenti PDF ─────────────────────────────────────────────────────────────
export const FILES = {
  ftMeridiane: 'FT-2026-0418_Officine-Meridiane.pdf',
  ftTrevalli: 'FT-1127-2026_Logistica-Tre-Valli.pdf',
  ftNordwave: 'FT-0093-2026_Nordwave-Digital.pdf',
  locazione: 'Contratto_locazione_Via-Garibaldi-41.pdf',
  ddt: 'DDT_2291_Tessitura-Brera-Nova.pdf',
  cedolino: 'Cedolino_09-2026_Ferraris-Luca.pdf',
  cv: 'CV_Chiara-Lombardi.pdf',
  preventivo: 'Preventivo_PR-2026-077_Studio-Alba.pdf',
  bolletta: 'Bolletta_energia_08-2026.pdf',
  quadro: 'Contratto_quadro_fornitura_2024.pdf',
  addendum: 'Addendum_01_2025.pdf',
  listino: 'Listino_prezzi_2026.pdf',
  audit: 'Verbale_audit_qualita_2026.pdf',
}

// ─── Valori estratti dei job (rolling_state = { id: { valore, fonte } }) ─────
const v = (valore, file, page = 1) => ({ valore, data_validita: null, fonte: file ? { file, page } : undefined })

export const DOSSIER_MERIDIANE = {
  files: [FILES.quadro, FILES.addendum, FILES.listino, FILES.audit, FILES.ftMeridiane],
  state: {
    c_forn: v('Officine Meridiane S.r.l.', FILES.quadro, 1),
    c_piva: v('09356720961', FILES.quadro, 1),
    c_ogg: v('Fornitura di componenti metallici per arredo', FILES.quadro, 1),
    c_stip: v('15/01/2024', FILES.quadro, 1),
    c_scad: v('31/12/2027', FILES.addendum, 1),
    c_rinn: v('Sì, annuale (tacito)', FILES.quadro, 2),
    c_prea: v('90 giorni', FILES.quadro, 2),
    c_val: v('150.000,00', FILES.addendum, 1),
    c_pag: v('Bonifico 90 gg d.f.f.m.', FILES.addendum, 1),
    c_pen: v('0,5% al giorno lavorativo, max 10%', FILES.quadro, 2),
    c_list: v('+3,8% dal 01/01/2026', FILES.listino, 1),
    c_audit: v('Conforme · 92/100', FILES.audit, 1),
    c_iso: v('18/05/2028', FILES.audit, 1),
    c_foro: v('Milano', FILES.quadro, 2),
    c_ref: v('Ing. Paolo Re', FILES.quadro, 2),
    c_fatt: v('FT 2026/0418 · 7.039,40 €', FILES.ftMeridiane, 1),
  },
}

// Fatture del batch di settembre (una cartella per fornitore).
export const INVOICES = [
  { dossier: 'Officine Meridiane', file: FILES.ftMeridiane, num: 'FT 2026/0418', data: '12/09/2026', forn: CO.meridiane.name, piva: CO.meridiane.piva, imp: '5.770,00', iva: '1.269,40', tot: '7.039,40', scad: '30/11/2026', mod: 'Bonifico', iban: 'IT60X0542811101000000123456', oda: 'ODA-2026-311 del 28/08/2026' },
  { dossier: 'Logistica Tre Valli', file: FILES.ftTrevalli, num: '1127/2026', data: '30/09/2026', forn: CO.trevalli.name, piva: CO.trevalli.piva, imp: '2.433,53', iva: '535,38', tot: '2.968,91', scad: '31/10/2026', mod: 'RiBa', iban: '', oda: '' },
  { dossier: 'Nordwave Digital', file: FILES.ftNordwave, num: '0093/2026', data: '01/10/2026', forn: CO.nordwave.name, piva: CO.nordwave.piva, imp: '2.010,00', iva: '442,20', tot: '2.452,20', scad: '31/10/2026', mod: 'Bonifico', iban: 'IT02L1234512345123456789012', oda: 'Contratto SaaS n. NW-2025-018' },
  { dossier: 'Elettroforniture Pavan', file: 'Fattura_318-B_Elettroforniture-Pavan.pdf', num: '318/B', data: '18/09/2026', forn: 'Elettroforniture Pavan S.n.c.', piva: '02215870165', imp: '1.053,11', iva: '231,69', tot: '1.284,80', scad: '18/10/2026', mod: 'Bonifico', iban: 'IT45R0306911100100000004567', oda: 'ODA-2026-329 del 09/09/2026' },
  { dossier: 'Cartotecnica Lariana', file: 'FV-2026-0772_Cartotecnica-Lariana.pdf', num: 'FV-2026-0772', data: '21/09/2026', forn: 'Cartotecnica Lariana S.r.l.', piva: '03362710135', imp: '526,27', iva: '115,78', tot: '642,05', scad: '31/10/2026', mod: 'RID/SDD', iban: '', oda: '' },
  { dossier: 'Verniciature Orobiche', file: 'Fattura_2026-219_Verniciature-Orobiche.pdf', num: '2026/219', data: '24/09/2026', forn: 'Verniciature Orobiche S.r.l.', piva: '04119350163', imp: '3.600,00', iva: '792,00', tot: '4.392,00', scad: '30/11/2026', mod: 'Bonifico', iban: 'IT87F0503411102000000009876', oda: 'ODA-2026-305 del 21/08/2026' },
  { dossier: 'Ferramenta Corsini & Figli', file: 'Fattura_1543_Ferramenta-Corsini.pdf', num: '1543', data: '26/09/2026', forn: 'Ferramenta Corsini & Figli S.a.s.', piva: '01947260168', imp: '318,95', iva: '70,17', tot: '389,12', scad: '26/09/2026', mod: 'Carta', iban: '', oda: '' },
  { dossier: 'Tessitura Brera Nova', file: 'Fattura_26-01984_Tessitura-Brera-Nova.pdf', num: '26/01984', data: '29/09/2026', forn: CO.brera.name, piva: CO.brera.piva, imp: '9.195,82', iva: '2.023,08', tot: '11.218,90', scad: '30/11/2026', mod: 'Bonifico', iban: 'IT33D0569610900000012345067', oda: 'ODA-2026-298 del 12/08/2026' },
]

export function invoiceState(inv) {
  const f = inv.file
  return {
    f_num: v(inv.num, f, 1), f_data: v(inv.data, f, 1), f_forn: v(inv.forn, f, 1), f_piva: v(inv.piva, f, 1),
    f_cli: v(CLIENT.name, f, 1), f_imp: v(inv.imp, f, 1), f_iva: v(inv.iva, f, 1), f_tot: v(inv.tot, f, 1),
    f_scad: v(inv.scad, f, 1), f_mod: v(inv.mod, f, 1), f_iban: inv.iban ? v(inv.iban, f, 1) : v(null), f_oda: inv.oda ? v(inv.oda, f, 1) : v(null),
  }
}

export const PAYSLIPS = [
  ['Luca Ferraris', 'FRRLCU88C14A794K', '4° Commercio', '168', '2.767,20', '2.054,02', '204,98', '11,5'],
  ['Giulia Martinelli', 'MRTGLI91E52A794T', '3° Commercio', '168', '2.941,35', '2.163,70', '217,88', '8'],
  ['Andrea Colombo', 'CLMNDR85H09F205P', 'Quadro Commercio', '168', '4.120,00', '2.879,44', '305,19', '14'],
  ['Elisa Pagani', 'PGNLSE95A61A794W', '5° Commercio', '126', '1.604,88', '1.312,57', '118,88', '6,5'],
  ['Matteo Rinaldi', 'RNLMTT90T22B157C', '4° Commercio', '168', '2.689,40', '2.006,15', '199,22', '9'],
  ['Federica Moretti', 'MRTFDR87D45A794N', '2° Commercio', '168', '3.312,60', '2.388,07', '245,38', '12'],
  ['Simone Bassi', 'BSSSMN93M03L400Y', '4° Commercio', '168', '2.702,10', '2.014,63', '200,16', '3'],
  ['Valentina Greco', 'GRCVNT89R58A794F', '3° Commercio', '168', '2.958,45', '2.170,02', '219,15', '15,5'],
  ['Paolo Esposito', 'SPSPLA82C11F839H', '6° Commercio', '168', '1.968,30', '1.583,92', '145,80', '10'],
]

export function payslipState(row, fileName) {
  const [dip, cf, liv, ore, lordo, netto, tfr, ferie] = row
  return {
    p_dip: v(dip, fileName), p_cf: v(cf, fileName), p_mese: v('Settembre 2026', fileName), p_liv: v(liv, fileName),
    p_ore: v(ore, fileName), p_lordo: v(lordo, fileName), p_netto: v(netto, fileName), p_tfr: v(tfr, fileName), p_ferie: v(ferie, fileName),
  }
}

export const LEASES = [
  { dossier: 'Showroom Via Garibaldi 41 · Bergamo', file: FILES.locazione, loc: CO.colle.name, imm: 'Via Garibaldi 41, 24122 Bergamo (BG)', cat: 'Fg. 34, map. 1187, sub. 5 · C/1', dec: '01/03/2026', scad: '28/02/2032', can: '26.400,00', rata: '2.200,00 mensili anticipate', dep: '6.600,00', istat: '75%', prea: '6 mesi (PEC o raccomandata A/R)', reg: 'AdE Bergamo, 14/03/2026, n. 4821 serie 3T' },
  { dossier: 'Punto vendita Corso Italia 8 · Brescia', file: 'Locazione_Corso-Italia-8_Brescia.pdf', loc: 'Patrimonio Gussago S.r.l.', imm: 'Corso Italia 8, 25122 Brescia (BS)', cat: 'Fg. 112, map. 455, sub. 12 · C/1', dec: '01/09/2023', scad: '31/08/2029', can: '31.200,00', rata: '7.800,00 trimestrali anticipate', dep: '7.800,00', istat: '75%', prea: '6 mesi', reg: 'AdE Brescia, 22/09/2023, n. 9310 serie 3T' },
  { dossier: 'Punto vendita Via Manzoni 112 · Como', file: 'Locazione_Via-Manzoni-112_Como.pdf', loc: 'Lario Immobili S.r.l.', imm: 'Via Manzoni 112, 22100 Como (CO)', cat: 'Fg. 9, map. 2210, sub. 3 · C/1', dec: '15/01/2025', scad: '14/01/2031', can: '22.800,00', rata: '1.900,00 mensili anticipate', dep: '5.700,00', istat: '100%', prea: '12 mesi', reg: 'AdE Como, 30/01/2025, n. 1188 serie 3T' },
]

export function leaseState(l) {
  const f = l.file
  return {
    l_loc: v(l.loc, f, 1), l_cond: v(CLIENT.name, f, 1), l_imm: v(l.imm, f, 1), l_cat: v(l.cat, f, 1),
    l_dec: v(l.dec, f, 1), l_scad: v(l.scad, f, 1), l_can: v(l.can, f, 1), l_rata: v(l.rata, f, 1),
    l_dep: v(l.dep, f, 2), l_istat: v(l.istat, f, 2), l_prea: v(l.prea, f, 2), l_reg: v(l.reg, f, 2),
  }
}

export const SUPPLY_CONTRACTS = [
  { dossier: 'Officine Meridiane', state: DOSSIER_MERIDIANE.state, files: DOSSIER_MERIDIANE.files, status: 'done' },
  {
    dossier: 'Nordwave Digital', status: 'done',
    files: ['Contratto_SaaS_NW-2025-018.pdf', 'SLA_allegato_B.pdf', FILES.ftNordwave],
    state: {
      c_forn: v(CO.nordwave.name, 'Contratto_SaaS_NW-2025-018.pdf'), c_piva: v(CO.nordwave.piva, 'Contratto_SaaS_NW-2025-018.pdf'),
      c_ogg: v('Piattaforma e-commerce in SaaS, hosting e sviluppo evolutivo', 'Contratto_SaaS_NW-2025-018.pdf'),
      c_stip: v('03/03/2025', 'Contratto_SaaS_NW-2025-018.pdf'), c_scad: v('02/03/2028', 'Contratto_SaaS_NW-2025-018.pdf', 2),
      c_rinn: v('Sì, annuale (tacito)', 'Contratto_SaaS_NW-2025-018.pdf', 2), c_prea: v('60 giorni', 'Contratto_SaaS_NW-2025-018.pdf', 2),
      c_val: v('24.840,00', 'Contratto_SaaS_NW-2025-018.pdf', 3), c_pag: v('Bonifico 30 gg d.f.', FILES.ftNordwave),
      c_pen: v('Crediti di servizio se disponibilità < 99,5%', 'SLA_allegato_B.pdf'), c_list: v(null), c_audit: v(null), c_iso: v(null),
      c_foro: v('Milano', 'Contratto_SaaS_NW-2025-018.pdf', 4), c_ref: v('Dott.ssa Irene Sala', 'Contratto_SaaS_NW-2025-018.pdf', 4),
      c_fatt: v('0093/2026 · 2.452,20 €', FILES.ftNordwave),
    },
  },
  {
    dossier: 'Logistica Tre Valli', status: 'done',
    files: ['Contratto_trasporto_2025.pdf', 'Tariffario_2026.pdf', FILES.ftTrevalli, FILES.ddt],
    state: {
      c_forn: v(CO.trevalli.name, 'Contratto_trasporto_2025.pdf'), c_piva: v(CO.trevalli.piva, 'Contratto_trasporto_2025.pdf'),
      c_ogg: v('Trasporto merci groupage Nord Italia e consegne su appuntamento', 'Contratto_trasporto_2025.pdf'),
      c_stip: v('01/02/2025', 'Contratto_trasporto_2025.pdf'), c_scad: v('31/01/2027', 'Contratto_trasporto_2025.pdf'),
      c_rinn: v('No', 'Contratto_trasporto_2025.pdf', 2), c_prea: v('—', null), c_val: v('28.000,00', 'Contratto_trasporto_2025.pdf'),
      c_pag: v('RiBa 30 gg d.f.', FILES.ftTrevalli), c_pen: v('€ 50 per consegna oltre la finestra concordata', 'Contratto_trasporto_2025.pdf', 2),
      c_list: v('Fuel surcharge 6,5% (ott. 2026)', 'Tariffario_2026.pdf'), c_audit: v(null), c_iso: v(null),
      c_foro: v('Brescia', 'Contratto_trasporto_2025.pdf', 3), c_ref: v('Marco Ghidini', 'Contratto_trasporto_2025.pdf', 3),
      c_fatt: v('1127/2026 · 2.968,91 €', FILES.ftTrevalli),
    },
  },
  {
    dossier: 'Tessitura Brera Nova', status: 'running',
    files: ['Accordo_quadro_tessuti_2023.pdf', 'Proroga_2026.pdf', 'Listino_campionario_AI26.pdf', 'Fattura_26-01984_Tessitura-Brera-Nova.pdf'],
    progress: { docIndex: 2, docTotal: 4, pageIndex: 3, pageTotal: 7, docName: 'Listino_campionario_AI26.pdf', totalPagesProcessed: 9 },
    state: {
      c_forn: v(CO.brera.name, 'Accordo_quadro_tessuti_2023.pdf'), c_piva: v(CO.brera.piva, 'Accordo_quadro_tessuti_2023.pdf'),
      c_ogg: v('Fornitura tessuti per imbottiti e tendaggi', 'Accordo_quadro_tessuti_2023.pdf'), c_stip: v('09/05/2023', 'Accordo_quadro_tessuti_2023.pdf'),
      c_scad: v('31/12/2026', 'Proroga_2026.pdf'),
    },
  },
  { dossier: 'Verniciature Orobiche', status: 'queued', files: ['Contratto_conto_lavoro_2024.pdf', 'Verbale_audit_2025.pdf'], state: {} },
]

export const MAIN_SESSION_CHAT = [
  { role: 'user', content: 'Qual è la scadenza di pagamento e su quale IBAN devo pagare?' },
  { role: 'assistant', content: 'La fattura FT 2026/0418 va pagata con bonifico a 60 giorni data fattura fine mese, quindi entro il 30/11/2026.\nIBAN indicato dal fornitore: IT60 X054 2811 1010 0000 0123 456.' },
  { role: 'user', content: 'Ci sono righe che non corrispondono all’ordine ODA-2026-311?' },
  { role: 'assistant', content: 'L’ordine richiamato è ODA-2026-311 del 28/08/2026. Rispetto alle righe di prodotto, in fattura compaiono due voci accessorie:\n• Lavorazione taglio laser su disegno cliente — 1.150,00 €\n• Trasporto e imballo — 180,00 €\nVerifica che fossero previste nell’ordine: il resto (telai TV-80, staffe ST-12, piedini M10) è coerente con quantità e prezzi unitari.' },
]

export const LEASE_CHAT = [
  { role: 'user', content: 'Entro quando devo mandare la disdetta se voglio lasciare il locale alla prima scadenza?' },
  { role: 'assistant', content: 'La prima scadenza è il 28/02/2032. Il conduttore può recedere con preavviso di 6 mesi tramite PEC o raccomandata A/R (art. 4): la comunicazione deve arrivare entro il 31/08/2031.' },
  { role: 'user', content: 'Quanto pago al mese tra canone e spese?' },
  { role: 'assistant', content: 'Canone: 2.200,00 € al mese (26.400,00 € annui, rate mensili anticipate entro il giorno 5).\nSpese condominiali: forfait di 150,00 € al mese a carico del conduttore (art. 7).\nTotale mensile: 2.350,00 €, oltre all’adeguamento ISTAT al 75% dal secondo anno.' },
  { role: 'user', content: 'Il deposito cauzionale produce interessi?' },
  { role: 'assistant', content: 'Sì. Il deposito di 6.600,00 € (tre mensilità) è produttivo di interessi legali, che vengono corrisposti al conduttore alla fine di ogni anno di locazione (art. 6).' },
]
