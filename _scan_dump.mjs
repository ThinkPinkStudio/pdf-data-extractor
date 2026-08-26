import { readFileSync } from 'fs'
import { buildNumericHints } from './src/main/services/polizzaNumericScan.js'

const docSpecs = [
  ['in_vigore__Cedam_Italia_Srl_Rc_professionale_q.za_25_26.pdf.json', 'quietanza 25 26'],
  ['in_vigore__Cedam_Italia_Rcto_atto_2018_aumento_massimale.pdf.json', 'atto 2018'],
  ['in_vigore__cedam16032026092828.pdf.json', 'cedam1603'],
  ['in_vigore__Cedam_Italia_Rcto_PROFF_polizza.pdf.json', 'polizza'],
  ['in_vigore__Cedam_Italia_Rcto_regolazione_premio_2024.pdf.json', 'regolazione'],
  ['in_vigore__Cedam_Italia_Rcto_atto_2019_aumento_massimale_inserim._franchigia_front..pdf.json', 'atto 2019'],
  ['in_vigore__dichiarazione.pdf.json', 'dichiarazione'],
  ['in_vigore__app_RP_CEDAM_24_25.pdf.json', 'app RP CEDAM'],
]
const docs = []
for (const [f, name] of docSpecs) {
  const pages = JSON.parse(readFileSync('out/ocr/' + f, 'utf8'))
  const flat = pages.map((p) => String(p).split('\n').map((l) => l.replace(/\s{2,}/g, ' ').trim()).join('\n'))
  docs.push({ name, pages: flat })
}
const { byKind, all } = buildNumericHints(docs)
console.log('TOT hints:', all.length)
for (const [kind, hints] of byKind) {
  console.log('=== KIND', kind, '===')
  for (const h of hints) console.log('  conf', h.confidence, 'value', JSON.stringify(h.value), 'file', h.file, 'pat', h.pattern)
}