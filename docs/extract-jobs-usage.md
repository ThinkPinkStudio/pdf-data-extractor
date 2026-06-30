# Extract Jobs API — uso e test (Fase 1)

API async che incapsula l'estrazione single-polizza + l'export semplice.
Contratto completo: `docs/api-contract-extract-jobs.md`.

## File (tutto dentro `web/`)

```
lib/serviceAuth.ts                       # auth a token di servizio (Bearer)
lib/extractJobs.ts                       # job store in memoria + TTL + tipi/progress
lib/extractRunner.ts                     # UNICO seam verso l'estrazione + modalità echo
lib/simpleExcel.ts                       # export semplice (foglio Campo/Valore)
app/api/extract-jobs/route.ts            # POST  → { jobId }
app/api/extract-jobs/[id]/route.ts       # GET   → stato + progress (barra blu)
app/api/extract-jobs/[id]/result/route.ts# GET   → XLS (bytes)
middleware.ts                            # /api/extract-jobs esente dal redirect di sessione
```

## Setup

```bash
cd web
npm install                      # installa la nuova dipendenza exceljs
# .env
EXTRACT_SERVICE_TOKEN=un-token-lungo-e-casuale
EXTRACT_FAKE=1                   # per testare la pipeline senza backend reale
npm run dev
```

## Test rapido (modalità echo, EXTRACT_FAKE=1)

```bash
TOKEN=un-token-lungo-e-casuale

# 1) sottometti una polizza (1+ PDF)
JOB=$(curl -s -X POST http://localhost:3000/api/extract-jobs \
  -H "Authorization: Bearer $TOKEN" \
  -F "pdf=@/percorso/polizza-a.pdf" \
  -F "pdf=@/percorso/polizza-b.pdf" \
  -F "name=Polizza-123" | python3 -c "import sys,json;print(json.load(sys.stdin)['jobId'])")

# 2) poll dello stato (è la barra blu: docIndex/docTotal, pageIndex/pageTotal)
curl -s http://localhost:3000/api/extract-jobs/$JOB \
  -H "Authorization: Bearer $TOKEN"

# 3) a status=done, scarica l'XLS
curl -s http://localhost:3000/api/extract-jobs/$JOB/result \
  -H "Authorization: Bearer $TOKEN" -o Polizza-123.xlsx
```

## Note

- **Senza** `EXTRACT_FAKE=1`, l'estrazione è delegata a `web/lib/polizzaService.extractPolizza`
  (la funzione single-polizza del web). Finché quella non è eseguibile server-side, il job va in
  `error` con `kind: deterministic` e messaggio esplicativo. È il **solo** punto di integrazione:
  nessuna logica di estrazione è duplicata qui.
- Stato job **in memoria**: un riavvio dell'API perde i job in volo → l'orchestratore ri-sottomette.
- L'elaborazione gira **in background nel processo** (la POST torna subito): valido per `next start`
  standalone (server long-running), non per deploy serverless effimeri.

## Prossimo (Fase 2+)

App orchestratrice (`worker/`, suo Dockerfile): discovery ricorsiva, coda Postgres `batch_*`,
loop sequenziale che chiama questa API, salva l'XLS nell'albero mirror, retry/ripresa/report.
