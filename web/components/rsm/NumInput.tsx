'use client'

// Campo numerico all'italiana: si scrive liberamente («646,», «2,5»,
// «9.146»), il valore passa al modulo quando è un numero, e all'uscita dal
// campo si mostra pulito. Prima ogni tasto ritrasformava il testo in numero e
// la virgola spariva mentre la si scriveva.
import { useEffect, useState } from 'react'

/** «9.146» = 9146, «9.146,50» = 9146.5, «2,5» = 2.5, «10.5» = 10.5. */
export function parseItNumber(text: string): number | null {
  const s = text.trim().replace(/\s|€/g, '')
  if (!s) return 0
  let n: number
  if (s.includes(',')) n = Number(s.replace(/\./g, '').replace(',', '.'))
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ''))
  else n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const show = (v: number | undefined) => (v ? String(v).replace('.', ',') : '')

export default function NumInput({ value, onChange, width = 90, disabled, label, invalid }: {
  value: number | undefined; onChange: (n: number) => void; width?: number; disabled?: boolean; label?: string; invalid?: boolean
}) {
  const [text, setText] = useState(show(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setText(show(value)) }, [value, focus])
  return (
    <input inputMode="decimal" aria-label={label} value={text} disabled={disabled}
      style={{ width, borderColor: invalid ? 'var(--c-error)' : undefined }}
      onFocus={() => setFocus(true)}
      onBlur={() => { setFocus(false); setText(show(value)) }}
      onChange={(e) => {
        setText(e.target.value)
        const n = parseItNumber(e.target.value)
        if (n != null) onChange(n)
      }} />
  )
}
