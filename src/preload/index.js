import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── PDF ────────────────────────────────────────────────────────────────
  openPDFDialog: () => ipcRenderer.invoke('dialog:openPDF'),
  openMultiplePDFsDialog: () => ipcRenderer.invoke('dialog:openMultiplePDFs'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  loadPDF: (filePath) => ipcRenderer.invoke('pdf:load', filePath),
  removePDF: (id) => ipcRenderer.invoke('pdf:remove', id),
  getDocuments: () => ipcRenderer.invoke('pdf:getDocuments'),
  extractData: (docId, fields) => ipcRenderer.invoke('pdf:extract', docId, fields),
  chatWithPDF: (message, history, docId) => ipcRenderer.invoke('pdf:chat', { message, history, docId }),
  clearPDF: () => ipcRenderer.invoke('pdf:clear'),
  exportData: (format, data, fileName) => ipcRenderer.invoke('pdf:export', { format, data, fileName }),

  // ─── Session ────────────────────────────────────────────────────────────
  savePDFCopy: () => ipcRenderer.invoke('session:savePDFCopy'),
  exportChat: (format, messages, fileName) => ipcRenderer.invoke('session:exportChat', { format, messages, fileName }),
  exportAll: (messages, extracted, fileName) => ipcRenderer.invoke('session:exportAll', { messages, extracted, fileName }),

  // ─── History ────────────────────────────────────────────────────────────
  listHistory: () => ipcRenderer.invoke('history:list'),
  saveHistory: (session) => ipcRenderer.invoke('history:save', session),
  loadHistorySession: (id) => ipcRenderer.invoke('history:load', id),
  deleteHistorySession: (id) => ipcRenderer.invoke('history:delete', id),
  clearAllHistory: () => ipcRenderer.invoke('history:clearAll'),

  // ─── Batch ──────────────────────────────────────────────────────────────
  startBatch: (filePaths) => ipcRenderer.invoke('batch:start', { filePaths }),
  cancelBatch: () => ipcRenderer.invoke('batch:cancel'),
  onBatchProgress: (callback) => {
    ipcRenderer.on('batch:progress', (_event, data) => callback(data))
  },
  removeAllBatchListeners: () => {
    ipcRenderer.removeAllListeners('batch:progress')
  },

  // ─── Settings ───────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // ─── Ollama / LLM ───────────────────────────────────────────────────────
  getOllamaStatus: () => ipcRenderer.invoke('ollama:status'),
  getOllamaStatusUrl: (url) => ipcRenderer.invoke('ollama:statusUrl', url),
  testOpenAI: (apiKey, model) => ipcRenderer.invoke('llm:testOpenAI', { apiKey, model }),
  testAnthropic: (apiKey, model) => ipcRenderer.invoke('llm:testAnthropic', { apiKey, model }),

  // ─── LLM Streaming ──────────────────────────────────────────────────────
  onLLMChunk: (callback) => {
    ipcRenderer.on('llm:chunk', (_event, data) => callback(data))
  },
  removeAllLLMListeners: () => {
    ipcRenderer.removeAllListeners('llm:chunk')
  },

  // ─── App ────────────────────────────────────────────────────────────────
  getAppVersion: () => ipcRenderer.invoke('app:version')
})
