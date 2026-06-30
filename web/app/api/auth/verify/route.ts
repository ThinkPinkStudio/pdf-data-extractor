import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/tokens'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { publicUrl } from '@/lib/publicUrl'

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined
  const token = req.nextUrl.searchParams.get('token') ?? ''

  if (!token) {
    return NextResponse.redirect(publicUrl(req, '/auth/login?error=missing_token'))
  }

  const result = await verifyToken(token)

  if (!result.ok) {
    await logAction({ action: 'auth.verify', success: false, ip, userAgent, metadata: { reason: result.reason } })
    return NextResponse.redirect(publicUrl(req, `/auth/login?error=${result.reason}`))
  }

  const session = await getSession()
  session.email = result.email
  session.loginAt = Date.now()
  await session.save()

  await logAction({ email: result.email, action: 'auth.verify', success: true, ip, userAgent })

  return NextResponse.redirect(publicUrl(req, '/extractor'))
}
