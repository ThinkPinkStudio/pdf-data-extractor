import ExcelJS from 'exceljs'

// ─── Export semplice (decisione: NON lo scrittore sul gestionale) ────────────
// Replica esatta del comportamento di `exportToNewExcel` (desktop): un nuovo
// .xlsx con foglio "Polizza" e due colonne Campo / Valore, una riga per campo.
// È la stessa funzione di export che userà anche il percorso single-polizza web.

export interface FieldDef {
  id: string
  label: string
  enabled?: boolean
}

export async function buildSimpleXlsx(
  data: Record<string, string>,
  fields?: FieldDef[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Polizza')
  ws.columns = [
    { header: 'Campo', key: 'campo', width: 45 },
    { header: 'Valore', key: 'valore', width: 55 },
  ]

  const list: FieldDef[] =
    fields && fields.length > 0
      ? fields.filter((f) => f.enabled !== false)
      : Object.keys(data).map((id) => ({ id, label: id }))

  for (const f of list) {
    ws.addRow({ campo: f.label, valore: data[f.id] ?? '' })
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
