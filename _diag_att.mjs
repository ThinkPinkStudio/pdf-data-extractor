import { readFileSync } from 'fs'
import { collapseSpatial } from './src/main/services/ocrLayout.js'

function flat(f) {
  const j = JSON.parse(readFileSync('out/ocr/' + f, 'utf8'))
  return j.map((p) => collapseSpatial(String(p))).join('\n')
}
const attRegexes = [
  /(?:descrizione\s+del\s+rischio|oggetto\s+dell'assicurazione|oggetto\s+delle?\s+assicurazione)\s*[:.]?\s*\n?\s*([^\n]{15,300})/i,
  /(?:di\s+seguito\s+)?descritt[ao]\s*[:;]\s*\n?\s*([^\n]{15,300})/i,
  /ATTIVIT\S{0,2}(?:\s+ASSICURATA)?\s*[:]\s*\n?\s*([^\n]{15,300})/i,
]
for (const file of process.argv.slice(2)) {
  const text = flat(file)
  let m = null
  for (const re of attRegexes) { m = text.match(re); if (m) break }
  console.log('FILE', file)
  if (m) {
    const candidate = m[1].trim().replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '')
    console.log('  candidate:', JSON.stringify(candidate))
    console.log('  isPersonActivity:', /^(?:dr|dott|sig|dott\.ssa)[.,]?\s+\b[A-ZÀ-Ý]+\b,\s*attivit/i.test(String(m[1]).trim()))
  } else console.log('  NO match')
}