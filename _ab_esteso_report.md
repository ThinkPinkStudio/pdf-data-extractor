# A/B esteso — verdetto aggregato

Modello: **qwen2.5:7b-instruct** · num_ctx 24576 · motore a stadi gruppi (perField=false, cascade=false) · constrained JSON schema · precheck: off per A/B, keyword+semantic per C

Ground truth: `_prep_casi_report.json` (`casi[].valoriAttesi`). Confronto normalizzato (spazi/case); atteso "non presente/indicato" ⇒ campo vuoto.

## Caso A — CEDAM ITALIA SRL - RC Professionale (RCT/RCO rischi sanitari)

Profilo: Rc Professionale V3 · esito: **7/35 OK** (di cui 6 vuoti-corretti) · 21 sbagliati · 1 mancanti

| Campo | Label | Valore atteso | Fonte attesa | Estratto | Fonte estratta | Esito |
|-------|-------|---------------|--------------|----------|----------------|-------|
| polizza_numero | N° Polizza | 781949596 | Cedam Italia - Rcto - atto 2019 aumento massimale + inserim. franchigia front..pdf · pag.2 | 781949596 | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | OK |
| compagnia | Compagnia | UnipolSai Assicurazioni S.p.A. | Cedam Italia - Rcto - atto 2019 aumento massimale + inserim. franchigia front..pdf · pag.2 | Unipol Assicurazioni S.p.A. | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | WRONG |
| contraente | Contraente/Assicurato | CEDAM ITALIA SRL | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | IL CONTRAENTE | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.9 | WRONG |
| codice_fiscale_iva | P. IVA / Cod. Fiscale | 00587800137 | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | 00587800137 | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | OK |
| indirizzo | Indirizzo | VIA CERVA 22 - 20122 MILANO | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | VIA CERVA, 22 - 20122 MILANO | dichiarazione.pdf · pag.1 | OK |
| agenzia | Agenzia | CSA-CONSULENZE & SOLUZIONI AZIENDALI SRL | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | S. Donato M. (MI) | Cedam Italia - Rcto - regolazione premio 2024.pdf · pag.1 | WRONG |
| decorrenza | Decorrenza | 01/07/2010 | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | 31/12/2025 | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | WRONG |
| scadenza | Scadenza | 31/12/2026 | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | 31/12/2026 | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf | OK |
| rcp_imposta | Tacito Rinnovo | Sì | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | 0 | dichiarazione.pdf | WRONG |
| rcp_premio_totale | Premio lordo | 13.068,01 | Cedam Italia - Rcto - atto 2019 aumento massimale + inserim. franchigia front..pdf · pag.1 | — | — | MISSING |
| rcp_premio_imponibile | Frazionamento | Annuale | Cedam Italia - Rcto - atto 2019 aumento massimale + inserim. franchigia front..pdf · pag.1 | 0 | dichiarazione.pdf | WRONG |
| attivita | Professione dichiarata | Centri diagnostici CEDAM ITALIA SRL; prelievi ed esami del sangue, esami radiologici, mammografie, MOC, ecografia, ecocolor doppler, ecocardiografia, visite specialistiche di cardiologia/angiologia/dermatologia/ginecologia/oculistica/ortopedia/otorinolaringoiatria/medicina del lavoro | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.11 | CENTRI DIAGNOSTICI | Nuovo Questionario Assuntivo Strutture Sanitarie.pdf · pag.1 | WRONG |
| e1d90f78-3e3a-4e42-be90-001b8c34c05a | Fatturato dichiarato | 8.045.000,00 | Cedam Italia - Rcto - regolazione premio 2024.pdf · pag.1 | 4.000.000,00 | Cedam Italia - Rcto - atto 2018 aumento massimale.pdf · pag.2 | WRONG |
| c125c0d1-695b-4755-81db-e99137169686 | Retroattività | non indicato | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | — | — | EMPTY-ok |
| 89ffb116-bf3b-4bcb-a6bb-7ceeed04cfee | Data retroattività | non indicato | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | — | — | EMPTY-ok |
| 6e39add8-de2c-4d48-b231-f03cd4e05bd5 | Sinistri e circostanze  | nessun sinistro dichiarato | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.21 | CENTRI DIAGNOSTICI | dichiarazione.pdf · pag.1 | WRONG |
| rct_massimale_sinistro | Massimale per sinistro | 7.500.000,00 | Cedam Italia - Rcto - atto 2019 aumento massimale + inserim. franchigia front..pdf · pag.2 | 7.500.000,00 | dichiarazione.pdf · pag.1 | OK |
| rct_massimale_persona | Massimale annuo | 7.500.000,00 | Cedam Italia - Rcto - atto 2019 aumento massimale + inserim. franchigia front..pdf · pag.2 | 7.500.000,00 | dichiarazione.pdf · pag.1 | OK |
| rct_massimale_danni | Franchigia base | 20.000,00 | Cedam Italia - Rcto - atto 2019 aumento massimale + inserim. franchigia front..pdf · pag.2 | 20.000,00 | cedam16032026092828.pdf · pag.2 | OK |
| rct_massimale_prestatore | Scoperto base | non indicato | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | 1.000,00 | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.25 | WRONG |
| rct_parametro | Sottolimiti | RCT 2.000.000 per persona e 2.000.000 per danni a cose; RCO 2.000.000 per infortunato; garanzia AIDS/HIV max € 260.000; fonti radioattive max € 260.000; errato trattamento dati € 52.000; parcheggi franchigia € 154,94; committenza auto franchigia € 260; danni acqua/condutture franchigia € 250 e limite € 160.000; Q medico competente max € 260.000 | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | franchigia frontale per ogni tipo di danno di € 20.000 | Cedam Italia - Rcto - atto 2019 aumento massimale + inserim. franchigia front..pdf · pag.2 | WRONG |
| rct_importo_preventivo | Estensioni operative | A/A1 RC personale non dipendente; G errato trattamento dati; F fonti radioattive; L RC direttore sanitario; Q medico igienista e del lavoro/medico competente; garanzia AIDS/HIV, virus C e DELTA; attività complementari (parcheggi, insegne, guardiani, mensa, fiere, macchinari, pulizie, raggi X); condizione aggiuntive A/A1/F/G/I/L/Q | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.23 | 7.500.000,00 | dichiarazione.pdf · pag.1 | WRONG |
| rct_tasso | Esclusioni particolari | furto; cose in consegna/custodia; assestamento/franamenti terreno e danni da interruzioni di attività; opere in costruzione; inquinamento e falde; internet provider; energia atomica; esplosivi; interventi chirurgici; danni estetici e fisionomici; implantologia; fonti radioattive (salvo estensione F); sperimentazione clinica e riproduzione assistita (art. 19 e 26) | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.14 | 0 | dichiarazione.pdf | WRONG |
| rct_premio_imponibile | Condizioni particolari | atto 2018 aumento massimale a 5.000.000, atto 2019 massimale 7.500.000 + franchigia frontale 20.000 + tasso 3,26‰; app R9 regolazione premio 31/12/2023-31/12/2024; app R10 regolazione 31/12/2024-31/12/2025; clausola broker; tacito rinnovo SI; regolazione premio SI | Cedam Italia - Rcto - regolazione premio 2024.pdf · pag.1 | 0 | dichiarazione.pdf | WRONG |
| rct_imposta | Visto leggero | non indicato | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | 0 | dichiarazione.pdf | EMPTY-ok |
| rct_premio_totale | Massimale visto leggero | non indicato | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | — | — | EMPTY-ok |
| rcp_prodotti | Sindaco / Revisore | non presente | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | — | — | EMPTY-ok |
| rcp_qualifica | ODV / CDA | non presente | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | — | — | EMPTY-ok |
| rcp_massimale_sinistro | Progettazione / DL | non presente | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | 7.500.000,00 | dichiarazione.pdf · pag.1 | WRONG |
| rcp_massimale_annuo | Legge Merloni / Appalti | non presente | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | 7.500.000,00 | dichiarazione.pdf · pag.1 | WRONG |
| rcp_massimale_mat | Visto pesante / bonus edilizi | non presente | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | 7.500.000,00 | dichiarazione.pdf · pag.1 | WRONG |
| rcp_massimale_interr | Massimale visto pesante | non presente | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | 7.500.000,00 | dichiarazione.pdf · pag.1 | WRONG |
| rcp_scoperto_min_mondo | Attività giudiziale / stragiudiziale | non presente | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | 7.500.000,00 | dichiarazione.pdf · pag.1 | WRONG |
| rcp_scoperto_max_mondo | Incarichi giudiziari | non presente | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | 7.500.000,00 | dichiarazione.pdf · pag.1 | WRONG |
| rcp_scoperto_min_usa | Custodia documenti / valori | non presente | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | 7.500.000,00 | dichiarazione.pdf · pag.1 | WRONG |

Campi sbagliati: compagnia, contraente, agenzia, decorrenza, rcp_imposta, rcp_premio_imponibile, attivita, e1d90f78-3e3a-4e42-be90-001b8c34c05a, 6e39add8-de2c-4d48-b231-f03cd4e05bd5, rct_massimale_prestatore, rct_parametro, rct_importo_preventivo, rct_tasso, rct_premio_imponibile, rcp_massimale_sinistro, rcp_massimale_annuo, rcp_massimale_mat, rcp_massimale_interr, rcp_scoperto_min_mondo, rcp_scoperto_max_mondo, rcp_scoperto_min_usa

## Caso B — NEBULONI MAURO CARLO - RC Professionale Medico (AmTrust Medico Protetto)

Profilo: RC PROF MED V2 · esito: **4/28 OK** (di cui 5 vuoti-corretti) · 13 sbagliati · 6 mancanti

| Campo | Label | Valore atteso | Fonte attesa | Estratto | Fonte estratta | Esito |
|-------|-------|---------------|--------------|----------|----------------|-------|
| polizza_numero | N° Polizza | RCM00010027822 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | — | — | MISSING |
| compagnia | Compagnia | AmTrust Assicurazioni S.p.A. | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | AmTrust Assicurazioni S.p.A. | NEBULONI CARLO MARIO quietanza 2025.pdf · pag.1 | OK |
| contraente | Contraente/Assicurato | MAURO CARLO NEBULONI | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | MAURO CARLO NEBULONI | NEBULONI CARLO MARIO quietanza 2025.pdf · pag.1 | OK |
| codice_fiscale_iva | P. IVA / Cod. Fiscale | NBLMCR58L23D0033D (dedotto dal testo) | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | NBLMCR58L23D033D | NEBULONI CARLO MARIO quietanza 2025.pdf · pag.1 | WRONG |
| indirizzo | Indirizzo | VIA AMENDOLA 8 - ABBIATEGRASSO (MI) 20081 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | VIA AMENDOLA,8, ABBIATEGRASSO | NEBULONI CARLO MARIO quietanza 2025.pdf · pag.1 | WRONG |
| agenzia | Agenzia | SIMPLECLICK/ITALIA AGENCY | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | SIMPLE ITALIA AGENCY | NEBULONI CARLO MARIO quietanza 2025.pdf · pag.1 | WRONG |
| decorrenza | Decorrenza | 14/10/2021 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | 14/10/2025 | NEBULONI CARLO MARIO quietanza 2025.pdf · pag.1 | WRONG |
| scadenza | Scadenza | 14/10/2025 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | 14/10/2026 | NEBULONI CARLO MARIO quietanza 2025.pdf · pag.1 | WRONG |
| rcp_imposta | Tacito Rinnovo | Sì | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | si | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | OK |
| rcp_premio_totale | Premio lordo | 3.499,00 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | 2.862,16 | NEBULONI CARLO MARIO quietanza 2025.pdf · pag.1 | WRONG |
| rcp_premio_imponibile | Frazionamento | Annuale | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | annuale | NEBULONI CARLO MARIO quietanza 2025.pdf · pag.1 | OK |
| attivita | Professione dichiarata | Attività libero professionale assicurata: Radiodiagnostica (esclusa mammografia) | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | Reumatologia, Medicina dello sport, Oculistica - oftalmologia (esclusa chirurgia estetica), Otorinolaringoiatria (esclusa chirurgia estetica), Oculistica - oftalmologia inclusa chirurgia estetica pertinente, Otorinolaringoiatria inclusa chirurgia estetica pertinente, Chirurgia oncologica ortopedica, Chirurgia ricostruttiva, Chirurgia oncologica e senologica, Ginecologia 7 : con fecondazione - assistita, Chirurgia maxillo facciale (esclusa chirurgia estetica), Chirurgia andrologica, Chirurgia urologica, Chirurgia maxillo facciale inclusa chirurgia estetica pertinente, Chirurgia addominale, Chirurgia bariatrica, Chirurgia pediatrica, Chirurgia proctologica, Chirurgia dell'apparato digerente - gastroenterologia, Nefrologia chirurgica, Chirurgia ginecologica (esclusa ostetricia), Chirurgia fetale, Pediatria = con neonatologia - e TIN, Chirurgia della mano, Cardiochirurgia, Chirurgia estetica plastica, Ginecologia e ostetricia con assistenza al parto, Ortopedia - con traumatologia - (esclusi - interventi o spinali), Chirurgia addominale, Chirurgia bariatrica, Chirurgia pediatrica, Chirurgia proctologica, Chirurgia dell'apparato digerente - gastroenterologia, Nefrologia chirurgica, Chirurgia ginecologica (esclusa ostetricia), Chirurgia fetale, Pediatria = con neonatologia - e TIN, Chirurgia della mano, Cardiochirurgia, Chirurgia estetica plastica, Ginecologia e ostetricia con assistenza al parto, Ortopedia - con traumatologia - (esclusi - interventi o spinali) | — | WRONG |
| e1d90f78-3e3a-4e42-be90-001b8c34c05a | Fatturato dichiarato | non presente | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | 3499,00 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.1 | WRONG |
| c125c0d1-695b-4755-81db-e99137169686 | Retroattività | da data specifica (illimitata? non chiaro) | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | 10 anni limitata | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.11 | WRONG |
| 89ffb116-bf3b-4bcb-a6bb-7ceeed04cfee | Data retroattività | 14/10/2014 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | — | — | MISSING |
| 6e39add8-de2c-4d48-b231-f03cd4e05bd5 | Sinistri e circostanze  | 1 sinistro dichiarato (scheda/quietanza: Richieste di risarcimento - Sì) | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.4 | Contratto di Assicurazione per la Responsabilità Civile Professionale del Medico | NEBULONI CARLO MARIO quietanza 2025.pdf · pag.1 | WRONG |
| rct_massimale_sinistro | Massimale per sinistro | 2.000.000,00 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | — | — | MISSING |
| rct_massimale_persona | Massimale annuo | 6.000.000,00 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | — | — | MISSING |
| rct_massimale_danni | Franchigia base | 10.000,00 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | — | — | MISSING |
| rct_massimale_prestatore | Scoperto base | non indicato | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | 10000,00 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.10 | WRONG |
| rct_parametro | Sottolimiti | Ruolo apicale e direzione sanitaria - perdite patrimoniali € 200.000,00 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | RC MEDICO: 3.499.000,00 | NEBULONI CARLO MARIO quietanza 2025.pdf | WRONG |
| rct_importo_preventivo | Estensioni operative | Medicina estetica NO; Attività invasive minori Sì; Attività invasive e mezzi di soccorso Sì; Ruolo apicale e direzione sanitaria - Perdite patrimoniali 200.000,00 | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | Altre Perdite Patrimoniali e conduzione dello studio (RCT-RCO) | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | WRONG |
| rct_tasso | Esclusioni particolari | non presente (esclusioni non riportate in scheda; rimando alle condizioni di polizza del Set Informativo) | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | — | — | EMPTY-ok |
| rct_premio_imponibile | Condizioni particolari, aggiuntiive | Sottoscrizione della polizza firmata il 09/10/2024 presso Milano; tacito rinnovo, annuale; efficacia decorrenza/scadenza | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.5 | — | — | MISSING |
| rcp_scoperto_min_mondo | Tutela | non presente | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | — | — | EMPTY-ok |
| c23c8480-d1bd-4ed7-adb2-f0b0dd999308 | Massimale Tutela | non presente | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | — | — | EMPTY-ok |
| 6d1e131a-9700-4409-85b9-e476de07204e | Franchigia Tutela | non presente | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | — | — | EMPTY-ok |
| 0df0e5bc-c285-444f-a653-b8dbe1daab16 | Premio Lordo Tutela | non presente | Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf · pag.2 | — | — | EMPTY-ok |

Campi sbagliati: codice_fiscale_iva, indirizzo, agenzia, decorrenza, scadenza, rcp_premio_totale, attivita, e1d90f78-3e3a-4e42-be90-001b8c34c05a, c125c0d1-695b-4755-81db-e99137169686, 6e39add8-de2c-4d48-b231-f03cd4e05bd5, rct_massimale_prestatore, rct_parametro, rct_importo_preventivo

## Caso C — Cond Via della libertà 55 (Globale Fabbricati, DA SCARTARE)

Documenti OCR: cond della libertà 55 - Gloable Fabbricati - polizza .pdf · cond della libertà 55 - Gloable Fabbricati - q.za 25 26.pdf

| Profilo | Mode | Verdetto | Score | Soglia | Motivazione |
|---------|------|----------|-------|--------|-------------|
| Rc Professionale V3 | keywords | **ok** | 0.333 | 0.2 | parole chiave del profilo trovate nel contenuto |
| Rc Professionale V3 | semantic | **ok** | 0.460 | 0.45 | contenuto affine alle descrizioni dei campi |
| Rc Professionale V3 | llm | **mismatch** | 0.111 | 0.2 | tipo rilevato incompatibile col profilo |
| RC PROF MED V2 | keywords | **ok** | 0.333 | 0.2 | parole chiave del profilo trovate nel contenuto |
| RC PROF MED V2 | semantic | **ok** | 0.498 | 0.45 | contenuto affine alle descrizioni dei campi |
| RC PROF MED V2 | llm | **mismatch** | 0.091 | 0.2 | tipo rilevato incompatibile col profilo |

LLM detected per profilo A: {"type":"responsabilità civile terzi e prestatori","keywords":["polizza","assicurazione","condominio","incendio","rischio"]}
LLM detected per profilo B: {"type":"responsabilità civile terzi e prestatori","keywords":["condominio","incendio","responsabilità civile","assicurazione immobili","premio"]}

**Verdetto: solo il pre-check LLM scarta il fascicolo (mismatch) per entrambi i profili. keyword/semantic producono falsi positivi** (soglia keyword ratio>=0.2 matcha "prof"/"med" come sottostringhe; semantic penalizzata dalle descrizioni generiche di anagrafica).
