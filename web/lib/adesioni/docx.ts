// Compilazione del Modulo di Adesione (docxtemplater + pizzip) lato server.
// Porta docxService.js: legge il template dagli asset e ritorna un Buffer,
// sostituendo solo i segnaposto {{...}}.
import { readFileSync } from 'fs'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { buildDocxData } from './recordMapper.js'
import { adesioniAssetPath } from './serverConfig'
import type { AdesioniConfig } from './config'

const PLACEHOLDERS = ['cognome_nome', 'targa', 'residenza', 'citta', 'cap', 'provincia', 'codice_fiscale', 'email', 'tel', 'data_inizio', 'data_fine', 'premio', 'pacchetto', 'opzione']

export function fillModuloBuffer(record: Record<string, unknown>, config: AdesioniConfig): Buffer {
  const data = buildDocxData(record, config.fields, config.prezzi, config.dateOffsetDays) as unknown as Record<string, string>
  for (const k of PLACEHOLDERS) if (!(k in data)) data[k] = ''

  const content = readFileSync(adesioniAssetPath('modulo_template.docx'))
  const zip = new PizZip(content)
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: () => '',
  })
  doc.render(data)
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}
