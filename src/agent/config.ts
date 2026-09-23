export type Config = {
  puerto: number
  proveedor: string
  modelo: string
  apiKey: string
  accessKey: string
  maxIteraciones: number
  maxTokensSesion: number
  timeoutLlmMs: number
  limitePorMinuto: number
}

function entero(valor: string | undefined, porDefecto: number): number {
  const n = Number(valor)
  return Number.isInteger(n) && n > 0 ? n : porDefecto
}

/** Toda la configuración sale de variables de entorno; la clave del modelo nunca sale del backend. */
export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    puerto: entero(env["PORT"], 3000),
    proveedor: env["LLM_PROVIDER"] ?? "anthropic",
    modelo: env["LLM_MODEL"] ?? "claude-sonnet-5",
    apiKey: env["ANTHROPIC_API_KEY"] ?? "",
    accessKey: env["ACCESS_KEY"] ?? "",
    maxIteraciones: entero(env["MAX_ITERATIONS"], 25),
    maxTokensSesion: entero(env["MAX_TOKENS_SESSION"], 200_000),
    timeoutLlmMs: entero(env["LLM_TIMEOUT_MS"], 60_000),
    limitePorMinuto: entero(env["RATE_LIMIT_PER_MIN"], 20),
  }
}
