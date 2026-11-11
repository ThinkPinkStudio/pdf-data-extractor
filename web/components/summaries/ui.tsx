'use client'
// RIEPILOGHI — pezzi comuni delle viste: menu di scelta a tendina (ActionMenu
// con la spunta sulla voce attiva), testata delle card, riga con barra.
import type { ReactNode } from 'react'
import { ActionMenu } from '@/components/jobs/ActionMenu'
import { IcCheck, IcChevDown } from '@/components/jobs/Icons'

export interface PickOption { id: string; label: string; active?: boolean; disabled?: boolean; title?: string }

/** Filtro della toolbar: trigger «Etichetta ▾» e spunta sulla voce attiva. */
export function Pick({ label, options, onPick, ariaLabel, className }: {
  label: ReactNode
  options: PickOption[]
  onPick: (id: string) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <ActionMenu
      ariaLabel={ariaLabel}
      className={className || 'rp-sel'}
      trigger={<><span className="rp-sel-l">{label}</span><IcChevDown /></>}
      items={options.map((o) => ({
        id: o.id || '__all',
        label: o.label,
        icon: o.active ? <IcCheck /> : <span className="rp-noic" aria-hidden="true" />,
        onClick: () => onPick(o.id),
        disabled: o.disabled,
        title: o.title,
      }))}
    />
  )
}

export function CardHead({ title, sub, right, mb = 8 }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; mb?: number }) {
  return (
    <div className="rp-ch" style={{ marginBottom: mb }}>
      <h2 className="rp-h">{title}</h2>
      {sub != null && <span className="rp-sub">{sub}</span>}
      {right}
    </div>
  )
}

/** Riga con etichetta, barra (quota 0..1), conteggio e un valore secondario opzionale. */
export function BarRow({ label, share, count, extra, fill = '', labelWidth = 84, onClick, active, title, muted }: {
  label: ReactNode
  share: number
  count: ReactNode
  extra?: ReactNode
  fill?: '' | 'info' | 'ok' | 'muted'
  labelWidth?: number
  onClick?: () => void
  active?: boolean
  title?: string
  muted?: boolean
}) {
  const w = `${Math.max(0, Math.min(1, share)) * 100}%`
  const inner = (
    <>
      <span className={`rp-rl${muted ? ' rp-muted' : ''}`} style={{ width: labelWidth }} title={typeof label === 'string' ? label : title}>{label}</span>
      <span className="rp-meter"><span className={`rp-fill${fill ? ` ${fill}` : ''}`} style={{ width: w }} /></span>
      <span className="rp-rn">{count}</span>
      {extra != null && <span className="rp-sub rp-rx">{extra}</span>}
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={`rp-row rp-rowbtn${active ? ' on' : ''}`} onClick={onClick} title={title} aria-pressed={!!active}>
        {inner}
      </button>
    )
  }
  return <div className="rp-row" title={title}>{inner}</div>
}
