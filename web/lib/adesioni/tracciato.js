/**
 * Schema del tracciato AXA Partners (polizza 191025) e configurazione di default
 * della maschera. Modulo PURO (nessun import Electron) → testabile in Node.
 *
 * Le intestazioni qui sotto riproducono ESATTAMENTE quelle del flusso fornito
 * dalla compagnia (compresi gli apostrofi tipografici), così il file `.xlsx` in
 * uscita rispetta il formato richiesto. In lettura il match è comunque tollerante
 * (vedi normHeader) e, quando si carica un flusso reale, si riusano le sue
 * intestazioni così come sono.
 */

// Ordine canonico delle 34 colonne del tracciato.
export const TRACCIATO_HEADERS = [
  'NUMERO POLIZZA',
  'LOB',
  'TIPOLOGIA POLIZZA',
  'CODICE CONFIGURAZIONE',
  'IDENTIFICATIVO UNIVOCO APPLICAZIONE',
  'TIPO OGGETTO ASSICURATO',
  'CODICE FISCALE / P.IVA ASSICURATO',
  'COGNOME / RAGIONE SOCIALE ASSICURATO',
  'NOME ASSICURATO',
  'INDIRIZZO RESIDENZA ASSICURATO',
  'CAP RESIDENZA ASSICURATO',
  'CITTA’ RESIDENZA ASSICURATO',
  'PROVINCIA RESIDENZA ASSICURATO',
  'TARGA VEICOLO',
  'TELAIO VEICOLO',
  'MARCA VEICOLO',
  'MODELLO VEICOLO',
  'TIPOLOGIA VEICOLO',
  'PESO VEICOLO',
  'DATA IMMATRICOLAZIONE',
  "DATA INIZIO VALIDITA' COPERTURA",
  "DATA FINE VALIDITA' COPERTURA",
  'DATA RENDICONTAZIONE',
  'CODICE DOMANDA 1',
  'CODICE RISPOSTA 1',
  'CODICE DOMANDA 2',
  'CODICE RISPOSTA 2',
  'CODICE DOMANDA 3',
  'CODICE RISPOSTA 3',
  'CODICE DOMANDA 4',
  'CODICE RISPOSTA 4',
  'CODICE DOMANDA 5',
  'CODICE RISPOSTA 5',
  'TIPO MOVIMENTO'
]

/** Normalizza un'intestazione per il confronto tollerante (apostrofi, spazi, case). */
export function normHeader(h) {
  return String(h == null ? '' : h)
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

const YN = [{ value: 'S', label: 'Sì' }, { value: 'N', label: 'No' }]

// Campi configurabili della maschera. Ogni campo è mappato a una colonna del
// flusso (flussoCol), alla colonna del tracciato in uscita (trackCol) e,
// opzionalmente, a un segnaposto del modulo (docx).
export const DEFAULT_FIELDS = [
  // ─── Dati polizza ───────────────────────────────────────────────────────
  { id: 'numero_polizza', label: 'Numero polizza', group: 'polizza', type: 'fixed', fixed: '191025', flussoCol: 'NUMERO POLIZZA', trackCol: 'NUMERO POLIZZA', docx: null, enabled: true },
  { id: 'lob', label: 'LOB', group: 'polizza', type: 'fixed', fixed: 'A', flussoCol: 'LOB', trackCol: 'LOB', docx: null, enabled: true },
  { id: 'tipologia_polizza', label: 'Tipologia polizza', group: 'polizza', type: 'fixed', fixed: 'C', flussoCol: 'TIPOLOGIA POLIZZA', trackCol: 'TIPOLOGIA POLIZZA', docx: null, enabled: true },
  { id: 'codice_configurazione', label: 'Codice configurazione', group: 'polizza', type: 'select', required: true,
    options: [
      { value: '00001', label: '00001 — Assistenza' },
      { value: '00002', label: '00002 — Tutela legale' },
      { value: '00003', label: '00003 — Assistenza + Tutela legale' }
    ],
    flussoCol: 'CODICE CONFIGURAZIONE', trackCol: 'CODICE CONFIGURAZIONE', docx: null, enabled: true },
  { id: 'identificativo', label: 'Identificativo univoco', group: 'polizza', type: 'text', required: true, maxLength: 30, flussoCol: 'IDENTIFICATIVO UNIVOCO APPLICAZIONE', trackCol: 'IDENTIFICATIVO UNIVOCO APPLICAZIONE', docx: null, enabled: true },
  { id: 'tipo_oggetto', label: 'Tipo oggetto assicurato', group: 'polizza', type: 'fixed', fixed: '2', flussoCol: 'TIPO OGGETTO ASSICURATO', trackCol: 'TIPO OGGETTO ASSICURATO', docx: null, enabled: true },

  // ─── Aderente ───────────────────────────────────────────────────────────
  { id: 'codice_fiscale', label: 'Codice fiscale / P.IVA', group: 'contraente', type: 'text', required: true, maxLength: 20, flussoCol: 'CODICE FISCALE / P.IVA ASSICURATO', trackCol: 'CODICE FISCALE / P.IVA ASSICURATO', docx: 'codice_fiscale', enabled: true },
  { id: 'cognome', label: 'Cognome / Ragione sociale', group: 'contraente', type: 'text', required: true, maxLength: 20, flussoCol: 'COGNOME / RAGIONE SOCIALE ASSICURATO', trackCol: 'COGNOME / RAGIONE SOCIALE ASSICURATO', docx: null, enabled: true },
  { id: 'nome', label: 'Nome', group: 'contraente', type: 'text', required: true, maxLength: 20, flussoCol: 'NOME ASSICURATO', trackCol: 'NOME ASSICURATO', docx: null, enabled: true },
  { id: 'indirizzo', label: 'Indirizzo residenza', group: 'contraente', type: 'text', required: true, maxLength: 30, flussoCol: 'INDIRIZZO RESIDENZA ASSICURATO', trackCol: 'INDIRIZZO RESIDENZA ASSICURATO', docx: 'residenza', enabled: true },
  { id: 'cap', label: 'CAP', group: 'contraente', type: 'text', required: true, maxLength: 10, flussoCol: 'CAP RESIDENZA ASSICURATO', trackCol: 'CAP RESIDENZA ASSICURATO', docx: 'cap', enabled: true },
  { id: 'citta', label: 'Città', group: 'contraente', type: 'text', required: true, maxLength: 30, flussoCol: 'CITTA’ RESIDENZA ASSICURATO', trackCol: 'CITTA’ RESIDENZA ASSICURATO', docx: 'citta', enabled: true },
  { id: 'provincia', label: 'Provincia', group: 'contraente', type: 'text', required: true, maxLength: 5, flussoCol: 'PROVINCIA RESIDENZA ASSICURATO', trackCol: 'PROVINCIA RESIDENZA ASSICURATO', docx: 'provincia', enabled: true },

  // ─── Veicolo ────────────────────────────────────────────────────────────
  { id: 'targa', label: 'Targa', group: 'veicolo', type: 'text', required: true, maxLength: 20, flussoCol: 'TARGA VEICOLO', trackCol: 'TARGA VEICOLO', docx: 'targa', enabled: true },
  { id: 'telaio', label: 'Telaio', group: 'veicolo', type: 'text', required: false, maxLength: 20, flussoCol: 'TELAIO VEICOLO', trackCol: 'TELAIO VEICOLO', docx: null, enabled: true },
  { id: 'marca', label: 'Marca', group: 'veicolo', type: 'text', required: true, maxLength: 20, flussoCol: 'MARCA VEICOLO', trackCol: 'MARCA VEICOLO', docx: null, enabled: true },
  { id: 'modello', label: 'Modello', group: 'veicolo', type: 'text', required: true, maxLength: 20, flussoCol: 'MODELLO VEICOLO', trackCol: 'MODELLO VEICOLO', docx: null, enabled: true },
  { id: 'tipologia_veicolo', label: 'Tipologia veicolo', group: 'veicolo', type: 'select', required: true,
    options: [
      { value: '1', label: '1 — Autoveicolo' },
      { value: '2', label: '2 — Motoveicolo' },
      { value: '3', label: '3 — Truck' }
    ],
    flussoCol: 'TIPOLOGIA VEICOLO', trackCol: 'TIPOLOGIA VEICOLO', docx: null, enabled: true },
  { id: 'peso', label: 'Peso (kg)', group: 'veicolo', type: 'number', required: true, flussoCol: 'PESO VEICOLO', trackCol: 'PESO VEICOLO', docx: null, enabled: true },
  { id: 'data_immatricolazione', label: 'Data immatricolazione', group: 'veicolo', type: 'date', required: true, flussoCol: 'DATA IMMATRICOLAZIONE', trackCol: 'DATA IMMATRICOLAZIONE', docx: null, enabled: true },

  // ─── Copertura ──────────────────────────────────────────────────────────
  { id: 'data_inizio', label: 'Data inizio validità', group: 'copertura', type: 'date', required: true, flussoCol: "DATA INIZIO VALIDITA' COPERTURA", trackCol: "DATA INIZIO VALIDITA' COPERTURA", docx: 'data_inizio', docxDateOffset: true, enabled: true },
  { id: 'data_fine', label: 'Data fine validità', group: 'copertura', type: 'date', required: true, flussoCol: "DATA FINE VALIDITA' COPERTURA", trackCol: "DATA FINE VALIDITA' COPERTURA", docx: 'data_fine', docxDateOffset: true, enabled: true },
  { id: 'data_rendicontazione', label: 'Data rendicontazione', group: 'copertura', type: 'date', required: true, flussoCol: 'DATA RENDICONTAZIONE', trackCol: 'DATA RENDICONTAZIONE', docx: null, enabled: true },
  { id: 'tipo_movimento', label: 'Tipo movimento', group: 'copertura', type: 'select', required: true,
    options: [
      { value: 'A', label: 'A — Attivazione' },
      { value: 'M', label: 'M — Modifica' },
      { value: 'E', label: 'E — Cessazione' }
    ],
    flussoCol: 'TIPO MOVIMENTO', trackCol: 'TIPO MOVIMENTO', docx: null, enabled: true },

  // ─── Contatti (solo modulo, non presenti nel flusso) ─────────────────────
  { id: 'email', label: 'Email', group: 'contatti', type: 'email', required: false, flussoCol: null, trackCol: null, docx: 'email', enabled: true },
  { id: 'tel', label: 'Telefono', group: 'contatti', type: 'phone', required: false, flussoCol: null, trackCol: null, docx: 'tel', enabled: true }
]

// Questionario IDD (valorizzato solo per TIPO MOVIMENTO = "A").
export const DEFAULT_IDD = [
  { domanda: 'INTERESSE_COPERTURA', label: 'Sono interessato a sottoscrivere una polizza assicurativa Assistenza relativa alla circolazione stradale?', options: YN },
  { domanda: 'INTERESSE_SPECIFICO', label: 'Sono interessato ad una copertura assicurativa per:', options: [
      { value: 'MO', label: 'Moto' },
      { value: 'AF35', label: 'Autoveicolo fino a 35 q.li' },
      { value: 'VF35', label: 'Van commerciale fino a 35 q.li' },
      { value: 'TR', label: 'Truck' },
      { value: 'BI', label: 'Bike' }
    ] },
  { domanda: 'INTERESSE_SP_LEG', label: 'Sono interessato alla garanzia opzionale per Spese legali e peritali relative alla Circolazione stradale?', options: YN },
  { domanda: 'MASSIMALI_COERENTI', label: 'Le somme assicurate/massimali e la durata previste dalla polizza assicurativa sono coerenti con la mia esigenza di protezione?', options: YN },
  { domanda: 'INFO_TECNICHE', label: 'Sono informato sulla possibile presenza nella polizza assicurativa di Scoperti/Franchigie/Carenze/Limiti/Esclusioni?', options: YN }
]

// Tabella premi per codice configurazione (valori dal modulo di adesione).
export const DEFAULT_PREZZI = {
  '00001': { pacchetto: 'A', premio: '22,50' },
  '00002': { pacchetto: 'B', premio: '20,00' },
  '00003': { pacchetto: 'C', premio: '39,00' }
}
