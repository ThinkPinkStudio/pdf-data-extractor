/**
 * PRE-PROCESSING IMMAGINE per l'OCR (solo per pagine SENZA text layer).
 *
 * Dove agisce: PRIMA di tesseract.js in `ocrImageToText`. La pagina che arriva
 * dal render server (pdfRenderServer) è GIÀ a ~4400px con scala di grigi +
 * contrasto; qui si aggiunge solo ciò che manca davvero:
 *   - UPSCALE se l'immagine è piccola (<1600px lato lungo): Tesseract legge
 *     meglio a ~2000px+;
 *   - SHARPENING leggero (filtro 3x3) per ristabilire i bordi dopo l'upscale;
 *   - CONTRASTO prudente se la pagina arriva da un percorso senza
 *     pre-processing (es. OCR di immagini caricate direttamente).
 *
 * Ogni passo è in try/catch separato: al primo errore si restituisce
 * l'immagine ORIGINALE (mai rompere l'OCR).
 *
 * Dipendenza: `@napi-rs/canvas` (già usata da pdfRenderServer) caricata in
 * modo resiliente via createRequire — se assente, si torna all'originale.
 */
import { createRequire } from 'module'
import { existsSync } from 'fs'
import { join } from 'path'
// `@napi-rs/canvas` è installato in web/node_modules (non alla root del repo):
// il require parte dal package.json della web quando presente, altrimenti cwd.
const requireBase = existsSync(join(process.cwd(), 'web', 'package.json'))
  ? join(process.cwd(), 'web', 'package.json')
  : join(process.cwd(), 'package.json')
const require = createRequire(requireBase)

// Sotto questa larghezza (lato lungo) l'immagine viene upscalata 2x.
const MIN_LONG_SIDE = 1600
// Contrassegniamo la base64 passata come "già processata dal render" con il
// prefisso dataURL standard — il modulo lavora su qualunque PNG/JPEG base64.

function loadCanvasLib() {
  try {
    const { createCanvas, loadImage } = require('@napi-rs/canvas')
    return { createCanvas, loadImage }
  } catch {
    return null
  }
}

function sharpKernel(w, h, d, out) {
  // Filtro 3x3 di sharpening: potenzia i bordi (kernel [0,-1,0;-1,5,-1;0,-1,0]).
  const k = [0, -1, 0, -1, 5, -1, 0, -1, 0]
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let r = 0; let g = 0; let b = 0
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4
          const f = k[(ky + 1) * 3 + (kx + 1)]
          r += d[idx] * f; g += d[idx + 1] * f; b += d[idx + 2] * f
        }
      }
      const o = (y * w + x) * 4
      out[o] = r < 0 ? 0 : r > 255 ? 255 : r
      out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g
      out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b
      out[o + 3] = d[o + 3]
    }
  }
}

function stretchContrast(w, h, d) {
  // Normalizzazione di contrasto sui quantili 1%-99% (scan sbiadite/appiattite).
  const hist = new Float64Array(256)
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++
  let lo = 0; let hi = 255; let acc = 0
  const total = w * h
  const mark = total * 0.01
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= mark) { lo = i; break } }
  acc = 0
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= mark) { hi = i; break } }
  if (hi - lo < 20) return // già contrastata
  const range = hi - lo
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range))
    d[i + 1] = Math.max(0, Math.min(255, ((d[i + 1] - lo) * 255) / range))
    d[i + 2] = Math.max(0, Math.min(255, ((d[i + 2] - lo) * 255) / range))
  }
}

/**
 * Pre-elabora una pagina immagine (base64 dataURL) per migliorare l'OCR.
 * @param {string} base64DataUrl  PNG/JPEG dataURL
 * @returns {Promise<string>} base64 processata (o l'originale in caso di errore)
 */
export async function preprocessImage(base64DataUrl) {
  const original = String(base64DataUrl || '')
  if (!original) return original
  const lib = loadCanvasLib()
  if (!lib) return original
  const { createCanvas, loadImage } = lib
  try {
    let img
    try {
      img = await loadImage(original)
    } catch {
      // loadImage di napi supporta dataURL; per dataURL non puro, buffer fallback
      const b64 = original.includes('base64,') ? original.split('base64,')[1] : original
      img = await loadImage(Buffer.from(b64, 'base64'))
    }
    let w = img.width; let h = img.height
    if (!w || !h) return original
    const longSide = Math.max(w, h)
    let scale = 1
    if (longSide < MIN_LONG_SIDE) scale = Math.ceil(MIN_LONG_SIDE / longSide)
    const cw = Math.round(w * scale); const ch = Math.round(h * scale)
    const canvas = createCanvas(cw, ch)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, cw, ch)
    const imgData = ctx.getImageData(0, 0, cw, ch)
    const d = imgData.data

    // Contrasto sempre (se arriva non processata) + sharpening se upscalata.
    stretchContrast(cw, ch, d)
    if (scale > 1) {
      const out = new Uint8ClampedArray(d)
      sharpKernel(cw, ch, d, out)
      for (let i = 0; i < d.length; i++) d[i] = out[i]
    }
    ctx.putImageData(imgData, 0, 0)
    return canvas.toDataURL('image/png')
  } catch (e) {
    console.warn('[ocrPreprocess] pre-processing fallita, uso originale:', e.message)
    return original
  }
}