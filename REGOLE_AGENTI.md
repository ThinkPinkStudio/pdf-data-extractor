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

## Regola 2 — Contesto massimo: 8192 (MASSIMO, non superabile)

- La costante `MAX_BATCH_CTX_8GB = 8192` (in `src/services/polizzaService.js`) è il
  **tetto assoluto** di `num_ctx` per qualunque chiamata Ollama (motore a stadi,
  rolling, full-text, batch).
- **Non alzarla** senza cambiare modello/hardware: superare 8192 su VRAM 8GB fa
  spillare la KV su CPU e bloccare Ollama in "Stopping...".
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

## Note operative per gli agenti

- Dopo ogni modifica a codice/profili: `node --test test/*.test.mjs` (445+ test) e
  `cd web && npx tsc --noEmit` devono restare verdi.
- Le run di calibrazione/estrazione vanno lanciate una alla volta, con `--files` singolo
  per le cartelle per-tipo (mai l'intera cartella: ogni PDF è una polizza diversa).
- Le cartelle **nominative** (eulip, guffanti) sono un unico dossier plurifile: lì
  si leggono tutti i PDF insieme.
- Non committare senza conferma dell'utente, salvo diversa istruzione esplicita.