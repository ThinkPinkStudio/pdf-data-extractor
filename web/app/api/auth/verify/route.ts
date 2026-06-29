import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/tokens'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined
  const token = req.nextUrl.searchParams.get('token') ?? ''

  if (!token) {
    return NextResponse.redirect(new URL('/auth/login?error=missing_token', req.url))
  }

  const result = await verifyToken(token)

  if (!result.ok) {
    await logAction({ action: 'auth.verify', success: false, ip, userAgent, metadata: { reason: result.reason } })
    return NextResponse.redirect(new URL(`/auth/login?error=${result.reason}`, req.url))
  }

  const session = await getSession()
  session.email = result.email
  session.loginAt = Date.now()
  await session.save()

  await logAction({ email: result.email, action: 'auth.verify', success: true, ip, userAgent })

  return NextResponse.redirect(new URL('/extractor', req.url))
}
