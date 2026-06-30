import { getSettings } from './settingsStore'

const SERVICES_PATH = '../../src/main/services'

export interface PolizzaResult {
  fields: Record<string, string>
  log: string[]
}

export async function extractPolizza(pdfPath: string): Promise<PolizzaResult> {
  const stored = await getSettings()
  const { extractPolizzaRolling } = await import(`${SERVICES_PATH}/polizzaService.js`)

  const log: string[] = []
  const onProgress = (msg: string) => log.push(msg)

  const fields = await extractPolizzaRolling(pdfPath, stored, onProgress)

  return { fields, log }
}
