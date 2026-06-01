import { readFile } from 'fs/promises'

const CHUNK_SIZE = 800
const CHUNK_OVERLAP = 100

function chunkText(text) {
  const chunks = []
  let i = 0
  const clean = text.replace(/\s+/g, ' ').trim()
  while (i < clean.length) {
    const end = Math.min(i + CHUNK_SIZE, clean.length)
    chunks.push({
      id: chunks.length,
      text: clean.slice(i, end),
      start: i,
      end
    })
    i += CHUNK_SIZE - CHUNK_OVERLAP
    if (i >= clean.length) break
  }
  return chunks
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2)
}

export function searchChunks(query, chunks, topK = 4) {
  const queryTokens = new Set(tokenize(query))
  if (queryTokens.size === 0) return chunks.slice(0, topK)

  const scored = chunks.map(chunk => {
    const chunkTokens = tokenize(chunk.text)
    const matches = chunkTokens.filter(t => queryTokens.has(t)).length
    const density = matches / Math.max(chunkTokens.length, 1)
    return { ...chunk, score: matches + density * 10 }
  })

  return scored
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

export async function loadPDF(filePath) {
  const buffer = await readFile(filePath)

  let pdfParse
  try {
    const mod = await import('pdf-parse/lib/pdf-parse.js')
    pdfParse = mod.default
  } catch {
    try {
      const mod = await import('pdf-parse')
      pdfParse = mod.default
    } catch {
      throw new Error('Libreria pdf-parse non disponibile. Reinstalla le dipendenze.')
    }
  }

  const data = await pdfParse(buffer)
  const chunks = chunkText(data.text)

  return {
    text: data.text,
    chunks,
    numPages: data.numpages,
    info: data.info,
    buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  }
}
