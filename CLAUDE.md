# PDF Data Extractor — memo per l'assistente

Fatti d'ambiente e decisioni prese. NON richiederli all'utente: sono già qui.

## Infrastruttura (produzione)

- **Deploy web**: Coolify v4 (progetto "CSA PDF Extractor", ambiente `production`).
  Ogni merge su `main` → build automatica + bump versione (`chore: bump version
  to 1.0.NNN`). La versione deployata è visibile in Impostazioni accanto al
  titolo e su `GET /api/version` (con lista feature per verificare cosa è
  arrivato in produzione).
- **Ollama**: gira in **Docker su Coolify**, risorsa `ollama-with-open-webui`
  (container `ollama-api-…`), stesso host. URL dalla web app:
  `http://192.168.37.10:11434`. Per riavviarlo: pulsante Restart della risorsa
  in Coolify (dal terminale del container un `pkill -9 -f runner` uccide solo
  il runner e libera la GPU senza buttare giù il container).
- **Hardware**: GPU NVIDIA GeForce RTX 3060 Ti — **8 GB VRAM** — su host con
  32 GB di RAM. Tutto ciò che supera ~8 GB (pesi + KV cache) trabocca su CPU e
  crolla di velocità (`ollama ps` → "24%/76% CPU/GPU").
- **Modelli in uso**: `qwen2.5:7b-instruct` è il modello di riferimento
  (testo). `bge-m3` per gli embeddings (Qdrant + affinità semantica).
  `qwen3:8b` è utilizzabile SOLO con thinking spento (il codice manda
  `think:false` ai modelli "pensanti" — vedi `netFetch.js`). `llama3.1` è
  scarso su italiano+JSON: sconsigliato.
- **Qdrant**: su Coolify con API key; collezione configurabile da Impostazioni.

## Decisioni prese (non riaprirle)

- **DOCUMENTI TUTTI UGUALI (definitiva, non tornarci MAI più)**: ogni dato può
  stare in QUALSIASI tipologia di file. Vietata ogni logica per tipo documento:
  niente priorità tassonomiche, niente ancore/dropdown "fonte", niente fette di
  selezione per tipo. Decidono SOLO: descrizioni dei campi (affinità), evidenza
  nel testo, recency — e a pari data lo spareggio LESSICALE con la descrizione
  (`lex` sul candidato). Le uniche eccezioni ammesse sono type-blind: mai
  escludere campi dai 3 documenti più recenti né dal documento più corposo.
  I batch FOCALIZZATI (un documento per chiamata) si scelgono con due criteri
  type-blind: i 3 documenti più recenti **e** i 3 più affini alle descrizioni
  del gruppo — senza il secondo il documento più informativo (il contratto, che
  è anche il più vecchio) finiva spezzato in coda a batch di quietanze vecchie.

- **VISION DISMESSA**: il percorso vision (immagini al modello multimodale) NON
  deve esistere. I PDF scansionati passano da OCR Tesseract + modello di testo.
  Il worker web usa sempre `runWholeDossier`; il selettore "modello vision" è
  stato rimosso dalle Impostazioni. Errori storici "Multimodal data provided"
  venivano da lì.
- **stream:false → zombie**: con `stream:false` il timeout del client NON
  cancella la generazione lato server Ollama (si accodano generazioni-zombie
  che tengono il modello caricato per ore, `ollama stop` resta in "Stopping…").
  Cura definitiva possibile: passare i call-site a `stream:true`.
- **Motore a stadi (polizze)**: strategia "Gruppi a copertura totale" (default,
  vincitrice dell'A/B sul campo) o "Cascata dal più recente" (switch in
  Impostazioni, persiste da solo al cambio — chiave `polizzaStagedCascade`,
  esclusa dal salvataggio pagina via `EDITOR_KEYS`). Arbitro semantico prudente
  (promozione Δ>0.15, veto Δ>0.10, altrimenti recency + spareggio lessicale).
- **Questionario IDD (CSA Adesioni)**: per la legenda AXA le 5 domande sono
  OBBLIGATORIE e si valorizzano solo con TIPO MOVIMENTO "A" (fino a 20 coppie
  CODICE DOMANDA/RISPOSTA). Quindi: `validateRecord(record, fields, idd)` blocca
  il salvataggio di un'attivazione senza risposte, le intestazioni del tracciato
  si dimensionano sul questionario (`trackHeadersFor`) e l'archivio mostra lo
  stato IDD di ogni record con conferma prima di export/FTP incompleti.

- **Descrizioni dei campi**: `stripFieldExamples` toglie SOLO l'esempio, non
  tutto ciò che l'utente ha scritto dopo. Il vecchio taglio arrivava a fine riga
  e le descrizioni sono su una riga sola: da "Parametro regolazione" spariva il
  «VIETATO restituire da sole le parole 'Consuntivo'… ometti il campo», sia dal
  prompt sia dal vettore di affinità.
- **Affinità dei candidati**: la finestra di contesto attorno al valore si cerca
  sul testo NORMALIZZATO (`findValueWindow`/`buildNormIndex`). Con la ricerca
  letterale bastava una maiuscola diversa ("Acqui Terme" vs "ACQUI TERME")
  perché l'affinità fosse `null` e l'arbitro, cieco, decidesse per sola recency.
  Anche i seed di Stadio A hanno la loro affinità: prima entravano nudi.
- **Testo OCR SPAZIALE (griglia a colonne)**: `ocrImageToText` chiede a
  tesseract.js anche i `blocks` e ricostruisce la pagina come griglia monospace
  (`ocrLayout.js`) — i layout tabellari restano incolonnati nei PROMPT. Le
  regex, la datazione, gli embeddings e i chunk lavorano sul PIATTO derivato
  (`collapseSpatial`, sdoppiamento in `analyzeStagedDocs`:
  `spatialPages`/`pages`). I budget char si misurano in `usefulLength` (le run
  di spazi costano ~0 token). Cache OCR versionata (`ocr_cache.format`,
  `OCR_FORMAT=2`): al bump le voci vecchie sono miss e si rigenerano da sole.
- **Chiavi campo storpiate**: i modelli piccoli ricopiano male gli UUID dei
  campi ("311ac411…" per "311ac415…") — `matchFieldKey` (fuzzy ≤2, solo match
  univoco, chiavi ≥8) li recupera in `absorbStagedEntries` invece di buttare
  valori validi.
- **Pre-check di pertinenza** (profilo↔contenuto): switch `polizzaPrecheckMode`
  (default **off**; keywords/semantic/llm da confrontare sul campo). Blocca il
  job in status `mismatch` con "Procedi comunque" in UI (override persistito in
  `precheck.override`). Solo job con `profile_id`; ogni guasto infrastrutturale
  → `skipped`, MAI mismatch. Parte pura in `polizzaPrecheck.js` (soglie
  esportate), orchestratore in `polizzaPrecheckService.js`, aggancio nel worker
  post-OCR/pre-LLM. `contentKeywords` sul profilo = parole del CONTENUTO
  (diverse da `matchKeywords`, che agisce sul nome cartella).
- **Diagnostica**: la prima riga di ogni run dice strategia e modello REALI.
  "Scarica diagnostica" nella pagina Polizze è la fonte di verità per il debug.

## Fascicolo di riferimento (EULIP, 45 PDF)

Valori attesi per la taratura: N° polizza 283618616 · P.IVA contraente
00151510344 · decorrenza 31/12/2024 · scadenza 31/12/2025 · massimale sinistro
4.000.000,00 · imposta 1.001,25 e premio totale 5.501,25 (quietanza 2025) ·
agenzia ACQUI TERME · parametro regolazione "retribuzioni" (mai "Premi") ·
importo preventivo 1.800.000 (appendice 9). L'OCR dei 45 file è in cache per
hash: i rilanci non lo ripagano.

## Convenzioni

- L'utente lavora in italiano; UI bilingue IT/EN (`web/lib/i18n/messages.ts`).
- Test: `node --test test/*.test.mjs` (45+). Web: `npx tsc --noEmit` +
  `npx next build` prima di ogni PR.
- Flusso: branch di lavoro → PR su `main` → squash merge → Coolify deploya.
