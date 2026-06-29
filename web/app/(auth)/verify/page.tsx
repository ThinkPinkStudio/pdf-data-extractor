'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function VerifyInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  useEffect(() => {
    if (!token) {
      router.replace('/auth/login?error=missing_token')
      return
    }
    // The actual verification happens in the API route via GET /api/auth/verify?token=...
    // But middleware redirects /auth/verify to the API. This page is a fallback.
    router.replace(`/api/auth/verify?token=${token}`)
  }, [token, router])

  return (
    <div style={{ textAlign: 'center' }}>
      <span className="spinner" style={{ width: 32, height: 32 }} />
      <p style={{ marginTop: 16, color: 'var(--c-text-muted)' }}>Verifica in corso...</p>
    </div>
  )
}

export default function VerifyPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Suspense>
        <VerifyInner />
      </Suspense>
    </div>
  )
}
