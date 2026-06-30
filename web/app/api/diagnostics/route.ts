import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'
import { importSharedService } from '@/lib/sharedServices'
import { ocrStatus } from '@/lib/polizzaService'

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stored = await getSettings()
  const net = await importSharedService<any>('netDiagnostics.js')

  const system = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || '',
  }

  const ep = net.endpointForProvider(stored)
  const layers: Record<string, any> = {}
  try {
    if (ep.host) {
      const dns = await net.probeDns(ep.host)
      layers.dns = dns
      const ip = dns.ips?.[0]
      layers.tcp = await net.probeTcp(ep.host, ep.port, ip)
      layers.tls = await net.probeTls(ep.host, ep.port)
    }
    layers.http = await net.probeHttp(ep.url, ep.label === 'Anthropic' ? { method: 'POST', headers: {}, body: '{}' } : {})
  } catch (err) {
    layers.error = (err as Error).message
  }

  const ocr = await ocrStatus()

  return NextResponse.json({ system, endpoint: ep, layers, ocr })
}
