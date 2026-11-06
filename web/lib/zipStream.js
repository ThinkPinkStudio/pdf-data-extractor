// Scrittore ZIP in STREAMING (metodo "store", nessuna compressione).
//
// Perché non una libreria: JSZip tiene in memoria TUTTI i contenuti fino alla
// generazione. Un batch di polizze sono decine/centinaia di PDF salvati in
// Postgres come base64: caricarli tutti insieme nello stesso processo che fa
// girare OCR e worker LLM è il modo più veloce per farlo morire di OOM. Qui
// ogni file entra, viene scritto e viene lasciato andare: la memoria di picco
// è quella del singolo PDF.
//
// I PDF sono già compressi: "store" (0) evita CPU e memoria del deflate senza
// far crescere davvero l'archivio.
//
// Nessuna dipendenza da Node/DB: modulo puro, testabile (test/zipStream.test.mjs
// verifica gli archivi prodotti con `unzip` vero).

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const ZIP64_EOCD_SIG = 0x06064b50
const ZIP64_LOCATOR_SIG = 0x07064b50
const U32_MAX = 0xffffffff
const U16_MAX = 0xffff
// Bit 11 = nomi in UTF-8 (senza, i caratteri accentati dei nomi file italiani
// vengono interpretati come CP437 dagli estrattori).
const FLAG_UTF8 = 0x0800

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

// CRC-32 (IEEE), quello richiesto dal formato ZIP.
export function crc32(bytes, seed = 0) {
  let c = ~seed >>> 0
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (~c) >>> 0
}

// Data/ora in formato MS-DOS (quello dello ZIP): secondi a passi di 2, anno
// dal 1980. Date precedenti al 1980 non sono rappresentabili → 1980-01-01.
export function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  if (d.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 }
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

function u16(buf, off, v) { buf.writeUInt16LE(v & 0xffff, off) }
function u32(buf, off, v) { buf.writeUInt32LE(v >>> 0, off) }
function u64(buf, off, v) { buf.writeBigUInt64LE(BigInt(v), off) }

/**
 * Genera i byte di un archivio ZIP consumando le voci UNA ALLA VOLTA.
 *
 * @param {AsyncIterable<{name: string, data: Uint8Array, date?: Date}>|Iterable<{name: string, data: Uint8Array, date?: Date}>} entries
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* zipStoreStream(entries) {
  /** @type {{nameBuf: Buffer, crc: number, size: number, offset: number, time: number, date: number}[]} */
  const central = []
  let offset = 0

  for await (const entry of entries) {
    const nameBuf = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    const crc = crc32(data)
    const { time, date } = dosDateTime(entry.date)
    // Zip64 nell'header locale solo per file ≥ 4 GB (mai, in pratica, per un
    // PDF: ma un archivio corrotto in silenzio sarebbe peggio del controllo).
    const big = data.length > U32_MAX
    const extraLen = big ? 20 : 0
    const header = Buffer.alloc(30 + nameBuf.length + extraLen)
    u32(header, 0, LOCAL_SIG)
    u16(header, 4, big ? 45 : 20)
    u16(header, 6, FLAG_UTF8)
    u16(header, 8, 0) // store
    u16(header, 10, time)
    u16(header, 12, date)
    u32(header, 14, crc)
    u32(header, 18, big ? U32_MAX : data.length)
    u32(header, 22, big ? U32_MAX : data.length)
    u16(header, 26, nameBuf.length)
    u16(header, 28, extraLen)
    nameBuf.copy(header, 30)
    if (big) {
      const e = 30 + nameBuf.length
      u16(header, e, 0x0001)
      u16(header, e + 2, 16)
      u64(header, e + 4, data.length)  // non compressa
      u64(header, e + 12, data.length) // compressa (store)
    }
    yield header
    yield data
    central.push({ nameBuf, crc, size: data.length, offset, time, date })
    offset += header.length + data.length
  }

  const cdOffset = offset
  let cdSize = 0
  for (const e of central) {
    const needSizes = e.size > U32_MAX
    const needOffset = e.offset > U32_MAX
    const z64 = (needSizes ? 16 : 0) + (needOffset ? 8 : 0)
    const extraLen = z64 ? z64 + 4 : 0
    const rec = Buffer.alloc(46 + e.nameBuf.length + extraLen)
    u32(rec, 0, CENTRAL_SIG)
    u16(rec, 4, 0x031e)          // creato su UNIX, spec 3.0
    u16(rec, 6, z64 ? 45 : 20)
    u16(rec, 8, FLAG_UTF8)
    u16(rec, 10, 0)
    u16(rec, 12, e.time)
    u16(rec, 14, e.date)
    u32(rec, 16, e.crc)
    u32(rec, 20, needSizes ? U32_MAX : e.size)
    u32(rec, 24, needSizes ? U32_MAX : e.size)
    u16(rec, 28, e.nameBuf.length)
    u16(rec, 30, extraLen)
    u16(rec, 32, 0)              // commento
    u16(rec, 34, 0)              // disco
    u16(rec, 36, 0)              // attributi interni
    u32(rec, 38, 0o100644 << 16) // file regolare rw-r--r--
    u32(rec, 42, needOffset ? U32_MAX : e.offset)
    e.nameBuf.copy(rec, 46)
    if (z64) {
      let p = 46 + e.nameBuf.length
      u16(rec, p, 0x0001)
      u16(rec, p + 2, z64)
      p += 4
      // L'ordine dei campi zip64 è fisso: dimensioni prima, offset poi.
      if (needSizes) { u64(rec, p, e.size); u64(rec, p + 8, e.size); p += 16 }
      if (needOffset) u64(rec, p, e.offset)
    }
    yield rec
    cdSize += rec.length
  }

  // Zip64 di coda quando l'archivio supera i limiti dei campi a 32/16 bit.
  const needZip64End = central.length > U16_MAX || cdOffset > U32_MAX || cdSize > U32_MAX
  if (needZip64End) {
    const z = Buffer.alloc(56)
    u32(z, 0, ZIP64_EOCD_SIG)
    u64(z, 4, 44) // dimensione del record che segue questi 12 byte
    u16(z, 12, 0x031e)
    u16(z, 14, 45)
    u32(z, 16, 0)
    u32(z, 20, 0)
    u64(z, 24, central.length)
    u64(z, 32, central.length)
    u64(z, 40, cdSize)
    u64(z, 48, cdOffset)
    yield z
    const loc = Buffer.alloc(20)
    u32(loc, 0, ZIP64_LOCATOR_SIG)
    u32(loc, 4, 0)
    u64(loc, 8, cdOffset + cdSize)
    u32(loc, 16, 1)
    yield loc
  }

  const eocd = Buffer.alloc(22)
  u32(eocd, 0, EOCD_SIG)
  u16(eocd, 4, 0)
  u16(eocd, 6, 0)
  u16(eocd, 8, Math.min(central.length, U16_MAX))
  u16(eocd, 10, Math.min(central.length, U16_MAX))
  u32(eocd, 12, Math.min(cdSize, U32_MAX))
  u32(eocd, 16, Math.min(cdOffset, U32_MAX))
  u16(eocd, 20, 0)
  yield eocd
}
