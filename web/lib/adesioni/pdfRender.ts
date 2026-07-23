// Rendering del Modulo di Adesione in PDF ad alta fedeltà, poi unito all'allegato
// DIP. Porta pdfService.js sostituendo la BrowserWindow offscreen di Electron con
// Playwright/Chromium (preinstallato in ambiente: PLAYWRIGHT_BROWSERS_PATH).
//
// Perché HTML→Chromium e non conversione dal .docx: il layout va compilato con
// dati di lunghezza variabile senza sforare. Solo un motore che RIFLUISCE
// (HTML/CSS in Chromium) gestisce i valori lunghi (vanno a capo) senza tagliare.
import { readFileSync, existsSync, readdirSync } from 'fs'
import { pathToFileURL } from 'url'
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'
import { buildDocxData } from './recordMapper.js'
import { fillAndReflowScript } from './moduloFill.js'
import { adesioniAssetPath } from './serverConfig'
import type { AdesioniConfig } from './config'

// Mappa il sistema di coordinate del template (595×842 pt) sull'A4 reale: Chromium
// stampa 1px=1/96", quindi zoom 96/72 riempie l'A4.
const A4_STYLE = '@page{size:A4;margin:0} html{zoom:1.3333333}'

function logoDataUri(): string | null {
  const p = adesioniAssetPath('csa-logo.png')
  try {
    if (existsSync(p)) return `data:image/png;base64,${readFileSync(p).toString('base64')}`
  } catch { /* ignore */ }
  return null
}

// Pagine del template HTML, ordinate (page-1.xhtml, page-2.xhtml, …).
function templatePageFiles(): string[] {
  const dir = adesioniAssetPath('modulo_html')
  return readdirSync(dir)
    .filter((f) => /^page-\d+\.xhtml$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10))
}

/** Renderizza il modulo compilato (tutte le pagine) e lo unisce all'allegato DIP. */
export async function renderModuloPdf(record: Record<string, unknown>, config: AdesioniConfig): Promise<Buffer> {
  const data = buildDocxData(record, config.fields, config.prezzi, config.dateOffsetDays) as unknown as Record<string, unknown>
  const logo = logoDataUri()
  if (logo) data.__logoDataUri = logo

  const dir = adesioniAssetPath('modulo_html')
  const pageFiles = templatePageFiles()

  // --no-sandbox: necessario per Chromium in container (utente non privilegiato).
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  try {
    const page = await browser.newPage()
    const buffers: Buffer[] = []
    for (const f of pageFiles) {
      await page.goto(pathToFileURL(`${dir}/${f}`).href, { waitUntil: 'load' })
      await page.evaluate('document.fonts ? document.fonts.ready.then(()=>true) : true')
      // 1) riempimento segnaposto + riflusso (misurato a zoom 1)
      await page.evaluate(fillAndReflowScript(data))
      // 2) scala per riempire l'A4
      await page.evaluate(
        `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(A4_STYLE)};document.head.appendChild(s);})();true`
      )
      const pdf = await page.pdf({ printBackground: true, format: 'A4', margin: { top: '0', bottom: '0', left: '0', right: '0' }, preferCSSPageSize: true })
      buffers.push(Buffer.from(pdf))
    }
    const attachments = attachmentBuffers()
    return mergePdfBuffers([...buffers, ...attachments])
  } finally {
    await browser.close()
  }
}

/** Allegati fissi accodati al modulo (default: DIP incluso). */
function attachmentBuffers(): Buffer[] {
  const dip = adesioniAssetPath('dip.pdf')
  try {
    if (existsSync(dip)) return [readFileSync(dip)]
  } catch { /* ignore */ }
  return []
}

/** Unisce più PDF (buffer) in un unico documento. */
export async function mergePdfBuffers(inputs: (Buffer | Uint8Array)[]): Promise<Buffer> {
  const out = await PDFDocument.create()
  for (const bytes of inputs) {
    const src = await PDFDocument.load(bytes)
    const pages = await out.copyPages(src, src.getPageIndices())
    for (const p of pages) out.addPage(p)
  }
  return Buffer.from(await out.save())
}
