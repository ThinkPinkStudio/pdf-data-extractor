// Rasterizzazione headless di una pagina PDF → PNG dataURL.
// È l'UNICO pezzo che nel desktop fa il canvas del browser (Polizza.jsx ~394-417):
// stessa scala (lato lungo ~2200px) e stesso pre-processing grigi+contrasto.
// Il resto dell'algoritmo resta identico e viene dal meccanismo esatto.

export interface RenderedPage {
  pageNum: number
  totalPages: number
  dataUrl: string // data:image/png;base64,...
}

class NodeCanvasFactory {
  private createCanvas: (w: number, h: number) => any
  constructor(createCanvas: (w: number, h: number) => any) {
    this.createCanvas = createCanvas
  }
  create(width: number, height: number) {
    const canvas = this.createCanvas(Math.ceil(width), Math.ceil(height))
    return { canvas, context: canvas.getContext('2d') }
  }
  reset(cc: any, width: number, height: number) {
    cc.canvas.width = Math.ceil(width)
    cc.canvas.height = Math.ceil(height)
  }
  destroy(cc: any) {
    if (cc.canvas) {
      cc.canvas.width = 0
      cc.canvas.height = 0
    }
    cc.canvas = null
    cc.context = null
  }
}

export async function* renderPdfPages(buffer: Buffer): AsyncGenerator<RenderedPage> {
  const { createCanvas } = await import('@napi-rs/canvas')
  const pdfjsMod: any = await import('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs = pdfjsMod.default || pdfjsMod
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''

  const canvasFactory = new NodeCanvasFactory(createCanvas as unknown as (w: number, h: number) => any)

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false, // mitiga CVE-2024-4367 (come main/renderer)
    useSystemFonts: true,
    disableFontFace: true,
    canvasFactory,
  }).promise

  const totalPages: number = doc.numPages
  try {
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(3, 2200 / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })

      const { canvas, context } = canvasFactory.create(viewport.width, viewport.height)
      await page.render({ canvasContext: context, viewport, canvasFactory }).promise

      // grigi + contrasto, identico al renderer (Polizza.jsx 404-415)
      try {
        const imgData = context.getImageData(0, 0, canvas.width, canvas.height)
        const d = imgData.data
        const contrast = 1.35
        const intercept = 128 * (1 - contrast)
        for (let i = 0; i < d.length; i += 4) {
          let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
          g = g * contrast + intercept
          d[i] = d[i + 1] = d[i + 2] = g < 0 ? 0 : g > 255 ? 255 : g
        }
        context.putImageData(imgData, 0, 0)
      } catch {
        /* preprocessing opzionale, come nel renderer */
      }

      const dataUrl: string = canvas.toDataURL('image/png')
      page.cleanup()
      yield { pageNum, totalPages, dataUrl }
    }
  } finally {
    try {
      await doc.destroy()
    } catch {
      /* già distrutto */
    }
  }
}
