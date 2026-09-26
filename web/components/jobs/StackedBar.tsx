import type { Segment } from './model'

// Barra segmentata di avanzamento: un colore per gruppo di stati.
export function StackedBar({ segments, height = 8, title }: { segments: Segment[]; height?: number; title?: string }) {
  return (
    <div className="jb-bar" style={{ height }} title={title} role="img" aria-label={title}>
      {segments.map((s) => (
        <span key={s.key} style={{ flex: `${s.n} 1 0`, background: s.color, opacity: s.opacity ?? 1 }} />
      ))}
    </div>
  )
}
