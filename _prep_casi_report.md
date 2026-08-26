# Report preparazione casi — run A/B esteso (varietà di polizze)

**Data**: 2026-08-25
**Scopo**: selezionare 3 casi (A: RC professionale, B: medico se idoneo, C: da scartare) e produrre i VALORI ATTESI con FONTE per i campi dei profili.

---

## Sintesi dei 3 casi

| Caso | Fascicolo | Cartella | Zip | Profilo |
|---|---|---|---|---|
| **A** | CEDAM ITALIA SRL — RC Professionale (RCT/O rischi sanitari privati) | `…1/in vigore/` | zip 1 | **Rc Professionale V3** (35 campi) |
| **B** | NEBULONI MAURO CARLO — RC Professionale Medico (AmTrust Medico Protetto) | `…2/in vigore 3/` | zip 2 | **RC PROF MED V2** (28 campi) |
| **C** (da scartare) | Cond Via della libertà 55 — Globale Fabbricati | `…1/Cond Via della libertà 55/` | zip 1 | nessuno → mismatch |

---

## Scelte e motivazioni

### Caso A — CARATTERISTICHE: RC professionale con profilo «Rc Professionale V3»

Il fascicolo **CEDAM** (zip1 `in vigore/`) è stato scelto come caso A rispetto a **Nebuloni** (zip2 `in vigore 3/`):

- Il **fascicolo Cedam** è il più **corposo e diversificato**: contiene la **polizza base** (con massimali, attività, dichiarazioni, condizioni aggiuntive), **2 atti di variazione** (2018 aumento massimale a 5.000.000, 2019 aumento a 7.500.000 + franchigia frontale 20.000), **regolazione premio R9** (31/12/2023-31/12/2024), **applicazione di regolazione R10** (31/12/2024-31/12/2025 con fatturato consuntivo 8.045.000), la **quietanza 25/26** (premio lordo 13.068,01, scadenza 31/12/2026, tacito rinnovo SI) e il **questionario assuntivo**. Copre quasi tutti i 35 campi del profilo V3 con valori reali e distribuiti su più documenti (utile a testare il motore a stadi e la regola "documenti tutti uguali").
- È il profilo «Rc Professionale V3» per eccellenza: RCT/RCO con massimali per sinistro **7.500.000 €**, franchigia frontale **20.000 €**, fatturato/retribuzioni per regolazione, ecc.
- **Nebuloni** (AmTrust Medico Protetto, RCM00010027822) è invece una RC professionale del singolo medico, più simile al profilo «RC PROF MED V2»; è stato quindi destinato al **caso B**.

**PDF richiedenti OCR**: `dichiarazione.pdf` è **solo immagine** (nessun testo estraibile). Tutti gli altri 8 PDF hanno testo nativo e sono stati estratti.

### Caso B — valutazione del fascicolo medico

- **`Set_Informativo_AmTrust_Medico_Protetto_Ed062024_Agg072025.pdf`** è un **Set Informativo** (prodotto/condizioni generali), **senza** numero polizza, contraente/assicurato specifico, premi o massimali di un assicurato reale. **NON** è una polizza → **scartato per RC PROF MED V2**.
- **`Spese Mediche/Polizza europ 17.07.2026 - 23.07.2026.pdf`** è una polizza **MULTIRISCHI temporanea "Medico No Stop Italy"** (assistenza + rimborso spese mediche) intestata a **PARMA CALCIO 1913 SRL** per un calciatore; ha dati di tipo *assistenza sanitaria/società sportiva*, non di RC professionale medica. **Scartato**.
- Il fascicolo **`in vigore 3/Nebuloni Mauro Carlo — Rc Professionale — Polizza.pdf`** (AmTrust Medico Protetto) è una **vera RC professionale del medico** con tutti i dati richiesti → **scelto come Caso B**.

Quindi, diversamente dalla nota del briefing (che indicava la Set Informativa come unico candidato medico di zip2), il caso B corretto è il **fascicolo Nebuloni**, che si adatta perfettamente al profilo **RC PROF MED V2**.

### Caso C — fascicolo da scartare (pre-check pertinenza)

- Scelto: **`Cond Via della libertà 55 — Globale Fabbricati`** (zip1). È una polizza **multirischio sui beni** (Globale Fabbricati) di un condominio: nessun dato di RC professionale/medica, nessun contraente con attività professionale/fatturato.
- **Motivo mismatch**: assenza totale di keyword RC/mediche e di campi compatibili con i profili → atteso `mismatch` (keyword/semantic). Solo se il pre-check è disattivato potrebbe diventare estrazione fallita/vuota.
- Altri candidati da scartare equivalenti: `DiGrazia` (Globale abitazione), `Formiga RCA` (RC auto), `Bipolari` (RCT associazione), `Marini Asset`, `Specadent` (RCT-RCO), `2C ODON` (RC Sara odontoiatra).

**Osservazione per il pre-check**: i profili che andranno in `mismatch` per il caso C sono principalmente **Rc Professionale V3** e **RC PROF MED V2**, gli unici abilitati in questi run. Il motivo atteso è **assenza di keyword (keyword/semantic/llm)**.

---

## CASO A — CEDAM ITALIA SRL — Valori attesi per «Rc Professionale V3» (35 campi)

> Fonte = nome file (tutti in `zip1/in vigore/`), tra parentesi la pagina del PDF.

| Campo (id) | Label | Valore atteso | Fonte |
|---|---|---|---|
| `polizza_numero` | N° Polizza | **781949596** (sostituisce 6001103839253) | `Cedam Italia - Rcto - atto 2019…` p.2 (frontespizio polizza storica: 6001103839253) |
| `compagnia` | Compagnia | **UnipolSai Assicurazioni S.p.A.** (storica: MILANO ASSICURAZIONI S.p.A.) | `atto 2019…` p.2; `polizza` p.1 |
| `contraente` | Contraente/Assicurato | **CEDAM ITALIA SRL** | `polizza` p.1 |
| `codice_fiscale_iva` | P. IVA / Cod. Fiscale | **00587800137** | `polizza` p.1 |
| `indirizzo` | Indirizzo | **VIA CERVA 22 — 20122 MILANO** | `q.za 25 26` p.1; `polizza` p.11 (più sedi) |
| `agenzia` | Agenzia | **CSA-CONSULENZE & SOLUZIONI AZIENDALI SRL** (canale broker; storica Marenghi/Gerenza Milano) | `q.za 25 26` p.1 |
| `decorrenza` | Decorrenza | **01/07/2010** (polizza; rinnovi annuali) | `polizza` p.1 |
| `scadenza` | Scadenza | **31/12/2026** (rata corrente) | `q.za 25 26` p.1 |
| `rcp_imposta` | Tacito Rinnovo | **Sì** | `q.za 25 26` p.1 |
| `rcp_premio_totale` | Premio lordo | **13.068,01** (annuale; rate succ. 10.689,58+2.378,43) | `atto 2019…` p.1 |
| `rcp_premio_imponibile` | Frazionamento | **Annuale** | `atto 2019…` p.1 |
| `attivita` | Professione dichiarata | **Centri diagnostici CEDAM ITALIA SRL** (prelievi, esami sangue, radiologici, MOC, ecografia, cardiologia, ecc.) | `polizza` p.11 |
| `e1d90f78…` | Fatturato dichiarato | **8.045.000,00** (consuntivo retribuzioni R10) | `Rcto - regolazione premio 2024` p.1 |
| `c125c0d1…` | Retroattività | **non indicato** | — |
| `89ffb116…` | Data retroattività | **non indicato** | — |
| `6e39add8…` | Sinistri e circostanze | **nessun sinistro dichiarato** | `polizza` p.21 |
| `rct_massimale_sinistro` | Massimale per sinistro | **7.500.000,00** | `atto 2019…` p.2 |
| `rct_massimale_persona` | Massimale annuo | **7.500.000,00** (aggregato/annuo) | `atto 2019…` p.2 |
| `rct_massimale_danni` | Franchigia base | **20.000,00** (frontale, ogni tipo danno, incl. cond. aggiuntiva A) | `atto 2019…` p.2 |
| `rct_massimale_prestatore` | Scoperto base | **non indicato** (scoperti disponibili solo su estensioni: G 10% min 1.000, Q 10% min 500 max 10.000, L 10% min 1.500 max 10.000) | `polizza` p.25/p.27 |
| `rct_parametro` | Sottolimiti | **RCT 2.000.000/persona e 2.000.000 cose; RCO 2.000.000/infortunato; AIDS/HIV max 260.000; fonti radioattive max 260.000; errato trattamento dati 52.000; parcheggi franchigia 154,94; committenza auto franchigia 260; acqua/condutture franchigia 250 e limite 160.000; medico competente max 260.000** | `polizza` p.1/p.16/p.18/p.25/p.27 |
| `rct_importo_preventivo` | Estensioni operative | **A/A1 RC personale non dipendente; G errato trattamento dati; F fonti radioattive; L RC direttore sanitario; Q medico del lavoro/competente; attività complementari** (condizioni aggiuntive A-A1-F-G-I-L-Q) | `polizza` p.1/p.23/p.25/p.27 |
| `rct_tasso` | Esclusioni particolari | **furto; cose in consegna/custodia; assestamenti/cedimenti terreno; interruzioni attività; opere in costruzione; inquinamento/falde; internet provider; energia atomica; esplosivi; interventi chirurgici; danni estetici; implantologia; fonti radioattive (salvo estensione F); sperimentazione/riproduzione assistita** | `polizza` p.14/p.15 |
| `rct_premio_imponibile` | Condizioni particolari | **atti 2018/2019 (massimali 5.000.000→7.500.000 + franchigia 20.000 + tasso 3,26‰); app R9/R10 regolazione premio; clausola broker; tacito rinnovo SI; regolazione premio SI** | `regolazione premio 2024` p.1; `atto 2019` p.2 |
| `rct_imposta` | Visto leggero | **non indicato** | — |
| `rct_premio_totale` | Massimale visto leggero | **non indicato** | — |
| `rcp_prodotti` | Sindaco / Revisore | **non presente** | — |
| `rcp_qualifica` | ODV / CDA | **non presente** | — |
| `rcp_massimale_sinistro` | Progettazione / DL | **non presente** | — |
| `rcp_massimale_annuo` | Legge Merloni / Appalti | **non presente** | — |
| `rcp_massimale_mat` | Visto pesante / bonus edilizi | **non presente** | — |
| `rcp_massimale_interr` | Massimale visto pesante | **non presente** | — |
| `rcp_scoperto_min_mondo` | Attività giudiziale / stragiudiziale | **non presente** | — |
| `rcp_scoperto_max_mondo` | Incarichi giudiziari | **non presente** | — |
| `rcp_scoperto_min_usa` | Custodia documenti / valori | **non presente** | — |

---

## CASO B — NEBULONI MAURO CARLO — Valori attesi per «RC PROF MED V2» (28 campi)

> Fonte = `Nebuloni Mauro Carlo - Rc Professionale - Polizza.pdf` (in `zip2/in vigore 3/`), tra parentesi la pagina.

| Campo (id) | Label | Valore atteso | Fonte |
|---|---|---|---|
| `polizza_numero` | N° Polizza | **RCM00010027822** | p.1 |
| `compagnia` | Compagnia | **AmTrust Assicurazioni S.p.A.** | p.1 |
| `contraente` | Contraente/Assicurato | **MAURO CARLO NEBULONI** | p.1 |
| `codice_fiscale_iva` | P. IVA / Cod. Fiscale | **NBLMCR58L23D0033D** (testo molto corrotto, da verificare a video) | p.1 |
| `indirizzo` | Indirizzo | **VIA AMENDOLA 8 — ABBIATEGRASSO (MI) 20081** | p.1 |
| `agenzia` | Agenzia | **SIMPLECLICK/ITALIA AGENCY** (intermediario; da verificare a video) | p.1 |
| `decorrenza` | Decorrenza | **14/10/2021** (il testo è frammentario, coerente con scadenza/prossima quietanza 14/10/2025; verificare) | p.1 |
| `scadenza` | Scadenza | **14/10/2025** (prossima quietanza 14/10/2025) | p.1 |
| `rcp_imposta` | Tacito Rinnovo | **Sì** | p.1 |
| `rcp_premio_totale` | Premio lordo | **3.499,00** (imponibile 2.862,16 + imposte 636,84) | p.1 |
| `rcp_premio_imponibile` | Frazionamento | **Annuale** | p.1 |
| `attivita` | Professione dichiarata | **Radiodiagnostica (esclusa mammografia)** | p.2 |
| `e1d90f78…` | Fatturato dichiarato | **non presente** | — |
| `c125c0d1…` | Retroattività | **da data specifica** (non meglio esplicita in scheda) | p.2 |
| `89ffb116…` | Data retroattività | **14/10/2014** | p.2 (questionario) |
| `6e39add8…` | Sinistri e circostanze | **1 sinistro dichiarato** («Richieste di risarcimento: Sì», negli ultimi 5 anni) | p.4 |
| `rct_massimale_sinistro` | Massimale per sinistro | **2.000.000,00** | p.2 |
| `rct_massimale_persona` | Massimale annuo | **6.000.000,00** (per periodo/seria di sinistri) | p.2 |
| `rct_massimale_danni` | Franchigia base | **10.000,00** | p.2 |
| `rct_massimale_prestatore` | Scoperto base | **non indicato** | — |
| `rct_parametro` | Sottolimiti | **Ruolo apicale e direzione sanitaria — perdite patrimoniali 200.000,00** | p.2 |
| `rct_importo_preventivo` | Estensioni operative | **Medicina estetica NO; Attività invasive minori Sì; Attività invasive e mezzi di soccorso Sì; Ruolo apicale e direzione sanitaria (perdite patrimoniali 200.000)** | p.2 |
| `rct_tasso` | Esclusioni particolari | **non presenti in scheda** (rimando alle Condizioni di Assicurazione, non allegate) | — |
| `rct_premio_imponibile` | Condizioni particolari | **Sottoscrizione 09/10/2024 (Milano); tacito rinnovo annuale; Set Informativo Ed 06/2024 Agg 07/2025** | p.5 |
| `rcp_scoperto_min_mondo` | Tutela | **non presente** | — |
| `c23c8480…` | Massimale Tutela | **non presente** | — |
| `6d1e131a…` | Franchigia Tutela | **non presente** | — |
| `0df0e5bc…` | Premio Lordo Tutela | **non presente** | — |

Note:
- Il PDF Nebuloni ha **testo nativo ma molto corrotto/assemblato** (font embedded, colonne); per i campi anche indicati come "da verificare a video" (codice fiscale, agenzia, decorrenza) la fonte è attendibile ma va controllata visivamente. I valori principali (n. polizza, massimali, franchigia, premio) sono sicuri.
- La **quietanza 2025** del Nebuloni è un semplice attestato di firma (1 riga) e non contiene dati utili.

---

## PDF che richiedono OCR (solo immagine)

- **Caso A**: `in vigore/dichiarazione.pdf` → **solo immagine, richiede OCR** (1 pagina, nessun testo).
- **Caso B**: nessuno (fascicolo Nebuloni tutto con testo).
- Spese Mediche/PARMA CALCIO e Set Informativo: testo nativo presente.

---

## File prodotti

- `_prep_casi_report.json` — struttura dati macchina (casi + valori attesi + scartato).
- `_prep_casi_report.md` — questo report.

Nessuna modifica a `src/`, `web/`, `test/`.