/* eslint-disable @typescript-eslint/no-explicit-any */
// Rendering PDF lato SERVER (per i job di estrazione in background). Replica ESATTA
// di web/lib/pdfRender.ts (browser): ogni pagina viene disegnata su canvas ad alta
// risoluzione (lato lungo ~2200px ≈ 190dpi), pre-processata (scala di grigi +
// contrasto 1.35) e convertita in PNG dataURL. Mantenere identico al client è
// essenziale per la parità di qualità OCR/AI-vision con il desktop.
//
// In Node pdfjs non ha un DOM: usiamo @napi-rs/canvas tramite un CanvasFactory.

import { createCanvas } from '@napi-rs/canvas'

// Lato lungo target del rendering. Il desktop usa 2200px (≈190 dpi); lato server
// (job in background, non vincolato dal browser) raddoppiamo a ~4400px (≈380 dpi)
// per rendere leggibili le scansioni dense. NB: i provider vision ridimensionano
// l'immagine internamente (~1500-2048px lato lungo), quindi il guadagno maggiore è
// sull'OCR Tesseract (fascicolo intero); per la vision è innocuo.
const RENDER_LONG_SIDE = 4400
const RENDER_MAX_SCALE = 6

let _pdfjs: any = null
async function getPdfjs() {
  if (_pdfjs) return _pdfjs
  // Build "legacy" (CJS) di pdfjs 3.x: gira in Node senza worker DOM.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js')
  // Nessun worker in Node: il fake worker della build legacy è sufficiente.
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''
  _pdfjs = pdfjs
  return pdfjs
}

// pdfjs in Node crea canvas di appoggio (pattern/gruppi) tramite questa factory.
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, width), Math.max(1, height))
    return { canvas, context: canvas.getContext('2d') }
  }
  reset(cc: any, width: number, height: number) {
    cc.canvas.width = Math.max(1, width)
    cc.canvas.height = Math.max(1, height)
  }
  destroy(cc: any) {
    if (cc.canvas) { cc.canvas.width = 0; cc.canvas.height = 0 }
    cc.canvas = null
    cc.context = null
  }
}

export interface ServerRenderedDoc {
  numPages: number
  renderPage: (pageNum: number) => Promise<string> // PNG dataURL
  destroy: () => Promise<void>
}

export async function loadPdfServer(buffer: Buffer | Uint8Array): Promise<ServerRenderedDoc> {
  const pdfjs = await getPdfjs()
  // pdfjs (build legacy) rifiuta i Buffer di Node e pretende un Uint8Array "puro".
  // NB: `Buffer extends Uint8Array`, quindi un semplice `instanceof Uint8Array` non basta.
  const data = Buffer.isBuffer(buffer)
    ? new Uint8Array(buffer)
    : buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const canvasFactory = new NodeCanvasFactory()
  // isEvalSupported:false → mitiga l'esecuzione di JS da PDF malevoli (CVE-2024-4367)
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    canvasFactory,
    // In Node non c'è fetch del worker: disattiviamo i fetch esterni opzionali.
    useWorkerFetch: false,
    disableFontFace: true,
  }).promise

  const renderPage = async (pageNum: number): Promise<string> => {
    const page = await doc.getPage(pageNum)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(RENDER_MAX_SCALE, RENDER_LONG_SIDE / Math.max(baseViewport.width, baseViewport.height))
    const viewport = page.getViewport({ scale })
    const cc = canvasFactory.create(viewport.width, viewport.height)
    await page.render({ canvasContext: cc.context, viewport, canvasFactory }).promise
    // Pre-processing pixel-only: scala di grigi + aumento contrasto → testo più nero.
    try {
      const imgData = cc.context.getImageData(0, 0, cc.canvas.width, cc.canvas.height)
      const d = imgData.data
      const contrast = 1.35
      const intercept = 128 * (1 - contrast)
      for (let i = 0; i < d.length; i += 4) {
        let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        g = g * contrast + intercept
        d[i] = d[i + 1] = d[i + 2] = g < 0 ? 0 : g > 255 ? 255 : g
      }
      cc.context.putImageData(imgData, 0, 0)
    } catch {
      /* preprocessing opzionale */
    }
    // PNG: nessun artefatto di compressione sul testo (a differenza del JPEG)
    const png = cc.canvas.toDataURL('image/png')
    page.cleanup()
    canvasFactory.destroy(cc)
    return png
  }

  return {
    numPages: doc.numPages,
    renderPage,
    destroy: async () => {
      try { await doc.destroy() } catch { /* già distrutto */ }
    },
  }
}
