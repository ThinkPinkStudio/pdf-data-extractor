// Rendering del Modulo di Adesione in PDF ad alta fedeltà, poi unito agli allegati.
// Porta pdfService.js sostituendo la BrowserWindow offscreen di Electron con
// Playwright/Chromium. Supporta template HTML predefinito o personalizzato e una
// lista di allegati PDF configurabile (fallback: DIP incluso).
import os from 'os'
import path from 'path'
import { readFileSync, existsSync, readdirSync, writeFileSync, unlinkSync } from 'fs'
import { pathToFileURL } from 'url'
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'
import { buildDocxData } from './recordMapper.js'
import { fillAndReflowScript } from './moduloFill.js'
import { adesioniAssetPath, getRenderConfig } from './serverConfig'
import type { AdesioniConfig } from './config'

const A4_STYLE = '@page{size:A4;margin:0} html{zoom:1.3333333}'

function logoDataUri(): string | null {
  const p = adesioniAssetPath('csa-logo.png')
  try {
    if (existsSync(p)) return `data:image/png;base64,${readFileSync(p).toString('base64')}`
  } catch { /* ignore */ }
  return null
}

function bundledPageFiles(): string[] {
  const dir = adesioniAssetPath('modulo_html')
  return readdirSync(dir)
    .filter((f) => /^page-\d+\.xhtml$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10))
    .map((f) => path.join(dir, f))
}

// Inserisce un <base href> così un HTML custom risolve i riferimenti relativi
// (font/immagini/css) verso gli asset bundlati del modulo.
function injectBase(html: string, baseHref: string): string {
  const tag = `<base href="${baseHref}">`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`)
  return tag + html
}

/** Renderizza il modulo compilato e lo unisce agli allegati configurati. */
export async function renderModuloPdf(record: Record<string, unknown>, config: AdesioniConfig): Promise<Buffer> {
  const extras = await getRenderConfig()
  const data = buildDocxData(record, config.fields, config.prezzi, config.dateOffsetDays) as unknown as Record<string, unknown>
  const logo = logoDataUri()
  if (logo) data.__logoDataUri = logo

  // Pagine da renderizzare: template custom (una pagina) o predefinito (multi-pagina).
  const tmpFiles: string[] = []
  let pagePaths: string[]
  if (extras.templateId === 'custom' && extras.templateHtml.trim()) {
    const baseHref = pathToFileURL(adesioniAssetPath('modulo_html') + path.sep).href
    const tmp = path.join(os.tmpdir(), `csa-modulo-${Date.now()}-${Math.round(process.hrtime()[1])}.xhtml`)
    writeFileSync(tmp, injectBase(extras.templateHtml, baseHref))
    tmpFiles.push(tmp)
    pagePaths = [tmp]
  } else {
    pagePaths = bundledPageFiles()
  }

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  try {
    const page = await browser.newPage()
    const buffers: Buffer[] = []
    for (const p of pagePaths) {
      await page.goto(pathToFileURL(p).href, { waitUntil: 'load' })
      await page.evaluate('document.fonts ? document.fonts.ready.then(()=>true) : true')
      await page.evaluate(fillAndReflowScript(data))
      await page.evaluate(
        `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(A4_STYLE)};document.head.appendChild(s);})();true`
      )
      const pdf = await page.pdf({ printBackground: true, format: 'A4', margin: { top: '0', bottom: '0', left: '0', right: '0' }, preferCSSPageSize: true })
      buffers.push(Buffer.from(pdf))
    }
    return mergePdfBuffers([...buffers, ...attachmentBuffers(extras.attachments)])
  } finally {
    await browser.close()
    for (const t of tmpFiles) { try { unlinkSync(t) } catch { /* ignore */ } }
  }
}

// Allegati configurati (base64) nell'ordine; se assenti, fallback al DIP incluso.
function attachmentBuffers(attachments: Array<{ name: string; dataBase64: string }>): Buffer[] {
  if (attachments && attachments.length) {
    return attachments.map((a) => Buffer.from(a.dataBase64, 'base64'))
  }
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
