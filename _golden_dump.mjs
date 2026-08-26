#!/usr/bin/env node
// Dump leggibile dei testi OCR per generare la golden dei valori reali.
// NON è parte del progetto: temporaneo, non committare.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { collapseSpatial } from './src/main/services/ocrLayout.js'

const OCR_CACHE = 'out/ocr'

const CASI = {
  A: { prefix: 'in_vigore__', out: 'out/_ocr_dump_A.txt' },
  B: { prefix: 'in_vigore_3__', out: 'out/_ocr_dump_B.txt' },
}

for (const c of Object.values(CASI)) {
  const files = readdirSync(OCR_CACHE).filter((f) => f.startsWith(c.prefix) && f.endsWith('.json'))
  const lines = []
  for (const f of files.sort()) {
    let pages = []
    try { pages = JSON.parse(readFileSync(join(OCR_CACHE, f), 'utf8')) } catch { continue }
    const pretty = f.slice(c.prefix.length, -'.json'.length).replace(/_/g, ' ')
    for (let i = 0; i < pages.length; i++) {
      const raw = String(pages[i] || '')
      if (!raw.trim()) continue
      lines.push(`\n══════════════════════════════════════════════`)
      lines.push(`FILE: ${pretty} — PAGINA ${i + 1} (${raw.length} char)`)
      lines.push(`──────────────────────────────────────────────`)
      lines.push(collapseSpatial(raw))
    }
  }
  mkdirSync('out', { recursive: true })
  writeFileSync(c.out, lines.join('\n'))
  console.log(`Scritto ${c.out} (${lines.length} righe)`)
}
