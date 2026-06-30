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
    serverComponentsExternalPackages: ['pg', 'nodemailer', 'pdfjs-dist', 'pdf-parse', 'exceljs', 'tesseract.js', 'jszip', 'electron'],
    instrumentationHook: true,
  },
}

export default nextConfig
