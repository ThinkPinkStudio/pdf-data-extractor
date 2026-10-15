// Casi per polizzaReconcileOcrEngine.test.mjs (vedi lì il perché).
// Non si lancia da solo: lo esegue il .test.mjs in un processo figlio con
// --experimental-strip-types, perché polizzaJobStore è TypeScript.
//
// Le due invarianti verificate:
//   1. `visionOcrEngine({ polizzaOcrEngine: 'tesseract' })` → null: dentro
//      `visionOcrPageText` si ricade su `ocrPageText` (Tesseract), mai sul
//      modello visivo;
//   2. `ocrCacheKey(hash, tesseract)` è l'HASH NUDO: la riconciliazione NON
//      scrive nella cache `:vis:<modello>` dell'estrazione (che resta col
//      motore configurato), quindi il testo Tesseract della preliminare non
//      inquina quello dell'estrazione.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const webRoot = pathToFileURL(join(root, 'web') + '/').href
register(pathToFileURL(join(here, 'helpers', 'tsResolveHook.mjs')).href, { data: { webRoot } })

const svc = await import(pathToFileURL(join(root, 'src', 'services', 'polizzaService.js')).href)
const rec = await import(pathToFileURL(join(root, 'src', 'services', 'policyReconcile.js')).href)
const store = await import(pathToFileURL(join(root, 'web', 'lib', 'polizzaJobStore.ts')).href)

test("riconciliazione: polizzaOcrEngine 'tesseract' non è un motore visivo (si usa Tesseract)", () => {
  assert.equal(svc.visionOcrEngine({ polizzaOcrEngine: 'tesseract' }), null)
  assert.equal(svc.visionOcrEngine({ polizzaOcrEngine: 'TESSERACT' }), null)
  assert.equal(svc.visionOcrEngine({ polizzaOcrEngine: '' }), null)
  // Controprova: col motore configurato il visivo resta attivo (worker).
  assert.equal(svc.visionOcrEngine({ polizzaOcrEngine: 'qwen3-vl:32b' }), 'qwen3-vl:32b')
})

test("riconciliazione: la cache Tesseract è l'hash nudo, mai `:vis:` del worker", () => {
  const h = 'f00dbabe'
  assert.equal(store.ocrCacheKey(h, { polizzaOcrEngine: 'tesseract' }), h)
  assert.equal(store.ocrCacheKey(h, { polizzaOcrEngine: '' }), h)
  // Con pagina «sandwich» l'OCR è comunque attivo: la chiave porta il marcatore.
  assert.equal(store.ocrCacheKey(h, { polizzaOcrEngine: 'tesseract' }, true), `${h}:sw`)
  // Il worker (modello visivo) scrive e legge altrove: nessuna collisione.
  assert.notEqual(store.ocrCacheKey(h, { polizzaOcrEngine: 'qwen3-vl:32b' }), h)
})

test('riconciliazione: dossierOcrEngine resta invariato per il WORKER (non toccato dalla modifica)', () => {
  const s = { polizzaOcrEngine: 'qwen3-vl:32b', polizzaEngineFlags: { ocrsoloscansioni: true } }
  // Fascicolo di sole scansioni → per il worker il motore visivo resta scelto.
  assert.equal(svc.dossierOcrEngine(s, [false, false]), 'qwen3-vl:32b')
  // Con almeno un file digitale → Tesseract (comportamento già esistente).
  assert.equal(svc.dossierOcrEngine(s, [true, false]), '')
})

// [B] FALLBACK VISIVO PER GLI ILLEGGIBILI — il predicato. `retryIllegiblesWithVision`
// (web/lib/polizzaReconcile.ts) rilegge col modello visivo SOLO le scansioni per cui
// valgono tutte queste: (1) `extractPolicyNumbersFromPages` delle prime 5 pagine è
// vuoto — nessun numero etichettato; (2) `knownNumbersInPages` sull'intero testo è
// vuoto — il documento non cita un numero del batch; (3) la prima pagina è una
// scansione (digital[0] === false). Qui si verificano (1) e (2) sulle funzioni reali,
// cioè la parte che decide CHI è «illeggibile»: se sbagliasse, si rileggerebbero tutti
// i fascicoli col modello visivo (costo di ore) o nessuno (nessun recupero).
test('riconciliazione: il predicato degli «illeggibili» — numero etichettato presente', () => {
  const page = 'Premio  562,50\nPolizza n. 01469DAS00040  31/12/2026'
  const nums = rec.extractPolicyNumbersFromPages([page])
  assert.ok(nums.length > 0, 'deve trovare il numero etichettato')
  assert.ok(nums.includes('1469DAS00040'), `numero in forma canonica (letti: ${nums.join(', ')})`)
})

test('riconciliazione: il predicato degli «illeggibili» — nessun numero, nessuna citazione', () => {
  // Nessuna cella nomina la polizza → nessun numero etichettato: è il caso da rileggere.
  const page = 'Premio  562,50\nDecorrenza  01/01/2026\nContraente   ROSSI MARIO'
  assert.equal(rec.extractPolicyNumbersFromPages([page]).length, 0)
  // E non cita nessun numero noto del batch (l'elenco «known» è di un'ALTRA polizza).
  assert.equal(rec.knownNumbersInPages([page], ['1469DAS00045']).length, 0)
})

test('riconciliazione: il predicato degli «illeggibili» — documento di contorno che CITA un numero del batch', () => {
  // «Set informativo» senza numero proprio ma con il numero della polizza nel testo:
  // NON è illeggibile (ha una prova), quindi non deve essere riletto col modello visivo.
  const DAS = '1469DAS00040'
  const page = 'Riferimento pratica  1469DAS00040\nPremio  562,50'
  assert.equal(rec.extractPolicyNumbersFromPages([page]).length, 0, 'nessun numero etichettato')
  assert.ok(rec.knownNumbersInPages([page], [DAS]).length > 0, 'ma il numero del batch è citato nel testo')
})
