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
  const fieldsRaw = (formData.get('fields') as string | null) ?? ''

  if (!pdfFile) {
    return NextResponse.json({ error: 'Nessun file PDF' }, { status: 400 })
  }

  if (!fieldsRaw.trim()) {
    return NextResponse.json({ error: 'Nessun campo specificato' }, { status: 400 })
  }

  const tmpPath = join(tmpdir(), `pdf-extract-${randomUUID()}.pdf`)
  logAction({ email: session.email, action: 'extract.start', resource: pdfFile.name, ip, userAgent })

  try {
    const buffer = Buffer.from(await pdfFile.arrayBuffer())
    await writeFile(tmpPath, buffer)

    const fieldList = fieldsRaw.split(',').map((f) => f.trim()).filter(Boolean)

    // Dynamically import services (CJS compatible)
    const { extractDataFromPDF } = await import('@/lib/extractService')
    const fields = await extractDataFromPDF(tmpPath, fieldList)

    logAction({ email: session.email, action: 'extract.complete', resource: pdfFile.name, ip, userAgent, metadata: { fieldCount: fields.length } })

    return NextResponse.json({ fields })
  } catch (err) {
    logAction({ email: session.email, action: 'extract.error', resource: pdfFile.name, success: false, ip, userAgent, metadata: { error: String(err) } })
    return NextResponse.json({ error: 'Errore durante l\'estrazione: ' + String(err) }, { status: 500 })
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
}
