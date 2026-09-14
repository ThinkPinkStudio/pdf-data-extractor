'use client'
import { useCallback, useState, type ReactNode } from 'react'

/**
 * Conferma IN-APP (niente window.confirm/alert): un pannellino fisso in basso
 * a destra con messaggio e due pulsanti. Uso:
 *   const { ask, panel } = useConfirmPanel()
 *   if (!(await ask('Eliminare il profilo?', { okLabel: 'Elimina', danger: true }))) return
 *   … e nel JSX: {panel}
 * La promessa si risolve true/false alla scelta; una nuova richiesta mentre
 * un'altra è aperta chiude la precedente come "annulla".
 */
export interface ConfirmOptions { okLabel?: string; cancelLabel?: string; danger?: boolean; title?: string; details?: ReactNode }

export function useConfirmPanel() {
  const [state, setState] = useState<{ message: string; opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null)
  const ask = useCallback((message: string, opts: ConfirmOptions = {}) => new Promise<boolean>((resolve) => {
    setState((prev) => { if (prev) prev.resolve(false); return { message, opts, resolve } })
  }), [])
  const close = (v: boolean) => setState((prev) => { if (prev) prev.resolve(v); return null })
  const panel = state ? (
    <div role="dialog" aria-modal="false" style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 1000, maxWidth: 460, padding: 14,
      background: 'var(--c-bg-card, #fff)', border: `1px solid ${state.opts.danger ? 'var(--c-error, #ef4444)' : 'var(--c-border, #ddd)'}`,
      borderRadius: 'var(--r-md, 8px)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', fontSize: 13,
    }}>
      {state.opts.title && <p style={{ fontWeight: 600, marginBottom: 6 }}>{state.opts.title}</p>}
      <p style={{ whiteSpace: 'pre-wrap', marginBottom: state.opts.details ? 6 : 10 }}>{state.message}</p>
      {state.opts.details && <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--c-text-secondary)' }}>{state.opts.details}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => close(false)}>{state.opts.cancelLabel || 'Annulla'}</button>
        <button type="button" className={`btn ${state.opts.danger ? 'btn-secondary' : 'btn-primary'}`} autoFocus
          style={{ fontSize: 12, ...(state.opts.danger ? { color: 'var(--c-error)', borderColor: 'var(--c-error)' } : {}) }} onClick={() => close(true)}>
          {state.opts.okLabel || 'Conferma'}
        </button>
      </div>
    </div>
  ) : null
  return { ask, panel }
}
