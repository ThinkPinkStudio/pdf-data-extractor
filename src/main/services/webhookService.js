import { createServer } from 'http'
import { loadPDF, searchChunks } from './pdfService.js'
import { getSettings } from './settingsService.js'
import { extractDataWithProvider } from './llmService.js'

let server = null

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

async function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJSON(res, 200, { status: 'ok', service: 'pdf-extractor', version: '1.0.0' })
    return
  }

  if (req.method === 'POST' && req.url === '/extract') {
    try {
      const body = await readBody(req)
      const { filePath, profileId } = body

      if (!filePath) {
        sendJSON(res, 400, { error: 'filePath is required' })
        return
      }

      const pdfData = await loadPDF(filePath)
      const settings = getSettings()

      let fields = settings.extractions.filter(f => f.enabled)
      if (profileId && Array.isArray(settings.profiles)) {
        const profile = settings.profiles.find(p => p.id === profileId)
        if (profile && Array.isArray(profile.fields)) {
          fields = profile.fields.filter(f => f.enabled !== false)
        }
      }

      const fieldQuery = fields.map(f => f.description).join(' ')
      const relevant = searchChunks(fieldQuery, pdfData.chunks, 6)
      const chunks = relevant.length > 0 ? relevant : pdfData.chunks.slice(0, 4)

      const result = await extractDataWithProvider(settings, fields, chunks)

      sendJSON(res, 200, {
        success: true,
        fileName: filePath.split('/').pop(),
        numPages: pdfData.numPages,
        data: result
      })
    } catch (err) {
      sendJSON(res, 500, { error: err.message })
    }
    return
  }

  sendJSON(res, 404, { error: 'Not found' })
}

export function startWebhook(port) {
  stopWebhook()
  server = createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      console.error('[webhook] Unhandled error:', err.message)
      if (!res.headersSent) sendJSON(res, 500, { error: 'Internal server error' })
    })
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`[webhook] Listening on http://127.0.0.1:${port}`)
  })
  server.on('error', err => {
    console.error('[webhook] Server error:', err.message)
  })
}

export function stopWebhook() {
  if (server) {
    try { server.close() } catch {}
    server = null
  }
}

export function isRunning() {
  return server !== null
}
