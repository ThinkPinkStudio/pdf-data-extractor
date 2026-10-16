// Pool di worker Tesseract (16/10/2026): più pagine lette insieme, una per core.
// Il testo di ogni pagina non deve dipendere da quante pagine girano insieme né
// dal worker che la legge (il ripiego PSM 3 resta sullo stesso worker).
import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { createRequire } from 'node:module'
import { ocrWorkerCount, ocrPageText, closeOcrWorker } from '../src/services/polizzaService.js'

test('ocrWorkerCount: impostazione, altrimenti core meno 2, tra 1 e 32', () => {
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
  const auto = Math.max(1, Math.min(cores - 2, 32))
  assert.equal(ocrWorkerCount({ polizzaOcrWorkers: 3 }), 3)
  assert.equal(ocrWorkerCount({ polizzaOcrWorkers: '2' }), 2)
  assert.equal(ocrWorkerCount({ polizzaOcrWorkers: 100 }), 32)
  assert.equal(ocrWorkerCount({ polizzaOcrWorkers: 0 }), auto)
  assert.equal(ocrWorkerCount({}), auto)
  assert.equal(ocrWorkerCount(), auto)
})

// Pagina sintetica con testo stampato: basta a Tesseract per leggere qualcosa.
function pageImage(lines) {
  const require = createRequire(import.meta.url)
  let canvasMod
  try { canvasMod = require('../web/node_modules/@napi-rs/canvas') } catch { return null }
  const c = canvasMod.createCanvas(1400, 120 + lines.length * 90)
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#000'
  g.font = '48px sans-serif'
  lines.forEach((l, i) => g.fillText(l, 60, 110 + i * 90))
  return 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64')
}

test('pool: stesso testo in parallelo e in fila, il pool si richiude e riparte', async (t) => {
  const imgs = [
    pageImage(['POLIZZA N. 01469DAS00076', 'Premio lordo 182,00']),
    pageImage(['Tutela legale 20.000 19,84', 'Decorrenza 30/06/2026']),
    pageImage(['CONTRAENTE A.D. ITALIA SRL', 'Scadenza 30/06/2027']),
  ]
  if (imgs.some((x) => !x)) { t.skip('canvas non disponibile'); return }
  const one = { polizzaOcrWorkers: 1 }
  const seq = []
  for (const im of imgs) seq.push(await ocrPageText(im, one))
  if (!seq.some((x) => x && x.trim())) { t.skip('Tesseract non disponibile in questo ambiente'); await closeOcrWorker(); return }
  const three = { polizzaOcrWorkers: 3 }
  const par = await Promise.all([...imgs, ...imgs].map((im) => ocrPageText(im, three)))
  assert.deepEqual(par, [...seq, ...seq])
  assert.match(seq[0], /01469DAS00076/)
  await closeOcrWorker()
  // dopo la chiusura il pool si ricrea alla prima pagina
  assert.equal(await ocrPageText(imgs[1], three), seq[1])
  await closeOcrWorker()
})
