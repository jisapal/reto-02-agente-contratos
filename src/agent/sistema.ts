import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * System prompt = comportamiento (agent/prompt.md) + conocimiento del proceso (src/knowledge/).
 * Se lee en cada turno: cambiar una regla de negocio no requiere tocar el servidor ni reiniciarlo.
 */
export function construirSistema(directory: string): string {
  const comportamiento = readFileSync(join(directory, "agent", "prompt.md"), "utf8")
  const conocimiento = readFileSync(join(directory, "src", "knowledge", "registro-contratos.md"), "utf8")
  return `${comportamiento.trim()}\n\n---\n\n# Conocimiento del proceso\n\n${conocimiento.trim()}\n`
}
