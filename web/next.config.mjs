import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Espone la versione reale dell'app (dal package.json della root del repo) al
// client, così la sidebar mostra "vX.Y.Z" come nell'app desktop.
let appVersion = ''
try {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  appVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || ''
} catch {
  appVersion = ''
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  // Next.js 14 uses experimental.serverComponentsExternalPackages
  experimental: {
    // @firecrawl/pdf-inspector è un native module (NAPI-RS, .node): webpack
    // non può processarlo a build-time ("Module parse failed"). Va escluso
    // dal bundle (server-only, come pg/playwright/etc.) e risolto a runtime.
    serverComponentsExternalPackages: ['pg', 'nodemailer', 'pdfjs-dist', 'pdf-parse', 'exceljs', 'tesseract.js', 'jszip', '@napi-rs/canvas', 'playwright', 'playwright-core', 'docxtemplater', 'pizzip', 'pdf-lib', 'ssh2-sftp-client', 'basic-ftp', '@firecrawl/pdf-inspector', '@firecrawl/pdf-inspector-linux-x64-gnu', '@firecrawl/pdf-inspector-linux-arm64-gnu', '@firecrawl/pdf-inspector-linux-x64-musl', '@firecrawl/pdf-inspector-linux-arm64-musl', '@firecrawl/pdf-inspector-darwin-arm64', '@firecrawl/pdf-inspector-darwin-x64'],
    instrumentationHook: true,
  },
}

export default nextConfig
