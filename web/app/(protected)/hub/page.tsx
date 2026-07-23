'use client'

import Link from 'next/link'
import { useI18n } from '@/lib/i18n/I18nProvider'

/* ─── Icone delle tre sezioni ───────────────────────────────────────────── */
const IconExtractor = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
)
const IconCompare = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="7" height="16" rx="1" />
    <rect x="14" y="4" width="7" height="16" rx="1" />
    <line x1="10" y1="9" x2="14" y2="9" />
    <line x1="10" y1="15" x2="14" y2="15" />
  </svg>
)
const IconAdesioni = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 2h6a1 1 0 0 1 1 1v1h1a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1z" />
    <path d="M9 4h6" />
    <line x1="9" y1="12" x2="15" y2="12" />
    <line x1="9" y1="16" x2="13" y2="16" />
  </svg>
)

interface Section {
  href: string
  icon: React.ReactNode
  titleKey: string
  descKey: string
}

const SECTIONS: Section[] = [
  { href: '/extractor', icon: <IconExtractor />, titleKey: 'nav.secExtractor', descKey: 'hub.extractorDesc' },
  { href: '/compare', icon: <IconCompare />, titleKey: 'nav.secCompare', descKey: 'hub.compareDesc' },
  { href: '/adesioni', icon: <IconAdesioni />, titleKey: 'nav.secAdesioni', descKey: 'hub.adesioniDesc' },
]

export default function HubPage() {
  const { t } = useI18n()

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginTop: 12, marginBottom: 36 }}>
        <h1 className="page-title" style={{ marginBottom: 8 }}>{t('hub.title')}</h1>
        <p style={{ color: 'var(--c-text-secondary)', fontSize: 15, margin: 0 }}>{t('hub.subtitle')}</p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
        }}
      >
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="hub-card">
            <span className="hub-card-icon">{s.icon}</span>
            <span className="hub-card-title">{t(s.titleKey)}</span>
            <span className="hub-card-desc">{t(s.descKey)}</span>
            <span className="hub-card-cta">{t('hub.open')} →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
