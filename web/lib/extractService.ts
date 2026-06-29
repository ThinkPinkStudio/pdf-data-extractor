import { extractFields } from './llmAdapter'

export async function extractDataFromPDF(
  pdfPath: string,
  fieldList: string[]
): Promise<Array<{ name: string; value: string }>> {
  return extractFields(pdfPath, fieldList)
}
