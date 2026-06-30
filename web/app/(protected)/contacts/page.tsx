'use client'

import { useT } from '@/lib/i18n/I18nProvider'

const C = {
  company: 'ThinkPink Studio',
  tagline: 'Soluzioni digitali su misura',
  address: 'Via Tito Speri 6, 57016 Rosignano Solvay (LI)',
  phone: '351 452 9451',
  email: 'info@thinkpinkstudio.it',
  website: 'www.thinkpinkstudio.it',
  vatLabel: 'P.IVA', vatNumber: '02871460347',
  cfLabel: 'CF', cfNumber: 'GLLFNC89C28Z611W',
}

const IconPin = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>)
const IconPhone = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z" /></svg>)
const IconMail = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" /><polyline points="22,6 12,13 2,6" /></svg>)
const IconGlobe = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>)

function ContactRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--c-accent-faint)', border: '1px solid var(--c-accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-accent)', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 14, color: 'var(--c-text-primary)' }}>{children}</span>
    </div>
  )
}

export default function ContactsPage() {
  const t = useT()
  return (
    <>
      <h1 className="page-title">{t('contacts.title')}</h1>
      <div className="card" style={{ maxWidth: 560, borderRadius: 'var(--r-xl)', padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--c-separator)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" width={52} height={52} style={{ borderRadius: 14, boxShadow: '0 4px 16px var(--c-accent-dim)' }} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{C.company}</div>
            <div style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>{t('contacts.tagline')}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
          <ContactRow icon={<IconPin />}>{C.address}</ContactRow>
          <ContactRow icon={<IconPhone />}><a href={`tel:${C.phone.replace(/\s/g, '')}`} style={{ color: 'var(--c-accent)' }}>{C.phone}</a></ContactRow>
          <ContactRow icon={<IconMail />}><a href={`mailto:${C.email}`} style={{ color: 'var(--c-accent)' }}>{C.email}</a></ContactRow>
          <ContactRow icon={<IconGlobe />}><a href={`https://${C.website}`} target="_blank" rel="noreferrer" style={{ color: 'var(--c-accent)' }}>{C.website}</a></ContactRow>
        </div>
        <div style={{ paddingTop: 16, borderTop: '1px solid var(--c-separator)', display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--c-text-muted)' }}>
          <span><b style={{ color: 'var(--c-accent)' }}>{C.vatLabel}</b> {C.vatNumber}</span>
          <span><b style={{ color: 'var(--c-accent)' }}>{C.cfLabel}</b> {C.cfNumber}</span>
        </div>
      </div>
    </>
  )
}
