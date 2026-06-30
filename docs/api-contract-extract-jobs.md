# Contratto API — Extract Jobs (Fase 0)

API **asincrona** che incapsula il meccanismo single-polizza esatto + l'export semplice.
Una richiesta = **una polizza** (uno o più PDF dello stesso fascicolo). Il client (l'orchestratore batch, ma anche n8n/script) **sottomette** i PDF, **fa poll** dello stato/avanzamento, poi **scarica** l'XLS.

- Base path: `/api/extract-jobs`
- Runtime: Node (`export const runtime = 'nodejs'`)
- Trasferimento: **bytes** (multipart in upload, XLS in download)
- Stato job: **in memoria** per istanza, con TTL (vedi §6)

---

## Autenticazione

Tutte le rotte richiedono un **token di servizio** (macchina-a-macchina), non la sessione browser. Stesso modello del webhook desktop.

```
Authorization: Bearer <EXTRACT_SERVICE_TOKEN>
```

- Il token è in env `EXTRACT_SERVICE_TOKEN` (lato API).
- `401 Unauthorized` se mancante o errato.
- Le rotte `/api/extract-jobs/**` sono **esentate dal redirect di sessione** nel `middleware.ts` (fanno auth a token da sé).

---

## 1. `POST /api/extract-jobs` — sottometti una polizza

Crea un job e avvia l'estrazione in background. Ritorna subito.

**Request** — `multipart/form-data`:

| campo | tipo | note |
|---|---|---|
| `pdf` | file (ripetibile) | uno o più PDF della **stessa** polizza |
| `name` | string (opz.) | nome logico della polizza (per il nome file XLS / log) |

**Response** — `202 Accepted`:

```json
{ "jobId": "b3f1c2a4-...", "status": "queued" }
```

Errori: `400` (nessun PDF), `401` (token), `413` (payload troppo grande, se configurato un limite).

---

## 2. `GET /api/extract-jobs/:id` — stato + avanzamento

È la sorgente della **barra blu**. Il `progress` ha **esattamente** la forma di `rollingProgress` emessa dal meccanismo via `onProgress`.

**Response** — `200`:

```json
{
  "jobId": "b3f1c2a4-...",
  "status": "running",
  "progress": {
    "docIndex": 0,
    "docTotal": 3,
    "pageIndex": 4,
    "pageTotal": 11,
    "docName": "polizza.pdf",
    "totalPagesProcessed": 4
  },
  "error": null,
  "createdAt": 1751240000000,
  "updatedAt": 1751240042000
}
```

`status` ∈ `queued | running | done | error`.
- a `queued`/inizio, `progress` può essere `null`;
- a `done`, l'XLS è scaricabile da §3;
- a `error`, `error` contiene `{ message, kind }` con `kind ∈ transient | deterministic` (mappato da `isLlmConnectionError`/`isLlmFatal`) per guidare il retry dell'orchestratore.

Errori: `401`, `404` (job inesistente o **già evicato** per TTL → l'orchestratore tratta il 404 come "ri-sottometti").

---

## 3. `GET /api/extract-jobs/:id/result` — scarica l'XLS

**Response** — `200` con il file (l'export semplice, foglio `Polizza`, colonne `Campo`/`Valore`):

```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="<name>.xlsx"
```

Errori: `401`, `404` (job inesistente), `409 Conflict` se `status != done` (con body `{ status }`).

---

## 4. Forma del `progress` (canonica)

Unico contratto condiviso UI ↔ API ↔ orchestratore. **Non** va reinventata: è ciò che `extractPolizzaRolling(files, settings, onProgress)` già passa a `onProgress`.

```ts
interface ExtractProgress {
  docIndex: number          // documento corrente (0-based)
  docTotal: number          // totale documenti della polizza
  pageIndex: number         // pagina corrente (1-based) del documento
  pageTotal: number         // totale pagine del documento
  docName: string           // nome file del documento corrente
  totalPagesProcessed: number
}
```

L'orchestratore somma il proprio livello **macro** (polizza X/N) a questo livello **micro** per la barra completa.

---

## 5. Ciclo di vita (lato orchestratore)

```
POST (pdf[]) ──▶ { jobId }
   │
   ├─ loop: GET /:id  ──▶ status=running, progress {doc,pag}   (aggiorna barra)
   │                       status=error   → classifica kind, retry o report
   │
   └─ status=done ──▶ GET /:id/result ──▶ salva XLS in OUTPUT_ROOT, item=done
```

Poll consigliato ogni ~1–2 s. Timeout di job lato orchestratore (es. nessun avanzamento per N minuti) → tratta come `transient`, ri-sottometti.

---

## 6. Stato job in memoria + TTL

- Store: `Map<jobId, Job>` singleton di processo (sopravvive tra richieste nello stesso server Node long-running).
- **TTL**: i job `done`/`error` vengono evicati dopo `EXTRACT_JOB_TTL_MS` (default 10 min) dall'ultimo update; i `running` non si evicano.
- Conseguenza voluta: un riavvio dell'API perde i job in volo → l'orchestratore ri-sottomette (idempotente). Nessuna persistenza necessaria.

---

## 7. Note di implementazione

- Le rotte girano in **Node runtime**; l'elaborazione è un'async function **non attesa** dalla response (`POST` ritorna subito, il lavoro prosegue nel processo). Valido per deploy `next start` standalone (server long-running), non per serverless effimero.
- L'estrazione è invocata tramite **un solo seam** (`web/lib/extractRunner.ts`) che chiama la funzione single-polizza del web: nessuna logica di estrazione duplicata qui.
- L'export è la funzione semplice condivisa (`web/lib/simpleExcel.ts`), la stessa che userà anche il percorso single-polizza del web.
