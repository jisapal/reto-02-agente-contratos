import { argsAJsonSchema } from "./json-schema"
import type { EsquemaHerramienta } from "../llm/adapter"
import * as contratos from "../tools/contratos"
import type { Herramienta } from "../tools/lib/herramienta"

/** Cada export de src/tools/contratos.ts se publica como contratos_<export>. */
export function cargarHerramientas(): Map<string, Herramienta> {
  const mapa = new Map<string, Herramienta>()
  for (const [nombre, herramienta] of Object.entries(contratos)) mapa.set(`contratos_${nombre}`, herramienta as Herramienta)
  return mapa
}

export function esquemasParaLLM(herramientas: Map<string, Herramienta>): EsquemaHerramienta[] {
  return [...herramientas].map(([nombre, h]) => {
    return { nombre, descripcion: h.description, parametros: argsAJsonSchema(h.args) }
  })
}
