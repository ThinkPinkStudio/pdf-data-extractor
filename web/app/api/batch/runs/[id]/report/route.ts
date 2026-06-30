import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getReportRows } from '@/lib/batchQueries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLUMNS = ['policy_key', 'folder_path', 'status', 'attempts', 'output_path', 'last_error']

function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = columns.join(',')
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(',')).join('\n')
  return body ? `${head}\n${body}` : head
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = parseInt(params.id, 10)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })
  }
  const type = req.nextUrl.searchParams.get('type') === 'errors' ? 'errors' : 'manifest'
  const rows = await getReportRows(id, type)
  const csv = toCsv(rows, COLUMNS)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="batch_run${id}_${type}.csv"`,
    },
  })
}
