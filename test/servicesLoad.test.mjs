/**
 * Ogni modulo di src/services deve almeno CARICARSI.
 *
 * Perché: il worker web importa i servizi a runtime (importSharedService →
 * import() dinamico dentro un try/catch), quindi un errore di sintassi in un
 * servizio NON fa fallire né `tsc` né `next build`: in produzione il modulo
 * semplicemente non si carica e la funzione che lo usava sparisce in silenzio
 * (successo: un numero di riga incollato in polizzaPrecheckService.js ha
 * spento il pre-check per un'intera giornata di deploy). Questo test lo
 * intercetta in `node --test`.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const servicesDir = join(here, '..', 'src', 'services')

// Moduli che a import-time toccano risorse di sistema o pacchetti opzionali
// del web (browser, binari nativi): si verificano solo con `node --check`.
const SYNTAX_ONLY = new Set([])

const files = readdirSync(servicesDir).filter((f) => /\.(js|mjs)$/.test(f)).sort()

test('src/services: elenco non vuoto', () => {
  assert.ok(files.length > 10, `trovati solo ${files.length} moduli`)
})

for (const f of files) {
  test(`src/services/${f} si carica senza errori`, async () => {
    if (SYNTAX_ONLY.has(f)) {
      const { execFileSync } = await import('node:child_process')
      execFileSync(process.execPath, ['--check', join(servicesDir, f)], { stdio: 'pipe' })
      return
    }
    let mod
    try {
      mod = await import(join(servicesDir, f))
    } catch (err) {
      // Un pacchetto mancante nell'ambiente di test (es. node_modules del web
      // non installata) non è un errore del modulo: lo si segnala e si ripiega
      // sul solo controllo sintattico. Un SyntaxError invece è SEMPRE un errore.
      if (err instanceof SyntaxError) throw err
      if (err?.code === 'ERR_MODULE_NOT_FOUND' && !String(err.message).includes(`services/${f}`)) {
        const { execFileSync } = await import('node:child_process')
        execFileSync(process.execPath, ['--check', join(servicesDir, f)], { stdio: 'pipe' })
        return
      }
      throw err
    }
    assert.ok(mod && typeof mod === 'object')
  })
}
