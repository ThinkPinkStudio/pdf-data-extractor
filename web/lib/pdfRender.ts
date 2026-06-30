'use client'

// Rendering PDF lato BROWSER (come l'app desktop): ogni pagina viene disegnata su
// canvas ad alta risoluzione, pre-processata (scala di grigi + contrasto) e
// convertita in PNG base64. Il server riceve l'immagine e fa OCR/AI vision.

/* eslint-disable @typescript-eslint/no-explicit-any */
let _pdfjs: any = null

async function getPdfjs() {
  if (_pdfjs) return _pdfjs
  const pdfjs = await import('pdfjs-dist')
  // Il worker è servito da /public (stessa build dell'app desktop).
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'
  _pdfjs = pdfjs
  return pdfjs
}

export interface RenderedDoc {
  numPages: number
  renderPage: (pageNum: number) => Promise<string> // PNG dataURL
  destroy: () => Promise<void>
}

export async function loadPdfFromFile(file: File): Promise<RenderedDoc> {
  const pdfjs = await getPdfjs()
  const buf = new Uint8Array(await file.arrayBuffer())
  // isEvalSupported:false → mitiga l'esecuzione di JS da PDF malevoli (CVE-2024-4367)
  const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise

  const renderPage = async (pageNum: number): Promise<string> => {
    const page = await doc.getPage(pageNum)
    const baseViewport = page.getViewport({ scale: 1 })
    // Lato lungo ~2200px ≈ 190 dpi: tabelle dense leggibili, senza far esplodere il modello.
    const scale = Math.min(3, 2200 / Math.max(baseViewport.width, baseViewport.height))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise
    // Pre-processing pixel-only: scala di grigi + aumento contrasto → testo più nero.
    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const d = imgData.data
      const contrast = 1.35
      const intercept = 128 * (1 - contrast)
      for (let i = 0; i < d.length; i += 4) {
        let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        g = g * contrast + intercept
        d[i] = d[i + 1] = d[i + 2] = g < 0 ? 0 : g > 255 ? 255 : g
      }
      ctx.putImageData(imgData, 0, 0)
    } catch {
      /* preprocessing opzionale */
    }
    const png = canvas.toDataURL('image/png')
    page.cleanup()
    return png
  }

  return {
    numPages: doc.numPages,
    renderPage,
    destroy: async () => {
      try {
        await doc.destroy()
      } catch {
        /* già distrutto */
      }
    },
  }
}
