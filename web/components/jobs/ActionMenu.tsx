'use client'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { IcMore } from './Icons'

// useLayoutEffect solo nel browser (nel render del server React avvisa).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export interface MenuItem { id: string; label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; title?: string }

// Menu ⋯: le celle della tabella hanno overflow nascosto, quindi il pannello
// è posizionato in FIXED sulle coordinate del pulsante; scroll/Escape/click
// fuori lo chiudono. Lo scroll DENTRO il menu no (i menu lunghi con
// max-height scorrono: riepiloghi, anni), e dopo l'apertura la posizione si
// corregge con l'altezza vera (sopra il pulsante se sotto non c'è posto).
export function ActionMenu({ items, ariaLabel, trigger, className }: { items: MenuItem[]; ariaLabel: string; trigger?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => {
      const tgt = e.target as Node
      if (menuRef.current?.contains(tgt) || btnRef.current?.contains(tgt)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = (e: Event) => {
      if (e.type === 'scroll' && e.target instanceof Node && menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  // Altezza vera (max-height del CSS compresa): sotto il pulsante se c'è posto, altrimenti sopra.
  useIsoLayoutEffect(() => {
    if (!open || !menuRef.current || !btnRef.current) return
    const h = menuRef.current.getBoundingClientRect().height
    const r = btnRef.current.getBoundingClientRect()
    let top = r.bottom + 4
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 4 - h)
    setPos((p) => (p && Math.abs(p.top - top) > 0.5 ? { ...p, top } : p))
  }, [open])

  if (!items.length) return null

  function toggle(e: MouseEvent) {
    e.stopPropagation()
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const width = 230
    const estH = items.length * 30 + 16
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
    let top = r.bottom + 4
    if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - 4 - estH)
    setPos({ top, left })
    setOpen(true)
  }

  return (
    <>
      <button ref={btnRef} type="button" className={`jb-btn ghost icon${className ? ` ${className}` : ''}`} aria-label={ariaLabel} title={ariaLabel}
        aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        {trigger || <IcMore />}
      </button>
      {open && pos && (
        <div ref={menuRef} className="jb-menu" role="menu" style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
          {items.map((it) => (
            <Fragment key={it.id}>
              {it.danger && <hr />}
              <button type="button" role="menuitem" className={it.danger ? 'danger' : ''} disabled={it.disabled} title={it.title}
                onClick={() => { setOpen(false); it.onClick() }}>
                {it.icon}{it.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </>
  )
}
