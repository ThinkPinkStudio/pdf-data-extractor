import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined

  const session = await getSession()
  if (!session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const pdfFile = formData.get('pdf') as File | null
  if (!pdfFile) {
    return NextResponse.json({ error: 'Nessun file PDF' }, { status: 400 })
  }

  const tmpPath = join(tmpdir(), `polizza-${randomUUID()}.pdf`)
  logAction({ email: session.email, action: 'polizza.start', resource: pdfFile.name, ip, userAgent })

  try {
    const buffer = Buffer.from(await pdfFile.arrayBuffer())
    await writeFile(tmpPath, buffer)

    const { extractPolizza } = await import('@/lib/polizzaService')
    const result = await extractPolizza(tmpPath)

    logAction({ email: session.email, action: 'polizza.complete', resource: pdfFile.name, ip, userAgent })

    return NextResponse.json(result)
  } catch (err) {
    logAction({ email: session.email, action: 'polizza.error', resource: pdfFile.name, success: false, ip, userAgent, metadata: { error: String(err) } })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
}
