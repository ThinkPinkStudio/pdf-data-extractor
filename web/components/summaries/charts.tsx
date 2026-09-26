'use client'
// RIEPILOGHI — grafici in SVG in linea (nessuna libreria), come nei mockup
// approvati: colonne per anno (cruscotto) e istogramma (vista «Per campo»).
// Colori SOLO da classi con i token dell'app (.rp-col, .rp-grid…): seguono il
// tema chiaro e scuro. Larghezza reale del contenitore, altezza fissa.
import { useWidth } from './hooks'
import { niceStep, type Fmt, type NumKind } from './format'

export interface YearBar { year: number; inProgress: boolean; ref: boolean; value: number | null; count: number; n?: number }

const YB_H = 236
const YB_BASE = 190
const YB_TOP = 58

/**
 * Colonne per anno: anno di riferimento pieno e in grassetto, anni prima più
 * tenui, anno in corso tratteggiato. Un anno in cui non tutte le polizze hanno
 * il valore (partialLabel non null) porta «*» sul valore e lo dice nel tooltip.
 */
export function YearBars({ bars, field, fmt, ariaLabel, yearLabel, countLabel, partialLabel }: {
  bars: (YearBar & { n: number })[]
  field: NumKind
  fmt: Fmt
  ariaLabel: string
  yearLabel: (b: YearBar, compact: boolean) => string
  countLabel: (n: number) => string
  partialLabel?: (b: YearBar & { n: number }) => string | null
}) {
  const [ref, w] = useWidth<HTMLDivElement>(640)
  const width = Math.max(240, Math.round(w || 640))
  const max = Math.max(0, ...bars.map((b) => (b.value != null && b.value > 0 ? b.value : 0)))
  const step = niceStep(max / 2)
  const top = step * 2
  const ticks = max > 0 ? [step, step * 2] : []
  const tickText = ticks.map((v) => fmt.agg(v, field))
  const left = Math.max(44, Math.max(0, ...tickText.map((s) => s.length)) * 6 + 14)
  const n = Math.max(1, bars.length)
  const slot = (width - left) / n
  const barW = Math.max(14, Math.min(70, slot * 0.58))
  const compact = slot < 104
  const y = (v: number) => YB_BASE - (top > 0 ? (Math.max(0, v) / top) * (YB_BASE - YB_TOP) : 0)
  const refIdx = bars.findIndex((b) => b.ref)
  const before = bars.map((b, i) => (!b.inProgress && (refIdx < 0 || i < refIdx) ? i : -1)).filter((i) => i >= 0)
  const opacity = (b: YearBar, i: number): number => {
    if (b.ref) return 1
    if (refIdx >= 0 && i > refIdx) return 0.85
    const k = before.indexOf(i)
    if (k < 0) return 0.85
    return before.length > 1 ? 0.55 + (0.3 * k) / (before.length - 1) : 0.7
  }
  return (
    <div ref={ref} style={{ width: '100%', minWidth: 0 }}>
      <svg width={width} height={YB_H} viewBox={`0 0 ${width} ${YB_H}`} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
        <line className="rp-axis" x1={0} y1={YB_BASE} x2={width} y2={YB_BASE} />
        {ticks.map((v, i) => (
          <g key={v}>
            <line className="rp-grid" x1={0} y1={y(v)} x2={width} y2={y(v)} />
            <text className="rp-tick" x={0} y={y(v) - 4}>{tickText[i]}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = left + i * slot + slot / 2
          const x = cx - barW / 2
          const has = b.value != null
          const h = has ? Math.max(b.value! > 0 ? 2 : 0, YB_BASE - y(b.value!)) : 0
          const part = partialLabel ? partialLabel(b) : null
          const tip = `${yearLabel(b, false)}: ${has ? fmt.agg(b.value, field) : '—'} · ${countLabel(b.count)}${part ? ` · ${part}` : ''}`
          return (
            <g key={b.year}>
              <title>{tip}</title>
              {has && h > 0 && (b.inProgress
                ? <rect className="rp-col partial" x={x + 0.5} y={YB_BASE - h + 0.5} width={barW - 1} height={Math.max(1, h - 1)} rx={4} />
                : <rect className="rp-col" x={x} y={YB_BASE - h} width={barW} height={h} rx={4} opacity={opacity(b, i)} />)}
              <text className={`rp-val${b.ref ? ' ref' : ''}${b.inProgress ? ' dim' : ''}`} x={cx} y={YB_BASE - h - 8} textAnchor="middle">{has ? `${fmt.bare(b.value, field)}${part ? '*' : ''}` : '—'}</text>
              <text className={`rp-xl${b.inProgress ? ' dim' : ''}`} x={cx} y={208} textAnchor="middle">{yearLabel(b, compact)}</text>
              <text className="rp-xs" x={cx} y={225} textAnchor="middle">{countLabel(b.count)}</text>
              {/* area di hover più grande della colonna */}
              <rect x={left + i * slot} y={YB_TOP - 20} width={slot} height={YB_H - YB_TOP + 20} fill="transparent" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export interface HistItem { key: string; label: string; count: number; muted?: boolean }

const HI_H = 200
const HI_BASE = 170

/** Istogramma: colonne in --c-info, conteggio sopra, fascia sotto. */
export function Histogram({ items, ariaLabel, titleOf }: { items: HistItem[]; ariaLabel: string; titleOf?: (it: HistItem) => string }) {
  const [ref, w] = useWidth<HTMLDivElement>(540)
  const width = Math.max(200, Math.round(w || 540))
  const n = Math.max(1, items.length)
  const slot = width / n
  const barW = Math.max(8, Math.min(60, slot * 0.8))
  const max = Math.max(1, ...items.map((i) => i.count))
  const small = slot < 58
  const skip = slot < 34 ? 2 : 1
  return (
    <div ref={ref} style={{ width: '100%', minWidth: 0 }}>
      <svg width={width} height={HI_H} viewBox={`0 0 ${width} ${HI_H}`} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
        <line className="rp-axis" x1={0} y1={HI_BASE} x2={width} y2={HI_BASE} />
        {items.map((it, i) => {
          const cx = i * slot + slot / 2
          const h = it.count > 0 ? Math.max(3, (it.count / max) * (HI_BASE - 40)) : 0
          const op = it.muted ? 0.6 : 0.6 + 0.4 * (it.count / max)
          return (
            <g key={it.key}>
              <title>{titleOf ? titleOf(it) : `${it.label}: ${it.count}`}</title>
              {h > 0 && <rect className={`rp-col ${it.muted ? 'muted' : 'info'}`} x={cx - barW / 2} y={HI_BASE - h} width={barW} height={h} rx={4} opacity={op} />}
              <text className="rp-val" x={cx} y={HI_BASE - h - 7} textAnchor="middle">{it.count}</text>
              {i % skip === 0 && <text className="rp-xs" x={cx} y={188} textAnchor="middle" style={small ? { fontSize: 10 } : undefined}>{it.label}</text>}
              <rect x={i * slot} y={20} width={slot} height={HI_H - 20} fill="transparent" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
