import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { version } = require('./package.json')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      // Chiave API Resend iniettata a BUILD TIME (Settings → Variables/Secrets →
      // Actions: RESEND_API_KEY). Il magic link viene spedito via API HTTPS di
      // Resend (porta 443) invece che SMTP: passa anche dietro firewall aziendali
      // restrittivi che bloccano le porte SMTP (25/465/587) in uscita.
      __RESEND_API_KEY__: JSON.stringify(process.env.RESEND_API_KEY || ''),
      // Mittente del magic link (dominio verificato su Resend). Override via env
      // MAGIC_LINK_FROM al build.
      __MAGIC_LINK_FROM__: JSON.stringify(
        process.env.MAGIC_LINK_FROM || 'PDF Data Extractor <noreply@thinkpinkstudio.it>'
      )
    },
    build: {
      rollupOptions: {
        external: ['pdf-parse']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(version),
      // URL del portale download aperto dal badge "aggiornamento disponibile".
      // Override possibile via variabile repo UPDATE_DOWNLOAD_URL (Settings → Variables → Actions).
      __UPDATE_URL__: JSON.stringify(process.env.UPDATE_DOWNLOAD_URL || 'https://downloads.thinkpinkstudio.it/p/pdf-data-extractor')
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    optimizeDeps: {
      include: ['pdfjs-dist']
    }
  }
})
