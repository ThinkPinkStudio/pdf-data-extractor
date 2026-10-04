# Demo per presentazioni (dati inventati)

Kit per rigenerare gli screenshot della sezione **PDF Extractor** con dati di
fantasia, palette **OmegaNodes** (navy + oro) ed etichette neutre ("Pratiche" al
posto di "Polizze"), da mostrare a imprenditori esterni.

Il prodotto non viene toccato: palette ed etichette sono iniettate solo nel
browser che scatta (`theme-omeganodes.css`, `relabel.js`). I dati stanno in un
PostgreSQL **locale** e separato, mai quello di produzione.

## Cosa contiene

| File | Ruolo |
|---|---|
| `data.mjs` | Catalogo: aziende fittizie, 8 profili documento (fatture, contratti di fornitura, locazioni, DDT, cedolini, CV, preventivi, bollette), valori estratti, chat |
| `generate-pdfs.mjs` | Crea i PDF di esempio in `pdfs/` e l'albero cartelle per la pagina bulk in `bulk/` |
| `seed.mjs` | Svuota e ripopola il DB demo: profili, batch, elaborazioni, cronologia (rifiuta un `DATABASE_URL` non locale) |
| `capture.mjs` | Scatta gli screenshot (Playwright, 2× retina) in `screenshots/` |
| `theme-omeganodes.css` | Token colore OmegaNodes (tema scuro e chiaro) + logo neutro |
| `relabel.js` | Etichette non assicurative a video (polizza → pratica) |

## Come rigenerare

```bash
# 1. PostgreSQL 18 locale usa-e-getta
docker run -d --name demo-pg18 -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=demo \
  -e POSTGRES_DB=pdfextractor -p 55432:5432 postgres:18

# 2. Web app collegata al DB demo (initDb crea le tabelle al boot)
cd web && npm ci && npx next build
DATABASE_URL=postgresql://demo:demo@localhost:55432/pdfextractor \
SESSION_SECRET=demo-session-secret-for-screenshots-0123456789 \
ALLOWED_DOMAINS=example.com npx next start -p 3100 &
cd ..

# 3. PDF, dati e screenshot
node demo/generate-pdfs.mjs
DATABASE_URL=postgresql://demo:demo@localhost:55432/pdfextractor node demo/seed.mjs
node demo/capture.mjs            # tutti
node demo/capture.mjs 07 08      # solo alcuni (prefisso del nome)
```

Se il Chromium di Playwright non è quello atteso, indica il binario con
`CHROMIUM_PATH=/percorso/chrome`.

Gli screenshot che dipendono dall'AI (estrazione, chat) mostrano sessioni
ripristinate dalla Cronologia e risultati salvati nel DB: per scattarli non
serve un modello Ollama attivo. Archivio e Chat archivio (Qdrant + embeddings)
non sono inclusi.
