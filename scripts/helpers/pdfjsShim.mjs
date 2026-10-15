// Shim CJS→ESM per pdfjs nel solo HARNESS (scripts/reconcile-ocr-check.mjs).
// In Node puro `import('pdfjs-dist/legacy/build/pdf.js')` espone `getDocument`
// solo su `.default` (webpack/Next fa l'interop da sé e in produzione va bene);
// senza questo, `pdfjs.getDocument is not a function` in web/lib/pdfRenderServer.ts.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js')

export const getDocument = pdfjs.getDocument
export const GlobalWorkerOptions = pdfjs.GlobalWorkerOptions
export const version = pdfjs.version
export const OPS = pdfjs.OPS
export const Util = pdfjs.Util
export const ImageKind = pdfjs.ImageKind
export const AbortException = pdfjs.AbortException
export const InvalidPDFException = pdfjs.InvalidPDFException
export const MissingPDFException = pdfjs.MissingPDFException
export const PasswordResponses = pdfjs.PasswordResponses
export const VerbosityLevel = pdfjs.VerbosityLevel
export default pdfjs
