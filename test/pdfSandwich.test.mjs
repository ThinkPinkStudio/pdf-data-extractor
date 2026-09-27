/**
 * Pagina «sandwich» (immagine + OCR invisibile dello scanner) = scansione.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInvisibleTextScan } from '../src/services/pdfTextLayer.js'

const OPS = { setTextRenderingMode: 1, showText: 2, showSpacedText: 3, paintImageXObject: 4, paintJpegXObject: 5, save: 6, restore: 7, beginText: 8 }
const ol = (ops) => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1] || null) })

test('immagine + solo testo invisibile (modo 3) = scansione', () => {
  assert.equal(isInvisibleTextScan(ol([[OPS.paintImageXObject], [OPS.beginText], [OPS.setTextRenderingMode, [3]], [OPS.showText], [OPS.showText]]), OPS), true)
  assert.equal(isInvisibleTextScan(ol([[OPS.paintJpegXObject], [OPS.setTextRenderingMode, [7]], [OPS.showSpacedText]]), OPS), true)
})

test('testo visibile o nessuna immagine = pagina digitale', () => {
  assert.equal(isInvisibleTextScan(ol([[OPS.showText]]), OPS), false)
  assert.equal(isInvisibleTextScan(ol([[OPS.paintImageXObject], [OPS.showText]]), OPS), false, 'logo + testo visibile')
  assert.equal(isInvisibleTextScan(ol([[OPS.setTextRenderingMode, [3]], [OPS.showText]]), OPS), false, 'testo invisibile senza immagine')
  assert.equal(isInvisibleTextScan(ol([[OPS.paintImageXObject], [OPS.setTextRenderingMode, [3]], [OPS.showText], [OPS.setTextRenderingMode, [0]], [OPS.showText]]), OPS), false, 'anche testo visibile')
  // save/restore: il modo invisibile finisce col restore
  assert.equal(isInvisibleTextScan(ol([[OPS.paintImageXObject], [OPS.save], [OPS.setTextRenderingMode, [3]], [OPS.showText], [OPS.restore], [OPS.showText]]), OPS), false)
})
