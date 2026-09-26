# PDF Data Extractor — memo per l'assistente

> **PRIMA di agire leggi [REGOLE_AGENTI.md](REGOLE_AGENTI.md)**: estrazione per
> DESCRIZIONE soltanto (mai id/label nei prompt), contesto default 8192 (massimo
> 32768, configurabile, sul server da 48 GB), una sola
> run alla volta (anche in produzione, con lock condiviso), **NESSUN guardrail
> "indovinato" (soglie/valori inventati)**: si estrae associando l'etichetta al
> valore adiacente nel layout (testo o tabella), vuoto se non trovato. Vincolante
> per ogni agente. **Regola 4**: ogni misura è su TUTTI i campi del profilo
> (denominatore = dimensione del profilo), con una verità per ogni campo (valore o
> vuoto): niente "verificati", niente selezioni.

Fatti d'ambiente e decisioni prese. NON richiederli all'utente: sono già qui.

## Infrastruttura (produzione)

- **Deploy web**: Coolify v4 (progetto "CSA PDF Extractor", ambiente `production`).
  **Il container di produzione usa `test_branch`, NON `main`** (confermato
  dall'utente il 25/09/2026): ogni DEPLOY di `test_branch` va al cliente
  (https://genius.csabroker.it). **Il push NON deploya** (26/09/2026): Coolify
  sta dietro la VPN e i webhook di GitHub non arrivano; il deploy si lancia a
  mano da Coolify o con `scripts/deploy-prod.mjs` (API Coolify, token
  deploy+read fuori dal repo: pusha, mette PAUSE, aspetta la produzione libera,
  deploya, verifica i marcatori). Prima di misurare, controllare in
  `/api/version` il marcatore `buildFeatures` del codice atteso (golden-prod
  ora lo registra in summary.json). **A temperatura 0 le run sono
  deterministiche**: stesso codice e stessa configurazione danno gli stessi
  valori (qwen2.5 senza flag sul codice del 26/09 = run b1, 0 differenze),
  quindi una differenza tra due configurazioni è segnale, non rumore. `main` è fermo alla 1.0.153 e la versione
  mostrata resta 1.0.153 anche col codice nuovo: per sapere cosa gira, provare
  una route recente. Mai pushare mentre gira una misura in produzione (il
  redeploy riavvia il server a metà run). Storicamente: merge su `main` →
  build automatica + bump versione (`chore: bump version to 1.0.NNN`). La versione deployata è visibile in Impostazioni accanto al
  titolo e su `GET /api/version` (con lista feature per verificare cosa è
  arrivato in produzione).
- **Ollama (dal 25/09/2026)**: server dedicato `supergenius`, **192.168.100.72**
  (sottorete diversa da Coolify, instradata), **RTX 6000 Ada 48 GB VRAM**,
  Ollama nativo (systemd, `OLLAMA_HOST=0.0.0.0:11434`, firewall ufw aperto
  solo agli IP ammessi). URL dalla web app: `http://192.168.100.72:11434`.
  Il contesto si alza da Impostazioni tecniche («Tetto contesto batch», fino a
  32768); «Riabbina» ha l'opzione «Estrai subito dopo l'abbinamento».
- **Ollama storico**: gira in **Docker su Coolify**, risorsa `ollama-with-open-webui`
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

- **Ciclo correzioni 25/09/2026 sera (analisi di 55 errori dei golden in
  produzione, workflow con revisore avversario)**: (a) prova degli importi
  piccoli (< 4 cifre intere) = numero intero nel testo o citazione che lo
  contiene — un 5,84 CALCOLATO non passa più; numeri spezzati dal kerning
  ricomposti anche nelle griglie lette dalla cache (`rejoinCachedGrid`,
  modulo `splitNumbers.js`); confini delle cifre (50000000 non sta dentro
  250000000) e ricerca del valore limitata alle pagine della chiamata;
  (b) date con anno a 2 cifre valide solo se la parola del periodo è LEGATA per
  posizione alla data (o seconda di una coppia crescente): il piè di pagina DAS
  «Aut. D.M. del 26.11.59 … al Gruppo Generali» datava i documenti al 2059;
  (c) campi di VERIFICA: la citazione è obbligatoria e deve NOMINARE l'oggetto
  verificato (`verificationObjectPhrases` dalla testa della descrizione, parole
  non identificative per frequenza su tutte le teste del profilo), citazioni con
  «…» accettate a segmenti contigui nella stessa pagina, risposte PRESCRITTE
  dalla descrizione («scrivi 'Nessuna'») validate dalla citazione, eco di frasi
  citate nella descrizione di un ALTRO campo scartato; (d) Stadio A.7 tabelle
  DOCUMENTO PER DOCUMENTO (3 più recenti + 3 più affini), niente «il valore più
  grande», candidati A.7 nel registro del consenso, spareggio tra righe di
  tabella per numero di documenti distinti; (e) tolte le ultime letture di
  id/label nei controlli (P.IVA, nome file, frontespizio, identificativi,
  selezione caselle A.5) e la trappola inventata «un nome societario non è
  un'agenzia». Cache OCR per motore SOLO per i documenti con pagine
  scansionate (i digitali condividono la griglia con qualunque motore).
  Golden corretti: 6 verità (GUFFANTI RC Estensioni 'Nessuna', GUFFANTI 2026
  Condizioni 'Non operante', BOLCHINI TL Interessi vuoto, BOLCHINI 2026 P.IVA o
  CF, SPALLINO RC Sinistri = No). Misura: `scripts/rescore-prod.mjs`.
- **OCR CON MODELLO VISIVO (25/09/2026, riaperto dall'utente SOLO come OCR)**:
  `polizzaOcrEngine` = '' / 'tesseract' (default) o il nome di un modello Ollama
  che vede le immagini (qwen2.5vl:7b consigliato: sta in GPU col 32B di testo).
  Il modello TRASCRIVE le sole pagine senza text layer (`visionOcrPageText`,
  pagina a ~1800 px a colori, caselle come [X]/[ ]); la trascrizione entra nel
  percorso testo di sempre (prova, consenso, date). Cache OCR per motore
  (`ocrCacheKey`: `<hash>:vis:<modello>`). Provabile nelle run di test (`ocr`).
  Motivo: Tesseract leggeva «€ 1.000.000,00» come «41.000.000,00» e
  «IPD0017417» come «1PD0017417» (BOLCHINI 2025, cache OCR di produzione).
- **CAMPI COMPILABILI (AcroForm) nella griglia** (26/09/2026): i valori
  scritti nei campi di un PDF compilabile stanno nelle annotazioni widget, non
  nel contenuto della pagina, e pdf.js `getTextContent` non li restituisce: il
  modello riceveva «CONTRAENTE:» col vuoto (Mastrantonio: numero, contraente,
  indirizzo SOLO nei campi), le quietanze GUFFANTI senza importo/data di
  quietanzamento, il questionario SPALLINO senza «€ 385.000,00» né risposte.
  `formFieldItems` (pdfTextLayer) li mette nella griglia nella loro posizione
  (testo, scelte; caselle come [X]/[ ]; nascosti e pulsanti fuori), solo su
  pagine che hanno già testo (una scansione con un campo data non deve saltare
  l'OCR). Le pagine DIGITALI lette dalla cache OCR si prendono dal text layer
  di adesso (`withFreshTextLayer`, worker e riconciliazione): prima una
  correzione del percorso testo non arrivava mai ai fascicoli già visti; le
  scansioni restano l'OCR in cache. Da misurare sui golden (cambia il testo di
  GUFFANTI RC, SPALLINO RC): è dietro il flag `campi`. Rischio visto: il
  questionario SPALLINO (senza data) prende il 31/03/2026 dal periodo
  «31.3.25-31.3.26» della tabella delle polizze in corso e passa davanti alla
  polizza del 2016 (ASSITA, massimale 2.000.000 come distrattori).
- **FLAG DEL MOTORE per le correzioni da misurare** (26/09/2026,
  `src/services/engineFlags.js`): una correzione nuova entra SPENTA dietro un
  flag; le run di test la accendono (`polizzaEngineFlags` nell'override,
  golden-prod `--flags campi,…`) e la si misura sull'app deployata contro la
  stessa base, con UN solo deploy. Promossa → entra in `DEFAULT_FLAGS`;
  bocciata → si toglie il codice. La prima riga della diagnostica elenca i
  flag attivi. Nomi in minuscolo. Flag del 26/09 (dall'analisi dei 55
  errori, parti approvate dal revisore): `campi` (AcroForm nella griglia),
  `cascata4` (F04: cascata a 4 campi per chiamata + copie con lo stesso text
  layer), `a78` (F13: proposte A.7/A.8 provvisorie, A.7 senza etichetta del
  campo solo ripiego, A.8 dalla griglia del documento più recente senza frasi
  di layout), `recupero` (F07: Stadio E con le pagine dei batch, budget dal
  contesto, ranking semantico+IDF fuso per rango, niente label, niente
  esempio «€ 2.500.000,00» nel prompt), `elenchi` (F08 parte 2: elenco
  localizzato voce per voce). Da misurare uno alla volta (golden-prod
  `--flags`). F12 (righe sovrapposte, caselle dei font simbolici) non fatto.
  `.goldens-out/PAUSE` ferma golden-prod PRIMA della run successiva (deploy
  senza spezzare una misura).
- **A pari data il testo digitale prima dell'OCR** (`byStagedRecency`, flag
  `ocr` sui documenti dal worker): la cascata visitava per prima la scansione
  (ordine alfabetico) e ne prendeva i campi letti male.
- **Pertinenza, tre correzioni (25/09/2026, golden in produzione)**: (1) la
  riga strutturale (copertura + importo) è richiesta SOLO se «Come
  riconoscerla» ammette una SEZIONE nella sua testa (`recognitionAllowsSection`:
  TL3 «Polizza o sezione di…» sì, RC «Polizza di…» no) — 5 RC su 7 finivano
  «Da verificare» con prove come «Tipo di contratto: Responsabilità Civile
  Professionale»; (2) «non operante» provato con la RIGA della copertura che
  ha un suo importo non nullo = contraddizione → «Da verificare» (DAS
  «Tutela Legale ESCLUSA 31.000,00»: ESCLUSA è l'indicizzazione); (3) con
  l'operatività attiva il filtro regex «polizza vera» (polizza n./contraente)
  non decide (LUCCA: «Certificato N°» accantonato prima di chiedere al modello).
- **Copertura MAI NOMINATA = non operante senza modello** (25/09/2026, BESA):
  se il nome della copertura (`recognitionCoverName`, da «Come riconoscerla»)
  non compare in NESSUNA pagina del fascicolo, `coverNeverNamed` → non
  pertinente con la ragione «mai nominata», nessuna chiamata. Prima il modello
  diceva «non operante» senza poter citare l'assenza e tutto finiva «Da
  verificare» (6 dubbi su 9: vita MetLife, Cat Nat, infortuni). Per «non
  operante» il prompt chiede di copiare la riga dove la copertura compare
  (opzione non barrata, voce senza premio). Dal 26/09 la domanda sulla
  POLIZZA si fa anche qui (una chiamata): senza polizza è Non valido.
- **Ragionamento per fase** (`polizzaThink`: off | abbinamento | estrazione |
  tutto; solo modelli che ragionano, qwen3 & co.): il pensiero resta fuori dal
  JSON. Default off; A/B nelle run di test.
- **VISION DISMESSA** (come percorso di ESTRAZIONE: immagini → campi): NON
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
- **Golden a VERITÀ PIENA (25/09/2026)**: `node scripts/calibrazione-goldens.mjs
  --full --ollama http://192.168.100.72:11434 --model <m> --out .goldens-out/<tag>`
  = i 13 fascicoli di `FULL_CASES` (golden-cases.mjs, cartelle lette
  ricorsivamente, profili di `profili-polizza-riconoscimento.json`), punteggio
  `scoreFullTruth` (polizzaEval.js): giusti/N con N = campi del profilo, vuoto
  giusto se la verità è vuota, `yes`/`emptyOrNo`/`anyof`, «Label#i» = campo di
  indice i; i campi senza verità contano sbagliati. Riepilogo in
  `<out>/summary.json`. EULIP escluso (golden parziale 13/24).
  `calibrazione-run` ora chiude il worker OCR ed esce (prima restava appeso).
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
  richiesta dell'utente; dal 26/09/2026 **NON VALIDO, non forzabile**, deciso
  dalla domanda al modello e non più dalla regex: vedi «Sole quietanze» sotto
  la PERTINENZA): `polizzaRequireValidPolicy` ora è ATTIVO di default
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
  **Impostazioni GLOBALI in Impostazioni tecniche** (22/09/2026, richiesta
  dell'utente): la card «Verifica e qualità estrazione» (modello fascicolo
  intero, passate di consenso, campi da verificare, modello arbitro, strategia
  a stadi `polizzaStagedCascade`, pre-controllo `polizzaPrecheckMode`) sta in
  `settings/technical` e si salva col pulsante della pagina (tolta da
  `EDITOR_KEYS` lì); non è più nella card dei campi polizza, dove sembrava
  una proprietà del profilo. **Default del pre-controllo = `llm`**
  («Classificazione col modello AI»); il valore salvato nel DB vince.
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
  **Sole quietanze → ACCANTONATA, forzabile** (decisione dell'utente,
  22/09/2026): la regola regex «polizza vera» (`policyEvidenceReport`: voce di
  polizza + parola di importo) passa anche una cartella di sole quietanze (DAS
  Alzaia: «Polizza n. …», «Premio lordo»). Perciò dopo un «operante» si fa una
  DOMANDA A PARTE al modello (`buildContrattoPrompt`: c'è il contratto —
  frontespizio, scheda, appendice con le garanzie — o solo quietanze/
  informativa/condizioni?), sugli stessi blocchi; si continua a leggere i
  batch finché non vede il contratto; se ogni batch interrogato dice
  «assente» → `setaside` → stato «Accantonato» con «Procedi comunque» (mai
  estratta da sola, mai scartata). La domanda NON va nello stesso prompt
  dell'operatività: messa lì, il 7B ribaltava DAS («ESCLUSA» → esclusione).
  Misurato 22/09: 10/10 con DAS Alzaia «accantonata» (fixture `expected:
  'accantonata'`). Il verificatore la voleva estratta: l'operatore la forza.
  **SUPERATA il 26/09/2026 → SENZA UNA POLIZZA È SEMPRE NON VALIDO, NON
  forzabile** (regola dell'utente, testuale: «SE NON HAI UNA POLIZZA NON
  ESTRAI! SENZA UNA POLIZZA È SEMPRE NON VALIDO»). Caso: ALZAIA NAVIGLIO
  PAVESE 101 Tutela legale DAS (un file, la quietanza di rinnovo): il 32B
  diceva «non operante» citando «Tutela Legale ESCLUSA 31.000,00» →
  contraddizione → «Da verificare»; la domanda sul contratto partiva SOLO
  dopo un «operante», quindi non è mai partita, e «Procedi comunque» ha
  estratto la quietanza. Ora (versione rivista dopo due revisioni avversarie
  dello stesso giorno): (1) la domanda sul contratto (`buildContrattoPrompt`,
  testo e schema invariati) è UNA del FASCICOLO, fatta PRIMA
  dell'operatività da `runContractCheck` per ogni profilo e modo (anche off),
  una volta sola nel percorso Automatico e condivisa coi profili suggeriti:
  prime pagine con testo di ogni documento, poi TUTTE le altre in ordine
  (`selectContrattoPages`, parti entro il budget), fino al primo «presente»
  o a `CONTRATTO_MAX_BATCHES` (12). Niente più domanda dentro i batch di
  operatività: la risposta dipendeva dal profilo (quali pagine l'operatività
  metteva prima) e una polizza a pag. 2 di un PDF unico diventava Non valido.
  Con «assente» nessuna chiamata di operatività. La regex «polizza vera» NON
  decide più (riga di diagnostica nel log) e `polizzaRequireValidPolicy` non
  spegne nulla. (2) `decideContract`: un «presente» valido → presente (vale
  solo se cita documento/pagina MOSTRATI in quel batch, `checkContractAnswer`);
  **assente = NON VALIDO solo se TUTTI i batch dicono «assente» e nessuna
  pagina con testo è rimasta fuori** (né documenti senza testo); pagine oltre
  il tetto → «non verificata»; un «non determinabile» o una risposta
  illeggibile tra gli «assente» → «non determinabile». Per «assente»
  documento e pagina sono null. (3) «non determinabile»/«non verificata» =
  **polizza non vista dal modello**: un «ok» (o «skipped», modo off) diventa
  «Da verificare», gli altri blocchi tengono la nota nel perché
  (`applyContractVerdict`, `decidePrecheck`): da soli si estrae SOLO con
  «presente» (una quietanza con «Tutela Legale 240,00» può dare un
  «operante» provato). Guasto → «non verificata» con `error`, mai Non valido.
  (4) Stato: `mismatch` con errore «Non valido — …» (`web/lib/jobValidity.ts`:
  UNA regola `isNotValidJob` = `precheck.notValid`, polizza «assente» o
  prefisso «Non valido»). NON forzabile: `proceed`, `extract`, `reuse` e il
  bulk rispondono 409 `code: 'not-valid'`, lo store rifiuta anche lui; in UI
  pillola/chip «Non valida»/«Non valide», unica azione Riabbina (rifà il
  controllo sugli stessi documenti), fuori da «aspettano una tua decisione».
  I vecchi «Accantonato — …» (anche dalla regex, falsi negativi veri: LUCCA
  AmTrust) restano FORZABILI («Senza polizza (controllo vecchio)»): Procedi
  comunque passa dalla guardia, che chiede al modello. (5) GUARDIA prima
  dell'estrazione nel worker (`ensurePolicy` → `policyGate`): «presente» →
  estrae; «assente» → Non valido; «non determinabile»/«non verificata» →
  estrae SOLO se l'operatore ha premuto Procedi comunque CONOSCENDO
  quell'esito (era già nel job), altrimenti «Da verificare» col perché (il
  ▶ su un abbinato non forza la polizza); guasto → Da verificare. (6) Riuso:
  mai verso un Non valido, mai da un'origine estratta forzando una polizza
  non vista (`forcedWithoutPolicy`: l'ALZAIA estratta prima del 26/09).
  Test: `test/polizzaContractCheck.test.mjs` (orchestratore con modello
  finto, `deps`), `test/uiJobState.test.mjs` (il figlio gira SENZA
  `NODE_TEST_CONTEXT`: ereditato, faceva uscire 0 anche con casi falliti).
  Fixture: ALZAIA e CAMPESTRE «RATE ANNUALI» (sola quietanza Allianz)
  `expected: 'non valido'`.
  **Gli script che fanno OCR NON terminano da soli**: il worker Tesseract
  (`_ocrWorker` in polizzaService) tiene vivo l'event loop; la misura del
  22/09 aveva finito in 5 minuti e il processo è rimasto appeso 2 ore a 0%
  CPU (scambiato per un'estrazione infinita). `pertinenza-eval` chiude il
  worker (`closeOcrWorker`) e fa `process.exit`; `calibrazione-run` no —
  se resta appeso dopo «Salvato in», è quello.
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

- **Elaborazioni riorganizzata** (22/09/2026, dalle 4 proposte UI scelte
  dall'utente: D come struttura, A e B come viste): `/polizza/jobs` = lista a
  CARD per batch (barra segmentata, «N polizze aspettano una tua decisione») +
  card «Estrazioni singole» = batch VIRTUALE `singole` che apre la STESSA
  pagina; `/polizza/jobs/[id]` = pagina del batch con URL proprio: striscia
  KPI = unico filtro, switch «Tabella | Coda» (ultima scelta in
  `localStorage.jobsView`, default Tabella; stato in query `vista/stato/
  polizza`, così un link apre esattamente quella polizza). Tabella = riga a
  44 px, pillola di stato, motivo in UNA riga, un'azione primaria per stato +
  menu ⋯, pannello laterale «Dettaglio polizza» (Pertinenza/Valori/File/Log)
  con ◀ ▶; sotto 960 px di larghezza la tabella nasconde Motivo e Campi. Coda
  = lista + lo STESSO dettaglio in linea, tastiera ↑↓ P R O. «Schema
  cartelle» = FINESTRA a parte di sola lettura (`FolderSchema.tsx`): le
  cartelle esplorate dal bulk con i conteggi per stato e le polizze come
  foglie con un puntino; niente azioni né livelli da navigare (l'utente:
  «solo uno schema, non milioni di livelli»). Nome della polizza =
  CARTELLA FINALE (`splitName`), il resto del percorso su una riga sotto
  (richiesta dell'utente). Motivo: una riga con ellissi, click sulla cella lo
  apre per esteso; interruttore «Motivi per esteso» in toolbar
  (`localStorage.jobsReasonFull`). Codice in
  `web/components/jobs/`: `actionSet.tsx` è l'UNICA regola stato→azioni,
  `useJobActions.tsx` l'unico posto delle chiamate (per le singole le azioni
  collettive sono una chiamata per job, non c'è `/batch/[id]/bulk`),
  `model.ts` le regole pure (stato di interfaccia, filtri, riga di motivo).
  Niente emoji nei pulsanti: icone SVG in `Icons.tsx`.
- **Voci di menu PDF Extractor con switch** (22/09/2026): card «Voci di menu»
  in Impostazioni tecniche, una per voce; `settings.navHiddenExtractor` (href
  nascosti), lista condivisa in `web/lib/navExtractor.ts`, letta dal layout
  server e passata alla Sidebar (`router.refresh()` dopo il salvataggio);
  «Impostazioni tecniche» mai nascondibile. Favicon in `web/app/icon.svg` +
  `icon.png`/`apple-icon.png` (il middleware lascia passare `/icon*` e
  `/apple-icon*`); i PNG si rigenerano dallo SVG con `qlmanage -t -s 512` su
  una copia con width/height 512 e poi `sips -z`.

- **Verifica del cliente 25/09/2026 (Pizzamiglio 3/9, condomìni 6/24, BESA)**:
  l'Excel di Pizzamiglio è della run col VECCHIO controllo a parole
  (`Pertinenza [keywords] … 0.33`), non dell'operatività. Correzioni:
  (1) **bulk: il profilo SCELTO vale per tutte le cartelle** — il nome cartella
  («prof», «med» come pezzo di parola) passava 4 condomìni a RC/Medica;
  il riconoscimento dal nome ora è a inizio parola e agisce solo con «Nessun
  tipo»/«Automatico»; (2) **batch di operatività**: tutti «non operante», almeno
  uno con prova, gli altri con prova non ritrovata → non pertinente (prima un
  «Sezione PA» troppo corto mandava ALZAIA 104 in «Da verificare»);
  (3) bozza «Come riconoscerla» TL: «TUTELA LEGALE / TUTELA GIUDIZIARIA»
  (Allianz «Tutela Giudiziaria SI 18,19» non era una riga strutturale);
  (4) **STORICO delle run**: tabella `polizza_job_runs`, una fotografia a ogni
  esito (done/matched/review/mismatch/error) scritta da `updateJob`; scheda
  «Storico» nel dettaglio con i valori cambiati rispetto alla run prima;
  (5) **ricerca globale** nella lista Elaborazioni (`/api/polizza/search`:
  cartella, batch, file, valori estratti; ogni parola deve comparire) → apre
  la polizza nel suo batch. Grafica invariata per scelta dell'utente («già
  così è perfetta»). Le cartelle BESA e dei condomìni NON sono in locale.

- **Polizze sparse in cartelle annidate → RICONCILIAZIONE AUTOMATICA per numero
  di polizza** (25/09/2026, richiesta dell'utente: «deve essere automatico»).
  Nessuna regola sulla STRUTTURA regge (BESA: «COI TECHNOLOGY SRL» con 3 file
  sciolti e 18 sottocartelle = 18 polizze; «…/preventivi» = offerte d'altri;
  «COSTA 1A/TUT. LEGALE» = seconda polizza), quindi decide la PROVA. I batch
  NUOVI (`batch_jobs.needs_reconcile`, TRUE da `initBatch`; i vecchi FALSE)
  aspettano «Fine caricamento», poi `polizzaReconcile.ts` legge TUTTI i file
  sotto il semaforo globale con `readPdfPagesWithOcr` (UNICA lettura
  text layer + OCR, estratta dal worker; il risultato va nella cache OCR per
  hash, l'estrazione non rifà l'OCR), trova i numeri
  (`extractPolicyNumbersFromPages`: nella cella dell'etichetta o SOTTO, nella
  colonna più vicina alla parola «polizza» — non il codice agenzia; mai la
  «polizza sostituita/precedente»; kerning «01469DAS000 40» riattaccato) e
  applica `planReconcile` (src/services/policyReconcile.js, pura, test in
  `test/policyReconcile.test.mjs`): file collegati da un numero = una
  posizione; un dossier con più posizioni è un CONTENITORE e cede solo i file
  col numero; posizioni con un numero in comune (anche col ramo davanti,
  suffisso ≥ 8 caratteri) si uniscono nella cartella dal percorso più corto;
  una cartella SENZA numeri con UNA sola polizza sotto ne fa parte. Il perché
  sta nel log del dossier («Riconciliazione per numero di polizza …»); i
  dossier svuotati spariscono. Simulato sui PDF veri (solo text layer):
  BESA TL penale, COI TL penale, Bertolotti GT724FH, cartelle doppie RC
  prodotti, Vita Zurich + rinnovo → uniti; COI/RUZZA contenitori intatti.
  Rischio noto: una cartella madre di scansioni il cui numero l'OCR non legge
  viene trattata come «senza numeri» (MORANDI 11, COSTA 1A).
  **26/09/2026 (BESA in produzione)**: mai come numero un codice fiscale di
  persona (RUZZA FABIO: «RZZFBA62T30F205P» dall'OCR, uguale in tutte le sue
  polizze) né un numero che il documento etichetta P.IVA/C.F.
  (`fiscalNumbers`); nella regola «cartella senza numeri» non conta una
  polizza sotto di lei che si unisce a una cartella di FUORI (la copia di
  Settala archiviata in «PREMENUGO/COPIE FIRMATE» teneva Premenugo in tre
  dossier). Resta separata — giustamente, per la prova — una «BOZZA DA
  APPROVARE» col numero provvisorio (EX/TPO17428237) dalla polizza definitiva
  (EX/M16548705): numeri diversi, nessun legame nei documenti.

  **Batch GIÀ CARICATI (26/09/2026, scelta dell'utente)**: i batch del
  cliente (PIZZAMIGLIO 18/09, BESA e CONDOMINI 22/09) sono anteriori alla
  riconciliazione (`needs_reconcile` FALSE). Il Riabbina di batch ha la
  casella «Riunisci prima i dossier con lo stesso numero di polizza» (body
  `reconcile: true` della bulk `rematch`, solo nei batch, non nelle singole):
  riaccende `needs_reconcile`, rimette in coda i dossier e l'orchestratore
  (`runBatch`) riconcilia PRIMA di abbinare, come per un batch nuovo. Rifiutata
  (409) se un dossier del batch è già in corso/in coda (l'orchestratore partito
  non la rifarebbe); nessun dossier rimesso in coda → flag spento. Solo NUMERO
  DI POLIZZA: stesso contraente o stessa P.IVA non uniscono mai.
  **Due unioni sbagliate nei batch del cliente (26/09 sera) e correzioni**:
  «212044» (testa comune dei numeri Vittoria rimasta dall'OCR delle copie
  firmate) univa COLAUTTI, RAMAZZINI e LIPPI → un numero che è l'INIZIO di un
  altro numero del batch più lungo di ≥4 caratteri è un frammento (solo tra i
  dossier riconciliati insieme: su una selezione parziale il numero intero può
  mancare); «NUMERO   POLIZZA   1/63317/48/165043362» (etichetta spezzata
  dall'OCR, numero a destra) non si leggeva e la Unipol di COSTA 1A, «senza
  numeri», finiva nella DAS della sottocartella → etichetta letta anche con la
  cella prima, numero anche nella cella a DESTRA (cella intera se fatta solo di
  cifre/separatori e con ≤3 lettere, mai una data), MAI se l'etichetta o le due
  righe sopra dicono sostituita/annulla/precedente (rinnovo Vittoria COLAUTTI:
  «POLIZZE SOSTITUITE … Polizza numero 212 . 044 . 0000902058»). **Separa per
  cartella d'origine** (bulk `split`, voce di menu solo se l'ultima unione è
  dopo l'ultima separazione): i file tornano nelle cartelle di `rel_path`
  (bulk: dossier = cartella; unioni manuali dell'upload si separano anch'esse
  per cartella), resta nel dossier la cartella del suo PRIMO file (l'id non
  cambia polizza: il nome dato dalla riconciliazione è il percorso più corto e
  può essere di un altro dossier), UNA transazione, dossier nuovi 'canceled' o
  riabbinati (`rematch`, anche `reconcile`); «Automatico» ripristinato, 
  `duplicate_of` azzerato (anche di chi puntava al dossier), punti Qdrant del
  dossier tolti, rifiuto con run di test in corso; 409 se nel processo gira
  ancora l'orchestratore del batch o un dossier toccato (`isBatchRunning`,
  `isJobRunning`: stato del DB e memoria possono divergere). Revisione
  avversaria: 24 difetti confermati, corretti tutti tranne i limiti scritti qui.
- **Pertinenza: polizze VERE bloccate, correzioni dalla prova** (26/09/2026,
  golden in produzione dopo «Senza polizza = Non valido», che non forza più;
  rivedute da due revisori avversari con replay sulle griglie vere di 779 PDF):
  (1) **«non operante» provato SOLO in pagine di QUESTIONARIO/PROPOSTA =
  scarto MARCATO** (`decideOperativita` → mismatch con `formEvidence`): da solo
  resta non pertinente (l'opzione non barrata del questionario delle esigenze
  è la prova più comune del non acquisto: Vittoria «Tutela Legale» senza X,
  Unipol «o la fornitura di servizi di tutela legale…» — con la prima versione
  «dubbio neutro» CASORETTO, EH448TD e RUZZA MI X4919 passavano da scartati a
  Da verificare), ma NON contraddice un «operante» provato nel contratto
  (`combineOperativitaBatches`: i formEvidence non sono `earlierNo`). BOLCHINI
  RC 2025: batch 1 = questionario AIG (righe «professionale … ⃝ X No» → ‡),
  «non operante» citando «Indicare il massimale per il quale si richiede
  copertura: € 250.000», batch 2 = polizza «operante» → prima «esiti
  contraddittori», ora ok. Vale anche per un «NO [X]» sulla riga della
  copertura: per forma non si distingue dalle domande su altro («…sub-
  appaltatori dispongano di una loro polizza per la responsabilità
  professionale? ⃝ Sì ⃝ X No» di BOLCHINI); rischio residuo: questionario «no»
  + «operante» sbagliato altrove passa (prima lo fermava la contraddizione).
  Pagina § = `isQuestionnairePageTitle` (facts registry): una CELLA della
  testa della pagina (primi 120 caratteri) COMINCIA con le parole di
  isQuestionnaireTitle — la parola «ovunque nella testa» marcava la prosa del
  contratto (Saporiti p6 «…definiti nella proposta di Assicurazione…»,
  MetLife «▪ Questionario medico-sportivo»). Per PAGINA (il questionario IDD
  rilegato nella polizza Santangelo marca solo p1/p9/p17 di 24). Prova § solo
  se TUTTE le pagine inviate che la contengono sono §. Limiti misurati:
  restano § un glossario («Modulo di Proposta / il formulario…») e un
  frontespizio-indice; le pagine di un questionario senza titolo ripetuto
  (GUFFANTI RINNOVO 2026: 6 pagine, marcata solo la 1) restano contratto →
  lì un «no» contraddice ancora (Da verificare, come prima). Tolta
  `proofIsUnselectedOption` (solo glifi ☐/[ ]: 1 riga su 8.779 pagine).
  **Scartata** (per ora): «operante» provato su pagina § → dubbio neutro
  (simmetria): bolchini-rc-2026 e guffanti-rc-2026 in produzione avevano il
  batch 1 «ok» dal questionario, ma BOIARDO/RAMAZZINI/SUSA/ZELO hanno «X Tutela
  Legale» nel questionario nello STESSO batch della scheda: se il modello cita
  il questionario la scheda non viene riletta e la polizza vera si blocca. Va
  misurata a parte.
  (2) **Nome della copertura in forma FLESSA solo sul FRONTESPIZIO**
  (`namesCoverageAnyForm`: parola intera senza le vocali finali, «medica» =
  «medico» = «medici», «sanitaria» = «sanitario»; `pageNamesCoverage`: forma
  esatta ovunque, flessa solo sulla prima pagina con testo di ogni documento,
  `first`). UNA regola per ordine dei batch (†), pagine nominate non lette,
  «mai nominata» (`coverNeverNamed(…, { titlePages })`) e prova «generica»
  (flessa solo se la prova sta sul frontespizio). Misura sulle 205 cartelle
  locali: la radice `objectRadix` (6 caratteri) faceva combaciare parole
  diverse («profes» = professione/professionista, «medic» = medicina) e su
  tutte le pagine 62 dossier su 205 perdevano lo scarto «mai nominata» per la
  RC medica (55 di altri rami; 19 per la RC V3); flessa sul solo
  frontespizio: 14 per la RC medica (5 polizze mediche vere — Badran,
  Bartoli, CALZAVARA, Kaisermann, PRINA rcprof — più PRINA tl e 8 cartelle di
  altri rami: set informativi DAS «ambito medico-sanitario», informative
  privacy), 0 per RC V3 e TL. LUCCA: «AMTRUST PROFESSIONISTA SANITARIO PROTETTO» (p1)
  nomina la RC sanitaria, «AMTRUST TUTELA MEDICI» (p2) no. Rischio residuo:
  frontespizi di altri rami col nome flesso («Giovane Medico» di PRINA tl):
  decide il modello, misura in `test/fixtures/pertinenza-negativi-expected.json`
  (8 negativi per RC V3 e RC MED). Righe strutturali (‡): sempre forma esatta.
  (3) LUCCA «non operante» con «ATTIVITÀ: PERSONALE SANITARIO NON MEDICO»
  (qwen3:32b, dal certificato di TUTELA LEGALE della pag. 2) è un errore di
  LETTURA del modello: nessuna regola di codice lo separa da un non operante
  vero. BOZZA di «Come riconoscerla» di RC PROF MED V2 (TESTA invariata:
  cambiarla cambia i nomi): professioni sanitarie mediche e non mediche, la
  professione dell'assicurato (anche «non medico») è la sua categoria, la TL
  per medici non lo è, «certificato di adesione» invece di «questionario».
  Da importare dall'UTENTE (i test controllano solo i fatti derivati: nomi,
  sezione ammessa). (C) BESA Allianz «Tutela Giudiziaria SI 18,19»: nessun
  codice, basta la testa «TUTELA LEGALE / TUTELA GIUDIZIARIA» della bozza.
  In produzione (B) e (C) dipendono dai testi che cambia l'utente.
  Misure: `pertinenza-eval.mjs` ora legge anche le fixture nel formato di
  bulk-prod (`root` + `match`: pertinenza-pizzamiglio/besa-expected.json,
  cartella + sottocartelle tranne i `match` di altri casi, come la
  riconciliazione del bulk) e SALTA un caso con file dichiarati mancanti;
  fixture golden `pertinenza-golden-expected.json` (13 casi, profilo per
  caso, allineata a FULL_CASES da `test/pertinenzaGoldenFixture.test.mjs`).
  **Misurato 26/09 mattina** (192.168.100.72, ctx 32768, modo llm, bozza dei
  profili): qwen2.5:32b golden 12/13 (BOLCHINI RC 2025 ok; LUCCA review: dice
  «operante» ma cita la riga «ASSICURATO … ATTIVITÀ: INFERMIERE…», che non
  nomina la copertura → prova generica), Pizzamiglio 9/9, BESA 8/10 (FL885YC
  Zurich bloccato ma con un batch «non leggibile»; COI FL519YE DAS bloccato:
  «Tutela Legale ESCLUSA 25.000,00» della rata letto come esclusione, poi
  nessuna prova valida — stesse pagine e stessi nomi di HEAD, non dipende da
  queste correzioni), negativi 8/8; qwen3:32b golden 12/13 (LUCCA **Non
  valido**: la domanda sulla polizza dice «certificati di adesione … non il
  contratto vero e proprio» → assente, non forzabile). Con i profili di
  PRODUZIONE (backup 25/09): LUCCA mismatch con qwen2.5 («infermiere» ≠
  «medici»), Non valido con qwen3; COI GV474DJ e PISAPIA review («Tutela
  Giudiziaria SI 18,19» non nomina «tutela legale»): servono i testi della
  bozza. Aperti (decisione dell'utente, da misurare): (i) certificato di
  adesione = polizza nella domanda sul contratto; (ii) per le coperture-
  prodotto, prova «operante» citata dal FRONTESPIZIO che nomina la copertura
  anche se la riga non la nomina (sulle 17 prove generiche delle 4 misure
  qwen2.5 cambierebbe solo LUCCA).
  **Due correzioni per i «Da verificare» dei batch del cliente (decisioni
  dell'utente, 26/09/2026 sera; in produzione 12 dubbi sui primi 30 dossier
  riabbinati, simulati a tavolino dai log):** (a) `combineOperativitaBatches`:
  un batch «non determinabile» NON contraddice un «non operante» provato dal
  CONTRATTO (non da un questionario) se nessun batch dice «operante»: è il
  batch delle pagine meno affini, dove la copertura non c'è → non pertinente
  (PIZZAMIGLIO BERTOLAZZI/CAMPESTRE/ALZAIA 104, CALDARA 7: 4 su 4 giusti per
  il catalogo; il solo «no» del questionario resta dubbio). (b) = decisione
  (ii): prova «operante» di un PRODOTTO di tutela legale (`productProof` in
  `verifyOperativitaEvidence`): se il DOCUMENTO della prova nomina la
  copertura in una delle sue prime 3 pagine inviate e la prova non sta in un
  questionario, vale la riga citata con un importo in euro coi decimali
  («Difesa Condominio 431,81 91,76 523,57» di AGRIPPA 12, dove «TUTELA /
  LEGALE» è l'intestazione della colonna spezzata su due righe) oppure una
  prova dal frontespizio che nomina la copertura e ha una riga con casella
  barrata e premio («garanzie prescelte…» sopra «[x] Difesa Penale e Civile
  99,84» della scheda «POLIZZA RAMO TUTELA GIUDIZIARIA»); in quel caso non
  servono né la parola nella riga né la riga «copertura + importo». Mai un
  numero di certificato come importo (LUCCA «TLM190942268»).

- **Riepilogo generale (26/09/2026, grafica approvata dall'utente sui
  mockup)**: il cliente spunta in Elaborazioni (pagina del batch e «Estrazioni
  singole») X polizze ESTRATTE dello stesso profilo e crea un RIEPILOGO
  SALVATO: dati sommati dove ha senso, andamenti per anno, confronto tra due
  anni. In vista Tabella «Aggiungi a un riepilogo ▾» e «Crea riepilogo» stanno
  DENTRO la barra delle azioni collettive (`extraBulk` di JobsTable), in Coda
  una barra propria; compaiono solo se la selezione ha almeno una polizza che
  può entrare. Pannello «Nuovo riepilogo»: nome, profilo fisso, «Anno da»
  (campi data, col numero di polizze che l'hanno), «valori nuovi» (live) o
  «fotografia a oggi». Voce di menu «Riepiloghi» (`/polizza/riepiloghi`,
  nascondibile come le altre, badge «nuovo» finché non la si apre); viste
  Cruscotto | Tabella per anno | Per campo | Confronto; «Esporta Excel» (Per
  anno, Polizze, Confronto A-B, Info). Codice: modulo PURO
  `src/services/summaryAggregate.js` (tipi, statistiche, ammissione, membri,
  fotografia, `summarize`; test `test/summaryAggregate.test.mjs`), regole del
  server senza DB in `web/lib/summaryCompose.ts` (test
  `test/summaryServer.cases.mjs`, lanciato da `summaryServer.test.mjs`), SQL e
  PATCH in `web/lib/summaryStore.ts`, export in `summaryWorkbook.ts`, tipi in
  `summaryTypes.ts`, route `/api/polizza/summaries` (+ `[id]`, `[id]/export`,
  `preview`), UI in `web/components/summaries/` e
  `app/(protected)/polizza/riepiloghi/`, tabella `polizza_summaries` (db.ts).
  Regole: (1) il TIPO di un campo (identificativo, verifica, data, importo,
  tasso, testo; importo «limite/condizione» → media) si legge SOLO dalla
  DESCRIZIONE (`classifyField`: fieldAsksIdentifier, descriptionAsksVerification,
  fieldValueKind, structuralNature), mai da id o label (un test sostituisce
  tutte le label); (2) entrano solo job `done`, con valori, non run di test,
  non Non validi, dello STESSO profilo (chiave = profile_id; estrazioni
  singole: firma degli id dei campi, salvata in `field_sigs` all'ingresso così
  una copia non attiva del profilo o un campo tolto nelle Impostazioni non le
  fanno uscire); doppioni per hash dei file rifiutati; l'aggiunta fa entrare le
  ammissibili e rimanda le altre col motivo; (3) LIVE = i numeri seguono le
  ri-estrazioni: job in ri-estrazione → valori dell'ultima run completata (i
  campi delle run hanno solo id e label: le descrizioni si completano dal
  profilo del riepilogo), job tornati «Da verificare»/«Non pertinente»/«Non
  valido» → esclusi, mai i valori vecchi; FOTOGRAFIA = valori copiati e
  classificazione dei campi CONGELATA (`frozen` in `snapshot.fieldDefs`: un
  ritocco del motore non cambia un report consegnato); «Congela» dice PRIMA
  quante polizze escluse usciranno; «Aggiorna la fotografia» tiene la voce
  vecchia di chi non è disponibile (tranne i Non validi); (4) Regola 4: la
  completezza ha per denominatore i campi del profilo di riferimento × le
  polizze; (5) una somma con polizze SENZA valore non è un calo: celle con «*»
  e «n di N polizze con il valore», lo scarto di una somma incompleta
  (`delta.partial`) non si colora, nell'Excel una riga «polizze con il valore»;
  colori degli scarti come nei mockup: aumento verde, calo o parità neutri;
  (6) PATCH OTTIMISTICO (letture fuori transazione, poi `FOR UPDATE` + `rev`,
  3 tentativi, 409 `conflict`): una transazione che chiede altre connessioni
  al pool lo esaurisce; (7) gli errori dell'API hanno un `code` tradotto
  dall'interfaccia (`rp.err.<code>`), i 500 non mostrano il messaggio del DB.
  Aperti: nessuna prova su Postgres (migrazione, SQL di `getJobsLight` e del
  PATCH da verificare al primo avvio); la fotografia copia dati personali
  (contraente, P.IVA) che restano dopo l'eliminazione del job; la stessa
  polizza due volte nello stesso anno è solo un avviso (`samePolicy`) e conta
  due volte; una polizza conta in un solo anno (quello del suo «Anno da»);
  anche in fotografia i valori si rileggono con i parser del motore
  (parseAmountMaybe, normalizeDateValue, isAbsencePlaceholder).

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
- Anteprima UI in locale SENZA Postgres: `next dev` muore in
  `instrumentation.ts` (initDb). Ricetta usata il 22/09/2026: pagina
  temporanea sotto `/auth/login-…` (path pubblico per il middleware) che monta
  le pagine vere con `window.fetch` simulato + try/catch TEMPORANEO su
  `initDb`; `.claude/launch.json` ha `web-dev` (porta 3005). Tutto da togliere
  prima del commit (`git checkout web/instrumentation.ts`).
- Flusso: branch di lavoro → PR su `main` → squash merge → Coolify deploya.
