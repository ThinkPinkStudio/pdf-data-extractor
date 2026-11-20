'use client'

// Pannello di avviso quando un salvataggio viene rifiutato (20/11/2026): un
// messaggio in cima alla pagina, magari fuori schermo, sembrava una perdita di
// dati. Il pannello dice che NON si è salvato nulla, che le modifiche sono
// ancora nella pagina, e per ogni motivo che cosa correggere e dove.
import { useEffect } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { ApiError } from '@/components/rsm/useRsm'

export interface SaveError { title: string; message: string; problems: { text: string; fix: string }[]; code?: string; lost?: string }

/** Dall'errore di una chiamata al contenuto del pannello. */
export function saveErrorOf(e: unknown, title: string, lost?: string): SaveError {
  if (e instanceof ApiError) return { title, message: e.message, problems: e.problems, code: e.code, lost }
  return { title, message: (e as Error)?.message || String(e), problems: [], lost }
}

export default function SaveErrorDrawer({ error, onClose }: { error: SaveError | null; onClose: () => void }) {
  const { t } = useI18n()
  useEffect(() => {
    if (!error) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [error, onClose])
  if (!error) return null
  return (
    <>
      <div className="rsm-drawer-veil" onClick={onClose} aria-hidden="true" />
      <aside className="rsm-drawer" role="alertdialog" aria-modal="true" aria-labelledby="rsm-save-err-title">
        <div className="rsm-drawer-head" style={{ borderTop: '4px solid var(--c-error)' }}>
          <div>
            <div className="rsm-kicker" style={{ color: 'var(--c-error)' }}>{t('rsm.err.kicker')}</div>
            <h2 id="rsm-save-err-title" style={{ margin: '2px 0 4px', fontSize: 19 }}>{error.title}</h2>
            <div className="rsm-muted" style={{ fontSize: 13 }}>{error.message}</div>
          </div>
          <button className="rsm-mini" onClick={onClose} aria-label={t('rsm.close')}>×</button>
        </div>
        <div className="rsm-drawer-body">
          <div style={{ margin: 0, padding: '10px 14px', borderRadius: 'var(--r-md)', fontSize: 13, lineHeight: 1.5, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)' }}>{error.lost || t('rsm.err.kept')}</div>
          {error.problems.length > 0 && (
            <div>
              <div className="rsm-drawer-h">{t('rsm.err.why', { n: error.problems.length })}</div>
              <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 10 }}>
                {error.problems.map((p, i) => (
                  <li key={i}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.text}</div>
                    <div className="rsm-muted" style={{ fontSize: 13 }}>{t('rsm.err.fix')} {p.fix}</div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {!error.problems.length && <div className="rsm-muted" style={{ fontSize: 13 }}>{t('rsm.err.generic')}</div>}
          <div className="rsm-note">{t('rsm.err.help')}{error.code ? ` (${t('rsm.err.code')}: ${error.code})` : ''}</div>
          <div><button className="btn btn-primary" onClick={onClose}>{t('rsm.err.ok')}</button></div>
        </div>
      </aside>
    </>
  )
}
