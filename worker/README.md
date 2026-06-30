# Worker — Orchestratore batch/bulk polizze

App dedicata (suo Dockerfile) che macina **decine di migliaia di polizze** in modo
**sequenziale e autonomo**: cammina ricorsivamente le cartelle, mette le polizze in
una coda Postgres, e per ognuna chiama l'**API di estrazione** (`/api/extract-jobs`),
salva l'XLS e produce un report. Non contiene logica di estrazione: il riuso del
meccanismo Polizze è garantito dal confine di processo (chiama solo l'API).

Design completo: `../docs/batch-bulk-polizze-design.md` · Contratto API: `../docs/api-contract-extract-jobs.md`.

## Moduli (`src/`)

```
config.ts      configurazione da env
discovery.ts   walk ricorsivo streaming + matcher configurabile (funzione pura)
csv.ts         helper CSV (puro)
db.ts          pool Postgres + schema batch_runs / batch_items (creato qui)
queue.ts       createRun, enqueue idempotente, claim SKIP LOCKED, checkpoint, pausa/resume
apiClient.ts   submit (bytes) / poll (progress) / download (XLS) verso l'API
runner.ts      loop sequenziale (concorrenza=1), retry/backoff, pausa su provider giù, output mirror
report.ts      manifest + report errori + riepilogo
index.ts       CLI: work | scan | dry-run | report
```

## Comandi

```bash
npm install

# anteprima: quante polizze troverebbe (sola lettura, niente DB)
npm run dry-run

# crea un run e mette le polizze in coda (discovery)
npm run scan

# loop autonomo che elabora la coda (è il comando del container)
npm run work

# manifest + report errori + riepilogo di un run
npm run report -- 1
```

## Config (env) — vedi `.env.example`

| var | default | note |
|---|---|---|
| `DATABASE_URL` | — | Postgres condiviso col web |
| `EXTRACT_API_URL` | `http://localhost:3000` | base URL dell'API estrazione |
| `EXTRACT_SERVICE_TOKEN` | — | stesso token dell'API |
| `OUTPUT_ROOT` | `/data/output` | radice dell'albero mirror degli XLS |
| `BATCH_ROOTS` | — | cartelle radice da scandire (csv) |
| `MATCH_NAME_REGEX` | `polizz` | regex nome sottocartella; vuota = qualsiasi cartella con PDF |
| `MATCH_GROUP` | `folder` | `folder` (tutti i PDF insieme) o `file` (un PDF = una polizza) |
| `MAX_TRANSIENT_ATTEMPTS` | `3` | retry inline sui transitori |
| `BACKOFF_MS` | `5000,30000,120000` | backoff per tentativo |
| `LLM_PAUSE_MS` | `60000` | pausa del run quando il provider è in difficoltà |

## Docker (container a sé, non in compose)

```bash
docker build -t pdf-extractor-worker ./worker
docker run --env-file worker/.env \
  -v /percorso/archivio:/data/archivio:ro \
  -v /percorso/output:/data/output \
  --restart unless-stopped \
  pdf-extractor-worker            # default = "work" (loop autonomo)

# discovery una tantum:
docker run --env-file worker/.env -v ... pdf-extractor-worker \
  npx tsx src/index.ts scan
```

## Autonomia & resilienza

- Il loop gira nel processo del container, **indipendente da qualsiasi sessione browser**.
- `--restart unless-stopped` + **ripresa da coda**: al boot gli item `processing` tornano `pending`.
- **Sequenziale** (concorrenza = 1). Provider giù → run in **pausa** con ripresa automatica.
- **Re-run idempotente**: ri-`scan` non duplica (chiave `policy_key`); ri-elaborare salta i `done`.
