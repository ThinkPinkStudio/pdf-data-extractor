'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href: '/extractor', label: 'Estrazione PDF', icon: '📄' },
  { href: '/polizza', label: 'Polizza RC', icon: '📋' },
  { href: '/batch', label: 'Batch', icon: '📦' },
  { href: '/history', label: 'Cronologia', icon: '🕐' },
  { href: '/settings', label: 'Impostazioni', icon: '⚙️' },
  { href: '/logs', label: 'Log Azioni', icon: '📊' },
]

export default function Sidebar({ email }: { email: string }) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/auth/login')
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">PDF Extractor</div>
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${pathname.startsWith(item.href) ? 'active' : ''}`}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
      <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12, marginTop: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 8, padding: '0 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {email}
        </div>
        <button className="btn btn-secondary" style={{ width: '100%', fontSize: 12 }} onClick={handleLogout}>
          Esci
        </button>
      </div>
    </aside>
  )
}
