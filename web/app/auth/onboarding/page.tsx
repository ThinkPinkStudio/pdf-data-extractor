'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useT } from '@/lib/i18n/I18nProvider'

function OnboardingForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useT()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMsg('')
    try {
      const res = await fetch('/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) {
        setStatus('done')
        const next = searchParams.get('next')
        router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/hub')
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        setErrorMsg(data.error || t('auth.errGeneric'))
        setStatus('error')
      }
    } catch (err) {
      setErrorMsg(t('auth.errGeneric'))
      setStatus('error')
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      {status === 'error' && (
        <div className="alert alert-error" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600 }}>{errorMsg}</div>
        </div>
      )}

      <div className="form-group">
        <label className="label" htmlFor="ob-email">{t('auth.email')}</label>
        <input
          id="ob-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('auth.emailPlaceholder')}
          required
          autoFocus
          autoComplete="email"
          style={{ fontSize: 15, padding: '11px 14px' }}
        />
      </div>

      <div className="form-group">
        <label className="label" htmlFor="ob-password">{t('auth.password')}</label>
        <input
          id="ob-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.passwordPlaceholder')}
          required
          minLength={8}
          autoComplete="new-password"
          style={{ fontSize: 15, padding: '11px 14px' }}
        />
      </div>

      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: '100%', padding: '12px 20px', fontSize: 14, fontWeight: 600, marginTop: 4 }}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? <span className="spinner" style={{ width: 18, height: 18 }} /> : t('auth.onboardingSubmit')}
      </button>

      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <Link href="/auth/login" style={{ fontSize: 13, color: 'var(--c-accent)' }}>
          {t('auth.backToLogin')}
        </Link>
      </div>
    </form>
  )
}

function OnboardingShell() {
  const t = useT()
  return (
    <AuthDecor>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
        {t('auth.onboardingTitle')}
      </h2>
      <p style={{ color: 'var(--c-text-muted)', fontSize: 13, marginBottom: 20, textAlign: 'center', lineHeight: 1.5 }}>
        {t('auth.onboardingSubtitle')}
      </p>
    </AuthDecor>
  )
}

function AuthDecor({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: '100%' }}>
      {children}
    </div>
  )
}

export default function OnboardingPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      background: 'var(--c-bg-app)',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          width: 52, height: 52,
          borderRadius: 14,
          background: 'var(--gradient-logo)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, margin: '0 auto 16px',
          boxShadow: '0 4px 20px var(--c-accent-dim)',
        }}>📄</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 6 }}>
          PDF Data Extractor
        </h1>
      </div>

      <div style={{
        width: '100%',
        maxWidth: 380,
        background: 'var(--c-bg-card)',
        border: '1px solid var(--c-border)',
        borderRadius: 14,
        padding: '28px 28px 24px',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <Suspense>
          <OnboardingShell />
          <OnboardingForm />
        </Suspense>
      </div>
    </div>
  )
}