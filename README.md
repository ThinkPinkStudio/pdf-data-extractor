# PDF Data Extractor

Applicazione web (Next.js) sviluppata da **ThinkPink Studio** per estrarre dati strutturati da documenti PDF tramite intelligenza artificiale. Gira su rete interna in HTTP; l'accesso avviene con account email+password (onboarding one-time per i domini autorizzati).

---

## Funzionalità

### Estrattore PDF
Carica uno o più PDF e lascia che l'AI estragga i campi configurati (nome, data, importo, ecc.). Ogni campo ha etichetta, descrizione per il modello e tipo di dato (testo, data, numero, email, P.IVA, CF, URL).

- **Multi-documento** — carica più PDF nella stessa sessione e chiedi confronti o differenze via chat
- **Chat sul documento** — conversazione libera con l'AI sul contenuto del PDF
- **Profili di estrazione** — salva insiemi di campi come profili riutilizzabili
- **Export sessione** — esporta dati estratti, chat e copia del PDF
- **Validazione valori** — evidenzia in tempo reale se un valore estratto è nel formato atteso

### Polizze RC
Sezione dedicata all'estrazione dati da polizze assicurative RC Terzi / RC Prodotti.

- **Estrazione rolling** — elabora una pagina alla volta accumulando lo stato in modo date-aware (vince sempre il dato più recente); più precisa su documenti lunghi
- **Supporto PDF scansionati** — OCR Tesseract offline (in cache per hash contenuto)
- **Tipi di polizza configurabili** — ogni tipo diventa un tab separato (es. RCT_O, RCP)
- **Mappatura celle Excel** — ogni campo estratto può essere mappato a una o più celle del gestionale
- **Export non distruttivo su template** — scrive i valori **solo** nelle celle target, modificando l'XML dentro lo ZIP `.xlsx` e lasciando intatto tutto il resto del file. Un diff mostra i valori vecchi/nuovi prima di salvare.
- **Istruzioni AI extra** — testo aggiuntivo incluso nel prompt per affinare l'estrazione

### Batch
Estrai dati da una cartella intera di PDF in automatico.

- Seleziona singoli file o un'intera cartella
- Barra di avanzamento per file e annullamento mid-batch
- Export risultati in **CSV** o **Excel**

### Cronologia
Ogni sessione di estrazione viene salvata automaticamente.

- Visualizza e ripristina sessioni precedenti
- Eliminazione selettiva o pulizia totale
- **Retention configurabile** — elimina automaticamente le sessioni più vecchie di N giorni (default 90, impostazione GDPR)

### Impostazioni
- **Provider LLM** — Ollama (locale, privacy-first), OpenAI o Anthropic
- **Ollama** — rilevamento automatico dei modelli installati, URL configurabile, modello vision separato
- **OpenAI / Anthropic** — chiave API e test di connessione dall'interfaccia
- **Tema** — dark / light con colore accent personalizzabile
- **Lingua** — Italiano / English (i18n)

---

## Stack tecnico

| Layer | Tecnologia |
|---|---|
| Frontend | Next.js 14 (App Router), React 18 |
| Backend | API route Next.js (Node) |
| Database | PostgreSQL (pg) |
| Auth | Email+password, sessione persistente (iron-session, cookie firmato) |
| PDF parsing | pdfjs-dist, pdf-parse |
| OCR | Tesseract.js offline (ita.traineddata in cache per hash) |
| Excel | ExcelJS, JSZip, SheetJS |
| LLM | Ollama, OpenAI API, Anthropic API |
| Deployment | Dockerfile su Coolify |

---

## Setup sviluppo

**Requisiti:** Node.js 20+, npm, un PostgreSQL raggiungibile

```bash
git clone https://github.com/ThinkPinkStudio/pdf-data-extractor.git
cd pdf-data-extractor
npm install
cp web/.env.example web/.env.local   # poi configura DATABASE_URL, SESSION_SECRET, ALLOWED_DOMAINS
npm run web:dev
```

La web app parte su `http://localhost:3000`.

### Build della web app

```bash
cd web
npm ci
npm run build       # next build (output standalone)
```

---

## Autenticazione

### Onboarding (una tantum)
Chi non ha ancora un account accede alla pagina **/auth/login** → "Primo accesso? Crea il tuo account". Inserendo un'email di un **dominio autorizzato** (`ALLOWED_DOMAINS` nelle env) e scegliendo una password (min 8 caratteri), l'account viene creato e si entra subito.

### Login
Email + password. La sessione è **persistente**: il cookie non scade, si accede una volta per tutte finché non si fa "Esci" o non cambia `SESSION_SECRET` (in quel caso tutti i cookie firmati con il vecchio segreto diventano invalidi).

### Recupero password
Dalla pagina di login → "Hai dimenticato la password?": l'utente inserisce la propria email e riceve un link di reset (valido 60 minuti di default) via **Resend** (se `RESEND_API_KEY` è impostata) altrimenti via **SMTP**.

### HTTP su rete interna
L'app gira in HTTP puro: il cookie di sessione è `httpOnly`, `sameSite: lax` e **senza** flag `Secure` (default). Per un'esposizione HTTPS vera impostare `COOKIE_SECURE=true`.

---

## Deploy della web app

La web si deploya su **Coolify con build pack Dockerfile** (unico metodo supportato). Istruzioni complete, variabili d'ambiente e note per il deploy solo‑IP/VPN: vedi [`DEPLOY.md`](./DEPLOY.md).

---

## Struttura del progetto

```
pdf-data-extractor/
├── .github/workflows/
│   └── release.yml           # Auto-incrementa la patch version ad ogni push su main
├── src/
│   └── services/             # Business logic condivisa (Node puro, importata dalla web)
│       ├── llmService.js            # Astrazione provider LLM (Ollama/OpenAI/Anthropic)
│       ├── pdfService.js            # Parsing PDF, chunking, ricerca
│       ├── polizzaService.js        # Estrazione polizze RC, orchestrazione export Excel
│       ├── ocrLayout.js             # Griglia spaziale OCR (colonne preservate)
│       ├── xlsxTemplateWriter.js    # Scrittura chirurgica sui template .xlsx (preserva tutto)
│       ├── xlsxTemplateReader.js    # Lettura valori dai template senza ExcelJS (robusta)
│       ├── premioLordo*.js          # Report premio/importo
│       ├── vectorIndexService.js    # Indice vettoriale Qdrant + embeddings
│       ├── vectorStore.js           # Store in-memory per chunk/documenti
│       └── ...
├── web/                      # Applicazione Next.js
│   ├── app/
│   │   ├── (protected)/      # Pagine autenticate (Extractor, Polizza, Batch, ...)
│   │   ├── auth/             # Login, onboarding, forgot, reset
│   │   └── api/              # Route API (incl. /api/auth/*)
│   ├── lib/
│   │   ├── auth.ts           # Sessione iron-session + hash/verify password (scrypt)
│   │   ├── sharedServices.ts # Loader runtime della business logic in src/services
│   │   └── db.ts             # Pool Postgres + inizializzazione tabelle
│   ├── middleware.ts         # Protezione rotte (cookies sessione)
│   └── Dockerfile            # Build standalone per Coolify
├── test/                     # Test Node (node --test test/*.test.mjs)
├── scripts/                  # Utility (eval-polizza, premio-lordo)
├── DEPLOY.md
└── package.json
```

---

## CI/CD

`release.yml` (GitHub Actions) si attiva ad ogni push su `main` (esclusi i commit `chore: bump version`) e incrementa la patch version in `package.json`. Il deploy della web app è gestito da **Coolify** sulla scia del push: ad ogni merge appare una build automatica con la nuova versione.

---

## Sicurezza PDF

Tutte le aperture di PDF (sia lato server Node) usano `isEvalSupported: false`, che disattiva il percorso di esecuzione di codice via font e mitiga CVE-2024-4367 (esecuzione di JavaScript arbitrario aprendo un PDF malevolo).

---

## Licenza

Proprietà di **ThinkPink Studio** — uso interno. Per informazioni: info@thinkpinkstudio.it