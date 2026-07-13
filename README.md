# PDF Data Extractor

Applicazione desktop cross-platform (Windows / macOS / Linux) sviluppata da **ThinkPink Studio** per estrarre dati strutturati da documenti PDF tramite intelligenza artificiale.

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
- **Supporto PDF scansionati** — usa un modello vision (Ollama, OpenAI o Anthropic) per leggere pagine immagine
- **Tipi di polizza configurabili** — ogni tipo diventa un tab separato (es. RCT_O, RCP)
- **Mappatura celle Excel** — ogni campo estratto può essere mappato a una o più celle del gestionale
- **Export non distruttivo su template** — scrive i valori **solo** nelle celle target, modificando l'XML dentro lo ZIP `.xlsx` e lasciando intatto tutto il resto del file (formattazione, colori, formati numero, validazioni, formattazione condizionale, grafici). Niente più messaggio di ripristino su Windows e nessuna alterazione dell'aspetto originale. Un diff mostra i valori vecchi/nuovi prima di salvare.
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

### Contatti
Rubrica integrata per gestire i contatti associati alle estrazioni.

### Impostazioni
- **Provider LLM** — Ollama (locale, privacy-first), OpenAI o Anthropic
- **Ollama** — rilevamento automatico dei modelli installati, URL configurabile, modello vision separato
- **OpenAI / Anthropic** — chiave API e test di connessione dall'interfaccia
- **Tema** — dark / light con colore accent personalizzabile
- **Lingua** — Italiano / English (i18n)
- **Notifiche** — abilita/disabilita le notifiche di sistema
- **Webhook HTTP** — espone un'API locale per integrare l'estrazione in flussi esterni

---

## Stack tecnico

| Layer | Tecnologia |
|---|---|
| Desktop shell | Electron 28 |
| Frontend | React 18, i18next |
| Build | Electron Vite 2, Vite 5 |
| Packaging | Electron Builder 24 |
| PDF parsing | pdfjs-dist, pdf-parse |
| Excel | ExcelJS (file nuovi), JSZip (patch chirurgica dei template) |
| LLM | Ollama, OpenAI API, Anthropic API |

---

## Setup sviluppo

**Requisiti:** Node.js 20+, npm

```bash
git clone https://github.com/ThinkPinkStudio/pdf-data-extractor.git
cd pdf-data-extractor
npm install
npm run dev            # avvio in sviluppo (hot reload)
```

### Build locale

```bash
npm run build                  # compila con electron-vite
npx electron-builder --win     # pacchettizza per Windows
npx electron-builder --mac     # pacchettizza per macOS
npx electron-builder --linux   # pacchettizza per Linux
```

Gli artefatti finiscono in `dist/`.

### Deploy della web app

La parte web si deploya su **Coolify con build pack Dockerfile** (unico metodo
supportato). Istruzioni complete, variabili d'ambiente e note per il deploy
solo‑IP/VPN: vedi [`DEPLOY.md`](./DEPLOY.md).

---

## Struttura del progetto

```
pdf-data-extractor/
├── .github/workflows/
│   ├── version-bump.yml      # Auto-incrementa la patch version ad ogni push su main
│   └── release.yml           # Build multi-platform + GitHub Release
├── assets/
│   └── icon.png
├── src/
│   ├── main/                 # Processo principale Electron
│   │   ├── index.js          # Entry point: finestra, IPC, webhook, startup
│   │   ├── ipc/
│   │   │   └── handlers.js   # Tutti gli handler IPC (incl. controllo aggiornamenti)
│   │   └── services/
│   │       ├── llmService.js            # Astrazione provider LLM (Ollama/OpenAI/Anthropic)
│   │       ├── pdfService.js            # Parsing PDF, chunking, ricerca
│   │       ├── polizzaService.js        # Estrazione polizze RC, orchestrazione export Excel
│   │       ├── xlsxTemplateWriter.js    # Scrittura chirurgica sui template .xlsx (preserva tutto)
│   │       ├── xlsxTemplateReader.js    # Lettura valori dai template senza ExcelJS (robusta)
│   │       ├── settingsService.js       # Persistenza impostazioni
│   │       ├── historyService.js        # Sessioni storiche, purge GDPR
│   │       ├── vectorStore.js           # Store in-memory per chunk/documenti
│   │       └── webhookService.js        # Server HTTP locale per integrazioni esterne
│   ├── preload/
│   │   └── index.js          # Bridge sicuro renderer↔main (contextBridge)
│   └── renderer/
│       └── src/
│           ├── App.jsx               # Root: title bar, routing pagine, tema, lingua
│           ├── components/
│           │   ├── TitleBar.jsx      # Barra del titolo personalizzata (drag + controlli finestra)
│           │   └── Sidebar.jsx       # Navigazione + badge aggiornamenti
│           ├── pages/                # Extractor, Polizza, Batch, History, Contacts, Settings
│           └── i18n/locales/         # it.json, en.json
├── electron.vite.config.mjs  # Config Vite: define globali (__APP_VERSION__, __UPDATE_URL__)
└── package.json
```

---

## CI/CD e Release

Due workflow GitHub Actions automatizzano il processo.

### `version-bump.yml`
Si attiva ad ogni push su `main` (esclusi i commit `chore: bump version`). Incrementa la patch version in `package.json` e committa.

### `release.yml`
Si attiva quando il commit inizia con `chore: bump version`.
- Build parallela su Windows, macOS e Linux
- Carica gli artefatti (`.exe`, `.dmg`, `.AppImage`, `.deb`)
- Crea una GitHub Release con tag `v{version}-{shortSHA}`

---

## Rilevamento aggiornamenti

All'avvio l'app interroga l'API GitHub Releases per verificare se esiste una versione più recente. In tal caso compare un piccolo badge nella sidebar (accanto alla versione) che apre il portale di download. Il controllo è silenzioso: senza connessione o in caso di errore non mostra nulla.

L'URL del portale è `https://downloads.thinkpinkstudio.it/p/pdf-data-extractor` e può essere sovrascritto in fase di build tramite la variabile repo `UPDATE_DOWNLOAD_URL` (iniettata da Vite come costante globale `__UPDATE_URL__`):

1. **GitHub → repo → Settings → Secrets and variables → Actions**
2. Tab **Variables** → **New repository variable**
3. Nome: `UPDATE_DOWNLOAD_URL`, Valore: l'URL desiderato

Se la variabile non è impostata, viene usato l'URL di default sopra (o, in fallback, la pagina della GitHub Release).

---

## Sicurezza PDF

Tutte le aperture di PDF (sia lato Node sia nel renderer) usano `isEvalSupported: false`, che disattiva il percorso di esecuzione di codice via font e mitiga CVE-2024-4367 (esecuzione di JavaScript arbitrario aprendo un PDF malevolo).

---

## Webhook HTTP (API locale)

L'app può esporre un server HTTP locale (`127.0.0.1` — non accessibile dall'esterno) per integrare l'estrazione in automazioni (es. n8n, script Python, PowerShell). Abilitalo da **Impostazioni → Webhook** e scegli la porta (default `3847`).

### Autenticazione

Ogni richiesta deve includere il token generato dall'app:

```
Authorization: Bearer <token>
# oppure
X-Webhook-Token: <token>
```

### Endpoint

#### `GET /health`
Verifica che il servizio sia attivo (non richiede autenticazione).

```json
{ "status": "ok", "service": "pdf-extractor" }
```

#### `POST /extract`
Estrae i dati da un PDF locale.

**Body:**
```json
{
  "filePath": "/percorso/assoluto/al/documento.pdf",
  "profileId": "id-profilo-opzionale"
}
```

**Risposta:**
```json
{
  "success": true,
  "fileName": "documento.pdf",
  "numPages": 12,
  "data": { "campo1": "valore estratto", "campo2": "altro valore" }
}
```

Se `profileId` è omesso vengono usati i campi attivi nelle impostazioni; se fornito, i campi del profilo corrispondente.

---

## Licenza

Proprietà di **ThinkPink Studio** — uso interno. Per informazioni: info@thinkpinkstudio.it
