'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useT } from '@/lib/i18n/I18nProvider'

function ResetForm() {
  const t = useT()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMsg('')
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (res.ok) {
        setStatus('done')
      } else {
        const data = await res.json().catch(() => ({}))
        setErrorMsg(data.error || t('auth.errTokenInvalid'))
        setStatus('error')
      }
    } catch (err) {
      setErrorMsg(t('auth.errGeneric'))
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(46,160,67,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, margin: '0 auto 20px',
        }}>✓</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t('auth.resetDone')}</h2>
        <Link
          href="/auth/login"
          className="btn btn-primary"
          style={{ display: 'inline-block', marginTop: 24, padding: '10px 20px', fontSize: 14 }}
        >
          {t('auth.login')}
        </Link>
      </div>
    )
  }

  if (!token) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div className="alert alert-error" style={{ marginBottom: 20, textAlign: 'left' }}>
          <div style={{ fontWeight: 600 }}>{t('auth.errTokenInvalid')}</div>
        </div>
        <Link
          href="/auth/login"
          className="btn btn-secondary"
          style={{ display: 'inline-block', padding: '10px 20px', fontSize: 14 }}
        >
          {t('auth.backToLogin')}
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      {status === 'error' && (
        <div className="alert alert-error" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600 }}>{errorMsg}</div>
        </div>
      )}

      <div className="form-group">
        <label className="label" htmlFor="reset-password">{t('auth.password')}</label>
        <input
          id="reset-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.passwordPlaceholder')}
          required
          minLength={8}
          autoFocus
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
        {status === 'loading' ? <span className="spinner" style={{ width: 18, height: 18 }} /> : t('auth.resetSubmit')}
      </button>

      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <Link href="/auth/login" style={{ fontSize: 13, color: 'var(--c-accent)' }}>
          {t('auth.backToLogin')}
        </Link>
      </div>
    </form>
  )
}

export default function ResetPage() {
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
        <ResetShell />
        <Suspense>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  )
}

function ResetShell() {
  const t = useT()
  return (
    <>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
        {t('auth.resetTitle')}
      </h2>
      <p style={{ color: 'var(--c-text-muted)', fontSize: 13, marginBottom: 20, textAlign: 'center', lineHeight: 1.5 }}>
        {t('auth.resetSubtitle')}
      </p>
    </>
  )
}