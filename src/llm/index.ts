import type { Config } from "../agent/config"
import type { AdaptadorLLM } from "./adapter"
import { crearAnthropic } from "./anthropic"

/** Único lugar que conoce los proveedores. Para agregar otro: implementar AdaptadorLLM y sumarlo aquí. */
export function crearAdaptador(config: Config): AdaptadorLLM {
  switch (config.proveedor) {
    case "anthropic":
      return crearAnthropic({ apiKey: config.apiKey, modelo: config.modelo, timeoutMs: config.timeoutLlmMs })
    default:
      throw new Error(`LLM_PROVIDER desconocido: "${config.proveedor}" (disponible: anthropic)`)
  }
}
