// Orchestrazione della generazione: per ogni record produce il modulo .docx
// (e, se richiesto, il PDF ad alta fedeltà) e un unico tracciato .xlsx, il tutto
// impacchettato in uno ZIP scaricabile.
import JSZip from 'jszip'
import { fillModuloBuffer } from './docx'
import { writeTrackBuffer } from './xlsxTracciato'
import type { AdesioniConfig } from './config'

type Rec = Record<string, unknown>

export function safeName(record: Rec, i: number): string {
  const cognome = String(record.cognome || '').trim()
  const nome = String(record.nome || '').trim()
  const base = [cognome, nome].filter(Boolean).join('_') || `modulo_${i + 1}`
  return base.replace(/[^\w.-]+/g, '_')
}

export async function generateZip(records: Rec[], config: AdesioniConfig, opts: { pdf?: boolean } = {}): Promise<Buffer> {
  const zip = new JSZip()
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    const name = safeName(r, i)
    zip.file(`${name}.docx`, fillModuloBuffer(r, config))
    if (opts.pdf) {
      // Import dinamico: il rendering PDF (Playwright) è pesante e opzionale.
      const { renderModuloPdf } = await import('./pdfRender')
      zip.file(`${name}.pdf`, await renderModuloPdf(r, config))
    }
  }
  const tracciato = await writeTrackBuffer(records, config)
  zip.file('tracciato.xlsx', tracciato)
  const out = await zip.generateAsync({ type: 'nodebuffer' })
  return out as Buffer
}
