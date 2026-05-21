import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openPDFDialog: () => ipcRenderer.invoke('dialog:openPDF'),
  loadPDF: (filePath) => ipcRenderer.invoke('pdf:load', filePath),
  extractData: () => ipcRenderer.invoke('pdf:extract'),
  chatWithPDF: (message, history) => ipcRenderer.invoke('pdf:chat', { message, history }),
  clearPDF: () => ipcRenderer.invoke('pdf:clear'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  getOllamaStatus: () => ipcRenderer.invoke('ollama:status'),
  getOllamaStatusUrl: (url) => ipcRenderer.invoke('ollama:statusUrl', url),

  onLLMChunk: (callback) => {
    ipcRenderer.on('llm:chunk', (_event, data) => callback(data))
  },
  removeAllLLMListeners: () => {
    ipcRenderer.removeAllListeners('llm:chunk')
  }
})
