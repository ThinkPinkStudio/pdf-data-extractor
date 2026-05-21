let store = {
  filePath: null,
  fileName: null,
  text: '',
  chunks: [],
  numPages: 0
}

export function setDocument(data) {
  store = { ...store, ...data }
}

export function getDocument() {
  return store
}

export function clearDocument() {
  store = { filePath: null, fileName: null, text: '', chunks: [], numPages: 0 }
}

export function hasDocument() {
  return store.chunks.length > 0
}

export function getChunks() {
  return store.chunks
}

export function getFullText() {
  return store.text
}
