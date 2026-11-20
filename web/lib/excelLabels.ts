// TESTI DEGLI EXCEL rinominabili (19/11/2026, «ogni virgola configurabile»).
// Una riga per sostituzione, «testo di sempre = testo nuovo»: vale per i nomi
// dei fogli (anche come inizio: «Variazioni = Movimenti» rinomina «Variazioni
// IMPIEGATI» in «Movimenti IMPIEGATI») e per ogni cella il cui testo è
// esattamente quello di sempre (intestazioni di colonna, «SI»/«NO», «TOTALE»).
// Si applica alla fine, sul file già costruito: le regole di calcolo non lo
// vedono mai.
import type ExcelJS from 'exceljs'

export type LabelMap = { from: string; to: string }[]

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase()

/** «VECCHIO = NUOVO» per riga; righe vuote o senza «=» ignorate. */
export function parseLabels(text: string | null | undefined): LabelMap {
  return String(text || '').split(/\r?\n/).map((l) => {
    const i = l.indexOf('=')
    if (i <= 0) return null
    const from = l.slice(0, i).trim(), to = l.slice(i + 1).trim()
    return from ? { from, to } : null
  }).filter((x): x is { from: string; to: string } => !!x)
}

/** Nome di un foglio (max 31 caratteri, senza i segni che Excel non accetta). */
const sheetSafe = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)

export function applyLabels(wb: ExcelJS.Workbook, text: string | null | undefined) {
  const map = parseLabels(text)
  if (!map.length) return
  const exact = new Map(map.map((m) => [norm(m.from), m.to]))
  const used = new Set<string>()
  for (const ws of wb.worksheets) {
    // foglio: nome intero o inizio del nome
    const n = norm(ws.name)
    for (const m of map) {
      const f = norm(m.from)
      if (n === f || n.startsWith(`${f} `)) {
        const name = n === f ? sheetSafe(m.to) : sheetSafe(`${m.to}${ws.name.trim().slice(m.from.trim().length)}`)
        if (name && !used.has(name.toUpperCase())) ws.name = name
        break
      }
    }
    used.add(ws.name.toUpperCase())
    // celle con il testo esatto di sempre
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value !== 'string') return
        const to = exact.get(norm(cell.value))
        if (to != null) cell.value = to
      })
    })
  }
}
