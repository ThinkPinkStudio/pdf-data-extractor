import { app, shell, BrowserWindow, protocol, nativeImage } from 'electron'
import { join } from 'path'
import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { registerHandlers } from './ipc/handlers.js'
import { startWebhook, stopWebhook } from './services/webhookService.js'
import { getSettings, saveSettings } from './services/settingsService.js'
import { purgeExpiredSessions } from './services/historyService.js'

function getIconPath() {
  if (app.isPackaged) return join(process.resourcesPath, 'icon.png')
  return join(__dirname, '../../../assets/icon.png')
}

function createWindow() {
  const icon = nativeImage.createFromPath(getIconPath())
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#13141f',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximizeChange', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximizeChange', false))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
  dialog.showErrorBox('Errore imprevisto', `Si è verificato un errore:\n${err.message}`)
})

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
})

app.whenReady().then(() => {
  protocol.registerFileProtocol('local-pdf', (request, callback) => {
    const url = decodeURIComponent(request.url.replace('local-pdf://', ''))
    callback({ path: url })
  })

  const mainWindow = createWindow()
  registerHandlers(ipcMain, mainWindow)

  // One-time startup tasks: token generation + session purge
  try {
    const settings = getSettings()

    if (!settings.webhookToken) {
      settings.webhookToken = randomUUID()
      saveSettings(settings)
    }

    try { purgeExpiredSessions(settings.sessionRetentionDays ?? 90) } catch (_) {}

    if (settings.webhookEnabled) {
      startWebhook(settings.webhookPort || 3847, settings.webhookToken)
    }
  } catch (_) {}

  // Restart webhook when settings change
  ipcMain.on('settings:changed', () => {
    try {
      const settings = getSettings()
      stopWebhook()
      if (settings.webhookEnabled) {
        startWebhook(settings.webhookPort || 3847, settings.webhookToken)
      }
    } catch (_) {}
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopWebhook()
  if (process.platform !== 'darwin') app.quit()
})
