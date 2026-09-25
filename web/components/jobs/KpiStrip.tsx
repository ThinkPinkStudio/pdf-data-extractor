'use client'
import { useT } from '@/lib/i18n/I18nProvider'
import type { FilterKey } from './types'
import { FILTERS, FILTER_COLOR, FILTER_LABEL_KEY } from './model'

const NUM_CLASS: Record<FilterKey, string> = {
  all: '', active: 'jb-c-info', matched: 'jb-c-ok', review: 'jb-c-warn', mismatch: 'jb-c-orange', setAside: 'jb-muted', done: 'jb-c-ok', error: 'jb-c-err', canceled: 'jb-muted',
}

// Striscia dei contatori per stato: l'UNICO filtro della pagina del batch
// (vale per entrambe le viste). I riquadri a zero restano, attenuati, così
// le posizioni non cambiano da un batch all'altro.
export function KpiStrip({ counts, active, onChange }: { counts: Record<FilterKey, number>; active: FilterKey; onChange: (k: FilterKey) => void }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {FILTERS.map((k) => {
        const n = counts[k] || 0
        return (
          <button key={k} type="button" className={`jb-kpi${active === k ? ' active' : ''}${n === 0 && k !== 'all' ? ' zero' : ''}`}
            aria-pressed={active === k} onClick={() => onChange(k)}>
            <span className="l">{t(FILTER_LABEL_KEY[k])}</span>
            <span className={`n ${NUM_CLASS[k]}`}>{n}</span>
            <span className="b" style={{ background: FILTER_COLOR[k] }} />
          </button>
        )
      })}
    </div>
  )
}
