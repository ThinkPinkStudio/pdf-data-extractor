# PDF Data Extractor — memo per l'assistente

> **PRIMA di agire leggi [REGOLE_AGENTI.md](REGOLE_AGENTI.md)**: estrazione per
> DESCRIZIONE soltanto (mai id/label nei prompt), contesto MASSIMO 8192, una sola
> run alla volta (anche in produzione, con lock condiviso), **NESSUN guardrail
> "indovinato" (soglie/valori inventati)**: si estrae associando l'etichetta al
> valore adiacente nel layout (testo o tabella), vuoto se non trovato. Vincolante
> per ogni agente. **Regola 4**: ogni misura è su TUTTI i campi del profilo
> (denominatore = dimensione del profilo), con una verità per ogni campo (valore o
> vuoto): niente "verificati", niente selezioni.

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
  (testo, 4.7 GB — entra in 8 GB VRAM con KV cache). `bge-m3` per gli
  embeddings (Qdrant + affinità semantica) — NON cambiarlo senza rebuild
  della collezione (dimensione vettore diversa). `qwen3:14b` (9.3 GB) NON
  è il daily driver: supera la VRAM e spill su CPU; solo A/B notturni con
  `think:false`. Se si vuole la famiglia Qwen3 in produzione, il candidato
  è `qwen3:8b` (da pullare), mai 14b. `llama3.1` è scarso su italiano+JSON:
  sconsigliato.
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
  Il dialog "Run di test" in Elaborazioni sceglie il MOTORE (per-campo / gruppi /
  cascata): prima "gruppi/cascata" non disattivava `polizzaPerField`, quindi
  l'A/B non girava davvero sul motore a stadi.
- **JSON vincolato** (`polizzaConstrainedJson`, default on): Ollama riceve uno
  JSON Schema (o GBNF se `polizzaConstrainedFormat=gbnf`) con pattern per date /
  importi / P.IVA / tassi. Testi liberi senza pattern. Se Ollama 400, fallback a
  `format:json`. Modulo `gbnfSchema.js`.
- **Cross-field** (`validateCrossFields`): decorrenza < scadenza (già c'era),
  massimale annuo ≥ sinistro, sotto-massimali ≤ sinistro, premio totale ≈
  imponibile+imposta (±2%). Meglio vuoto che sbagliato.
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
  Il motore per-campo indicizza chunk PIATTI ma manda al LLM la pagina SPAZIALE
  (stesso sdoppiamento).
- **Chiavi campo storpiate**: i modelli piccoli ricopiano male gli UUID dei
  campi ("311ac411…" per "311ac415…") — `matchFieldKey` (fuzzy ≤2, solo match
  univoco, chiavi ≥8) li recupera in `absorbStagedEntries` invece di buttare
  valori validi.
- **Pre-check di pertinenza** (profilo↔contenuto): switch `polizzaPrecheckMode`
  (default **semantic** dal 15/09/2026 — richiesta dell'utente: «di default
  devono essere attivi»; prima era off e ogni polizza usciva «accettato senza
  controllo»; keywords/llm/off restano selezionabili in Impostazioni. Un valore
  salvato nel DB vince sul default. Col profilo scelto dalla classifica
  semantica il controllo gira lo stesso: passa per costruzione, ma la
  motivazione in «Pertinenza» è un verdetto vero). Blocca il
  job in status `mismatch` con "Procedi comunque" in UI (override persistito in
  `precheck.override`). Solo job con `profile_id`; ogni guasto infrastrutturale
  → `skipped`, MAI mismatch. Parte pura in `polizzaPrecheck.js` (soglie
  esportate), orchestratore in `polizzaPrecheckService.js`, aggancio nel worker
  post-OCR/pre-LLM. `contentKeywords` sul profilo = parole del CONTENUTO
  (diverse da `matchKeywords`, che agisce sul nome cartella).
- **Diagnostica**: la prima riga di ogni run dice strategia e modello REALI.
  "Scarica diagnostica" nella pagina Polizze è la fonte di verità per il debug.
- **Eval estrazione (golden EULIP)**: `src/services/polizzaEval.js` +
  `test/fixtures/eulip-expected.json`. Punteggio di un JSON già estratto:
  `node scripts/eval-polizza.mjs --actual extracted.json`. Ogni cambio a
  modello/GBNF/strategia si misura qui PRIMA di dichiararlo un miglioramento.
  I test del solo scorer: `test/polizzaEval.test.mjs` (niente Ollama).

- **UN SOLO percorso testo per worker, script e test** (11/09/2026): la griglia
  spaziale pdfjs sta in `src/services/pdfTextLayer.js` (`spatialPagesFromPdf`)
  ed è usata dal worker (`polizzaJobWorker.ts`), da `calibrazione-run.mjs`,
  `test-guffanti.mjs`, `test-docling.mjs`. Prima era copiata in quattro posti:
  "in test funziona, online no" nasceva anche da lì. Le pagine senza text layer
  restano `''` al loro posto (numerazione stabile, OCR selettivo possibile).
- **Golden dal LOCALE, contro l'Ollama vero** (il container cloud non
  raggiunge 192.168.37.10 e su CPU un batch costa 10 minuti):
  `cd web && npm ci && cd .. && ln -sfn web/node_modules node_modules`, poi
  `node scripts/calibrazione-goldens.mjs` (tutti i fascicoli golden in
  sequenza, motore a stadi, punteggio per fascicolo; `--only`, `--model`,
  `--ollama`, `--resolve-only` per il solo controllo chiavi→campi).
- **Copertura del testo PRIMA del modello**: `node scripts/coverage-check.mjs`
  verifica che ogni valore dei golden sia nel testo che il modello riceve
  (sorgenti `pdfjs`, `pymupdf`, `docling`). Misurato 11/09/2026 sui 6 fascicoli
  golden presenti in `polizze_test`: pdfjs 84/84 valori. Se un dato non esce,
  il problema NON è il testo: è prompt/arbitro/impostazioni.
- **Servizi condivisi caricati a runtime**: il worker importa `src/services/*`
  con `import()` dentro try/catch, quindi un errore di SINTASSI lì NON rompe né
  `tsc` né `next build`: la funzione sparisce in silenzio (11/09/2026: un numero
  di riga incollato in `polizzaPrecheckService.js` ha spento il pre-check per
  tutti i deploy di un giorno). `test/servicesLoad.test.mjs` importa ogni modulo.
- **Default riallineati ai test** (11/09/2026): `polizzaPerField` default
  **false** (motore a stadi, come CLAUDE.md e gli script di calibrazione; il
  per-campo resta opt-in dallo switch) e `polizzaRequireValidPolicy` default
  **false** (regola con marcatori hardcoded → Regola 1b; opt-in). Il valore
  salvato nel DB vince sempre sul default: controllare Impostazioni tecniche.
- **Docling: il predownload deve CONVERTIRE**: Docling ≥ 2.12x carica i pesi
  alla prima conversione, non alla costruzione del converter. `predownload.py`
  ora converte un PDF minimo (stessa config di `main.py`); prima l'immagine
  "pre-scaricata" non conteneva i modelli e il primo `/parse` scaricava a
  runtime (o falliva 500 offline).

- **Testo dei prompt = GRIGLIA pdf.js + tabelle Docling** (12/09/2026, definitivo
  salvo misure contrarie): `normalizeStagedDocInput` mette nei prompt la griglia
  spaziale e aggiunge per pagina le tabelle Docling riparate; il markdown
  allineato resta il testo piatto (regex/affinità/embeddings). Il markdown da
  solo scompone i frontespizi a modulo (AIG: data di decorrenza dieci righe
  sotto l'etichetta, "AIG E UROPE S. A ." a lettere staccate → decorrenza =
  data di continuità, compagnia mai trovata). `POLIZZA_MD_PROMPT=1` solo per A/B.
- **Ogni stadio verifica l'EVIDENZA**: anche A.7 (tabella) e A.8 (frontespizio)
  passano da `passesStagedEvidence` sul blocco inviato. Prima entravano
  candidati inventati con documento/pagina/affinità ("Agenzia Assicurativa
  Roma", "Sì, massimale 5.000.000 €" su otto campi di verifica) e battevano i
  batch per incumbency. I campi di VERIFICA ("Verifica se…", decisi dalla
  descrizione: `descriptionAsksVerification`) hanno "evidenza" OBBLIGATORIA
  nello schema/GBNF: senza frase citata nel testo, vuoto.
- **Natura dei massimali dalla TESTA della descrizione** (`structuralNature`,
  mai id/label): "per singolo sinistro … per i Danni cagionati" è per-sinistro,
  non "danni"; massimale per sinistro = annuo è il caso normale (esente dalle
  guardie duplicati/anti-spill). Riga di tabella di un documento VECCHIO non
  batte un documento più recente (tableRow cede alla recency stretta).
- **Campi d'IDENTITÀ: consenso su TUTTI i documenti** (`pickConsensusCandidate`
  con `tierBlind` per i campi né strutturali né economici periodici): compagnia,
  contraente, P.IVA, indirizzo non cambiano col periodo, quindi i voti contano
  su tutto il fascicolo, non solo sul livello di data più recente (SPALLINO:
  "AIG Europe S.A." 12 volte perdeva contro "ASSITA" 2 volte dall'appendice).
  Per date/premi/massimali la recency resta sovrana. Lo stadio tabella applica
  anche il veto fonte-opzioni (tabella "polizze precedenti" del questionario).
- **Documento-questionario = lo dice il TITOLO** (`isQuestionnaireTitle` sulle
  prime righe della prima pagina); pagina-opzione = pagina di un questionario o
  riga con CASELLA e importo (`hasOptionAmountLine`). Prima bastava la parola
  "questionario" ovunque: il contratto Lloyd's (34 pagine) era un questionario
  e la sua scheda di copertura (5.000.000 / 10.000) veniva vetata come opzione.
- **Numeri spezzati dal kerning del text layer** ("€ 5 .0 00.000", "€ 1 0 .000"):
  `joinSplitNumbers` (pdfTextLayer) ricompone SOLO frammenti cifre/punti la cui
  unione è un importo ben formato; due importi veri affiancati restano separati.
- **Copie identiche scartate** (stesso testo normalizzato: "quietanzata" e
  "quietanzata firmata", appendici caricate tre volte) prima dell'estrazione:
  niente chiamate doppie, niente voti moltiplicati (GUFFANTI RC 2025: 9 file
  per 4 documenti distinti, 562 chiamate, 62 minuti).
- **Cartella senza polizza principale → ACCANTONATA con la ragione** (12/09/2026,
  richiesta dell'utente): `polizzaRequireValidPolicy` ora è ATTIVO di default
  (`false` per spegnerlo); `policyEvidenceReport` dice cosa manca (nessuna voce
  di polizza / nessun importo strutturale) e il worker scrive "Accantonato — …
  Documenti letti: …" (etichetta «Accantonato» nella pagina Elaborazioni,
  stesso «Procedi comunque»). Ogni scarto di pertinenza spiega il PERCHÉ
  (parole del profilo non trovate, affinità a confronto, termini rilevati) e,
  se un altro profilo attivo è più affine, lo PROPONE («Profilo suggerito»):
  la classifica semantica gira su ogni scarto, non solo nel modo semantico.
  **Motivazione anche quando ACCETTATO** (`precheck.summary`: verdetto, ragione,
  parole trovate, termini rilevati, classifica dei primi 3 profili, avviso
  «possibile falso positivo» se un altro profilo è più affine): visibile sotto
  lo stato nella pagina Elaborazioni, nel log del job e nella colonna
  «Pertinenza» dell'export xlsx.
- **Tipo di valore vincolato dalla TESTA della descrizione** (`fieldValueKind`,
  mai label né descrizione intera): l'"Indirizzo" TL3 che cita la P.IVA di
  passaggio prendeva il pattern P.IVA/CF e il modello era costretto a 16
  caratteri ("VIAALESSANDROVOL"). Controllo di colonna dello stadio tabella con
  `headerLex` (frazione delle parole dell'INTESTAZIONE presenti nella
  descrizione, token unici): "IMPOSTE 42,78" veniva scartato per "PREMIO LORDO"
  perché "premio" compariva cinque volte nella descrizione. Colonna sbagliata
  ma riga giusta → si prende il valore della colonna la cui intestazione nomina
  il campo (stessa riga), mai vuoto. Datazione dei documenti anche con anni a 2
  cifre ("Dal 16/12/25 al 16/12/26"): la quietanza di rinnovo era "senza data". **Solo in righe di periodo e con giorno/mese validi**: senza questo
  vincolo "045 8300010"/"00/84/90" di un piè di pagina davano al Set
  Informativo la data 00/84/2090, ne facevano il documento "più recente" e il
  suo testo esplicativo vinceva su tutto (GUFFANTI TL da 87% a 35%: la causa
  vera del crollo dei tutela legale del 13/09).
- **Etichetta di LAYOUT** (`valueLabelledByLayout` + `distinctiveHeadTokens`): un
  valore che nella griglia sta dopo, o sotto nella stessa colonna, la parola
  DISTINTIVA della testa della descrizione ("DECORRENZA / 04/06/2025") è
  evidenza strutturale come una riga di tabella (tableRow, affinità ≥ 0.70):
  quattro voti per la data di firma del profilo cliente ("MILANO 14/04/2025")
  non la battono. Le parole distintive vengono dalla frequenza inversa sulle
  teste delle descrizioni del profilo (mai liste: "polizza" sta ovunque e non
  distingue). Diag: `ok·etichetta:<parola>`. **Limiti (13/09)**: vale SOLO per
  celle brevi di griglia (≤ 5 parole, separate da ≥2 spazi) e SOLO da documenti
  DATATI — un esempio del Set Informativo ("massimale 25.000") batteva il
  50.000,00 della polizza e "attività professionale" in una frase batteva
  "Servizi vari" (GUFFANTI TL 9/23). Nel consenso dei campi d'identità i
  documenti senza data votano solo se nessun candidato è datato. **Dal 13/09 pomeriggio l'etichetta di layout vale SOLO per i campi
  DATA** (`fieldValueKind === 'date'`): per importi e testi le tabelle le legge
  A.7 con le intestazioni vere, e nel Set Informativo (datato dall'edizione)
  "massimale 25.000" in una cella d'esempio batteva 5 voti per il 50.000,00
  della polizza (GUFFANTI TL 9/23 sia con la griglia sia col markdown).
- **Stadio A.7 in JSON garantito** (`format:'json'`, oggetto `{"voci":[…]}`):
  con la risposta libera un JSON malformato spegneva tutto lo stadio tabella
  (4 run su 15 senza proposte) e senza la protezione tableRow le cifre in prosa
  del Set Informativo, semanticamente più affini, battevano le celle della
  tabella premi. Consenso dei campi d'identità a maggioranza CHIARA (≥ 1,5× i
  voti del corrente): la stretta faceva vincere la targa GJ009XD (8) sul numero
  di polizza (6).
- **Import profili SOSTITUISCE per id** (13/09/2026): un profilo importato con lo
  stesso `id` di uno esistente lo rimpiazza al suo posto (si correggono le
  descrizioni senza cancellare nulla); gli id nuovi si aggiungono. Anteprima
  ("N aggiornati, M nuovi") in un pannello interno. Se il profilo attivo è tra
  gli aggiornati, campi e prompt applicati si riallineano; altrimenti nulla
  cambia. **Niente `window.confirm`/`alert`** nell'app: ogni conferma passa da
  `useConfirmPanel` (`web/components/ConfirmPanel.tsx`), pannellino fisso in
  basso a destra.
- **Profili: si toccano SOLO le descrizioni** (decisione dell'utente): la
  versione con le descrizioni riscritte è `polizze_test/profili-polizza-
  calibrato-v2.json` (stessi id, stesse label; Compagnia/Agenzia/Contraente/
  Indirizzo/Decorrenza/Scadenza/imposte/imponibile/fatturato/sinistri e i campi
  "Verifica se…" con regola Sì/No/vuoto e citazione; TL3: date dal rinnovo più
  recente, parametro/importo di regolazione dalla tabella RISCHI ASSICURATI,
  garanzie non operanti e tipologia dai soli elementi barrati). Si importa dalla
  pagina Impostazioni e sostituisce i profili con lo stesso id.
- **Tipo automatico SOLO dalla descrizione** (13/09/2026): tolta la lista di
  label ("frazionamento", "tacito rinnovo", "esclusioni"…) che marcava un campo
  come testuale; l'esempio numerico vale anche in elenco "(es. 49,05, 137,67)".
  Con le descrizioni v2 "Tacito Rinnovo"/"Frazionamento" (imposte/imponibile)
  cadevano nella lista di label e 137,67 / 618,75 venivano scartati. Nella
  somiglianza lessicale (lex, headerLex) le clausole NEGATE della descrizione
  ("NON è il premio lordo", "non confondere…", "mai…") non contano
  (`positiveDescriptionText`): "PREMIO LORDO" batteva la colonna "IMPOSTA".
- **Placeholder di ASSENZA sempre vuoti** ("non indicato", "da verificare",
  n/d — `isAbsencePlaceholder`) anche se la descrizione li cita come risposta;
  "NESSUNA"/"non previsto" restano dati se la descrizione li ammette. Date a 2
  cifre ("Dal 31/01/26") accettate da pattern e normalizzatore (prima il modello
  completava "31/01/2631"). Output degenere del decoding vincolato ("000…") →
  retry in JSON libero. Niente più regola "tutto maiuscolo = intestazione".
- **Filtro profilo↔fascicolo SEMANTICO, senza soglie** (`rankProfilesForDocs`):
  classifica TUTTI i profili per affinità descrizioni dei campi ↔ pagine
  (bge-m3, solo descrizioni senza esempi); il pre-check 'semantic' passa se il
  profilo del job è il più affine. Nel bulk il tipo «Automatico» (`profile_id`
  'auto') fa adottare al worker il profilo più affine e congela i suoi campi.
  Le parole del contenuto (`contentKeywords`, del profilo) restano un secondo
  cancello. Verità = le descrizioni dei profili, modificabili dall'utente.
  Campo del profilo **«Come riconoscerla»** (`recognition`, testo libero): se
  TUTTI i profili in gara lo hanno, la classifica si fa su quello (definizione
  del TIPO, un descrittore per profilo); altrimenti sulle descrizioni dei campi
  (che parlano dei DATI e sono in gran parte comuni a tutti i profili). Mai le
  due scale mescolate. Flag del profilo **«Attivo»** (`enabled`, assente =
  attivo: export/import retrocompatibili): un profilo non attivo (in
  composizione, di test) è escluso dal riconoscimento automatico, dal
  confronto del pre-controllo e dall'auto-riconoscimento da nome cartella;
  resta selezionabile a mano.

- **Nome file MAI nei prompt** (13/09/2026): i marcatori di pagina sono
  `[Documento N · pag. P]` (`stagedDocTag`, `d.ord` assegnato dopo la
  deduplica); il modello risponde `"documento": "Documento N"` e `matchRealDoc`
  risolve l'ordinale. Col nome file nel contesto il modello lo copiava nei
  campi (GUFFANTI RC 2025: "GUFFANTI GROUP", prefisso di tutti i file, 21 voti
  come compagnia; numero di appendice e "proroga fino al 30 06 2025" letti dal
  nome). Un valore presente solo nel nome file ora non ha evidenza e cade.
- **Guardie "di concetto" sul testo del campo RIMOSSE** (13/09/2026):
  `agenzia=compagnia`, `contraente=compagnia`, `compagnia=contraente`,
  `rinvio-attivita` (scartava OGNI valore sotto 12 caratteri, quindi "Sì"/"No")
  e `premio-copertura-diversa` (per NOME file). Erano regex su id+label+
  descrizione: con descrizioni che nominano gli altri concetti per escluderli
  ("NON è l'intermediario") colpivano il campo sbagliato e buttavano i valori
  giusti (Lloyd's scartato 15 volte dalla compagnia, Guffanti Group 30 volte
  dal contraente). Restano solo esclusioni di ARTEFATTI: nome file, frammento
  JSON (`looksLikeJsonFragment`), "Documento N", importo con zeri iniziali
  (pattern JSON Schema/GBNF e sanitize: "06457990965" non è un importo).
- **"Sì"/"No" solo dove la descrizione lo chiede** (13/09/2026): un valore
  Sì/No passa `sanitizeFieldValue` solo se la descrizione pone una verifica
  ("Verifica se…", `descriptionAsksVerification`) o nomina Sì/No come risposte;
  un campo che chiede un elenco testuale non riceve "Sì" (SPALLINO RC:
  Esclusioni particolari = "Sì").
- **Zero dal testo libero = segnaposto** (13/09/2026): nei batch di gruppo e nel
  recupero uno "0"/"0,00" senza etichetta di layout non entra nel merge
  (`placeholder:zero`): il modello lo scrive per "non è in questa pagina" (95
  voti su 102 per un massimale; "Tasso 0" come valore finale su GUFFANTI TL).
  Le celle di tabella dello Stadio A.7 ("Interessi 0,00", "Diritti 0,00" delle
  quietanze TL, attesi dai golden) restano dati: A.7 non passa da lì.
- **Consenso: testo corrente = un voto per documento; varianti di testo
  sommate** (13/09/2026 sera): un valore che sta su ≥80% delle pagine di un
  documento di ≥4 pagine (`isRunningTextInDoc`: sede della compagnia nel piè
  di pagina, nome prodotto "DAS Professionista" nell'intestazione) è
  `boilerplate` e nel consenso conta UNA volta per documento, non una per
  pagina (GUFFANTI/BOLCHINI TL: 12 voti contro 3 per l'indirizzo del
  contraente, che sta solo nel frontespizio). Le varianti dello stesso TESTO
  ("VIALE CATERINA DA FORLI' 32" / "… 32 - 20146 MILANO") sommano i voti nel
  gruppo del testo contenuto (solo valori con lettere: gli importi restano
  esatti). Un valore uguale a una chiave del formato ("valore", "evidenza") è
  un'eco e non un dato.
- **Evidenza delle date con anno a 2 cifre** (13/09/2026 sera): il modello
  risponde "16/12/2025" e la quietanza di rinnovo dice "Dal 16/12/25 al
  16/12/26"; `passesStagedEvidence` accetta la data breve intera sul contesto
  GREZZO (confini di parola, mai sei cifre dentro un telefono). SPALLINO TL:
  decorrenza/scadenza del rinnovo scartate "senza evidenza", periodo fermo al
  2024-2025.
- **Testo identico su ≥3 campi = eco** (13/09/2026 sera): dopo il merge, lo
  stesso testo libero (≥6 caratteri, non Sì/No, non campi di verifica) su tre
  o più campi resta solo dove l'evidenza è migliore (riga di tabella, poi
  affinità); gli altri si svuotano. ALZAIA TL: "Tutela Legale" risposto ad
  attività, parametro, garanzie non operanti e tipologia.
- **Due righe di tabella per lo stesso campo** (14/09/2026 notte): vince
  l'evidenza strutturale (`structLex`), poi la sola etichetta di RIGA
  (`rowLex`: "TOTALE" batte "4,245 RC Professionale" per un premio "totale"),
  poi l'affinità; a parità resta la prima. Con la stessa intestazione di
  colonna le due righe pareggiavano e decideva il rumore dell'embedding
  (GUFFANTI RC 2025 v5: premio lordo 2.250,00 della riga componente invece di
  18.000,00 della riga TOTALE, poi scavalcato da 500.000,00 di una clausola).
  Il diag di A.7 ora dice "sostituisce"/"NON sostituisce". Il testo corrente
  (`boilerplate`) si cerca ANCHE nelle pagine spaziali (`isRunningTextInAnyLayer`):
  il markdown Docling omette i piè di pagina ripetuti, la griglia no.
- **Campi di VERIFICA: risposte canonizzate dalla descrizione, MAI enum nello
  schema** (14/09/2026 notte, misurato): `verificationAnswers` legge le parole
  citate ('Sì', 'No', 'presente', 'escluso') di una descrizione "Verifica
  se…" e `sanitizeFieldValue` canonizza la grafia ("SI" → "Sì") e scarta il
  resto ("ARCHITETTI" per ODV/CDA, "presente" su un Sì/No). L'enum nello
  JSON Schema/GBNF è stato provato e TOLTO: costretto a Sì/No/null il modello
  sceglieva "Sì" quasi sempre (BOLCHINI RC 2025: 6 verifiche a "Sì" con verità
  vuota, 30/35 → 23/35); libero, scrive "non indicato" e il segnaposto cade.
- **Proprietario NEGATO dalla descrizione** (14/09/2026 notte): la clausola
  "NON è … della compagnia, dell'intermediario" di un campo F individua i campi
  G del profilo la cui testa di descrizione contiene quelle parole
  (`negatedOwnerFields`, nessuna lista). Dopo il consenso, un candidato di F
  che è TESTO CORRENTE (boilerplate) e la cui finestra contiene il valore
  estratto di un G appartiene a G: "Via Enrico Fermi 9/B, Verona" nel piè di
  pagina accanto a "D.A.S. Difesa Automobilistica Sinistri" è la sede della
  compagnia (GUFFANTI/BOLCHINI/SPALLINO TL, tutti e tre). Si ripete la scelta
  tra i candidati rimasti. Le DATE non sono campi d'identità: il consenso su
  tutti i documenti non vale per decorrenza/scadenza (SPALLINO TL: la polizza
  vecchia batteva la quietanza di rinnovo col voto cieco).
- **Seed P.IVA: campo per TESTA di descrizione** (14/09/2026 notte): il campo
  P.IVA/CF del seed si trova sulla testa della descrizione, non su
  label+descrizione intera ("NON è … la partita IVA della compagnia" nella
  descrizione del numero di polizza faceva finire lì il ripiego: N° Polizza =
  codice fiscale dei Lloyd's). Il testo corrente NON conta come rumore per i
  campi la cui descrizione (parte positiva) prevede il dato "nell'intestazione
  di ogni pagina" (`descriptionAllowsRunningText`): il numero di polizza in
  testa a ogni pagina è il dato, e collassato a un voto perdeva dal "Quote Id".
- **Domanda di modulo ≠ evidenza** (14/09/2026 notte): per un campo di
  verifica, una citazione che contiene TUTTE le risposte ammesse dalla
  descrizione ("…incarichi di Amministratore di Stabili? Sì No", "Richiesta di
  Risarcimento SI X NO") è la domanda del questionario con le sue opzioni:
  scartata (`isFormQuestionEvidence`, diag `evidenza:domanda-di-modulo`).
  SPALLINO RC: Sindaco/ODV/Progettazione/Merloni "Sì" con quella prova.
- **Testi riordinati dal modello: confronto per TOKEN** (14/09/2026 notte): il
  modello riscrive "37135 Verona - Via Enrico Fermi, 9/B" come "Via Enrico
  Fermi, 9/B - 37135 Verona"; la stringa intera non è più nel testo e il
  candidato restava senza sorgente (né data, né testo corrente, né proprietario
  negato: l'indirizzo DAS vinceva in 3 TL su 3). Ora `findStagedSource`,
  `isRunningTextInDoc` e il controllo del proprietario negato usano anche
  "tutti i token del valore (≥3 caratteri) nella stessa pagina"
  (`valueTokens`/`pageHasValueTokens`), solo per valori con lettere.
- **Valore uguale a quello di un proprietario negato = suo dato** (14/09/2026
  mattina): nel controllo del proprietario negato un candidato di F il cui
  valore coincide (o si contiene, per testi ≥ 8 caratteri) con il valore
  estratto di un campo G proprietario negato viene scartato a prescindere dal
  testo corrente (N° Polizza = P.IVA del contraente; Compagnia = contraente,
  ora esplicito nella descrizione v2). Il flag `boilerplate` resta sempre
  calcolato; l'esenzione "intestazione di ogni pagina" agisce solo sul
  conteggio dei voti (`runningTextAllowed`). Parole vuote della testa estese
  ("Nome o ragione sociale del contraente" → concetto "contraente").
- **Evidenza da pagina di questionario per una VERIFICA** (14/09/2026
  mattina): scartata (`evidenza:pagina-questionario`) se la descrizione del
  campo non nomina questionario/proposta come fonte nella parte positiva
  (`descriptionNamesQuestionnaire`; "un elenco di attività del questionario
  NON è una copertura" è negazione). Sinistri, che dice "nel questionario o
  nella proposta", la accetta. SPALLINO RC: "Incarichi di Sindaco/Revisore dei
  Conti" (riga dell'elenco attività) citata come prova di "Sì". La regola
  "testo corrente accanto al proprietario" vale solo per i campi che non
  prevedono il dato in intestazione/piè di pagina (`runningTextAllowed`):
  "AIG Europe S.A." in testa a ogni pagina era scartato come dato del
  contraente perché la finestra del frontespizio contiene anche il contraente.
- **Etichette NEGATE dalla descrizione** (14/09/2026 mattina): le citazioni
  dentro una clausola "NON è…" ("accanto a 'Sede legale', 'Sede e Direzione
  Generale', 'Rappresentanza Generale'") sono etichette di ciò che il campo NON
  è (`negatedQuotedLabels`, solo virgolette vere, mai gli apostrofi di
  "l'indirizzo"); un candidato la cui finestra nel documento contiene una di
  quelle etichette è scartato (`etichetta-negata:<etichetta>`). Nasce dai TL
  DAS: la sede "Sede e Direzione Generale: 37135 Verona - Via Enrico Fermi 9/B"
  sta su 4 pagine su 6 (non è testo corrente) e il nome della compagnia non
  le sta accanto: solo l'etichetta la distingue. `findValueWindow` trova anche
  i testi RIORDINATI dal modello (finestra attorno al token più lungo con tutti
  gli altri dentro), così affinità ed etichette funzionano anche lì.
- **Etichetta negata di UNA parola solo con i due punti** (14/09/2026): la
  citazione 'Sinistro' nella clausola "NON considerare … la definizione di
  'Sinistro'" svuotava le risposte vere di Sinistri (la parola sta ovunque);
  un'etichetta di una parola conta solo come "Sinistro:" nel testo, quelle di
  più parole ('Sede e Direzione Generale') per semplice presenza. Nel
  proprietario negato gli importi si confrontano per CIFRA ("3.000.000,00" =
  "3.000.000"): il fatturato uguale al massimale cadeva e tornava con l'altro
  formato. **Ritirato (misurato)**: per gli importi il proprietario negato
  NON decide più — il campo proprietario può essere quello sbagliato
  ("massimale visto leggero" 3.000.000 inventato svuotava il fatturato vero);
  gli importi doppi restano alla guardia duplicati (lex / riga di tabella).
- **Annuo < sinistro: ripresa dai candidati** (14/09/2026): quando la
  coerenza cross-field svuota il massimale annuo (impossibile < sinistro), si
  riprende tra i candidati che il modello aveva proposto per l'annuo quello
  coerente (≥ sinistro), il più votato poi il più affine; mai calcolato.
  BOLCHINI 2025: "20.000,00" (sottolimite) batteva due voti per "1.000.000,00"
  e l'annuo restava vuoto. Agenzia PANIZZA di BOLCHINI 2025 sta solo nella
  polizza SCANSIONATA (il testo pdf.js non la contiene): non estraibile senza OCR.
- **Valore marcato da etichetta negata: fuori ovunque** (14/09/2026): la sede
  DAS compare in più contesti (sede, reclami, piè di pagina) e solo alcune
  occorrenze stanno accanto a 'Sede e Direzione Generale'; se anche UNA
  occorrenza è scartata per etichetta negata, il valore (chiave per token,
  indipendente dall'ordine: `valueKey`) è marcato per quel campo e dopo il
  merge si sostituisce con i candidati non marcati (`STAGED_TAINTED`, diag
  "Etichetta negata, valore marcato"). GUFFANTI TL v9 = 20/23 con l'indirizzo
  giusto; SPALLINO/BOLCHINI TL lo prendevano ancora da altre pagine.
- **Seed di ripiego sanitizzati; etichette negate su finestra STRETTA**
  (14/09/2026): il seed regex di una data aveva catturato la riga "Data di
  continuità: dalle ore 24.00 del…" e il ripiego la metteva in Decorrenza
  (BOLCHINI 2025 v10): ogni seed passa da `sanitizeFieldValue` prima di
  riempire un campo vuoto; per i campi di tipo DATA (testa della descrizione,
  `fieldValueKind`) solo date. Le etichette negate si cercano in una finestra
  di ±80 caratteri (`winShort`): con ±200 "Data di continuità" della riga
  vicina faceva cadere la decorrenza vera del frontespizio.
- **Etichette negate su TUTTE le occorrenze del valore** (14/09/2026
  pomeriggio): `valueWindows` restituisce le finestre di ogni occorrenza
  (esatte e riordinate); la sede DAS sta anche nel paragrafo reclami ("DAS SpA
  - Via Enrico Fermi 9/B - 37135 Verona", senza etichetta) e la PRIMA
  occorrenza esatta era quella, così 'Sede e Direzione Generale' non si vedeva
  mai e SPALLINO/BOLCHINI TL tenevano la sede della compagnia come indirizzo.
- **Affinità sempre misurabile** (13/09/2026): se il candidato non si localizza
  in un documento (valore solo nella griglia spaziale o in una tabella
  riparata) la finestra si cerca nel CONTESTO della chiamata. Un candidato con
  affinità `null` era cieco per l'arbitro e vetato dal consenso anche con 5 voti.
- **Sorgente di un importo con decimali** (13/09/2026): `findStagedSource`
  prova anche la sola parte intera ("5.000.000,00" vs "€ 5.000.000"), come già
  `findValueWindow`; senza, il candidato giusto restava senza documento (né
  data né affinità) e 5 voti perdevano contro un importo letto una volta.

- **Excel del singolo dossier con i campi del JOB** (15/09/2026): il pulsante
  «Excel» della pagina Elaborazioni manda a `/api/polizza/export-new` anche
  `fields: job.field_defs`; prima `exportNewExcel` usava sempre il profilo
  ATTIVO nelle Impostazioni e un dossier RC esportato con attivo un profilo
  Tutela Legale usciva con 23 righe vuote (le chiavi dei valori sono gli id
  dei campi del job). L'export di batch usava già i `field_defs` dei job.

- **Portafoglio Compare: «Uguale a» dentro Comparazione, fuzzy a soglie %**
  (17/09/2026, richiesta dell'utente): la Comparazione ha DUE bottoni,
  «Differenze» (storica) e «Uguale a» (ex Confronto righe, sulle chiavi: basta
  una chiave uguale). Confronto righe, modalità Contiene/Diverso/Non contiene,
  filtri, nome chiave e «Stessa colonna» sono spariti dalla UI ma restano nel
  codice. Profili = blocco unico in Configurazione (i vecchi del Confronto
  righe compaiono convertiti). Trasformazione predefinita «Solo lettere».
  Somiglianza (`similarity` in `web/lib/compare/engine.ts`) = lettere coperte
  da tratti comuni di almeno N caratteri consecutivi ÷ lunghezza del valore più
  lungo, ordine dei pezzi indifferente; sotto la soglia bassa (50) scartata,
  tra le due «Da verificare», dalla alta (80) «Accettate». Abbinamento 1:1 per
  punteggio migliore. Test: `test/compareEngine.test.mjs`.

- **PERTINENZA = OPERATIVITÀ della copertura, filtro «Come riconoscerla»**
  (21/09/2026, dalle verifiche manuali Lucchese 1/4 e Pizzamiglio 3/9): il
  pre-controllo a parole accettava la tutela legale citata nelle condizioni
  generali o come opzione non barrata (il «punteggio» 0,67/0,33 era la frazione
  di parole trovate, soglia 0,2) e scartava una vera DAS per «ESCLUSA»
  (indicizzazione). Ora, se il profilo ha `recognition` («Come riconoscerla»,
  textarea in Impostazioni, esportata/importata col profilo) e il modo ≠ off,
  il modello legge quella definizione e le pagine più affini (embedding bge-m3
  del testo di riconoscimento vs pagine piatte; prime pagine dei documenti in
  testa; GRIGLIA spaziale nel prompt; budget da `computeSafeContextBudget` su
  8192) e risponde `esito` operante / non operante / non determinabile con
  `evidenza` COPIATA dal testo: `verifyOperativitaEvidence` la cerca nella pagina
  citata, poi nelle altre inviate (normalizzata o per token). Tabella di
  decisione in `polizzaOperativita.js` (`decideOperativita`): operante con prova
  → ok; non operante con prova → mismatch; tutto il resto (prova assente, non
  determinabile, parola «da evitare» + operante = contraddizione, guasto) →
  nuovo stato **`review` «Da verificare»**, bloccante, senza campi estratti.
  Le parole da evitare non decidono più da sole quando c'è `recognition`.
  Con `recognition` un GUASTO (Ollama/embeddings giù, risposta illeggibile)
  dà `review`, non `skipped`: scelta dell'utente («in dubbio non si estrae»),
  il dossier resta visibile e sbloccabile con Riabbina/Procedi; mai
  un'estrazione silenziosa «senza controllo» (era la lamentela del cliente).
  Profilo suggerito = un altro profilo attivo con `recognition` che risulta
  OPERANTE con prova (`suggestOperativeProfile`, primi 2 della classifica);
  tipo «Automatico» del bulk: classifica + operatività sui primi 3, si adotta
  il primo operante. Senza `recognition`: metodi storici, ma ok+suggerimento o
  skipped → review (`degradeWithoutRecognition`); `effectivePrecheckMode` è
  l'unica regola del modo effettivo (prima modo semantic + parole → «accettato
  senza controllo»). Niente «punteggio» nelle motivazioni (numeri solo nel log).
  Bozze dei testi in `polizze_test/profili-polizza-riconoscimento.json`
  (import per id). Misura: `node scripts/pertinenza-eval.mjs` contro
  `test/fixtures/pertinenza-expected.json` (13 posizioni; `--no-recognition
  --mode keywords` per il prima). Il modo salvato in produzione (`keywords`)
  resta il ripiego. **Misurato 22/09/2026** sulle 10 posizioni disponibili in
  locale (Lucchese ARAG + 9 Pizzamiglio; mancano le 3 cartelle Lucchese RC
  DUAL / Helvetia epoca): percorso storico 5/10 → operatività **10/10**.
  Quattro cose decise dalla misura, non a tavolino. **Nome della copertura**
  = le parole distintive CONSECUTIVE della testa di «Come riconoscerla»
  (frequenza inversa tra le teste dei profili, `recognitionCoverName`:
  «tutela legale»; «medica»|«sanitaria»; profili gemelli → parole non in
  tutte le teste); una parola sola («sezione», «contraente») sta ovunque.
  **Riga strutturale** = riga della griglia col nome della copertura E un
  importo o una spunta (`structuralCoverLines`: «Tutela Legale 240,00 42,06»,
  «TUTELA LEGALE Imponibile annuo € 249,06», «Tutela Legale ESCLUSA
  31.000,00»): è il «premio proprio / casella / riepilogo» della definizione;
  «TUTELA LEGALE (opzionale)» in un elenco del DIP non lo è. (1) **ordine
  delle pagine** (`selectOperativitaPages`): il primo batch è fatto SOLO di
  pagine con riga strutturale (mescolate alla prosa, il modello citava le
  condizioni invece della scheda); poi le pagine che nominano con importi,
  la prosa che nomina, i frontespizi, il resto per embedding; batch pieno →
  ci si ferma (la pagina esclusa apre il batch dopo); pagine lunghe spezzate
  in parti. Senza: la scheda BOIARDO era 47ª su 54 pagine e in 6 batch non
  arrivava mai al modello. (2) **prova di «operante»**: deve nominare la
  copertura (non «Ogni garanzia opera secondo i termini…») E stare in una
  pagina con una riga strutturale (non l'elenco opzioni del DIP di
  CAMPESTRE); altrimenti review. (3) **coerenza tra batch**
  (`combineOperativitaBatches`): «operante» dopo un «non operante» provato →
  review «esiti contraddittori»; «non operante» con pagine che nominano la
  copertura ancora non lette → review, non scarto. (4) Un **riesame
  avversario** del 7B («scettico, conferma/smentisci») è stato provato e
  TOLTO: smentiva le prove vere (DAS «ESCLUSA» = indicizzazione, BOIARDO con
  l'imponibile sotto gli occhi). Le pagine vanno al modello con `withPairs`
  (griglia + coppie etichetta→valore), come nell'estrazione. La misura è
  fragile alla composizione dei batch (stessa pagina, esito diverso con
  compagni diversi): ogni ritocco va rimisurato, mai dedotto.
- **Abbinamento separato dall'estrazione** (21/09/2026): stato **`matched`
  «Abbinato»** (`precheck.matchOnly`: bulk «🔍 Solo abbinamento», route
  `dossier` campo `matchOnly`; «🔁 Riabbina» = `resetJobForRetry({matchOnly})`,
  con profilo attuale / scelto / `auto`) → il worker si ferma dopo OCR +
  pertinenza; «▶ Estrai» (`confirmMatchAndRequeue`, `precheck.confirmed`: il
  controllo non si rifà) su riga, selezione (`bulk` action `extract`/`rematch`)
  o batch (`extract-all`). «Procedi comunque» vale anche su `review`. L'OCR è
  in cache per hash: l'estrazione non lo ripete. Pagina Elaborazioni: chip per
  stato che filtrano le righe, colonna «Profilo» (auto → nome, «suggerito» con
  «Usa e riabbina»), motivazione strutturata (esito — Documento N pag. P:
  «prova» / motivo). Export batch: colonna «Profilo» + un foglio per profilo
  (valori di profili diversi mai sotto le stesse intestazioni).

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
