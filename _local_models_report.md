# Test modelli locali — RC PROF MED V2 sul fascicolo CEDAM "in vigore"

Ollama **localhost:11434** (non la GPU di produzione) · baseline **qwen2.5:7b = 16/28** (9 OK + 7 EMPTY-ok, da `_nonreg_report`)
Motore: staged-gruppi (`perField=false`, `cascade=false`) · constrained JSON · precheck off · embedding `bge-m3` (ATTIVO nel run 14b)

## Verdetto sintetico

| Modello | Punteggio | Delta vs 7b | Tempo | Note |
|---|---|---|---|---|
| `qwen2.5:7b` (baseline) | 16/28 | — | — | OK 9 · EMPTY 7 · WRONG 10 · MISSING 2 |
| `qwen3.5:9b` | **n/d (FALLITO)** | — | — | Ollama locale si spegne durante il run (`fetch failed`); JSON con chiave `id_campo` duplicata. Provato 24576 e 16384 ctx: crash in entrambi |
| `qwen2.5:14b` | **16/28 (Δ 0)** | 1298 s (~21.6 min) | 4 OK + 12 EMPTY-ok · 4 WRONG · 8 MISSING |

**Conclusione principale**: un modello più capiente (14b da 9 GB) **NON risolve gli errori**: punteggio identico alla baseline 16/28. Il 9b è inutilizzabile su questa macchina (instabile). I campi che erano sbagliati con 7b restano sbagliati, e il 14b **manca dei dati anagrafici strutturali** che il 7b prendeva (numero polizza, compagnia, contraente, indirizzo, decorrenza, frazionamento). Il collo di bottiglia è in gran parte **del motore/di regole deterministiche**, non della "capacità" del modello.

## Miglioramenti col 14b (WRONG/MISSING con 7b → ora OK/EMPTY-ok)

| Campo | 7b | 14b | Causa |
|---|---|---|---|
| `rcp_premio_totale` (Premio lordo) | WRONG (10.689,58 = rata) | **OK (13.068,01)** | determinismo: «imponibile 10.689,58 + imposta 2.378,43 = premio lordo completato» |
| `6e39add8-...` (Sinistri) | WRONG | EMPTY-ok | anti-label |
| `rct_parametro` (Sottolimiti) | WRONG | EMPTY-ok | document-questionario escluso |
| `rct_importo_preventivo` (Estensioni) | WRONG | EMPTY-ok | — |
| `rct_tasso` (Esclusioni) | WRONG | EMPTY-ok | — |

## Persistiti sbagliati ANCHE col 14b

| Campo | Atteso | 14b | Causa probabile |
|---|---|---|---|
| `attivita` (Professione) | CENTRI DIAGNOSTICI | tecnico di laboratorio | **seed Stadio A** punta a `tecnico di laboratorio…` dalla polizza (il dato giusto `CENTRI DIAGNOSTICI` è in dichiarazione.pdf); guardrail ne riceve il conflitto |
| `e1d90f78-...` (Fatturato dichiarato) | 8.045.000,00 | 4.000.000,00 | **[deterministico] passata** a conf 0.9 (atto 2018) — errore di regola, non di LLM |
| `rct_massimale_sinistro` (Massimale/sinistro) | 7.500.000,00 | 20.000,00 | **[deterministico] passata** (cedam1603… p2 riga2 conf 0.95): il viral massimale viene da regola |
| `rct_massimale_prestatore` (Scoperto base) | (non presente) | 1.000,00 | **[deterministico]** (polizza p25 conf 0.9) + merge |

Nota: i sotto-massimali (`rct_massimale_sinistro=20.000` vs atteso `7.500.000`) e i premi/altro marcati sono **sovrascritti dalla passata deterministica**: sono errori della **regola deterministica**, non limite del LLM.

## Regressioni col 14b rispetto al 7b (il modello PIÙ grande perde campi che il piccolo prendeva)

| Campo | 7b | 14b |
|---|---|---|
| `polizza_numero` | OK | **MISSING** |
| `compagnia` | WRONG (UNIPOL) | **MISSING** |
| `contraente` | OK | **MISSING** |
| `indirizzo` | OK | **MISSING** |
| `decorrenza` | OK | **MISSING** (svuotato dalla "Coerenza date" 29/07/2010) |
| `rcp_premio_imponibile` (Frazionamento) | OK | **MISSING** |
| `rct_massimale_persona` | MISSING | MISSING (invariato) |

Questo è l'indizio più utile: col modello grande il motore **filtra/svuota** troppo (placeholder→scarta, "senza evidenza", vita deterministica di decorrenza), e molti campi anagrafici base finiscono vuoti.

## Tabella compatta — modello migliore (qwen2.5:14b, 16/28)

| Campo | Attese | Estratto (14b) | Esito |
|---|---|---|---|
| polizza_numero | 781949596 | — | MISSING |
| compagnia | UNIPOLSAI ASSICURAZIONI S.P.A. | — | MISSING |
| contraente | CEDAM ITALIA SRL | — | MISSING |
| codice_fiscale_iva | 00587800137 | 00587800137 | OK |
| indirizzo | VIA CERVA 22 | — | MISSING |
| agenzia | (non presente) | — | EMPTY-ok |
| decorrenza | 31/12/2025 | — | MISSING |
| scadenza | 31/12/2026 | 31/12/2026 | OK |
| rcp_imposta | Sì | — | MISSING |
| **rcp_premio_totale** | **13.068,01** | 13.068,01 | **OK** (era WRONG col 7b) |
| rcp_premio_imponibile | annuale | — | MISSING |
| attivita | CENTRI DIAGNOSTICI | tecnico di laboratorio | WRONG |
| e1d90f78-... (Fatturato) | 8.045.000,00 | 4.000.000,00 | WRONG |
| c125c0d1... (Retroattività) | (non presente) | — | EMPTY-ok |
| 89ffb116... (Data retroattività) | (non presente) | — | EMPTY-ok |
| 6e39add8... (Sinistri) | (non presente) | — | EMPTY-ok |
| rct_massimale_sinistro | Massimale per sinistro | 7.500.000,00 | 20.000,00 | WRONG |
| rct_massimale_persona | Massimale annuo | 7.500.000,00 | — | MISSING |
| rct_massimale_danni | Franchigia base | 20.000,00 | 20.000,00 | OK |
| rct_massimale_prestatore | Scoperto base | (non presente) | 1.000,00 | WRONG |
| rct_parametro | Sottolimiti | (non presente) | — | EMPTY-ok |
| rct_importo_preventivo | Estensioni | (non presente) | — | EMPTY-ok |
| rct_tasso | Esclusioni | (non presente) | — | EMPTY-ok |
| rct_premio_imponibile | Condizioni part. | (non presente) | — | EMPTY-ok |
| rcp_scoperto_min_mondo | Tutela | (non presente) | — | EMPTY-ok |
| c23c8480... | Massimale Tutela | (non presente) | — | EMPTY-ok |
| 6d1e131a... | Franchigia Tutela | (non presente) | — | EMPTY-ok |
| 0df0e5bc... | Premio Lordo Tutela | (non presente) | — | EMPTY-ok |

## Diagnostica rilevante (14b)

- Affinità semantica **attiva** (bge-m3): 56 pagine + 28 descrizioni embeddate.
- `attivita` seed: polizza → `tecnico di laboratorio…` (errato); in `dichiarazione.pdf` c'è `CENTRI DIAGNOSTICI` (batch 2/16) ma viene **sanitizzato/scartato** → prevale il seed sbagliato.
- Determinati: `rcp_premio_totale` (riparazione = imponibile 10.689,58 + imposta 2.378,43 → 13.068,01, OK), `e1d90f78` (4.000.000), `rct_massimale_sinistro` (20.000), `rct_massimale_danni` (20.000), `rct_massimale_prestatore` (1.000). → 5 campi sovrascritti su 42 hint.
- Coerenza date: 29/07/2010 → svuotata decorrenza (rule 8).
- Coerenza massimali rct: persona (7.500.000) > sinistro (20.000) → persona svuotato.
- Il run è stato **interrotto** 2 volte da `fetch failed` (batch 6/16, poi 8-10): lo stesso crash visto col 9b, ma il 14b completa un risultato.

## Riduzione num_ctx

Al 9b a 24576 servivano 32 batch; col 14b a `polizzaBatchContext:16384` i batch aumentano (testo spezzato di più), ma il run termina prima del consolidamento completo (8 campi validi a fine motore). Il 14b a 24576 (13 GB) faceva crash: a 16384 resta 100% GPU.