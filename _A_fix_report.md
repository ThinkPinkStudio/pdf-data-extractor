# Probe STAGED fix — caso A (Rc Professionale V3)

- Modello: qwen2.5:7b-instruct · Ollama: http://192.168.37.10:11434 · strategia staged-gruppi
- **Punteggio: 17/35** (ok=10 · emptyOk=7 · wrong=12 · missing=6)

## Campo per campo

| campo | label | atteso | estratto | esito |
|---|---|---|---|---|
| `polizza_numero` | N° Polizza | `781949596` | `781949596` | OK |
| `compagnia` | Compagnia | `UnipolSai Assicurazioni S.p.A.` | `Unipol Assicurazioni S.p.A.` | WRONG |
| `contraente` | Contraente/Assicurato | `CEDAM ITALIA SRL` | `Cedam Italia SRL` | OK |
| `codice_fiscale_iva` | P. IVA / Cod. Fiscale | `00587800137` | `00587800137` | OK |
| `indirizzo` | Indirizzo | `VIA CERVA 22 - 20122 MILANO` | `VIA CERVA, 22 - 20122 MILANO` | OK |
| `agenzia` | Agenzia | `CSA-CONSULENZE & SOLUZIONI AZIENDALI SRL` | `S. Donato M.` | WRONG |
| `decorrenza` | Decorrenza | `01/07/2010` | `` | MISSING |
| `scadenza` | Scadenza | `31/12/2026` | `31/12/2026` | OK |
| `rcp_imposta` | Tacito Rinnovo | `Sì` | `` | MISSING |
| `rcp_premio_totale` | Premio lordo | `13.068,01` | `13.068,01` | OK |
| `rcp_premio_imponibile` | Frazionamento | `Annuale` | `` | MISSING |
| `attivita` | Professione dichiarata | `Centri diagnostici CEDAM ITALIA SRL; prelievi ed esami del sangue, esami radiologici, mammografie, MOC, ecografia, ecocolor doppler, ecocardiografia, visite specialistiche di cardiologia/angiologia/dermatologia/ginecologia/oculistica/ortopedia/otorinolaringoiatria/medicina del lavoro` | `Strutture sanitarie` | WRONG |
| `e1d90f78-3e3a-4e42-be90-001b8c34c05a` | Fatturato dichiarato | `8.045.000,00` | `8.045.000,00` | OK |
| `c125c0d1-695b-4755-81db-e99137169686` | Retroattività | `non indicato` | `` | EMPTY-ok |
| `89ffb116-bf3b-4bcb-a6bb-7ceeed04cfee` | Data retroattività | `non indicato` | `31/12/2025` | WRONG |
| `6e39add8-de2c-4d48-b231-f03cd4e05bd5` | Sinistri e circostanze | `nessun sinistro dichiarato` | `` | EMPTY-ok |
| `rct_massimale_sinistro` | Massimale per sinistro | `7.500.000,00` | `7.500.000,00` | OK |
| `rct_massimale_persona` | Massimale annuo | `7.500.000,00` | `7.500.000,00` | OK |
| `rct_massimale_danni` | Franchigia base | `20.000,00` | `20.000,00` | OK |
| `rct_massimale_prestatore` | Scoperto base | `non indicato` | `7.500.000,00` | WRONG |
| `rct_parametro` | Sottolimiti | `RCT 2.000.000 per persona e 2.000.000 per danni a cose; RCO 2.000.000 per infortunato; garanzia AIDS/HIV max € 260.000; fonti radioattive max € 260.000; errato trattamento dati € 52.000; parcheggi franchigia € 154,94; committenza auto franchigia € 260; danni acqua/condutture franchigia € 250 e limite € 160.000; Q medico competente max € 260.000` | `10% per sinistro con minimo di 1.500,00 e massimo di 10.000,00` | WRONG |
| `rct_importo_preventivo` | Estensioni operative | `A/A1 RC personale non dipendente; G errato trattamento dati; F fonti radioattive; L RC direttore sanitario; Q medico igienista e del lavoro/medico competente; garanzia AIDS/HIV, virus C e DELTA; attività complementari (parcheggi, insegne, guardiani, mensa, fiere, macchinari, pulizie, raggi X); condizione aggiuntive A/A1/F/G/I/L/Q` | `` | MISSING |
| `rct_tasso` | Esclusioni particolari | `furto; cose in consegna/custodia; assestamento/franamenti terreno e danni da interruzioni di attività; opere in costruzione; inquinamento e falde; internet provider; energia atomica; esplosivi; interventi chirurgici; danni estetici e fisionomici; implantologia; fonti radioattive (salvo estensione F); sperimentazione clinica e riproduzione assistita (art. 19 e 26)` | `` | MISSING |
| `rct_premio_imponibile` | Condizioni particolari | `atto 2018 aumento massimale a 5.000.000, atto 2019 massimale 7.500.000 + franchigia frontale 20.000 + tasso 3,26‰; app R9 regolazione premio 31/12/2023-31/12/2024; app R10 regolazione 31/12/2024-31/12/2025; clausola broker; tacito rinnovo SI; regolazione premio SI` | `` | MISSING |
| `rct_imposta` | Visto leggero | `non indicato` | `` | EMPTY-ok |
| `rct_premio_totale` | Massimale visto leggero | `non indicato` | `` | EMPTY-ok |
| `rcp_prodotti` | Sindaco / Revisore | `non presente` | `` | EMPTY-ok |
| `rcp_qualifica` | ODV / CDA | `non presente` | `` | EMPTY-ok |
| `rcp_massimale_sinistro` | Progettazione / DL | `non presente` | `7.500.000,00` | WRONG |
| `rcp_massimale_annuo` | Legge Merloni / Appalti | `non presente` | `7.500.000,00` | WRONG |
| `rcp_massimale_mat` | Visto pesante / bonus edilizi | `non presente` | `7.500.000,00` | WRONG |
| `rcp_massimale_interr` | Massimale visto pesante | `non presente` | `7.500.000,00` | WRONG |
| `rcp_scoperto_min_mondo` | Attività giudiziale / stragiudiziale | `non presente` | `` | EMPTY-ok |
| `rcp_scoperto_max_mondo` | Incarichi giudiziari | `non presente` | `7.500.000,00` | WRONG |
| `rcp_scoperto_min_usa` | Custodia documenti / valori | `non presente` | `7.500.000,00` | WRONG |

Legenda: OK/OK-text = corretto · EMPTY-ok = atteso assente e resta vuoto · MISSING = atteso valorizzato ma manca · WRONG = presente ma errato.
