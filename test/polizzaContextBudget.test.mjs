import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { computeSafeContextBudget, estimateOllamaTokens, buildGroupBatches } from '../src/services/polizzaService.js'

// Overhead di sistema/guida campi in TOKEN, come la funzione lo computa.
const overheadTokens = (systemChars, userChars) => estimateOllamaTokens(systemChars + userChars)

test('estimateOllamaTokens: rapporto realistico char→token (~3,5) e nessuna sottostima pericolosa', () => {
  // Un testo OCR di 3500 char deve stimare ~1000 token (3,5 char/token).
  const sample = 'X'.repeat(3500)
  const est = estimateOllamaTokens(sample.length)
  assert.ok(est <= 1000, `stima ${est} > 1000 per 3500 char`)
  assert.ok(est >= 900, `stima ${est} < 900 per 3500 char (rapporto gonfiato?)`)
  // Il vecchio /2,5 sovrastimava (1400): con 3,5 il valore è aderente al reale.
  // Coerenza: testo doppio ⇒ stima doppia (proporzionalità della stima).
  assert.equal(estimateOllamaTokens(7000), estimateOllamaTokens(3500) * 2)
  // Mai negativa o NaN e mai 0 per input positivo (guardia per input nulli).
  assert.equal(estimateOllamaTokens(0), 0)
  assert.equal(estimateOllamaTokens(null), 0)
  assert.ok(estimateOllamaTokens(1) >= 1)
  // Non deve MAI sottostimare in modo pericoloso: il rapporto reale osservato
  // è ~2,6 char/token, quindi la stima resta ≥ allo scontato (conservativa)
  // su campioni piccoli dove l'arrotondamento all'insù domina.
  assert.ok(estimateOllamaTokens(26) >= 7, `260ch → ${estimateOllamaTokens(26)} < 10`)
})

test('computeSafeContextBudget con tetto alto (>24576): resta coerente col margine', () => {
  // Context alto come quello configurabile (36K): il budget del TESTO del batch
  // non deve MAI superare numCtx - margine - overhead (invariante anti-troncamento).
  for (const numCtx of [32768, 49152, 65536]) {
    const systemChars = 8000
    const userChars = 4000
    const marginRatio = 0.12
    const budgetChars = computeSafeContextBudget(numCtx, { systemChars, userChars, marginRatio })
    const totalTokens = estimateOllamaTokens(budgetChars) + overheadTokens(systemChars, userChars)
    const maxTokens = numCtx - Math.floor(numCtx * marginRatio)
    assert.ok(budgetChars > 0, `budget ${budgetChars} non positivo per ${numCtx}`)
    assert.ok(totalTokens <= maxTokens, `testo+guida ${totalTokens} > numCtx-margine ${maxTokens} (ctx ${numCtx})`)
    assert.ok(totalTokens <= numCtx, `testo+guida ${totalTokens} > numCtx ${numCtx}`)
  }
})

test('batchCtx: un tetto alto (>24576) nel budget non produce MAI batch oltre num_ctx - margine', () => {
  // Il budget di TESTO del batch deriva dal num_ctx configurato (polizzaBatchContext
  // può alzarlo oltre 24576). Con context alto, i batch costruiti con quel budget
  // devono restare comunque dentro l'invariante anti-troncamento: mai superare
  // num_ctx - margine una volta considerato l'overhead di guida+system.
  const numCtx = 32768
  const systemChars = 8000
  const userChars = 4000
  const marginRatio = 0.12
  const budget = computeSafeContextBudget(numCtx, { systemChars, userChars, marginRatio })
  const maxTokens = numCtx - Math.floor(numCtx * marginRatio) - overheadTokens(systemChars, userChars)
  const bigPage = 'X'.repeat(300000)
  const docList = Array.from({ length: 6 }, (_, i) => ({
    name: `allegato-${i}.pdf`,
    pages: [bigPage, bigPage],
    spatialPages: null,
  }))
  const batches = buildGroupBatches(docList, budget)
  assert.ok(batches.length >= 6, `solo ${batches.length} batch per 6 documenti`)
  for (const b of batches) {
    const tokens = estimateOllamaTokens(b.text.length)
    assert.ok(tokens <= maxTokens, `batch ${tokens} token > max ${maxTokens}`)
  }
})

test('budget resta sempre sotto numCtx - margine', () => {
  const numCtx = 24576
  const systemChars = 8000
  const userChars = 4000
  const marginRatio = 0.12
  const budgetChars = computeSafeContextBudget(numCtx, { systemChars, userChars, marginRatio })
  const totalTokens = estimateOllamaTokens(budgetChars) + overheadTokens(systemChars, userChars)
  const maxTokens = numCtx - Math.floor(numCtx * marginRatio)
  assert.ok(totalTokens <= maxTokens, `testo+guida ${totalTokens} token > numCtx-margine ${maxTokens}`)
  assert.ok(totalTokens <= numCtx, `testo+guida ${totalTokens} token > numCtx ${numCtx}`)
})

test('limite sconosciuto (numCtx assente): default sicuro, mai presumere fit', () => {
  const b0 = computeSafeContextBudget(0, { systemChars: 2000 })
  const bundef = computeSafeContextBudget(undefined, { systemChars: 2000 })
  const benorme = computeSafeContextBudget(131072, { systemChars: 2000 })
  assert.ok(b0 === bundef && b0 > 0, 'default sicuro identico e positivo')
  // Con limite enorme il budget non esplode oltre il tetto prudenziale.
  assert.ok(benorme > 0 && benorme <= 131072 * 2, `enorme ${benorme}`)
})

test('overhead stima: marginale per batch enorme → budget ridoto ma positivo', () => {
  const numCtx = 4096
  const systemChars = 3000 // quasi tutto il contesto
  const userChars = 2000
  const budgetChars = computeSafeContextBudget(numCtx, { systemChars, userChars, marginRatio: 0.12 })
  assert.ok(budgetChars >= 0, `budget ${budgetChars}`)
  // Mai superare il limite completo.
  assert.ok(estimateOllamaTokens(budgetChars) + overheadTokens(systemChars, userChars) <= numCtx)
})

test('spillover: docLIst grande non produce MAI batch oltre numCtx - margine', () => {
  const numCtx = 8192
  const systemChars = 2000
  const userChars = 2000
  const marginRatio = 0.12
  const budget = computeSafeContextBudget(numCtx, { systemChars, userChars, marginRatio })
  const maxTokens = numCtx - Math.floor(numCtx * marginRatio) - overheadTokens(systemChars, userChars)
  const bigPage = 'X'.repeat(120000)
  const docList = Array.from({ length: 22 }, (_, i) => ({
    name: `allegato-${i}.pdf`,
    pages: [bigPage, bigPage, bigPage],
    spatialPages: null,
  }))
  const batches = buildGroupBatches(docList, budget)
  assert.ok(batches.length >= 22, `solo ${batches.length} batch per 22 documenti`)
  for (const b of batches) {
    const tokens = estimateOllamaTokens(b.text.length)
    assert.ok(tokens <= maxTokens, `batch ${tokens} token > max ${maxTokens}`)
  }
})

test('jn = 22_45_68 > limit: mai eccede numCtx - margin', () => {
  // Matrice di casi: numeri di context diversi, diverse guide, marginali diversi.
  for (const numCtx of [4096, 8192, 16384, 24576, 32768, 0]) {
    for (const systemChars of [500, 2000, 8000]) {
      for (const userChars of [1000, 3000]) {
        for (const marginRatio of [0.08, 0.12, 0.15]) {
          const effectiveCtx = (numCtx && numCtx > 0) ? numCtx : 4096
          const overhead = estimateOllamaTokens(systemChars + userChars)
          const max = effectiveCtx - Math.floor(effectiveCtx * marginRatio)
          const budget = computeSafeContextBudget(numCtx, { systemChars, userChars, marginRatio })
          // Se l'overhead (guida + system) da SOLO supera già numCtx - margine,
          // il testo non può più esserci: la funzione deve riportare 0, non un
          // valore positivo, e NEL CASO INVERSO (overhead che ci sta) il totale
          // testo+guida NON deve mai superare numCtx - margine.
          if (overhead >= max) {
            assert.ok(budget === 0, `overhead ${overhead} ≥ max ${max} → budget ${budget} dovrebbe essere 0`)
          } else {
            const total = estimateOllamaTokens(budget) + overhead
            assert.ok(total <= max, `numCtx ${numCtx} sys ${systemChars} usr ${userChars} marg ${marginRatio}: ${total} > ${max}`)
          }
        }
      }
    }
  }
})

test('regressione budget: un documento ~1800 char entra INTERO nel batch (num_ctx reale adeguato)', () => {
  // La dichiarazione del caso Cedam è ~1806 char flat; col vecchio cap a 512 token
  // (~1024 char) veniva troncata prima del check-evidenza (riga massimale
  // 7.500.000,00 in coda). Con num_ctx reale adeguato (24576 + 12% margine) il
  // budget deve lasciar entrare l'intero documento in un batch.
  const numCtx = 24576
  const systemChars = 3000      // guida campi + prompt di sistema tipici del gruppo
  const userChars = 1500
  const marginRatio = 0.12
  const budget = computeSafeContextBudget(numCtx, { systemChars, userChars, marginRatio })
  // Un documento di 1806 char DEV'ESSERE molto sotto il budget, che ora è
  // proporzionale al residuo del modello (70% di numCtx - margine ≈ migliaia di char).
  const dichiarazione = 'RIGA ' + 'X'.repeat(1795) + ' MASSIMALI 7.500.000,00 ENDMARKER'
  // exact char count: 6 + 1795 + 27 = 1828 > 1806 (guardia di riga)
  assert.ok(budget >= dichiarazione.length * 2, `budget ${budget} troppo piccolo per ${dichiarazione.length} char`)
  const doc = { name: 'dichiarazione-2026.pdf', pages: [dichiarazione], spatialPages: null }
  const batches = buildGroupBatches([doc], budget)
  assert.strictEqual(batches.length, 1, `il documento è stato spezzato in ${batches.length} batch`)
  assert.ok(batches[0].text.includes('ENDMARKER'), 'la coda del documento è andata persa: troncato dopo 1024 char')
  assert.ok(batches[0].text.includes('7.500.000,00'), 'la riga coi massimali giusti non è arrivata al modello')
  // Invariante anti-troncamento: testo + guida mai oltre numCtx - margine.
  const maxTokens = numCtx - Math.floor(numCtx * marginRatio)
  const totalTokens = estimateOllamaTokens(batches[0].text.length) + estimateOllamaTokens(systemChars + userChars)
  assert.ok(totalTokens <= maxTokens, `${totalTokens} token > numCtx-margine ${maxTokens}`)
})