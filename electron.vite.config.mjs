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
