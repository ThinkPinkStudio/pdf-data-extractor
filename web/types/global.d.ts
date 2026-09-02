declare module "*.css" { const content: Record<string, string>; export default content; }

// File System Access API — showDirectoryPicker è esposta solo in Chromium e non è
// (ancora) nei tipi lib.dom di TypeScript. Dichiarazione minima per il bulk.
interface FileSystemDirectoryHandle {
  readonly name: string
  values(): AsyncIterableIterator<FileSystemHandle>
}
interface FileSystemHandle {
  readonly kind: 'file' | 'directory'
  readonly name: string
}
interface FileSystemFileHandle extends FileSystemHandle {
  getFile(): Promise<File>
}
interface Window {
  showDirectoryPicker?(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
}
