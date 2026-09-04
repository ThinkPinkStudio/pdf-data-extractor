'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useT } from '@/lib/i18n/I18nProvider'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const errorParam = searchParams.get('error')
  const t = useT()

  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [errorDetail, setErrorDetail] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMsg('')
    setErrorDetail('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok) {
        const next = searchParams.get('next')
        router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/hub')
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        setErrorMsg(data.error || t('auth.errGeneric'))
        setErrorDetail(data.detail || '')
        setStatus('error')
      }
    } catch (err) {
      setErrorMsg(t('auth.errGeneric'))
      setErrorDetail((err as Error).message)
      setStatus('error')
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      {(errorParam || status === 'error') && (
        <div className="alert alert-error" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600 }}>
            {errorParam
              ? errorParam === 'expired'
                ? t('auth.errExpired')
                : t('auth.errGeneric')
              : errorMsg}
          </div>
          {errorDetail && <div style={{ fontSize: 12, marginTop: 6, opacity: 0.9, wordBreak: 'break-word' }}>{errorDetail}</div>}
        </div>
      )}

      <div className="form-group">
        <label className="label" htmlFor="email">{t('auth.email')}</label>
        <input
          id="email"
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

      <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--c-text-muted)', lineHeight: 1.5 }}>
        {t('auth.emailOnlyHint')}
      </p>

      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: '100%', padding: '12px 20px', fontSize: 14, fontWeight: 600, marginTop: 18 }}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? <span className="spinner" style={{ width: 18, height: 18 }} /> : t('auth.login')}
      </button>
    </form>
  )
}

function LoginShell() {
  const t = useT()
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
        <p style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>
          {t('auth.subtitle')}
        </p>
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
        <LoginForm />
      </div>

      <p style={{ marginTop: 20, color: 'var(--c-text-muted)', fontSize: 12 }}>
        {t('auth.authorizedOnly')}
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginShell />
    </Suspense>
  )
}