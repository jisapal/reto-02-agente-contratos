import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, cpSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generarModulo } from "../scripts/build-modulo"
import { cargarHerramientas, esquemasParaLLM } from "../src/agent/herramientas"

const RAIZ = process.cwd()

function archivos(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n)
    return statSync(ruta).isDirectory() ? archivos(ruta, base) : [ruta.slice(base.length + 1)]
  })
}

test("modulo/ no diverge de las fuentes de la aplicación", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mod-"))
  for (const d of ["agent", "src"]) cpSync(join(RAIZ, d), join(tmp, d), { recursive: true })
  generarModulo(tmp)
  const esperados = archivos(join(tmp, "modulo")).sort()
  assert.deepEqual(archivos(join(RAIZ, "modulo")).sort(), esperados)
  for (const f of esperados) {
    assert.equal(readFileSync(join(RAIZ, "modulo", f), "utf8"), readFileSync(join(tmp, "modulo", f), "utf8"), `modulo/${f} está desactualizado: corre npm run build:modulo`)
  }
})

test("agent.md y SKILL.md traen el frontmatter exigido", () => {
  const agente = readFileSync(join(RAIZ, "modulo", "agent.md"), "utf8")
  assert.match(agente, /^---\ndescription: .+\nmode: primary\npermission:\n  edit: deny\n  bash: deny\n---/)
  const skill = readFileSync(join(RAIZ, "modulo", "skill", "registro-contratos", "SKILL.md"), "utf8")
  assert.match(skill, /^---\nname: registro-contratos\ndescription: .+\n---/)
})

test("los esquemas JSON de las herramientas son válidos para el LLM", () => {
  const esquemas = esquemasParaLLM(cargarHerramientas())
  assert.equal(esquemas.length, 5)
  const registrar = esquemas.find((e) => e.nombre === "contratos_registrar")
  const props = (registrar?.parametros as { properties: Record<string, unknown>; required: string[] }).properties
  assert.ok("mensaje_id" in props && "contrato" in props && "confirmado" in props)
  assert.ok(esquemas.every((e) => (e.parametros as { type: string }).type === "object"))
})
