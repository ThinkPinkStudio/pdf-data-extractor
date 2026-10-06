import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Cosa sta servendo QUESTA istanza?" — verificabile in un comando, mai più a
// parole: `curl -s https://<dominio>/api/version`. Nessun dato sensibile,
// quindi niente autenticazione. La lista buildFeatures è HARDCODED e va
// aggiornata a ogni feature UI rilevante: se una feature è nella lista,
// l'istanza che risponde la sta servendo — indipendentemente da cache del
// browser o proxy.
const BUILD_FEATURES = [
  'strategy-switch',      // Impostazioni → Verifica e qualità → Strategia di estrazione (1.0.107)
  'archive-chat',         // voce Chat archivio + /api/archive/chat (1.0.107)
  'semantic-routing',     // gate campo×documento + arbitro semantico nel merge (1.0.108)
  'maintenance-panel',    // voce Dati → /maintenance + /api/admin/maintenance (1.0.109)
  'storico-ricerca',      // storico delle run + ricerca globale (25/09/2026)
  'riconciliazione',      // riconciliazione dei dossier per numero di polizza (25/09/2026)
  'think-per-fase',       // ragionamento del modello per fase + override nelle run di test (25/09/2026)
  'ocr-visivo-v2',        // OCR con modello visivo, pagine intere (repeat_penalty, trattini → spazi) (25/09/2026)
  'motore-ciclo1',        // correzioni dall'analisi dei 55 errori (prove, verifiche, A.7, date) (25/09/2026)
  'copertura-mai-nominata', // pertinenza: copertura mai nominata = non operante senza modello (25/09/2026)
  'riconciliazione-cf', // riconciliazione: niente CF come numero, copie di fuori non dividono la cartella (26/09/2026)
  'campi-compilabili', // valori dei campi AcroForm nella griglia; pagine digitali dal text layer di adesso (26/09/2026)
  'flag-motore',       // flag del motore per le run di test: campi, cascata4, a78, recupero, elenchi (26/09/2026)
  'contesto-128k',     // (storico) tetto contesto 131072; OCR visivo con 16k token d'uscita (26/09/2026)
  'contesto-256k',     // tetto contesto 262144, ridotto al nativo del modello (qwen3:30b-a3b a 256k ≈ 43 GB) (26/09/2026)
  'non-valido',        // senza polizza = Non valido, mai estratto né forzabile; domanda sulla polizza sempre (26/09/2026)
  'pertinenza-questionario', // «non operante» provato solo in pagine di questionario non contraddice il contratto; nome copertura in ogni forma sul frontespizio (26/09/2026)
  'flag-verifiche',    // flag del motore «verifiche»: le verifiche possono citare con parole diverse (26/09/2026)
  'riepilogo-generale', // Riepiloghi: polizze estratte dello stesso profilo sommate per anno, confronto, export (26/09/2026)
  'riconcilia-esistenti', // Riabbina di batch con «Riunisci prima i dossier con lo stesso numero di polizza» (26/09/2026)
  'riconcilia-frammenti', // riconciliazione: niente frammenti di numero, numero a destra dell'etichetta; «Separa per cartella d'origine» (26/09/2026)
  'pertinenza-prodotto', // «non determinabile» non contraddice un «non operante» provato; prova di un prodotto TL dal documento che la nomina (26/09/2026)
  'pertinenza-documento', // il documento che nomina la copertura su tutte le sue pagine; regola (a) senza i «no» della scheda; frontespizio dal titolo (26/09/2026)
  'pertinenza-spunte',   // ✓ punto elenco ≠ spunta, «art. 6,13» ≠ importo, riga ‡ con importo coi decimali; fine dello stream Ollama nel log (27/09/2026)
  'estrazione-sandwich', // pagine immagine + OCR invisibile dello scanner → OCR; intestazione di colonna ≠ valore (A.7); imponibile = imposte svuotati (27/09/2026)
  'manutenzione-bulk',  // Manutenzione: lista dei batch con caselle, filtro ed «Elimina selezionati» (28/09/2026)
  'elaborazioni-elimina', // Elaborazioni: caselle su card dei batch e risultati della ricerca, «Elimina selezionati» (28/09/2026)
  'elaborazioni-azioni', // Elaborazioni: sulla selezione (batch e polizze trovate) Estrai, Riabbina, Riabbina ed estrai, Procedi, Riprova, Con profilo, Annulla (28/09/2026)
  'elaborazioni-ultimo-lancio', // Elaborazioni: card e intestazione del batch mostrano l'ultimo lancio (data e chi), non il caricamento (28/09/2026)
  'elaborazioni-parola-da-evitare', // Elaborazioni: i fascicoli fermi per una parola da evitare del profilo lo dicono (testa «Parola da evitare «x»», riquadro nel dettaglio), non «prova respinta» (28/09/2026)
  'preventivi-riunisci', // Preventivi/proposte/quotazioni senza numero di polizza fuori dalla domanda sul contratto e mai prova di acquisto; riunione per numero di polizza accesa di default in ogni Riabbina di batch; nuovo tentativo a metà batch su risposta illeggibile; campi importo solo importi (03/10/2026)
  'forzate-copertura-assente', // Estrazione forzata di una polizza che non nomina mai la copertura: i campi della copertura restano vuoti; riconciliazione con numeri letti diversi dall'OCR (03/10/2026)
  'datazione-colonne-frontespizio', // Datazione dei documenti senza date dell'impresa/timbri/eventi e letture OCR isolate, preventivi senza data; A.7: colonna di un altro campo importo, recency tra righe; A.8 dal documento più recente; frase negata come etichetta (03/10/2026)
  'testo-cella-completamento', // Campi di testo: la cella della scheda batte la prosa delle condizioni e l'opzione del solo questionario (anche «Valutazione delle richieste ed esigenze»); A.7 completa la riga del premio per i campi «sulla stessa riga»; casella iniziale tolta (04/10/2026)
  'illeggibile-quarti', // Pertinenza: una metà di batch ancora illeggibile si divide di nuovo (fino ai quarti) prima del «Da verificare» (04/10/2026)
  'date-piu-recenti', // Arbitro: l'affinità non fa vincere una decorrenza/scadenza più vecchia (04/10/2026)
  'contratto-prompt-originale', // Domanda sul contratto: tolta la coda sui preventivi (una polizza scansionata senza numero diventava Non valida); i preventivi li toglie la regola deterministica (04/10/2026)
  'zero-stampato-sezioni', // Lo 0,00 sotto la colonna che nomina il campo (interessi DAS) non è un segnaposto; flag «sezioni» per A.7 (04/10/2026)
  'sandwich-docling-ritirato', // Ritirata la lettura OCR per tutto nei documenti «sandwich» del ramo Docling: su BOIARDO (P45) non sistemava le date e metteva testo OCR illeggibile tra i candidati della compagnia (04/10/2026 sera)
  'flag-zeri', // Flag «zeri» (spento): in A.7 un importo stampato a zero è un valore quando la descrizione lo prevede (interessi, diritti) (05/10/2026)
  'forzate-tutti-i-campi', // Estrazione forzata: si estraggono TUTTI i campi del profilo; tolta la regola che svuotava i campi della copertura «mai nominata» (05/10/2026, decisione dell'utente)
  'zeri-default-righe', // Flag «zeri» acceso di default; flag «righe» (spento): in A.7 la riga la sceglie la descrizione, senza istruzioni fisse né esempi (05/10/2026)
  'flag-date8', // Flag «date8» (spento): le date del frontespizio sono provvisorie, la cascata le chiede anche ai documenti più recenti (05/10/2026)
  'flag-filtroelenchi', // Flag «filtroelenchi» (spento): nei campi-elenco il modello tiene solo le voci che la descrizione ammette (05/10/2026)
  'zeri-spento', // Flag «zeri» di nuovo spento: misurato 539 → 534 su 28 posizioni (lo zero spinge il modello sulla riga «PREMIO ANNUO» delle schede DAS) (05/10/2026)
  'illeggibile-pagina-singola', // Pertinenza e domanda sulla polizza: un batch illeggibile (modello in loop) si divide fino alla pagina singola (05/10/2026, CAVALLO FT394VX)
  'pertinente-incompleta', // Non valido «Pertinente ma incompleta – reperire la polizza principale» quando i documenti (appendici, quietanze) si riferiscono a una polizza del profilo (05/10/2026, richiesta del cliente)
  'filtroelenchi-default', // Flag «filtroelenchi» acceso: un campo-elenco le cui voci il modello giudica TUTTE estranee alla descrizione resta vuoto (+7 campi, 0 persi sulle copie del 05/10)
  'riconciliazione-contenuto', // Riconciliazione solo dal CONTENUTO: numeri noti in tutto il documento, PDF con più polizze divisi per pagine, nessuna regola sulle cartelle (04/10/2026)
  'riepilogo-default', // Flag «riepilogo» acceso: stessa riga/stesso riepilogo per valore, lordo comprensivo, legame transitivo, diritti = imposte, imponibile per esclusione (+11 su 41 posizioni, misura offline del 05/10); riga della copertura col profilo del job (gli id dei campi si ripetono nei profili clonati)
  'flag-riepilogo', // Flag «riepilogo» (stessa riga/stesso riepilogo del campo legato, lordo comprensivo dalla riga delle componenti, diritti = imposte)
  'pertinenza-default', // Flag «primepagine» e «coppietesto» accesi: domanda sulla polizza col primo batch di sole prime pagine; coppie etichetta→valore anche per i testi nella pertinenza (prova del 06/10 su 41 fascicoli: GOLDONI estratta, nessun esito peggiorato)
  'flag-primepagine', // Flag «primepagine»: domanda sulla polizza, primo batch con le sole prime pagine
  'flag-coppietesto', // Flag «coppietesto»: nella pertinenza, coppie etichetta→valore anche per i testi sotto l'intestazione di colonna
  'date-impossibili', // Date con un giorno che il mese non ha (31/09, 30/02) scartate: lettura sbagliata dell'OCR
  'ocr-scansioni-default', // Flag «ocrsoloscansioni» acceso: OCR visivo (polizzaOcrEngine) solo nei fascicoli di sole scansioni; prova del 06/10 con qwen3-vl:32b P07 0→19, P37 16→21, P24 16→20, P22 14→17
  'flag-ocrsoloscansioni', // Flag «ocrsoloscansioni»: OCR col modello visivo solo nei fascicoli di sole scansioni (Tesseract dove c'è testo digitale), nel worker e nella lettura preliminare
  'flag-citazioneriga', // Flag «citazioneriga»: pertinenza, prova che salta parole in mezzo alla riga del premio (due parole e due importi in ordine su una riga)
  'fuoco-default', // Flag «fuocopolizza» acceso: estrazione sui soli documenti della polizza provata dalla pertinenza (P03 15 → 21 su 23, prova del 06/10)
  'flag-fuocopolizza', // Flag «fuocopolizza»: estrazione sui soli documenti della polizza provata dalla pertinenza
  'garanzie-colonna', // Flag «garanziecolonna» acceso: l'elenco delle garanzie scelte della copertura dalle righe con premio nella colonna della copertura, se il valore estratto non ne nomina nessuna (P27 «Difesa Condominio»; replay +1 −0)
  'riga-coerente', // Flag «riepilogo»: le voci comprese nel lordo dalla riga dove imponibile + voci = lordo (LAMBRATE P32: imposte 47,32 della rata successiva, non 46,79 della riga della garanzia)
  'riepilogo-dettagliato', // Flag «riepilogo»: lo stesso premio (stesse imposte e lordo) stampato altrove con le voci separate: se imponibile + diritti/interessi della riga = imponibile estratto, si prendono dalla riga (GOLDONI P30: 162,47 = 159,99 + 2,48)
  'flag-a7ripiego', // Flag «a7ripiego» (spento): una proposta di A.7 la cui riga e colonna non nominano il campo («Categoria» per l'Attività) è solo ripiego e il campo si chiede alla cascata
  'sezione-copertura', // Flag «altresezioni»: l'importo della prima riga della «SEZIONE <copertura>» sotto l'etichetta che nomina il campo («Imponibile annuo € 343,86» di Vittoria P44/P45) prima del riepilogo (replay del 06/10: +3)
  'oltre-il-lordo', // Flag «riepilogo»: una voce che la descrizione del lordo dice compresa (imposte, diritti, interessi) e che lo supera si svuota (Unipol P01: imposte 108,51 del contratto contro lordo 21,37 della tutela legale)
  'altre-sezioni', // Flag «altresezioni» acceso: in un documento con una «SEZIONE <copertura>» un importo dei campi della copertura che compare solo in altre sezioni si svuota (Vittoria P39/P41: «Franchigia 300» dell'acqua condotta; replay del 06/10 +2 −0)
  'flag-coppiecopertura', // Flag «coppiecopertura» (spento): pertinenza, nelle coppie etichetta→valore le celle col premio sotto la colonna intestata alla copertura (DAS OneClick P16/P18: «TUTELA LEGALE» → 24,00)
  'flag-datagriglia', // Flag «datagriglia» (spento): un documento che il markdown lascia senza data si data dalla griglia OCR (quietanze «sandwich» P39/P44/P45); «date8» mirato: date del frontespizio provvisorie solo se un documento datato è più recente, e lì vince la data più recente del documento più recente
  'riepilogo-non-stampata', // Flag «riepilogo»: diritti/interessi/imposte letti in una colonna di tabella che non li nomina si svuotano (la voce non è stampata); poi l'imponibile per esclusione (P19 18 → 21, replay del 06/10)
  'riga-griglia', // Flag «rigagriglia» acceso: dopo il merge, importo della copertura dalla sua riga nella stessa colonna dei totali; campi «sulla stessa riga» del premio dalla cella sotto l'intestazione che li nomina (+19 −1 su 41 posizioni, misura offline del 05/10)
]

export async function GET() {
  return NextResponse.json({
    version: process.env.NEXT_PUBLIC_APP_VERSION || 'n/d',
    buildFeatures: BUILD_FEATURES,
    now: new Date().toISOString(),
  })
}
