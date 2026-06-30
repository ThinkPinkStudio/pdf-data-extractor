# Servizio Batch/Bulk Polizze — Design & Piano

> **v2 — architettura a due servizi.** Orchestrazione in un'app dedicata; il web espone un'**API di estrazione asincrona**; trasferimento file **a bytes**; avanzamento con **stato documento/pagina** (la "barra blu" attuale).
> Stato: linee guida approvate, dettagli implementativi da affinare.

---

## 1. Obiettivo e vincoli

Date delle **cartelle radice** (struttura interna ignota, ricorsiva), trovare le **sottocartelle-polizza** ed estrarre i dati **come nel flusso Polizze**, **una polizza alla volta** (no parallelo), per **decine di migliaia** di polizze.

Decisioni fissate:

- **Due servizi**: un'**API di estrazione** (lato web, definitivo) e un'**app orchestratrice** dedicata.
- L'orchestratore ha il **suo Dockerfile** (come `web/Dockerfile`), costruito ed eseguito a sé — **non** aggiunto come servizio in `docker-compose.yml`.
- **Trasferimento a bytes**: i PDF salgono in multipart, l'XLS torna in download. Niente filesystem condiviso obbligatorio.
- **API asincrona** con **avanzamento per polizza**: quale documento e quale pagina si sta elaborando — la stessa barra blu che c'è adesso.
- **Autonomia**: il run prosegue anche se l'utente abbandona la sessione (l'orchestratore non è mai legato a un browser).
- **Riuso esatto** del meccanismo Polizze, **non copiato**.
- **Output**: export **semplice** già esistente (foglio `Campo`/`Valore`), **non** lo scrittore sul gestionale.
- **Report errori**.

---

## 2. Principio cardine — riuso garantito dal confine di processo

L'orchestratore **non contiene codice di estrazione**: può solo chiamare l'API. Il meccanismo Polizze resta l'**unica fonte** e la non-duplicazione diventa **strutturale**, non più affidata alla disciplina: nessun ramo può divergere. Anche l'**export semplice** avviene dietro l'API — l'orchestratore riceve l'**XLS già pronto** e lo salva, senza nemmeno dipendere da ExcelJS.

---

## 3. Architettura — due servizi

```
┌───────────────────────────────┐          ┌────────────────────────────────────────┐
│  ORCHESTRATORE                 │          │  API ESTRAZIONE (web, async, a token)   │
│  (nuova app, suo Dockerfile)   │          │                                         │
│                                │  POST    │  /api/extract-jobs   (multipart PDF)    │
│  • discovery ricorsiva         │ ───────▶ │      → { jobId }                        │
│  • coda persistente            │  GET     │  /api/extract-jobs/:id                  │
│  • loop SEQUENZIALE (1/volta)  │ ◀─────── │      → { status, progress{doc,pag} }    │ ◀ barra blu
│  • salva XLS nell'output       │  GET     │  /api/extract-jobs/:id/result           │
│  • retry / ripresa / report    │ ◀─────── │      → XLS (bytes)                      │
└───────────────┬───────────────┘          │  dentro: meccanismo single-polizza      │
                │ stato macro (polizza X/N) │  ESATTO + export semplice               │
                ▼                           └────────────────────────────────────────┘
   barra blu completa = macro (X/N) + micro (doc i/tot, pag p/tot)
   i PDF li legge l'orchestratore e li invia a bytes
```

---

## 4. API di estrazione (asincrona, a bytes)

Endpoint, protetti da **token di servizio** (Bearer — stesso modello del webhook desktop `POST /extract`):

- **`POST /api/extract-jobs`** — multipart con i PDF di **una** polizza → avvia l'estrazione, risponde `202 { jobId }`.
- **`GET /api/extract-jobs/:id`** — stato + avanzamento:

  ```json
  {
    "status": "running",              // queued | running | done | error
    "progress": {
      "docIndex": 0, "docTotal": 3,
      "pageIndex": 4, "pageTotal": 11,
      "docName": "polizza.pdf",
      "totalPagesProcessed": 4
    },
    "error": null
  }
  ```

  È **esattamente** la forma di `rollingProgress` che oggi alimenta la barra blu in `Polizza.jsx`. L'API non inventa nulla: ri-pubblica il progress nativo che il meccanismo emette via `onProgress` in `extractPolizzaRolling(files, settings, onProgress)`.

- **`GET /api/extract-jobs/:id/result`** — a `status=done` restituisce l'**XLS a bytes** (l'export semplice). Opzionale: anche il JSON dei campi.

Internamente l'API esegue la **stessa** funzione single-polizza (rolling/vision pagina-per-pagina) e la **stessa** funzione di export semplice già esistenti. L'`onProgress` del meccanismo aggiorna il record di stato del job, che il `GET` espone.

**Stato del job: in memoria** per istanza API (Map singleton), con **TTL/eviction** sui job conclusi. *Decisione presa:* con elaborazione sequenziale c'è **un solo job attivo per volta** → una singola istanza basta e la durabilità ce l'ha l'orchestratore. Persistere non darebbe comunque ripresa "a metà documento" (il rolling non è ri-avviabile da pagina 7), quindi non vale la complessità. Se l'API riparte col job in volo, l'orchestratore vede il **poll fallire** e **ri-sottomette** la polizza (idempotente). Il multi-replica non serve (contraddice il sequenziale); se mai servisse, store condiviso o sticky session.

---

## 5. Orchestratore (app dedicata, suo Dockerfile)

Nessuna logica di estrazione. Responsabilità:

- **Discovery ricorsiva** + matcher configurabile (sez. 6).
- **Coda persistente** (sez. 7).
- **Loop sequenziale** (concorrenza = 1): per ogni polizza → `POST` PDF a bytes → **poll** `GET :id` (registra ed espone il progress doc/pagina) → a `done` `GET :id/result`, salva l'XLS nell'albero di output → marca `done`; on `error` → `error` + report.
- **Autonomia**: gira nel suo processo/container, indipendente da qualsiasi sessione browser; con `restart: unless-stopped` a runtime riparte e **riprende dalla coda**.
- **Ripresa al boot** (item rimasti `processing` → ripresi, idempotenti) + **graceful shutdown** (SIGTERM: finisce o lascia ripartibile l'item corrente).
- **Report errori** + riepilogo.

Collocazione: nuova workspace nel monorepo accanto a `src/` e `web/` (es. `worker/`) con il proprio **`worker/Dockerfile`**.

---

## 6. Discovery ricorsiva e matcher configurabile

Struttura ignota → **niente hard-coding**: la regola che identifica una «cartella-polizza» è **configurabile** per run, con strategie combinabili:

- **per nome cartella** (regex, default `/polizz/i`), e/o
- **cartella foglia con ≥ 1 PDF**, e/o
- **pattern di path** (glob).

I PDF della cartella vengono inviati **insieme** (come Polizze fa con i più file di un fascicolo). Requisiti di scala:

- **Scansione in streaming** (enqueue man mano, niente liste enormi in RAM);
- **idempotenza** via `policy_key` (hash del path assoluto): una ri-scansione non duplica;
- **dry-run di anteprima**: conta quante polizze troverebbe **prima** di partire, per validare il matcher su una struttura reale.

---

## 7. Coda persistente (nell'orchestratore)

Stato sempre su DB (mai solo in memoria) — è ciò che rende il run resiliente a riavvii. **Decisione presa: Postgres condiviso** (lo stesso del web), tabelle in **schema/prefisso `batch_`**, create dall'**init dell'orchestratore** (non da `initDb` del web), così la proprietà dello schema resta sua e uno split futuro è banale. Zero infra nuova, un solo backup, stato batch interrogabile accanto ad `action_logs`; la scrittura è una goccia (sequenziale) → nessuna contesa. Alternativa solo se si vuole l'orchestratore totalmente autosufficiente: SQLite su volume (col singolo worker sequenziale non serve il locking di Postgres), al costo di frammentare dove vivono i dati operativi.

```sql
CREATE TABLE batch_runs (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|running|paused|done|cancelled
  root_paths JSONB NOT NULL,
  matcher_config JSONB NOT NULL,
  output_config JSONB,
  total_items INT NOT NULL DEFAULT 0,
  done_items INT NOT NULL DEFAULT 0,
  error_items INT NOT NULL DEFAULT 0,
  created_by TEXT, created_at BIGINT NOT NULL,
  started_at BIGINT, finished_at BIGINT
);

CREATE TABLE batch_items (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES batch_runs(id) ON DELETE CASCADE,
  policy_key TEXT NOT NULL,                 -- idempotenza
  folder_path TEXT NOT NULL,
  pdf_paths JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending|processing|done|error|skipped
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  job_id TEXT,                              -- job API in corso (per ripresa/poll)
  output_path TEXT,
  started_at BIGINT, finished_at BIGINT, duration_ms INT,
  UNIQUE (run_id, policy_key)
);
CREATE INDEX idx_batch_items_run_status ON batch_items(run_id, status);
```

Claim sicuro del prossimo item: `SELECT … WHERE status='pending' … FOR UPDATE SKIP LOCKED LIMIT 1`.

---

## 8. Avanzamento — la "barra blu" a due livelli

- **Macro** (orchestratore): polizza **X di N** + conteggi done/error/skipped + ETA.
- **Micro** (API job): **documento i/tot, pagina p/tot, nome doc** — il `rollingProgress` nativo.

La UI somma i due livelli, es. *"Polizza 1.240 / 47.310 · file 2/3 · pag 4/11"*: è la **stessa barra blu di adesso**, estesa col contesto del batch. La UI resta **thin** (polling), legge lo stato dall'orchestratore, ed è sicura al reload e alla chiusura del browser.

---

## 9. Output per polizza (semplice)

L'XLS arriva **già pronto dall'API** (export semplice, foglio `Polizza`, colonne `Campo`/`Valore`, una riga per campo). L'orchestratore lo **salva** nell'albero di output configurabile (`output_path` tracciato in coda). **Decisione presa: albero mirror in una cartella di output dedicata** — `<OUTPUT_ROOT>/<path-relativo-cartella-polizza>/<nome>.xlsx` — **non** accanto ai sorgenti (così gli originali restano read-only e le ri-scansioni non si confondono); il path relativo evita collisioni di nomi e la sovrascrittura è idempotente. In più un **manifest CSV** alla radice (`policy_key → cartella → output → stato`), che fa anche da base al report errori.

---

## 10. Report errori e osservabilità

- Errore per-polizza su `batch_items.last_error`.
- A fine run e on-demand: **report scaricabile** (CSV/Excel) di ogni polizza fallita — path, motivo, tentativi, timestamp — più **riepilogo**: totali, ok, falliti, saltati, durata, throughput.
- Log strutturati (riusa `logger`/`logAction` → `action_logs`): `batch.start`, `batch.item.error`, `batch.complete`.

---

## 11. Resilienza e gestione errori

- Errore su un item → `error`, si prosegue (un PDF corrotto non blocca il run).
- **Provider LLM giù**: il meccanismo rolling già interrompe l'estrazione invece di macinare a vuoto; l'orchestratore mette **l'intero run in pausa con backoff** e **riprende** quando l'LLM torna.
- **Retry a due classi** (decisione presa), per tipo d'errore già classificato dal meccanismo (`isLlmConnectionError` / `isLlmFatal`):
  - *transitori* (connessione/timeout/5xx): fino a **3 tentativi** con backoff (5s → 30s → 2m); se è errore di connessione, **pausa dell'intero run** e ripresa quando il provider torna;
  - *deterministici* (PDF corrotto/illeggibile/estrazione vuota): **1 tentativo**, `error` con motivo, avanti.
- **Re-run idempotente**: ri-lanciare un batch salta gli item già `done` (per `policy_key`) → rilavori solo i falliti.
- **Crash/riavvio**: `restart: unless-stopped` + ripresa da coda; item idempotenti (ri-estrazione innocua, l'export sovrascrive).

---

## 12. Prerequisiti / dipendenze

- Funzione single-polizza eseguibile **server-side dietro l'API** (input PDF a bytes → progress + XLS). È la stessa che serve comunque al percorso single-polizza definitivo: l'API la riusa, non la duplica.
- **Token di servizio** per le chiamate orchestratore → API.
- I file polizza accessibili **all'orchestratore** (è lui che legge i PDF e li invia a bytes; l'API non tocca il filesystem delle polizze).

---

## 13. Piano a fasi

| Fase | Contenuto | Criterio di accettazione |
|---|---|---|
| **0 — Contratto API** | `POST`/`GET`/`GET result`, forma del progress (= `rollingProgress`), token di servizio. | Contratto scritto e condiviso. |
| **1 — API estrazione** | Endpoint async che avvolge il meccanismo single-polizza + export semplice; progress via `onProgress`. | Una polizza: submit → poll(progress) → XLS. |
| **2 — Scaffolding orchestratore** | Workspace `worker/` + `worker/Dockerfile`; client API; config. | Container build & run; chiama l'API su 1 polizza. |
| **3 — Discovery** | Scanner ricorsivo streaming + matcher + dry-run + enqueue idempotente. | Trova le polizze attese; nessun duplicato. |
| **4 — Loop + coda** | Sequenziale, claim `SKIP LOCKED`, poll, salva XLS, checkpoint, retry/backoff, ripresa al boot, graceful shutdown. | Run end-to-end; kill & restart riprende dal punto giusto. |
| **5 — Stato + UI** | Stato macro+micro; barra blu estesa; report scaricabile. | Barra come l'attuale + contesto batch; chiusura browser non ferma il run. |
| **6 — Hardening scala** | Decine di migliaia: streaming/indici/memoria, throttle LLM, pausa-LLM-down, prove di autonomia. | Run lungo stabile in memoria; autonomia dimostrata. |

---

## 14. Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Richiesta API appesa su estrazione lunga | **Async** (submit + poll), non richieste sincrone bloccanti. |
| API multi-replica con stato job in memoria | Singola istanza, oppure store condiviso/sticky session. |
| Riavvio API a metà job → progress perso | Orchestratore **ri-sottomette** la polizza (idempotente). |
| LLM giù a metà run | Pausa + backoff del run, ripresa automatica. |
| Crash/restart orchestratore | `restart: unless-stopped` + ripresa da coda. |
| Struttura cartelle imprevista | Matcher configurabile + **dry-run** di anteprima. |
| Throughput | Sequenziale per requisito; ETA; eventuale parallelismo futuro dietro flag. |

---

## 15. Decisioni e domande aperte

**Chiuse (decise):**

- Stato job nell'API: **in memoria** (Map singleton + TTL); durabilità nell'orchestratore via ri-sottomissione.
- Coda orchestratore: **Postgres condiviso**, schema/prefisso `batch_`, creato dall'init dell'orchestratore.
- Output: **albero mirror** in `OUTPUT_ROOT` + **manifest CSV**.
- Retry: **due classi** — 3 tentativi transitori con backoff (pausa run se connessione giù) / 1 tentativo deterministico; re-run idempotente.
- Matcher: **due stadi** — regex nome (`/polizz/i`) + cartella foglia con ≥1 PDF; **dry-run** di anteprima.

**Ancora aperte (da affinare con dati reali, non bloccanti):**

- Regex/glob **esatti** del matcher quando avremo un esempio reale di struttura.
- Valore concreto di `OUTPUT_ROOT` e dei numeri di retry/backoff, se diversi dai default.
- `EXTRACT_SERVICE_TOKEN` e **mount** dei PDF nell'orchestratore (dettagli di deploy).
