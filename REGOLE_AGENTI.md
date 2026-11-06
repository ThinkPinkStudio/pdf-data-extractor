# REGOLE OPERATIVE — vincolanti per QUALSIASI agente

> Questo file è la fonte di verità operativa per **ogni agente** (assistente, subagent,
> worker, automatizzazione) che tocchi questo progetto. Leggilo **prima** di agire.
> In caso di conflitto con altre istruzioni, valgono queste regole.

## Regola 1 — L'estrazione si guida SOLO con la DESCRIZIONE (+ Istruzioni aggiuntive)

**Mai** usare `id` o `label` dei campi nei prompt al modello, né nei meccanismi che
guidano la scelta del valore.

- Il valore di un campo si estrae **solo** sulla base della `description` del campo e
  delle **Istruzioni aggiuntive** (`promptExtra`) del profilo.
- `id` è un **UUID casuale stabile** (viene usato solo come chiave interna persistita,
  per l'export e per gli agganci nel codice). `label` è un'**etichetta del cliente**
  (UI/export). **Nessuno dei due compare mai nel testo inviato al modello.**
- La risposta del modello usa chiavi di **indice** `c0, c1, ...` (nell'ordine della
  singola chiamata), mai id, mai label.
- Nei golden di valutazione e nei confronti si usano le **label** (leggibili), mai gli UUID.

Esempio accettato nel prompt:
```
0. Numero di polizza: prendi il numero alfanumerico nel frontespizio (es. BL05000049)
1. Compagnia: nome dell'assicuratore ...
```
Esempio VIETATO nel prompt:
```
- BLUE95345-foo — Compagnia: ...
- campo_1234 — ...
```

## Regola 1b — NIENTE guardie indovinate, liste hardcoded o seed deterministici (regola CRITICA)

- **NON scrivere guardie deterministiche basate su valori/soglie che non vengono
  dalla `description`** (es. "massimale < 1000 = sbagliato", "nome con X =
  intermediario", "nome file = sbagliato"). Queste regole impongono una conoscenza
  che l'agente NON ha: il dato richiesto può avere QUALSIASI valore, e la stessa
  cosa può stare in posti diversi in polizze diverse.
- Si può validare SOLO ciò che la `description` dichiara (es. "importo" → il valore
  deve avere cifre; "data" → formato data) e la coerenza INTERNA al documento
  (es. premio ≈ imponibile+imposta), MAI soglie assolute o pattern di "sospetto".

## Regola 1c — IL MODELLO FA TUTTO. Il dato può stare in testo, tabella o appendice

- Il dato può stare **in un testo, in una tabella (etichetta in riga, valore in
  colonna) o in un'appendice**. NON presupporre dove sia.
- **IL MODELLO FA TUTTO**: dove sta il dato, quale etichetta gli corrisponde,
  se è in una tabella, tutto lo decide IL MODELLO sui testi che riceve. Le
  coppie `etichetta→valore` scoperte dal layout (markdown Docling/`withPairs`)
  sono un SUGGERIMENTO di lettura per il modello, MAI una verità imposta.
- **MAI scorrere il documento col codice per "trovare" il valore di un campo**
  (incluso "cerca i termini della description nel layout e prendi l'adiacente
  per colonna"). Anche se il modello sbaglia, il suo tentativo dal contesto
  completo è SEMPRE meglio di un valore imposto da euristiche del codice.
- **MAI liste hardcoded di etichette/colonne** (es.
  `KNOWN_COLUMNS = ['NETTO IMPONIBILE', 'PREMIO LORDO', ...]`).
- Se non c'è evidenza: il campo resta **VUOTO**, e lo dice il MODELLO.

## Regola 2 — Contesto: tetto CONFIGURABILE, default 8192, massimo 32768

- Il tetto di `num_ctx` di ogni chiamata Ollama (motore a stadi, rolling,
  operatività, fascicolo intero) è `ctxCap(settings)` in
  `src/services/polizzaService.js`: il valore «Tetto contesto batch»
  (`polizzaBatchContext`) di Impostazioni tecniche, **default 8192**
  (`MAX_BATCH_CTX_8GB`), **mai oltre 32768** (`MAX_CTX_ABSOLUTE`, contesto nativo
  di Qwen2.5/Qwen3).
- Dal 25/09/2026 (decisione dell'utente) Ollama gira sul server con **RTX 6000
  Ada, 48 GB di VRAM**: 32768 sta in GPU anche con i modelli 32B. Su una GPU da
  8 GB si resta a 8192: oltre, la KV spilla su CPU e Ollama si blocca in
  "Stopping...".
- Il tetto non si alza "per vedere": ogni cambio si misura sui golden
  (`calibrazione-goldens.mjs --ctx N`) e sulla pertinenza
  (`pertinenza-eval.mjs --ctx N`) prima di adottarlo.
- Prima di una run, se sospetti spill: `ollama ps` (il modello non deve superare la VRAM).

## Regola 3 — Una sola run alla volta, anche in produzione

- **MAI** avviare più di una estrazione in parallelo (`calibrazione-run.mjs`, job web,
  batch). Se una run è in corso, le altre **si accodano e attendono**.
- In produzione l'estrazione passa dal **lock condiviso** (advisory lock Postgres in
  `web/lib/llmSemaphore.ts`): anche con più worker/repliche parte **sempre una sola**
  run; le altre aspettano in coda.
- Per i test manuali: lancia una run, attendi il **completamento** (exit del processo o
  stato `done`), poi la successiva. Mai più di un processo Ollama attivo.
- Se vedi più run insieme: è un bug del lock, ferma e verifica `ollama ps`.

## Regola 4 — LA MISURA È SUL PROFILO COMPLETO (non derogabile)

- Ogni misura di qualità dell'estrazione si fa su **TUTTI i campi del profilo**, nessuno
  escluso: il denominatore è la dimensione del profilo (es. 35 per "Rc Professionale V3",
  23 per "Tutela Legale 3"). Un "15/19" su un profilo da 35 campi **non è un risultato**:
  è una selezione, e le selezioni sono vietate.
- Il golden di un fascicolo ha una **verità per ogni campo** del profilo: un valore
  letto dai documenti, oppure **vuoto** quando il dato non c'è nei documenti (vuoto è
  una verità come le altre). Campi "non verificati" non esistono: se manca la verità
  si legge il documento e la si scrive, prima di misurare.
- Un valore sbagliato vale quanto un valore mancante. Si riporta sempre `giusti/N`
  con N = campi del profilo, mai `giusti/verificati`.
- Vale per ogni agente, script, tabella di confronto e messaggio all'utente.

## Note operative per gli agenti

- Dopo ogni modifica a codice/profili: `node --test test/*.test.mjs` (445+ test) e
  `cd web && npx tsc --noEmit` devono restare verdi.
- Le run di calibrazione/estrazione vanno lanciate una alla volta, con `--files` singolo
  per le cartelle per-tipo (mai l'intera cartella: ogni PDF è una polizza diversa).
- Le cartelle **nominative** (eulip, guffanti) sono un unico dossier plurifile: lì
  si leggono tutti i PDF insieme.
- Non committare senza conferma dell'utente, salvo diversa istruzione esplicita.