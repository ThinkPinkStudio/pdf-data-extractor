#!/usr/bin/env node
/**
 * Punteggio di un JSON di estrazione contro il golden EULIP (o un golden custom).
 *
 * Non lancia Ollama: prende l'output già prodotto (export job, "Scarica diagnostica",
 * o un file { data: { campo: valore } }).
 *
 *   node scripts/eval-polizza.mjs --actual path/to/extracted.json
 *   node scripts/eval-polizza.mjs --actual extracted.json --expected test/fixtures/eulip-expected.json
 *
 * Exit 0 sempre (è un report); usa --min 0.8 per fallire sotto soglia di match.
 */
import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { scoreExtraction, formatScoreReport, EULIP_EXPECTED } from '../src/main/services/polizzaEval.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const actualPath = arg('actual')
if (!actualPath) {
  console.error('Uso: node scripts/eval-polizza.mjs --actual extracted.json [--expected golden.json] [--min 0.8]')
  process.exit(2)
}

const expectedPath = arg('expected')
const expected = expectedPath
  ? loadJson(resolve(expectedPath))
  : loadJson(join(root, 'test/fixtures/eulip-expected.json'))

const actual = loadJson(resolve(actualPath))
const score = scoreExtraction(actual, expected?.fields ? expected : EULIP_EXPECTED)
console.log(formatScoreReport(score))

const min = arg('min')
if (min != null) {
  const threshold = Number(min)
  if (!Number.isFinite(threshold)) {
    console.error(`--min non numerico: ${min}`)
    process.exit(2)
  }
  if (score.fieldMatchRate < threshold) {
    console.error(`Sotto soglia: match ${score.fieldMatchRate} < ${threshold}`)
    process.exit(1)
  }
}
