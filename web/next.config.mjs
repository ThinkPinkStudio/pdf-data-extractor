import path from 'node:path'

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // pacchetti nativi/pesanti: non bundlarli, caricali a runtime da node_modules
    serverComponentsExternalPackages: [
      'pg', 'nodemailer',
      'pdfjs-dist', 'tesseract.js', 'jszip', 'exceljs', 'pdf-parse', '@napi-rs/canvas',
    ],
    instrumentationHook: true,
    // consente di importare il meccanismo esatto da ../../src (processo main Electron)
    externalDir: true,
  },
  webpack: (config) => {
    // 'electron' → shim server-side (vedi electron-shim.js)
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      electron: path.resolve('./electron-shim.js'),
    }
    return config
  },
}

export default nextConfig
