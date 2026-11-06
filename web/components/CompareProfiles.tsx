'use client'

import { useEffect, useState } from 'react'
import { useConfirmPanel } from './ConfirmPanel'
import { mergeProfileLists } from '@/lib/compare/profilesMerge'

// Pannello «Profili salvati» del Comparatore (blocco unico in Configurazione).
// Chi lo usa passa la chiave di impostazioni e lo snapshot dei criteri. Con
// `legacyKey` + `convertLegacy` mostra anche i profili di una chiave storica
// (es. quelli del vecchio Confronto righe) convertiti: alla prima modifica
// della lista finiscono salvati sotto `settingsKey`, nessuno va perso.
export default function CompareProfiles<T>({
  settingsKey,
  fileName,
  snapshot,
  onLoad,
  parseSingle,
  hint,
  legacyKey,
  convertLegacy,
  legacySuffix = ' (vecchio profilo)',
  showJson = true,
}: {
  settingsKey: string
  fileName: string
  // Criteri correnti da salvare nel profilo (null = niente da salvare).
  snapshot: () => T | null
  onLoad: (profile: T, name: string) => void
  // Interop: JSON che contiene UNA sola configurazione invece di un dizionario
  // di profili (es. export del desktop). Restituisce il profilo o null.
  parseSingle?: (parsed: unknown) => T | null
  hint?: string
  legacyKey?: string
  convertLegacy?: (legacy: unknown) => T | null
  legacySuffix?: string
  // false = niente «Esporta JSON» / «Importa JSON» (nascosti in Configurazione)
  showJson?: boolean
}) {
  const [profiles, setProfiles] = useState<Record<string, T>>({})
  // Profili della chiave storica che non si riesce a convertire: si elencano
  // lo stesso (grigi, non caricabili) invece di farli sparire senza dirlo.
  const [legacyBroken, setLegacyBroken] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  // Lettura fallita (sessione scaduta, API giù): va DETTA, se no un errore e
  // «nessun profilo» si vedono uguali e sembra che i profili siano spariti.
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const { ask: askConfirm, panel: confirmPanel } = useConfirmPanel()
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  useEffect(() => {
    let alive = true
    fetch('/api/settings')
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? 'sessione scaduta, rientra nell\'app' : `risposta ${r.status}`)
        return (await r.json()) as Record<string, unknown>
      })
      .then((d: Record<string, unknown>) => {
        if (!alive) return
        // I profili della chiave propria si mostrano SEMPRE: la conversione dei
        // vecchi è un extra che non può nasconderli (vedi profilesMerge.ts).
        const { own, converted, broken } = mergeProfileLists<T>(d, settingsKey, legacyKey, convertLegacy, legacySuffix)
        setProfiles({ ...converted, ...own })
        setLegacyBroken(broken)
      })
      .catch((err: Error) => { if (alive) setLoadError(err.message || 'errore di rete') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [settingsKey, legacyKey, convertLegacy, legacySuffix])

  async function persist(next: Record<string, T>) {
    setProfiles(next)
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [settingsKey]: next }),
    })
  }

  async function saveAs() {
    const n = name.trim()
    if (!n) return
    const snap = snapshot()
    if (!snap) return
    if (profiles[n] && !(await askConfirm(`Sovrascrivere il profilo «${n}»?`, { okLabel: 'Sovrascrivi' }))) return
    await persist({ ...profiles, [n]: snap })
    setName('')
    flash(`Profilo «${n}» salvato.`)
  }

  function load(n: string) {
    const p = profiles[n]
    if (!p) return
    onLoad(p, n)
    flash(`Profilo «${n}» caricato.`)
  }

  async function remove(n: string) {
    if (!(await askConfirm(`Eliminare il profilo «${n}»?`, { okLabel: 'Elimina', danger: true }))) return
    const next = { ...profiles }
    delete next[n]
    await persist(next)
    flash(`Profilo «${n}» eliminato.`)
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importJson(file: File | undefined) {
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== 'object') return
      const single = parseSingle?.(parsed)
      if (single) {
        const n = file.name.replace(/\.json$/i, '') || 'importato'
        await persist({ ...profiles, [n]: single })
        flash(`Profilo «${n}» importato.`)
        return
      }
      const incoming = parsed as Record<string, T>
      await persist({ ...profiles, ...incoming })
      flash(`${Object.keys(incoming).length} profili importati.`)
    } catch {
      flash('File non valido: nessun profilo importato.')
    }
  }

  const names = Object.keys(profiles)

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {confirmPanel}
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: hint ? 4 : 14 }}>Profili salvati</h2>
      {hint && <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 0, marginBottom: 14 }}>{hint}</p>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') saveAs() }}
          placeholder="Nome profilo"
          style={{ flex: 1, minWidth: 180 }}
        />
        <button className="btn btn-secondary" onClick={saveAs} disabled={!name.trim()}>Salva come profilo</button>
        {showJson && (
          <>
            <button className="btn btn-secondary" onClick={exportJson} disabled={!names.length}>Esporta JSON</button>
            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
              Importa JSON
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => { importJson(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          </>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {names.map((n) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 14 }}>{n}</span>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => load(n)}>Carica</button>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => remove(n)}>Elimina</button>
          </div>
        ))}
        {/* Vecchi profili senza nulla da convertire: si vedono comunque, così
            è chiaro che esistono e perché non si possono caricare. */}
        {legacyBroken.map((n) => (
          <div key={'old-' + n} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
            <span style={{ flex: 1, fontSize: 14 }}>{n}</span>
            <span style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>vecchio profilo senza colonne da riusare</span>
          </div>
        ))}
        {!names.length && !legacyBroken.length && (
          loadError ? (
            <p style={{ fontSize: 12, color: 'var(--c-danger, #f87171)', margin: 0 }}>
              Non sono riuscito a leggere i profili salvati ({loadError}). Non sono stati cancellati: ricarica la pagina.
            </p>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: 0 }}>
              {loading ? 'Carico i profili…' : 'Nessun profilo salvato in questo ambiente: scrivi un nome qui sopra e premi «Salva come profilo» per mettere da parte i criteri attuali.'}
            </p>
          )
        )}
      </div>
      {msg && <div className="alert alert-success" style={{ marginTop: 12 }}>{msg}</div>}
    </div>
  )
}
