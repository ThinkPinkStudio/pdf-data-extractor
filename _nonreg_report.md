# Verifica NON-REGRESSIONE — RC PROF MED V2 sul fascicolo CEDAM "in vigore"

Data: 2026-08-25T18:15:07+00:00 · Modello: `qwen2.5:7b-instruct` (num_ctx 24576) · `bge-m3`
Motore: staged-gruppi (perField=false, cascade=false) · constrained JSON · precheck off

## Verdetto

- **Baseline storica: 12/28** (7 corretti + 5 vuoti legittimi nell ultimo run misurato, `_probe_final`)
- **Attuale: 9/28 (di cui 7 vuoti corretti) (== 16 campi corretti + vuoti lecit)**
- **Verdetto: non regressione: >=12 (OK)**

Conteggi: 9 OK · 7 EMPTY-ok · 10 WRONG · 2 MISSING · su 28 campi.

## Campi che prima erano corretti (OK) e ora NON lo sono

| Campo | Label | Prima (valore) | Ora | Causa/Fonte |
|---|---|---|---|---|
| `rcp_premio_totale` | Premio lordo | 13068,01 | 10.689,58 (WRONG) | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 |
| `rct_massimale_sinistro` | Massimale per sinistro | 7.500.000,00 | 20.000,00 (WRONG) | cedam16032026092828.pdf · pag.2 |


## Pezzi che sono valsi peggio del baseline (per merezza)
- `rct_massimale_persona` (Massimale annuo): WRONG→MISSING — 
> Miglioria: `rcp_scoperto_min_mondo` (Tutela) da WRONG a EMPTY-ok.

> Miglioria: `c23c8480-d1bd-4ed7-adb2-f0b0dd999308` (Massimale Tutela) da WRONG a EMPTY-ok.

> Miglioria: `6d1e131a-9700-4409-85b9-e476de07204e` (Franchigia Tutela) da WRONG a EMPTY-ok.

> Miglioria: `0df0e5bc-c285-444f-a653-b8dbe1daab16` (Premio Lordo Tutela) da WRONG a EMPTY-ok.


## Tabella completa (28 campi)

| Campo | Label | Valore atteso | Valore estratto | Fonte estratta | Esito |
|---|---|---|---|---|---|
| `polizza_numero` | N° Polizza | 781949596 | 781949596 | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | **OK** |
| `compagnia` | Compagnia | UNIPOLSAI ASSICURAZIONI S.P.A. | UNIPOL ASSICURAZIONI S.p.A. | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | **WRONG** |
| `contraente` | Contraente/Assicurato | CEDAM ITALIA SRL | CEDAM ITALIA SRL | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | **OK** |
| `codice_fiscale_iva` | P. IVA / Cod. Fiscale | 00587800137 | 00587800137 | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | **OK** |
| `indirizzo` | Indirizzo | VIA CERVA 22 | VIA CERVA, 22, 20122 MILANO | dichiarazione.pdf · pag.1 | **OK** |
| `agenzia` | Agenzia | (non presente) | S. Donato M. | Cedam Italia - Rcto - regolazione premio 2024.pdf · pag.1 | **WRONG** |
| `decorrenza` | Decorrenza | 31/12/2025 | 31/12/2025 | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | **OK** |
| `scadenza` | Scadenza | 31/12/2026 | 31/12/2026 | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf | **OK** |
| `rcp_imposta` | Tacito Rinnovo | Sì | — | — | **MISSING** |
| `rcp_premio_totale` | Premio lordo | 13.068,01 | 10.689,58 | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | **WRONG** |
| `rcp_premio_imponibile` | Frazionamento | annuale | annuale | Cedam Italia Srl - Rc professionale - q.za 25 26.pdf · pag.1 | **OK** |
| `attivita` | Professione dichiarata | CENTRI DIAGNOSTICI | CENTRI DIAGNOSTICI | dichiarazione.pdf · pag.1 | **OK** |
| `e1d90f78-3e3a-4e42-be90-001b8c34c05a` | Fatturato dichiarato | 8.045.000,00 | 4.000.000,00 | Cedam Italia - Rcto - atto 2018 aumento massimale.pdf · pag.2 | **WRONG** |
| `c125c0d1-695b-4755-81db-e99137169686` | Retroattività | (non presente) | — | — | **EMPTY-ok** |
| `89ffb116-bf3b-4bcb-a6bb-7ceeed04cfee` | Data retroattività | (non presente) | — | — | **EMPTY-ok** |
| `6e39add8-de2c-4d48-b231-f03cd4e05bd5` | Sinistri e circostanze  | (non presente) | Ramo di competenza: Responsabilità Civile | app RP CEDAM 24-25.pdf · pag.1 | **WRONG** |
| `rct_massimale_sinistro` | Massimale per sinistro | 7.500.000,00 | 20.000,00 | cedam16032026092828.pdf · pag.2 | **WRONG** |
| `rct_massimale_persona` | Massimale annuo | 7.500.000,00 | — | — | **MISSING** |
| `rct_massimale_danni` | Franchigia base | 20.000,00 | 20.000,00 | cedam16032026092828.pdf · pag.2 | **OK** |
| `rct_massimale_prestatore` | Scoperto base | (non presente) | 1.000,00 | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.25 | **WRONG** |
| `rct_parametro` | Sottolimiti | (non presente) | RCO: 2.000.000,00
RCT: 1.000.000,00 | Nuovo Questionario Assuntivo Strutture Sanitarie.pdf | **WRONG** |
| `rct_importo_preventivo` | Estensioni operative | (non presente) | Preventivo Fatturato 4.000.000,00 | Cedam Italia - Rcto + PROFF - polizza.pdf · pag.1 | **WRONG** |
| `rct_tasso` | Esclusioni particolari | (non presente) | 1,815x* | Cedam Italia - Rcto - atto 2018 aumento massimale.pdf · pag.2 | **WRONG** |
| `rct_premio_imponibile` | Condizioni particolari, aggiuntiive | (non presente) | — | — | **EMPTY-ok** |
| `rcp_scoperto_min_mondo` | Tutela | (non presente) | — | — | **EMPTY-ok** |
| `c23c8480-d1bd-4ed7-adb2-f0b0dd999308` | Massimale Tutela | (non presente) | — | — | **EMPTY-ok** |
| `6d1e131a-9700-4409-85b9-e476de07204e` | Franchigia Tutela | (non presente) | — | — | **EMPTY-ok** |
| `0df0e5bc-c285-444f-a653-b8dbe1daab16` | Premio Lordo Tutela | (non presente) | — | — | **EMPTY-ok** |

## Diagnostica rilevante

- Registro fatti: 1205 voci numeriche su 9 documenti (guardia anti-fantasma, deterministica)
- Guardrail Tutela: nessuna evidenza della garanzia nel fascicolo → "rcp_scoperto_min_mondo" (Tutela) svuotato (meglio vuoto che sbagliato)
- Guardrail Tutela: nessuna evidenza della garanzia nel fascicolo → "c23c8480-d1bd-4ed7-adb2-f0b0dd999308" (Massimale Tutela) svuotato (meglio vuoto che sbagliato)
- Guardrail Tutela: nessuna evidenza della garanzia nel fascicolo → "6d1e131a-9700-4409-85b9-e476de07204e" (Franchigia Tutela) svuotato (meglio vuoto che sbagliato)
- Guardrail Tutela: nessuna evidenza della garanzia nel fascicolo → "0df0e5bc-c285-444f-a653-b8dbe1daab16" (Premio Lordo Tutela) svuotato (meglio vuoto che sbagliato)
- [deterministico] rcp_premio_totale: 10.689,58 (fonte: Cedam Italia Srl - Rc professionale - q.za 25 26.pdf p1 riga 1, conf 0.92)
- [deterministico] e1d90f78-3e3a-4e42-be90-001b8c34c05a: 4.000.000,00 (fonte: Cedam Italia - Rcto - atto 2018 aumento massimale.pdf p2 riga 2, conf 0.9)
- [deterministico] rct_massimale_sinistro: 20.000,00 (fonte: cedam16032026092828.pdf p2 riga 2, conf 0.95)
- [deterministico] rct_massimale_danni: 20.000,00 (fonte: cedam16032026092828.pdf p2 riga 2, conf 0.95)
- [deterministico] rct_massimale_prestatore: 1.000,00 (fonte: Cedam Italia - Rcto + PROFF - polizza.pdf p25 riga 25, conf 0.9)
- Passata deterministica: 5 campi sovrascritti su 38 hint trovati nella cache OCR
- Coerenza massimali rct: persona 7.500.000,00 > sinistro 20.000,00 → persona svuotato
- Motore a stadi completato: 19 campi validi su 28
