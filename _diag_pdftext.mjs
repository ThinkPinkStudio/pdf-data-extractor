import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

const folders = process.argv.slice(2)
for (const folder of folders) {
  console.log(`\n===== ${folder} =====`)
  for (const f of readdirSync(folder).filter((x) => x.toLowerCase().endsWith('.pdf'))) {
    const data = new Uint8Array(readFileSync(join(folder, f)))
    pdfjs.GlobalWorkerOptions.workerSrc = ''
    try {
      const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useWorkerFetch: false, disableFontFace: true }).promise
      let chars = 0, pagesWithText = 0, total = doc.numPages
      const samples = []
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p)
        const content = await page.getTextContent()
        const len = content.items.reduce((s, it) => s + (it.str?.length || 0), 0)
        if (len > 2) pagesWithText++
        chars += len
        if (samples.length < 2 && len > 10) samples.push(`p${p}: ${len}ch "${content.items.slice(0, 6).map((i) => i.str).join(' ').slice(0, 80)}"`)
        page.cleanup()
      }
      try { await doc.destroy() } catch {}
      console.log(`- ${f}: ${doc.numPages} pag, testo ${chars} ch, ${pagesWithText}/${total} con testo → ${chars > 200 ? 'HA TESTO (pdfjs basta)' : 'IMMAGINE (serve OCR Tesseract)'}`)
      for (const s of samples) console.log(`    ${s}`)
    } catch (e) {
      console.log(`- ${f}: ERRORE ${e.message}`)
    }
  }
}