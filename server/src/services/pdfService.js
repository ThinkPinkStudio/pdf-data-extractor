// Adattato da src/main/services/pdfService.js (versione Electron)
import { readFile } from 'fs/promises';

const CHUNK_SIZE    = 800;
const CHUNK_OVERLAP = 100;

function chunkText(text) {
  const chunks = [];
  const clean  = text.replace(/\s+/g, ' ').trim();
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + CHUNK_SIZE, clean.length);
    chunks.push({ id: chunks.length, text: clean.slice(i, end), start: i, end });
    i += CHUNK_SIZE - CHUNK_OVERLAP;
    if (i >= clean.length) break;
  }
  return chunks;
}

async function getPdfParse() {
  try {
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    return mod.default;
  } catch {
    const mod = await import('pdf-parse');
    return mod.default;
  }
}

export async function loadPDFBuffer(buffer) {
  const pdfParse = await getPdfParse();
  const data     = await pdfParse(buffer);
  return { text: data.text, chunks: chunkText(data.text), numPages: data.numpages };
}

export async function loadPDF(filePath) {
  return loadPDFBuffer(await readFile(filePath));
}
