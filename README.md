# PDF Data Extractor

Applicazione desktop cross-platform (Windows / macOS / Linux) sviluppata da **ThinkPink Studio** per estrarre dati strutturati da documenti PDF tramite intelligenza artificiale.

---

## Funzionalità

### Estrattore PDF
Carica uno o più PDF e lascia che l'AI estragga i campi configurati (nome, data, importo, ecc.). Ogni campo ha etichetta, descrizione per il modello e tipo di dato (testo, data, numero, email, P.IVA, CF, URL).

- **Multi-documento** — carica più PDF nella stessa sessione e chiedile confronti o differenze via chat
- **Chat sul documento** — conversazione libera con l'AI sul contenuto del PDF
- **Profili di estrazione** — salva insiemi di campi come profili riutilizzabili
- **Export sessione** — esporta dati estratti, chat e copia del PDF in un unico archivio
- **Validazione valori** — evidenzia in tempo reale se un valore estratto è nel formato atteso

### Polizze RC
Sezione dedicata all'estrazione dati da polizze assicurative RC Terzi / RC Prodotti.

- **Estrazione rolling** — elabora una pagina alla volta accumulando lo stato; più precisa su documenti lunghi
- **Supporto PDF scansionati** — usa un modello vision (Ollama, OpenAI o Anthropic) per leggere pagine immagine
- **Tipi di polizza configurabili** — ogni tipo diventa un tab separato nell'interfaccia (es. RCT_O, RCP)
- **Mappatura celle Excel** — ogni campo estratto può essere mappato a una o più celle del gestionale Excel
- **Export su template** — scrive i valori estratti direttamente in un file Excel esistente, preservando formattazione e formule; mostra un diff prima di salvare
- **Istruzioni AI extra** — testo aggiuntivo incluso nel prompt di estrazione per affinare il comportamento del modello

### Batch
Estrai dati da una cartella intera di PDF in automatico.

- Seleziona singoli file o un'intera cartella
- Barra di avanzamento per file
- Annullamento mid-batch
- Export risultati in **CSV** o **Excel**

### Cronologia
Ogni sessione di estrazione viene salvata automaticamente.

- Visualizza e ripristina sessioni precedenti
- Eliminazione selettiva o pulizia totale
- **Retention configurabile** — elimina automaticamente le sessioni più vecchie di N giorni (default 90, impostazione GDPR)

### Contatti
Rubrica integrata per gestire i contatti associati alle estrazioni.

### Impostazioni
- **Provider LLM** — scegli tra Ollama (locale, privacy-first), OpenAI e Anthropic
- **Ollama** — rilevamento automatico dei modelli installati, URL configurabile, modello vision separato
- **OpenAI / Anthropic** — inserisci la chiave API e testa la connessione direttamente dall'interfaccia
- **Tema** — dark / light, con colore accent personalizzabile
- **Lingua** — Italiano / English (i18n)
- **Notifiche** — abilita/disabilita le notifiche di sistema
- **Webhook HTTP** — espone un'API locale per integrare l'estrazione in flussi esterni (vedi sezione dedicata)

---

## Stack tecnico

| Layer | Tecnologia |
|---|---|
| Desktop shell | Electron 28 |
| Frontend | React 18, i18next |
| Build | Electron Vite 2, Vite 5 |
| Packaging | Electron Builder 24 |
| PDF parsing | pdfjs-dist, pdf-parse |
| Excel | ExcelJS, XLSX |
| LLM | Ollama, OpenAI API, Anthropic API |

---

## Setup sviluppo

**Requisiti:** Node.js 20+, npm

```bash
# Clona il repository
git clone https://github.com/ThinkPinkStudio/pdf-data-extractor.git
cd pdf-data-extractor

# Installa le dipendenze
npm install

# Avvia in modalità sviluppo (hot reload)
npm run dev
```

### Build locale

```bash
npm run build                          # Compila con electron-vite
npx electron-builder --win            # Pacchettizza per Windows
npx electron-builder --mac            # Pacchettizza per macOS
npx electron-builder --linux          # Pacchettizza per Linux
```

Gli artefatti finiscono in `dist/`.

---

## Struttura del progetto

```
pdf-data-extractor/
├── .github/workflows/
│   ├── version-bump.yml      # Auto-incrementa patch version ad ogni push su main
│   └── release.yml           # Build multi-platform + GitHub Release
├── assets/
│   └── icon.png
├── src/
│   ├── main/                 # Processo principale Electron
│   │   ├── index.js          # Entry point: finestra, IPC, webhook, startup
│   │   ├── ipc/
│   │   │   └── handlers.js   # Tutti gli handler IPC
│   │   └── services/
│   │       ├── llmService.js        # Astrazione provider LLM (Ollama/OpenAI/Anthropic)
│   │       ├── pdfService.js        # Parsing PDF, chunking, ricerca semantica
│   │       ├── polizzaService.js    # Logica estrazione polizze RC, export Excel
│   │       ├── settingsService.js   # Persistenza impostazioni (electron-store)
│   │       ├── historyService.js    # Sessioni storiche, purge GDPR
│   │       ├── vectorStore.js       # Store in-memory per chunk/documenti
│   │       └── webhookService.js    # Server HTTP locale per integrazioni esterne
│   ├── preload/
│   │   └── index.js          # Bridge sicuro tra renderer e main (contextBridge)
│   └── renderer/
│       └── src/
│           ├── App.jsx               # Root: routing pagine, tema, lingua
│           ├── components/
│           │   └── Sidebar.jsx       # Navigazione + check aggiornamenti
│           ├── pages/
│           │   ├── Extractor.jsx     # Estrattore PDF + chat
│           │   ├── Polizza.jsx       # Polizze RC
│           │   ├── Batch.jsx         # Elaborazione batch
│           │   ├── History.jsx       # Cronologia sessioni
│           │   ├── Contacts.jsx      # Rubrica contatti
│           │   └── Settings.jsx      # Impostazioni
│           └── i18n/
│               └── locales/
│                   ├── it.json
│                   └── en.json
├── electron.vite.config.mjs  # Config Vite: define globali (__APP_VERSION__, __UPDATE_URL__)
└── package.json
```

---

## CI/CD e Release

Il processo è completamente automatizzato tramite due workflow GitHub Actions:

### 1. `version-bump.yml`
Si attiva ad ogni push su `main` (esclusi i commit `chore: bump version`).
Incrementa automaticamente la patch version in `package.json` e committa.

### 2. `release.yml`
Si attiva quando il commit inizia con `chore: bump version`.
- Build parallela su Windows, macOS e Linux
- Carica gli artefatti (`.exe`, `.dmg`, `.AppImage`, `.deb`)
- Crea una GitHub Release con tag `v{version}-{shortSHA}`

---

## Variabili GitHub (Repository Variables)

Queste variabili si configurano in **Settings → Variables → Actions** del repository.

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `UPDATE_DOWNLOAD_URL` | No | URL del portale download da aprire quando l'utente clicca sul badge di aggiornamento. Se non impostata, rimanda alla GitHub Release. |

### Come impostare `UPDATE_DOWNLOAD_URL`

1. Vai su **GitHub → repo → Settings → Secrets and variables → Actions**
2. Tab **Variables** → **New repository variable**
3. Nome: `UPDATE_DOWNLOAD_URL`, Valore: `https://downloads.thinkpinkstudio.it`

La variabile viene iniettata da Vite al momento del build come costante globale `__UPDATE_URL__`. Per aggiornarla basta modificare il valore nella pagina delle variabili — nessuna modifica al codice necessaria.

---

## Rilevamento aggiornamenti

All'avvio l'app interroga l'API GitHub Releases per controllare se esiste una versione più recente. Se sì, compare un piccolo badge nella sidebar (accanto alla versione corrente) che apre il portale di download configurato tramite `UPDATE_DOWNLOAD_URL` (o la GitHub Release se la variabile non è impostata).

Il controllo è silenzioso: se non c'è connessione o la chiamata fallisce, non viene mostrato nulla.

---

## Webhook HTTP (API locale)

L'app può esporre un server HTTP locale (`127.0.0.1` — non accessibile dall'esterno) per integrare l'estrazione in automazioni esterne (es. n8n, script Python, PowerShell).

Abilitalo da **Impostazioni → Webhook** e scegli la porta (default `3847`).

### Autenticazione

Ogni richiesta deve includere il Bearer token generato dall'app:

```
Authorization: Bearer <token>
# oppure
X-Webhook-Token: <token>
```

### Endpoint

#### `GET /health`
Verifica che il servizio sia attivo. Non richiede autenticazione.

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
  "data": {
    "campo1": "valore estratto",
    "campo2": "altro valore"
  }
}
```

Se `profileId` è omesso vengono usati i campi attivi nelle impostazioni. Se fornito, vengono usati i campi del profilo corrispondente.

---

## Licenza

Proprietà di **ThinkPink Studio** — uso interno. Per informazioni: info@thinkpinkstudio.it
