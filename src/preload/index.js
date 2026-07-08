import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── PDF ────────────────────────────────────────────────────────────────
  openPDFDialog: () => ipcRenderer.invoke('dialog:openPDF'),
  openMultiplePDFsDialog: () => ipcRenderer.invoke('dialog:openMultiplePDFs'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  openPDFsInFolderDialog: () => ipcRenderer.invoke('dialog:openPDFsInFolder'),
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

  // ─── Sicurezza / Diagnostica rete ─────────────────────────────────────────
  testConnection: () => ipcRenderer.invoke('diagnostics:testConnection'),
  getDiagnosticsSystem: () => ipcRenderer.invoke('diagnostics:system'),
  deepNetworkDiagnostics: () => ipcRenderer.invoke('diagnostics:deepNetwork'),
  exportDiagnosticsReport: (payload) => ipcRenderer.invoke('diagnostics:exportReport', payload),
  openDiagnosticsLogFolder: () => ipcRenderer.invoke('diagnostics:openLogFolder'),

  // ─── LLM Streaming ──────────────────────────────────────────────────────
  onLLMChunk: (callback) => {
    ipcRenderer.on('llm:chunk', (_event, data) => callback(data))
  },
  removeAllLLMListeners: () => {
    ipcRenderer.removeAllListeners('llm:chunk')
  },

  // ─── App ────────────────────────────────────────────────────────────────
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  platform: process.platform,

  // ─── Window controls ────────────────────────────────────────────────────
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximizeChange: (callback) => {
    ipcRenderer.on('window:maximizeChange', (_event, val) => callback(val))
  },
  removeWindowMaximizeListeners: () => {
    ipcRenderer.removeAllListeners('window:maximizeChange')
  },

  // ─── Polizza RC ─────────────────────────────────────────────────────────
  openExcelDialog: () => ipcRenderer.invoke('dialog:openExcel'),
  polizzaGetFields: () => ipcRenderer.invoke('polizza:getFields'),
  polizzaGetDefaultMapping: () => ipcRenderer.invoke('polizza:getDefaultMapping'),
  polizzaExtract: (filePaths) => ipcRenderer.invoke('polizza:extract', { filePaths }),
  polizzaGetFileBuffer: (filePath) => ipcRenderer.invoke('polizza:getFileBuffer', { filePath }),
  polizzaVisionExtract: (imageFiles) => ipcRenderer.invoke('polizza:visionExtract', { imageFiles }),
  polizzaExtractRolling: (filePaths) => ipcRenderer.invoke('polizza:extractRolling', { filePaths }),
  polizzaRollingVisionUpdate: (params) => ipcRenderer.invoke('polizza:rollingVisionUpdate', params),
  polizzaOcrPage: (params) => ipcRenderer.invoke('polizza:ocrPage', params),
  polizzaExtractWholeDossier: (params) => ipcRenderer.invoke('polizza:extractWholeDossier', params),
  vectorIndexDossier: (params) => ipcRenderer.invoke('vector:indexDossier', params),
  vectorSearch: (params) => ipcRenderer.invoke('vector:search', params),
  vectorProbe: () => ipcRenderer.invoke('vector:probe'),
  polizzaOcrStatus: () => ipcRenderer.invoke('polizza:ocrStatus'),
  polizzaWriteLog: (params) => ipcRenderer.invoke('polizza:writeLog', params),
  polizzaEmailLog: (params) => ipcRenderer.invoke('polizza:emailLog', params),
  onPolizzaRollingProgress: (callback) => {
    ipcRenderer.on('polizza:rollingProgress', (_event, data) => callback(data))
  },
  removePolizzaRollingListeners: () => {
    ipcRenderer.removeAllListeners('polizza:rollingProgress')
  },
  polizzaExportNew: (data, suggestedName) => ipcRenderer.invoke('polizza:exportNew', { data, suggestedName }),
  polizzaReadTemplateStructure: (templatePath) => ipcRenderer.invoke('polizza:readTemplateStructure', { templatePath }),
  polizzaExportToTemplate: (templatePath, data, mapping) => ipcRenderer.invoke('polizza:exportToTemplate', { templatePath, data, mapping }),
  polizzaPreviewChanges: (templatePath, data, mapping) => ipcRenderer.invoke('polizza:previewChanges', { templatePath, data, mapping }),
  polizzaExportApproved: (templatePath, approvedChanges) => ipcRenderer.invoke('polizza:exportApproved', { templatePath, approvedChanges }),
  polizzaSaveDiagnostics: (content) => ipcRenderer.invoke('polizza:saveDiagnostics', { content }),

  // ─── Auth (Magic Link) ──────────────────────────────────────────────────
  authGetSession: () => ipcRenderer.invoke('auth:getSession'),
  authSendMagicLink: (email) => ipcRenderer.invoke('auth:sendMagicLink', { email }),
  authStartSso: () => ipcRenderer.invoke('auth:startSso'),
  authLogout: () => ipcRenderer.invoke('auth:logout'),

  // ─── Action Log ─────────────────────────────────────────────────────────
  getActionLog: () => ipcRenderer.invoke('actionLog:get')
})
