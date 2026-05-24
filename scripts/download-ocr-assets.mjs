/**
 * Downloads tessdata_fast language files for offline OCR.
 * Run automatically as part of "npm run build".
 * Files are saved to public/tesseract/langdata/ (excluded from git).
 */

import { existsSync, mkdirSync, createWriteStream, unlinkSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LANG_DIR = join(__dirname, '..', 'src', 'renderer', 'public', 'tesseract', 'langdata')
const LANGS = ['eng', 'ita', 'fra', 'deu', 'spa']
// tessdata_fast: lighter, faster models (still high quality with LSTM)
const BASE_URL = 'https://github.com/tesseract-ocr/tessdata_fast/raw/main'

mkdirSync(LANG_DIR, { recursive: true })

let anyDownloaded = false

for (const lang of LANGS) {
  const dest = join(LANG_DIR, `${lang}.traineddata`)
  if (existsSync(dest)) {
    const { size } = await import('fs').then(m => m.promises.stat(dest))
    if (size > 1024 * 100) { // > 100KB → assume valid
      console.log(`  ✓ ${lang}.traineddata (già presente, ${(size / 1024 / 1024).toFixed(1)} MB)`)
      continue
    }
  }

  console.log(`  ⬇  Scarico ${lang}.traineddata da tessdata_fast…`)
  anyDownloaded = true

  try {
    const res = await fetch(`${BASE_URL}/${lang}.traineddata`, {
      headers: { 'User-Agent': 'pdf-data-extractor-build/1.0' },
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

    const buf = await res.arrayBuffer()
    await writeFile(dest, Buffer.from(buf))

    const sizeMB = (buf.byteLength / 1024 / 1024).toFixed(1)
    console.log(`  ✓ ${lang}.traineddata (${sizeMB} MB)`)
  } catch (err) {
    // Clean up partial file
    try { if (existsSync(dest)) unlinkSync(dest) } catch (_) {}
    console.error(`  ✗ Errore scaricando ${lang}.traineddata: ${err.message}`)
    console.error('    Assicurati di avere accesso a internet durante la build.')
    process.exit(1)
  }
}

if (anyDownloaded) {
  console.log('\n  📦 Asset OCR pronti per il bundle offline.\n')
} else {
  console.log('  ✓ Asset OCR già presenti, nessun download necessario.')
}
