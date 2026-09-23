/**
 * Empaqueta el agente como módulo reutilizable (bonus 9.4).
 * modulo/ se GENERA desde las mismas fuentes que usa la aplicación:
 *   agent/prompt.md                      → modulo/agent.md
 *   src/knowledge/registro-contratos.md  → modulo/skill/registro-contratos/SKILL.md
 *   src/tools/contratos.ts + lib/        → modulo/tools/
 * tests/modulo.test.ts falla si modulo/ diverge de las fuentes.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const AGENT_FRONTMATTER = `---
description: Agente de recepción de contratos vigentes de Periferia IT Group. Lee el buzón único, extrae, valida, registra y archiva contratos, y genera alertas de vencimiento y pólizas.
mode: primary
permission:
  edit: deny
  bash: deny
---
`

export const SKILL_FRONTMATTER = `---
name: registro-contratos
description: Proceso de registro de contratos vigentes: clasificación (nuevo, actualización, duplicado, rechazado), confianza y revisión humana, pólizas, remitentes autorizados, alertas y archivo. Úsalo al procesar el buzón de contratos.
---

`

const README_MODULO = `# Módulo reutilizable: agente de registro de contratos

Archivo generado por \`npm run build:modulo\`; no se edita a mano (se edita en \`agent/\` y \`src/\`).

- \`agent.md\`: system prompt (comportamiento). Permisos: \`edit: deny\`, \`bash: deny\`.
- \`skill/registro-contratos/SKILL.md\`: conocimiento del proceso.
- \`tools/contratos.ts\`: cada export se publica como \`contratos_<export>\` (leer_buzon, extraer, validar, registrar, alertas).

Uso de las herramientas sin servidor: \`await tool.execute(args, { directory, sessionId })\` devuelve un string JSON \`{ ok, data | error }\`.
La carpeta de trabajo (\`directory\`) contiene \`fixtures/reto-02/\` y es donde se escribe \`out/\`. Única dependencia: \`zod\` (^3.23).
`

export function generarModulo(raiz: string): void {
  const salida = join(raiz, "modulo")
  rmSync(salida, { recursive: true, force: true })
  mkdirSync(join(salida, "skill", "registro-contratos"), { recursive: true })
  const prompt = readFileSync(join(raiz, "agent", "prompt.md"), "utf8")
  const conocimiento = readFileSync(join(raiz, "src", "knowledge", "registro-contratos.md"), "utf8")
  writeFileSync(join(salida, "agent.md"), `${AGENT_FRONTMATTER}\n${prompt}`)
  writeFileSync(join(salida, "skill", "registro-contratos", "SKILL.md"), `${SKILL_FRONTMATTER}${conocimiento}`)
  writeFileSync(join(salida, "README.md"), README_MODULO)
  cpSync(join(raiz, "src", "tools"), join(salida, "tools"), { recursive: true })
}

if (process.argv[1]?.endsWith("build-modulo.ts")) {
  generarModulo(process.cwd())
  console.log("modulo/ generado desde agent/prompt.md, src/knowledge/ y src/tools/")
}
