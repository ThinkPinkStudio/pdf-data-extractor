import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { version } = require('./package.json')

export default defineConfig(({ mode }) => {
  // Carica le variabili dai file .env / .env.local della root (prefisso '' =
  // include anche le var SENZA prefisso, es. RESEND_API_KEY). Così la chiave
  // messa in `.env.local` arriva davvero al build; in CI continuano a funzionare
  // anche le env reali della shell (GitHub Actions secrets).
  const env = loadEnv(mode, process.cwd(), '')

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        // Chiave API Resend iniettata a BUILD TIME. In locale: mettila in
        // `.env.local` (RESEND_API_KEY=...). In CI: Settings → Secrets → Actions.
        // Il magic link viene spedito via API HTTPS di Resend (porta 443) invece
        // che SMTP: passa anche dietro firewall aziendali che bloccano SMTP.
        __RESEND_API_KEY__: JSON.stringify(env.RESEND_API_KEY || ''),
        // Mittente del magic link (dominio verificato su Resend). Override via
        // MAGIC_LINK_FROM in `.env.local` o env al build.
        __MAGIC_LINK_FROM__: JSON.stringify(
          env.MAGIC_LINK_FROM || 'PDF Data Extractor <noreply@thinkpinkstudio.it>'
        ),
        // Domini email ammessi al login, separati da virgola (es. "csabroker.it,
        // thinkpinkstudio.it"). '*' = qualsiasi dominio.
        __ALLOWED_DOMAINS__: JSON.stringify(env.ALLOWED_DOMAINS || '*'),
        // Base URL del release-distributor, che fa da identity provider (SSO)
        // per il login con account condiviso. Override via SSO_BASE_URL.
        __SSO_BASE_URL__: JSON.stringify(env.SSO_BASE_URL || 'https://downloads.thinkpinkstudio.it')
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
        // Override possibile via UPDATE_DOWNLOAD_URL (.env.local o variabile repo Actions).
        __UPDATE_URL__: JSON.stringify(env.UPDATE_DOWNLOAD_URL || 'https://downloads.thinkpinkstudio.it/p/pdf-data-extractor')
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
  }
})
