import { readFileSync } from 'fs'
import { scanDocument } from './src/main/services/polizzaNumericScan.js'

const docMap = {
  'in_vigore__Cedam_Italia_Rcto_PROFF_polizza.pdf.json': 'polizza',
  'in_vigore__Cedam_Italia_Rcto_regolazione_premio_2024.pdf.json': 'regolazione',
  'in_vigore__app_RP_CEDAM_24_25.pdf.json': 'appRP',
  'in_vigore__cedam16032026092828.pdf.json': 'cedam1603',
}
const which = process.argv[2] || 'polizza'
const f = Object.keys(docMap).find((k) => docMap[k] === which)
if (!f) { console.error('doc non trovato'); process.exit(1) }
const pages = JSON.parse(readFileSync('out/ocr/' + f, 'utf8'))
const flat = pages.map((p) => String(p).split('\n').map((l) => l.replace(/\s{2,}/g, ' ').trim()).join('\n'))
const kindFilter = process.argv[3] || null
const hints = scanDocument({ name: which, pages: flat })
for (const h of hints) {
  if (kindFilter && h.kind !== kindFilter) continue
  console.log(`kind=${h.kind} value=${JSON.stringify(h.value)} conf=${h.confidence} pat=${h.pattern} p${h.page} line=${h.line}`)
  console.log(`    SRC: ${JSON.stringify(h.source)}`)
}