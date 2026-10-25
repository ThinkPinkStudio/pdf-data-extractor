# Demo per presentazioni (dati inventati)

Kit per rigenerare screenshot e video della sezione **PDF Extractor** con dati di
fantasia, palette **OmegaNodes** (navy + oro) ed etichette neutre ("Pratiche" al
posto di "Polizze", "Dossiers" al posto di "Policies"), da mostrare a imprenditori
esterni. I video escono in italiano o in inglese (`DEMO_LANG=en`).

Gli scatti sono pensati per la grafica di **`test_branch`** (Elaborazioni a
schede, dettaglio con pannello laterale, Riepiloghi con grafici). Il seed
riconosce lo schema: su `main` salta da solo le tabelle che non esistono.

Il prodotto non viene toccato: palette ed etichette sono iniettate solo nel
browser che scatta (`theme-omeganodes.css`, `relabel.js`). I dati stanno in un
PostgreSQL **locale** e separato, mai quello di produzione.

## Cosa contiene

| File | Ruolo |
|---|---|
| `data.mjs` | Catalogo: aziende fittizie, 8 profili documento (fatture, contratti di fornitura, locazioni, DDT, cedolini, CV, preventivi, bollette), valori estratti, chat, testi del seed, piano del seed (`PLAN`) e regia dei video (`FILM`) |
| `data-en.mjs` | Catalogo inglese a tema finanziario: società irlandese fittizia che ricostruisce dati da pratiche di mutuo (offerta, offerta rivista, perizia, buste paga), finanziamenti alle imprese, estratti conto di portafogli titoli, contratti fornitori, affitti; importi 1,234.56, IVA 23% |
| `lang.mjs` | Sceglie il catalogo da `DEMO_LANG` (`en` → inglese, file generati col suffisso `-en`) |
| `generate-pdfs.mjs` | Crea i PDF di esempio in `pdfs/` e l'albero cartelle per la pagina bulk in `bulk/` |
| `generate-pdfs-en.mjs` | Gli stessi documenti in inglese in `pdfs-en/` e `bulk-en/` |
| `pdf-layout.mjs` | Motore di impaginazione dei PDF, comune ai due generatori |
| `seed.mjs` | Svuota e ripopola il DB demo con il `PLAN` del catalogo: profili, batch (anche archivi pluriennali per i grafici), esiti di pertinenza, storico run, cronologia (rifiuta un `DATABASE_URL` non locale) |
| `capture.mjs` | Crea i Riepiloghi con l'API reale dell'app e scatta gli screenshot (Playwright, 2× retina) in `screenshots/` — solo italiano |
| `theme-omeganodes.css` | Token colore OmegaNodes (tema scuro e chiaro) + logo neutro |
| `relabel.js` | Etichette non assicurative a video (polizza → pratica, policy → dossier) |
| `video.mjs` | Registra i video dimostrativi (1920×1080, didascalie, cursore) in `video/pdf-extractor-<filmato>[-en].mp4`; batch, pratiche e campi da mostrare li prende da `FILM` del catalogo |

## Come rigenerare

```bash
# 1. PostgreSQL 18 locale usa-e-getta
docker run -d --name demo-pg18 -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=demo \
  -e POSTGRES_DB=pdfextractor -p 55432:5432 postgres:18

# 2. Web app di test_branch collegata al DB demo (initDb crea le tabelle al boot)
git worktree add --detach ../tb origin/test_branch && cd ../tb/web
npm ci && npx next build
DATABASE_URL=postgresql://demo:demo@localhost:55432/pdfextractor \
SESSION_SECRET=demo-session-secret-for-screenshots-0123456789 \
ALLOWED_DOMAINS=example.com npx next start -p 3100 &
cd -   # torna alla cartella del repo con demo/

# 3. PDF, dati e screenshot
node demo/generate-pdfs.mjs
DATABASE_URL=postgresql://demo:demo@localhost:55432/pdfextractor node demo/seed.mjs
node demo/capture.mjs            # tutti
node demo/capture.mjs 07 08      # solo alcuni (prefisso del nome)
node demo/video.mjs              # tutti i video (serve ffmpeg)
node demo/video.mjs overview     # solo alcuni: overview bulk profiles trust dashboards
```

Versione inglese: un DB e un'istanza dell'app a parte (stesso build, altra porta),
così le due lingue convivono.

```bash
docker exec demo-pg18 psql -U demo -d postgres -c "CREATE DATABASE pdfextractor_en"
cd ../tb/web && DATABASE_URL=postgresql://demo:demo@localhost:55432/pdfextractor_en \
SESSION_SECRET=demo-session-secret-for-screenshots-0123456789 \
ALLOWED_DOMAINS=example.com ADMIN_EMAILS=emma.walsh@example.com npx next start -p 3101 &
cd -
node demo/generate-pdfs-en.mjs
DEMO_LANG=en DATABASE_URL=postgresql://demo:demo@localhost:55432/pdfextractor_en node demo/seed.mjs
DEMO_LANG=en DEMO_URL=http://localhost:3101 node demo/video.mjs
```

Se il Chromium di Playwright non è quello atteso, indica il binario con
`CHROMIUM_PATH=/percorso/chrome`.

I video navigano l'app reale registrando lo schermo via CDP (interfaccia al 120%
per leggerla anche da telefono): `overview` (cartella bulk → Elaborazioni →
dettaglio batch → Pratiche → Riepiloghi), `bulk` (filtri, profilo per cartella,
stato, export, schema cartelle, Coda), `profiles` (profili, descrizioni dei campi,
Estrattore e chat), `trust` (pertinenza, fonte → PDF originale, storico delle run,
log, scansione illeggibile), `dashboards` (riepilogo creato da un batch, aggiunta
di un altro batch, Personalizza, Excel). La scelta della cartella usa i file di
`bulk/` senza aprire il selettore di sistema. Non lanciano un'estrazione dal
vivo: mostrano i risultati del seed. `profiles` cambia il profilo attivo e
`dashboards` crea un riepilogo: per ripartire puliti si rilancia il seed.

Gli screenshot che dipendono dall'AI (estrazione, chat) mostrano sessioni
ripristinate dalla Cronologia e risultati salvati nel DB: per scattarli non
serve un modello Ollama attivo. Archivio e Chat archivio (Qdrant + embeddings)
non sono inclusi. Il seed nasconde dal menu Batch, Archivio, Chat archivio,
Dati e Sicurezza (Impostazioni tecniche → Voci di menu) per una barra laterale
essenziale.
