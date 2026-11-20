'use client'

import { useParams } from 'next/navigation'
import { Suspense } from 'react'
import { SummaryView } from '@/components/summaries/SummaryView'

// DETTAGLIO DI UN RIEPILOGO: Suspense obbligatorio con useSearchParams (stato
// della vista nell'URL: vista, anno, gruppo, a, b, campo).
export default function SummaryPage() {
  const params = useParams<{ id: string }>()
  const id = String(params?.id || '')
  return (
    <Suspense fallback={<p style={{ fontSize: 13 }}><span className="spinner" /></p>}>
      <SummaryView key={id} id={id} />
    </Suspense>
  )
}
