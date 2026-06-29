import { app } from 'electron'
import log from 'electron-log/main'

// ─── Auto-update (electron-updater) ──────────────────────────────────────────
//
// In PRODUZIONE: controlla periodicamente se esiste una versione più recente, la
// scarica in background e la installa al RIAVVIO dell'app (autoInstallOnAppQuit).
// Comportamento scelto: "scarica e installa al riavvio", con notifica nativa.
//
// SICUREZZA: il feed di aggiornamento (build.publish) punta a una sorgente PUBBLICA
// — nessun token/segreto finisce nel build (che sarebbe estraibile). Per repo GitHub
// privato si usa il provider "generic" su un host pubblico (es. downloads.thinkpinkstudio.it).
//
// ROBUSTEZZA: tutto è guardato. Se electron-updater non è installato, o il feed non è
// raggiungibile (offline/VPN), l'app continua a funzionare normalmente — l'update non
// deve MAI impedire l'avvio o l'uso dell'app.
export async function initAutoUpdater(mainWindow) {
  // In dev non esiste app-update.yml: niente updater (eviti errori inutili).
  if (!app.isPackaged) return
  try {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.logger = log
    autoUpdater.autoDownload = true            // scarica appena trova una versione nuova
    autoUpdater.autoInstallOnAppQuit = true    // installa alla chiusura/riavvio

    autoUpdater.on('update-available', (info) => {
      try { mainWindow?.webContents?.send('update:available', info?.version) } catch (_) {}
    })
    autoUpdater.on('update-downloaded', (info) => {
      try { mainWindow?.webContents?.send('update:downloaded', info?.version) } catch (_) {}
    })
    autoUpdater.on('error', (err) => {
      try { log.warn('[updater] errore:', err?.message || String(err)) } catch (_) {}
    })

    // checkForUpdatesAndNotify: controlla, scarica e mostra una notifica nativa
    // ("aggiornamento pronto, sarà installato alla chiusura"). Niente codice renderer.
    const check = () => {
      try {
        autoUpdater.checkForUpdatesAndNotify().catch((e) => {
          try { log.warn('[updater] check fallito:', e?.message || String(e)) } catch (_) {}
        })
      } catch (e) {
        try { log.warn('[updater] check eccezione:', e?.message || String(e)) } catch (_) {}
      }
    }
    check()
    setInterval(check, 6 * 60 * 60 * 1000) // ricontrolla ogni 6 ore
  } catch (e) {
    // electron-updater assente o non configurato: l'app prosegue senza auto-update.
    try { log.warn('[updater] non disponibile:', e?.message || String(e)) } catch (_) {}
  }
}
