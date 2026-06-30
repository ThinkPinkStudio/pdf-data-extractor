// Definizioni campi polizza, dal meccanismo esatto (RCT_O / RCP).
export interface PolizzaField {
  id: string
  label: string
  description?: string
  type?: string
  enabled?: boolean
}

export async function getPolizzaFields(): Promise<{
  rct: PolizzaField[]
  rcp: PolizzaField[]
  all: PolizzaField[]
}> {
  // @ts-ignore — modulo JS del processo main (externalDir)
  const mod = await import('../../src/main/services/polizzaService.js')
  return {
    rct: (mod.RCT_FIELDS as PolizzaField[]) || [],
    rcp: (mod.RCP_FIELDS as PolizzaField[]) || [],
    all: (mod.ALL_POLIZZA_FIELDS as PolizzaField[]) || [],
  }
}
