# Probe STAGED fix — caso B (RC PROF MED V2)

- Modello: qwen2.5:7b-instruct · Ollama: http://192.168.37.10:11434 · strategia staged-gruppi
- **Punteggio: 12/28** (ok=6 · emptyOk=6 · wrong=13 · missing=3)

## Campo per campo

| campo | label | atteso | estratto | esito |
|---|---|---|---|---|
| `polizza_numero` | N° Polizza | `RCM00010027822` | `RCM00010027822` | OK |
| `compagnia` | Compagnia | `AmTrust Assicurazioni S.p.A.` | `Amtrust Assicurazioni S.p.A.` | OK |
| `contraente` | Contraente/Assicurato | `MAURO CARLO NEBULONI` | `MAURO CARLO NEBULONI` | OK |
| `codice_fiscale_iva` | P. IVA / Cod. Fiscale | `NBLMCR58L23D0033D (dedotto dal testo)` | `NBLMCR58L23D033D` | WRONG |
| `indirizzo` | Indirizzo | `VIA AMENDOLA 8 - ABBIATEGRASSO (MI) 20081` | `VIA AMENDOLA,8, ABBIATEGRASSO` | WRONG |
| `agenzia` | Agenzia | `SIMPLECLICK/ITALIA AGENCY` | `ABBIATEGRASSO` | WRONG |
| `decorrenza` | Decorrenza | `14/10/2021` | `14/10/2025` | WRONG |
| `scadenza` | Scadenza | `14/10/2025` | `14/10/2026` | WRONG |
| `rcp_imposta` | Tacito Rinnovo | `Sì` | `si` | OK |
| `rcp_premio_totale` | Premio lordo | `3.499,00` | `2.862,16` | WRONG |
| `rcp_premio_imponibile` | Frazionamento | `Annuale` | `annuale` | OK |
| `attivita` | Professione dichiarata | `Attività libero professionale assicurata: Radiodiagnostica (esclusa mammografia)` | `Reumatologia, Medicina dello sport, Oculistica - oftalmologia (esclusa chirurgia estetica), Otorinolaringoiatria (esclusa chirurgia estetica), Oculistica - oftalmologia inclusa chirurgia estetica pertinente, Otorinolaringoiatria inclusa chirurgia estetica pertinente, Chirurgia oncologica ortopedica, Chirurgia ricostruttiva, Chirurgia oncologica e senologica, Ginecologia 7 : con fecondazione - assistita I, Chirurgia maxillo facciale (esclusa chirurgia estetica), Chirurgia andrologica, Chirurgia urologica, Chirurgia maxillo facciale inclusa chirurgia estetica pertinente, Chirurgia addominale, Chirurgia bariatrica, Chirurgia pediatrica, Chirurgia proctologica, Chirurgia dell'apparato digerente - gastroenterologia, Nefrologia chirurgica, Chirurgia ginecologica (esclusa ostetricia), Chirurgia fetale, Pediatria = con neonatologia - e TIN, Chirurgia della mano, Cardiochirurgia, Chirurgia estetica plastica, Ginecologia e ostetricia con assistenza al parto, Ortopedia - con traumatologia - (esclusi - interventi o spinali), Chirurgia addominale, Chirurgia bariatrica, Chirurgia pediatrica, Chirurgia proctologica, Chirurgia dell'apparato digerente - gastroenterologia, Nefrologia chirurgica, Chirurgia ginecologica (esclusa ostetricia), Chirurgia fetale, Pediatria = con neonatologia - e TIN, Chirurgia della mano, Cardiochirurgia, Chirurgia estetica plastica, Ginecologia e ostetricia con assistenza al parto, Ortopedia - con traumatologia - (esclusi - interventi o spinali)` | WRONG |
| `e1d90f78-3e3a-4e42-be90-001b8c34c05a` | Fatturato dichiarato | `non presente` | `` | EMPTY-ok |
| `c125c0d1-695b-4755-81db-e99137169686` | Retroattività | `da data specifica (illimitata? non chiaro)` | `10 anni limitata` | WRONG |
| `89ffb116-bf3b-4bcb-a6bb-7ceeed04cfee` | Data retroattività | `14/10/2014` | `01/07/2025` | WRONG |
| `6e39add8-de2c-4d48-b231-f03cd4e05bd5` | Sinistri e circostanze | `1 sinistro dichiarato (scheda/quietanza: Richieste di risarcimento - Sì)` | `Reumatologia, Medicina dello sport, Oculistica - oftalmologia (esclusa chirurgia estetica), Otorinolaringoiatria (esclusa chirurgia estetica), Oculistica - oftalmologia inclusa chirurgia estetica pertinente, Otorinolaringoiatria inclusa chirurgia estetica pertinente, Chirurgia oncologica ortopedica, Chirurgia ricostruttiva, Chirurgia oncologica e senologica, Ginecologia 7 : con fecondazione - assistita I, Chirurgia maxillo facciale (esclusa chirurgia estetica), Chirurgia andrologica, Chirurgia urologica, Chirurgia maxillo facciale inclusa chirurgia estetica pertinente, Chirurgia addominale, Chirurgia bariatrica, Chirurgia pediatrica, Chirurgia proctologica, Chirurgia dell'apparato digerente - gastroenterologia, Nefrologia chirurgica, Chirurgia ginecologica (esclusa ostetricia), Chirurgia fetale, Pediatria = con neonatologia - e TIN, Chirurgia della mano, Cardiochirurgia, Chirurgia estetica plastica, Ginecologia e ostetricia con assistenza al parto, Ortopedia - con traumatologia - (esclusi - interventi o spinali), Ortopedia  con traumatologia inclusi interventi spinali` | WRONG |
| `rct_massimale_sinistro` | Massimale per sinistro | `2.000.000,00` | `2.000.000,00` | OK |
| `rct_massimale_persona` | Massimale annuo | `6.000.000,00` | `` | MISSING |
| `rct_massimale_danni` | Franchigia base | `10.000,00` | `` | MISSING |
| `rct_massimale_prestatore` | Scoperto base | `non indicato` | `10.000,00` | WRONG |
| `rct_parametro` | Sottolimiti | `Ruolo apicale e direzione sanitaria - perdite patrimoniali € 200.000,00` | `Altre Perdite Patrimoniali  e conduzione  dello studio (RCT-RCO)` | WRONG |
| `rct_importo_preventivo` | Estensioni operative | `Medicina estetica NO; Attività invasive minori Sì; Attività invasive e mezzi di soccorso Sì; Ruolo apicale e direzione sanitaria - Perdite patrimoniali 200.000,00` | `Altre Perdite Patrimoniali e conduzione dello studio (RCT-RCO)` | WRONG |
| `rct_tasso` | Esclusioni particolari | `non presente (esclusioni non riportate in scheda; rimando alle condizioni di polizza del Set Informativo)` | `` | EMPTY-ok |
| `rct_premio_imponibile` | Condizioni particolari, aggiuntive | `Sottoscrizione della polizza firmata il 09/10/2024 presso Milano; tacito rinnovo, annuale; efficacia decorrenza/scadenza` | `` | MISSING |
| `rcp_scoperto_min_mondo` | Tutela | `non presente` | `` | EMPTY-ok |
| `c23c8480-d1bd-4ed7-adb2-f0b0dd999308` | Massimale Tutela | `non presente` | `` | EMPTY-ok |
| `6d1e131a-9700-4409-85b9-e476de07204e` | Franchigia Tutela | `non presente` | `` | EMPTY-ok |
| `0df0e5bc-c285-444f-a653-b8dbe1daab16` | Premio Lordo Tutela | `non presente` | `` | EMPTY-ok |

Legenda: OK/OK-text = corretto · EMPTY-ok = atteso assente e resta vuoto · MISSING = atteso valorizzato ma manca · WRONG = presente ma errato.
