import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined

  const session = await getSession()
  const email = session.email
  session.destroy()

  logAction({ email, action: 'auth.logout', success: true, ip, userAgent })

  return NextResponse.json({ ok: true })
}
