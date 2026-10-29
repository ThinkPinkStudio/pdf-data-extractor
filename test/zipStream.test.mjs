/**
 * Scrittore ZIP in streaming: gli archivi prodotti devono essere leggibili da
 * un estrattore VERO (`unzip` di sistema, non un parser scritto qui che
 * ripeterebbe gli stessi eventuali errori del writer).
 *
 * Esegui:  node --test test/zipStream.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { crc32, dosDateTime, zipStoreStream } from '../web/lib/zipStream.js'

async function collect(entries) {
  const chunks = []
  for await (const c of zipStoreStream(entries)) chunks.push(c)
  return Buffer.concat(chunks)
}

function walk(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full, base))
    else out.push(relative(base, full).split('\\').join('/'))
  }
  return out.sort()
}

// Estrae con `unzip` vero e restituisce { percorso → contenuto }.
function extract(zipBytes) {
  const dir = mkdtempSync(join(tmpdir(), 'zipstream-'))
  const zipPath = join(dir, 'archivio.zip')
  writeFileSync(zipPath, zipBytes)
  const out = join(dir, 'out')
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', out])
  const files = {}
  for (const rel of walk(out)) files[rel] = readFileSync(join(out, rel))
  return files
}

test('il CRC-32 è quello dello standard (vettore noto "123456789")', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
  assert.equal(crc32(Buffer.alloc(0)), 0)
})

test('la data DOS codifica anno/mese/giorno e i secondi a passi di 2', () => {
  const { time, date } = dosDateTime(new Date(2026, 8, 11, 9, 1, 59))
  assert.equal(date >> 9, 2026 - 1980)
  assert.equal((date >> 5) & 0x0f, 9)
  assert.equal(date & 0x1f, 11)
  assert.equal(time >> 11, 9)
  assert.equal((time >> 5) & 0x3f, 1)
  assert.equal((time & 0x1f) * 2, 58)
})

test('unzip estrae i file nelle cartelle annidate, byte per byte', async () => {
  const a = Buffer.from('%PDF-1.4 contratto\n', 'utf8')
  const b = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256)) // binario, non testo
  const zip = await collect([
    { name: 'GUFFANTI GROUP/Polizza 1/contratto.pdf', data: a, date: new Date(2026, 0, 2, 3, 4, 6) },
    { name: 'GUFFANTI GROUP/Polizza 2/quietanza 2025.pdf', data: b, date: new Date(2026, 0, 2, 3, 4, 6) },
  ])
  const files = extract(zip)
  assert.deepEqual(Object.keys(files).sort(), [
    'GUFFANTI GROUP/Polizza 1/contratto.pdf',
    'GUFFANTI GROUP/Polizza 2/quietanza 2025.pdf',
  ])
  assert.deepEqual(files['GUFFANTI GROUP/Polizza 1/contratto.pdf'], a)
  assert.deepEqual(files['GUFFANTI GROUP/Polizza 2/quietanza 2025.pdf'], b)
})

test('i nomi accentati sopravvivono (flag UTF-8)', async () => {
  const data = Buffer.from('polizza', 'utf8')
  const zip = await collect([{ name: 'Città/Società à€/più così.pdf', data }])
  const files = extract(zip)
  assert.deepEqual(Object.keys(files), ['Città/Società à€/più così.pdf'])
})

test('l\'archivio vuoto è comunque un archivio ben formato', async () => {
  const zip = await collect([])
  assert.equal(zip.length, 22) // solo l\'End Of Central Directory
  assert.equal(zip.readUInt32LE(0), 0x06054b50)
  assert.equal(zip.readUInt16LE(8), 0) // nessuna voce
  // `unzip` si rifiuta di estrarre un archivio senza voci ("zipfile is empty"):
  // è il suo comportamento normale, non un archivio rotto.
  const dir = mkdtempSync(join(tmpdir(), 'zipstream-'))
  const zipPath = join(dir, 'vuoto.zip')
  writeFileSync(zipPath, zip)
  let output = ''
  try { output = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' }) }
  catch (e) { output = String(e.stdout || '') + String(e.stderr || '') }
  assert.match(output, /zipfile is empty/)
})

test('la sorgente può essere asincrona e viene consumata una voce alla volta', async () => {
  const letti = []
  async function* lazy() {
    for (const n of [1, 2, 3]) {
      letti.push(n)
      yield { name: `doc${n}.pdf`, data: Buffer.from(`file ${n}`) }
    }
  }
  const chunks = []
  const gen = zipStoreStream(lazy())
  // Alla PRIMA voce scritta la sorgente non può aver già letto tutto il resto:
  // è esattamente ciò che tiene bassa la memoria con un batch di gigabyte.
  const first = await gen.next()
  chunks.push(first.value)
  assert.deepEqual(letti, [1])
  for await (const c of gen) chunks.push(c)
  assert.deepEqual(letti, [1, 2, 3])
  const files = extract(Buffer.concat(chunks))
  assert.equal(files['doc3.pdf'].toString(), 'file 3')
})

test('unzip -t non trova errori su un archivio con molte voci', async () => {
  const entries = Array.from({ length: 200 }, (_, i) => ({
    name: `Cartella/Polizza ${String(i).padStart(3, '0')}/documento.pdf`,
    data: Buffer.from(`contenuto numero ${i}`.repeat(20)),
  }))
  const zip = await collect(entries)
  const dir = mkdtempSync(join(tmpdir(), 'zipstream-'))
  const zipPath = join(dir, 'molti.zip')
  writeFileSync(zipPath, zip)
  const out = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' })
  assert.match(out, /No errors detected in compressed data/)
  assert.equal(Object.keys(extract(zip)).length, 200)
})
