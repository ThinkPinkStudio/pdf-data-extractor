import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getRecentLogs } from '@/lib/logger'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim())

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only admin emails can view logs (or all allowed if ADMIN_EMAILS not set separately)
  if (ADMIN_EMAILS[0] !== '*' && !ADMIN_EMAILS.includes(session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '200', 10)
  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10)

  const logs = await getRecentLogs(Math.min(limit, 1000), offset)
  return NextResponse.json({ logs })
}
