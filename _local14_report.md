# Run locale qwen2.5:14b — fascicolo CEDAM "in vigore" (RC PROF MED V2)

- **Modello**: qwen2.5:14b · **Embedding**: bge-m3 · **Ollama**: http://127.0.0.1:11434 · **numCtx**: 16384
- **Motore:** staged-gruppi (perField=false, cascade=false, **grounding=off**) — stesso percorso del baseline
- **Tempo reale:** 730.6s
- **Verdetto (28 campi):** 4 OK + 12 vuoti corretti = **16/28** — vs **baseline 7b (9/28 (di cui 7 vuoti corretti))**

## Confronto campo per campo

| campo | label | atteso | estratto | esito |
|---|---|---|---|---|
| `polizza_numero` | N° Polizza | `781949596` | `` | MISSING |
| `compagnia` | Compagnia | `UNIPOLSAI ASSICURAZIONI S.P.A.` | `` | MISSING |
| `contraente` | Contraente/Assicurato | `CEDAM ITALIA SRL` | `` | MISSING |
| `codice_fiscale_iva` | P. IVA / Cod. Fiscale | `00587800137` | `00587800137` | OK |
| `indirizzo` | Indirizzo | `VIA CERVA 22` | `` | MISSING |
| `agenzia` | Agenzia | `(non presente)` | `` | EMPTY-ok |
| `decorrenza` | Decorrenza | `31/12/2025` | `` | MISSING |
| `scadenza` | Scadenza | `31/12/2026` | `31/12/2026` | OK |
| `rcp_imposta` | Tacito Rinnovo | `Sì` | `` | MISSING |
| `rcp_premio_totale` | Premio lordo | `13.068,01` | `13.068,01` | OK |
| `rcp_premio_imponibile` | Frazionamento | `annuale` | `` | MISSING |
| `attivita` | Professione dichiarata | `CENTRI DIAGNOSTICI` | `tecnico di laboratorio` | WRONG |
| `e1d90f78-3e3a-4e42-be90-001b8c34c05a` | Fatturato dichiarato | `8.045.000,00` | `4.000.000,00` | WRONG |
| `c125c0d1-695b-4755-81db-e99137169686` | Retroattività | `(non presente)` | `` | EMPTY-ok |
| `89ffb116-bf3b-4bcb-a6bb-7ceeed04cfee` | Data retroattività | `(non presente)` | `` | EMPTY-ok |
| `6e39add8-de2c-4d48-b231-f03cd4e05bd5` | Sinistri e circostanze  | `(non presente)` | `` | EMPTY-ok |
| `rct_massimale_sinistro` | Massimale per sinistro | `7.500.000,00` | `20.000,00` | WRONG |
| `rct_massimale_persona` | Massimale annuo | `7.500.000,00` | `` | MISSING |
| `rct_massimale_danni` | Franchigia base | `20.000,00` | `20.000,00` | OK |
| `rct_massimale_prestatore` | Scoperto base | `(non presente)` | `1.000,00` | WRONG |
| `rct_parametro` | Sottolimiti | `(non presente)` | `` | EMPTY-ok |
| `rct_importo_preventivo` | Estensioni operative | `(non presente)` | `` | EMPTY-ok |
| `rct_tasso` | Esclusioni particolari | `(non presente)` | `` | EMPTY-ok |
| `rct_premio_imponibile` | Condizioni particolari, aggiuntiive | `(non presente)` | `` | EMPTY-ok |
| `rcp_scoperto_min_mondo` | Tutela | `(non presente)` | `` | EMPTY-ok |
| `c23c8480-d1bd-4ed7-adb2-f0b0dd999308` | Massimale Tutela | `(non presente)` | `` | EMPTY-ok |
| `6d1e131a-9700-4409-85b9-e476de07204e` | Franchigia Tutela | `(non presente)` | `` | EMPTY-ok |
| `0df0e5bc-c285-444f-a653-b8dbe1daab16` | Premio Lordo Tutela | `(non presente)` | `` | EMPTY-ok |

Legenda: OK = valore corretto · EMPTY-ok = atteso vuoto e resta vuoto · MISSING = atteso valorizzato ma manca · WRONG = valore presente ma errato.
