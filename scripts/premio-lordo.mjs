#!/usr/bin/env node
/**
 * CLI: aggiunge PREMIO LORDO e IMPOTRO PREMIO LORDO TOTALE al report
 * "Tutte le Applicazioni".
 *
 *   node scripts/premio-lordo.mjs input.xlsx [output.xlsx] [opzioni]
 *
 * Opzioni:
 *   --sheet <nome>       foglio da elaborare (default: quello con nome numerico,
 *                        es. "20265539", altrimenti il primo)
 *   --rounding <modo>    commerciale (default, half-up: 26,105 → 26,11) oppure
 *                        "legacy" (half-even, come il vecchio output: 26,105 → 26,10)
 *   --keep-extra         NON rimuove le colonne oltre le 19 di tracciato
 *   --assume-default     applica 13,5% alle garanzie non in tabella senza
 *                        chiedere (senza questo flag il comando si FERMA)
 *   --dry-run            calcola e stampa il report, non scrive nulla
 *
 * Il lavoro vero lo fa src/main/services/premioLordoWorkbook.js, lo stesso
 * servizio usato dalla pagina web: qui ci sono solo argomenti, file e stampa.
 */

import { readFileSync, existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import path from 'path'

import {
  processPremioLordo,
  outputFileName,
  PremioLordoError
} from '../src/main/services/premioLordoWorkbook.js'
import { formatItalian } from '../src/main/services/premioLordo.js'

function parseArgs(argv) {
  const opts = {
    assumeDefault: false, dryRun: false, sheet: null,
    rounding: 'commerciale', keepExtra: false, positional: []
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--assume-default') opts.assumeDefault = true
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--keep-extra') opts.keepExtra = true
    else if (a === '--sheet') opts.sheet = argv[++i]
    else if (a.startsWith('--sheet=')) opts.sheet = a.slice(8)
    else if (a === '--rounding') opts.rounding = argv[++i]
    else if (a.startsWith('--rounding=')) opts.rounding = a.slice(11)
    else if (a.startsWith('--')) throw new Error(`Opzione sconosciuta: ${a}`)
    else opts.positional.push(a)
  }
  if (!['commerciale', 'legacy'].includes(opts.rounding)) {
    throw new Error(`--rounding accetta "commerciale" o "legacy", non "${opts.rounding}"`)
  }
  return opts
}

function stampaReport(r, opts) {
  console.log(`\nFoglio "${r.sheet}" · intestazione riga ${r.headerRow} · ${r.righeDati} righe dati`)
  console.log(`Nuove colonne: ${r.colonnaLordo} = PREMIO LORDO · ${r.colonnaTotale} = IMPOTRO PREMIO LORDO TOTALE`)
  console.log(`Arrotondamento: ${r.rounding}`)

  if (r.colonneExtra.length) {
    const desc = r.colonneExtra
      .map((e) => `${e.colonna}${e.etichetta ? ` "${e.etichetta}"` : ''} (${e.celle} celle)`)
      .join(', ')
    console.log(`\nColonne oltre il tracciato trovate in input: ${desc}`)
    console.log(r.colonneExtraRimosse
      ? '  → rimosse (usa --keep-extra per tenerle)'
      : '  --keep-extra: restano nel file')
  }

  console.log('\nRighe per Movimento:')
  for (const m of r.movimenti) console.log(`  ${String(m.righe).padStart(6)}  ${m.nome}`)

  console.log('\nGaranzie sulle Inclusioni → aliquota applicata:')
  for (const g of r.garanzie) {
    const pct = `${(g.aliquota * 100).toFixed(1).replace('.', ',')}%`
    console.log(`  ${String(g.righe).padStart(6)}  ${pct.padStart(7)} ${g.inTabella ? ' ' : '?'} ${g.nome}`)
  }

  if (r.premioNettoIllleggibile.length) {
    console.log(`\n⚠  ${r.premioNettoIllleggibile.length} inclusioni con Premio Netto non numerico:`)
    for (const m of r.premioNettoIllleggibile.slice(0, 10)) {
      console.log(`   riga ${m.riga}: ${JSON.stringify(m.valore)}`)
    }
  }

  if (r.pareggi.length) {
    const altro = r.rounding === 'commerciale' ? 'legacy' : 'commerciale'
    console.log(`\nℹ  ${r.pareggi.length} righe cadono esattamente a metà (…,xx5): ` +
      `con --rounding ${altro} varrebbero 0,01 in meno/più.`)
    for (const t of r.pareggi.slice(0, 12)) {
      console.log(`   riga ${t.riga}: ${t.garanzia} · netto ${t.premioNetto} · ` +
        `${r.rounding} ${formatItalian(t.valore)} vs ${altro} ${formatItalian(t.alternativa)}`)
    }
    if (r.pareggi.length > 12) console.log(`   … e altre ${r.pareggi.length - 12}`)
  }

  console.log(
    `\n${r.calcolate} PREMIO LORDO su ${r.inclusioni} inclusioni · ` +
    `${r.polizze} polizze · totale generale ${formatItalian(r.totaleGenerale)}`
  )

  console.log('\nVerifica sul calcolo:')
  for (const c of r.verifica) console.log(`  ${c.ok ? '✓' : '✗'} ${c.nome} — ${c.dettaglio}`)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const inputPath = opts.positional[0]
  if (!inputPath) {
    console.error(
      'Uso: node scripts/premio-lordo.mjs <input.xlsx> [output.xlsx] ' +
      '[--sheet N] [--rounding commerciale|legacy] [--keep-extra] [--assume-default] [--dry-run]'
    )
    process.exit(2)
  }
  if (!existsSync(inputPath)) throw new Error(`File non trovato: ${inputPath}`)

  const outputPath =
    opts.positional[1] || path.join(path.dirname(inputPath), outputFileName(path.basename(inputPath)))

  const { buffer, blocked, report } = await processPremioLordo(readFileSync(inputPath), {
    sheet: opts.sheet,
    rounding: opts.rounding,
    keepExtra: opts.keepExtra,
    // in dry-run non si scrive nulla, quindi le garanzie ignote non devono
    // bloccare il RAPPORTO: vengono comunque elencate qui sotto
    assumeDefault: opts.assumeDefault || opts.dryRun
  })

  stampaReport(report, opts)

  if (report.unknownGaranzie.length) {
    console.log('\n⛔ GARANZIE NON IN TABELLA — serve conferma dell\'aliquota:')
    for (const u of report.unknownGaranzie) {
      console.log(`   "${u.garanzia}" — ${u.righe} righe (es. riga ${u.esempi.join(', ')}${u.righe > 8 ? ', …' : ''})`)
    }
    if (blocked === 'unknownGaranzie') {
      console.log('\n   Nessun file scritto. Conferma l\'aliquota, oppure rilancia con --assume-default')
      console.log('   per applicare il 13,5% previsto per «tutte le altre garanzie».')
      process.exit(3)
    }
    console.log(`\n   ${opts.dryRun ? '--dry-run' : '--assume-default'}: applicato 13,5%.`)
  }

  if (opts.dryRun) {
    console.log('\n--dry-run: nessun file scritto.\n')
    return
  }

  if (report.celleRimosse) {
    console.log(`\nRimosse ${report.celleRimosse} celle oltre il tracciato` +
      `${report.formuleRimosse ? ` (di cui ${report.formuleRimosse} con formula)` : ''}` +
      `${report.unioniRimosse ? `, più ${report.unioniRimosse} intervallo/i di celle unite` : ''}.`)
  }
  for (const w of report.avvisi) console.log(`⚠  riferimento a colonne rimosse rimasto: ${w}`)

  await writeFile(outputPath, buffer)

  console.log('\nVerifica sul file scritto:')
  for (const c of report.rilettura) console.log(`  ${c.ok ? '✓' : '✗'} ${c.nome} — ${c.dettaglio}`)
  console.log(`\nScritto: ${outputPath}\n`)
}

main().catch((err) => {
  if (err instanceof PremioLordoError) {
    console.error(`\nErrore [${err.code}]: ${err.message}`)
    if (err.details?.sheets) console.error(`Fogli disponibili: ${err.details.sheets.join(', ')}`)
    console.error()
  } else {
    console.error(`\nErrore: ${err.message}\n`)
  }
  process.exit(1)
})
