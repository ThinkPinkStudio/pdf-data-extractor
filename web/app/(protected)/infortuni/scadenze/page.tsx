'use client'

// Scadenze delle adesioni infortuni (mese scorso / questo mese / mese
// prossimo), come la prima versione di CSA Adesioni. «Rinnova» apre «Nuova
// adesione» già compilata coi dati dell'adesione (copertura dal giorno della
// scadenza): il rinnovo prende un numero nuovo, ha il suo certificato e va
// nel BDX come ogni adesione. Le adesioni già rinnovate dicono con quale numero.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { fmtDate, holderName } from '@/lib/infortuni/rules.js'
import { useT } from '@/lib/i18n/I18nProvider'

interface Row {
  id: string
  numero: string
  cognome: string
  nome: string
  targa: string
  data_scadenza: string
  data: Record<string, unknown>
  renewedBy: string | null
}
interface Groups { past: Row[]; current: Row[]; next: Row[] }

const SECTIONS: { key: keyof Groups; labelKey: string; color: string }[] = [
  { key: 'past', labelKey: 'inf.sca.past', color: 'var(--c-error)' },
  { key: 'current', labelKey: 'inf.sca.current', color: 'var(--c-warning)' },
  { key: 'next', labelKey: 'inf.sca.next', color: 'var(--c-info)' },
]

export default function InfortuniScadenzePage() {
  const t = useT()
  const [groups, setGroups] = useState<Groups | null>(null)
  const [err, setErr] = useState(false)
  const [hideRenewed, setHideRenewed] = useState(false)

  const load = useCallback(() => {
    fetch('/api/infortuni/scadenze').then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => setGroups({ past: d.past || [], current: d.current || [], next: d.next || [] }))
      .catch(() => setErr(true))
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t('nav.infScadenze')}</h1>
          <p className="view-subtitle" style={{ margin: '4px 0 0' }}>{t('inf.sca.subtitle')}</p>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={hideRenewed} onChange={(e) => setHideRenewed(e.target.checked)} />
          {t('inf.sca.hideRenewed')}
        </label>
      </div>
      {err && <div className="alert alert-error" style={{ marginBottom: 16 }}>{t('inf.sca.loadError')}</div>}
      {!groups && !err && <div className="card">{t('inf.loading')}</div>}

      {groups && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {SECTIONS.map((sec) => {
            const rows = groups[sec.key].filter((r) => !hideRenewed || !r.renewedBy)
            return (
              <div key={sec.key} className="card">
                <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: sec.color, flexShrink: 0 }} />
                  {t(sec.labelKey)} ({rows.length})
                </h2>
                {rows.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: 0 }}>{t('inf.sca.none')}</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rows.map((r) => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, borderBottom: '1px solid var(--c-separator)', paddingBottom: 8, opacity: r.renewedBy ? 0.65 : 1 }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <strong>{holderName({ ...r.data, cognome: r.cognome, nome: r.nome })}</strong>
                          <span style={{ display: 'block', color: 'var(--c-text-secondary)' }}>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{r.numero}</span> · {r.targa} · {t('inf.sca.expires')} {fmtDate(r.data_scadenza)}
                          </span>
                          {r.renewedBy && <span style={{ display: 'block', fontSize: 12, color: 'var(--c-success)' }}>{t('inf.sca.renewedBy', { n: r.renewedBy })}</span>}
                        </span>
                        {!r.renewedBy && (
                          <Link href={`/infortuni?rinnova=${encodeURIComponent(r.id)}`} className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', flexShrink: 0 }}>
                            {t('inf.sca.renew')}
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
