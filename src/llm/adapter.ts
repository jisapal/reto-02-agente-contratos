/** Interfaz propia del proveedor de lenguaje: el ciclo del agente solo conoce estos tipos. */
export type LlamadaHerramienta = { id: string; nombre: string; args: unknown }
export type ResultadoHerramienta = { id: string; nombre: string; contenido: string }

export type MensajeLLM =
  | { rol: "user"; texto: string }
  | { rol: "assistant"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "tool"; resultados: ResultadoHerramienta[] }

export type EsquemaHerramienta = {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown>
}

export type PeticionLLM = {
  sistema: string
  mensajes: MensajeLLM[]
  herramientas: EsquemaHerramienta[]
  /** false = el modelo debe responder con texto (se usa al cerrar por tope de iteraciones). */
  permitirHerramientas: boolean
}

export type RespuestaLLM = {
  texto: string
  llamadas: LlamadaHerramienta[]
  uso: { entrada: number; salida: number }
}

export interface AdaptadorLLM {
  readonly proveedor: string
  readonly modelo: string
  enviar(peticion: PeticionLLM): Promise<RespuestaLLM>
}

/** Error del proveedor con mensaje apto para mostrar en el chat (nunca incluye la clave). */
export class ErrorLLM extends Error {}
