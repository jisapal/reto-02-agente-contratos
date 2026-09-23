import type { z } from "zod"

export type JsonSchema = Record<string, unknown>

type Def = {
  typeName: string
  description?: string
  innerType?: z.ZodTypeAny
  schema?: z.ZodTypeAny
  type?: z.ZodTypeAny
  valueType?: z.ZodTypeAny
  values?: readonly string[]
  value?: unknown
  shape?: () => Record<string, z.ZodTypeAny>
  defaultValue?: () => unknown
}

const def = (t: z.ZodTypeAny): Def => t._def as unknown as Def

function conDescripcion(esquema: JsonSchema, d: Def): JsonSchema {
  return d.description ? { ...esquema, description: d.description } : esquema
}

function objeto(shape: Record<string, z.ZodTypeAny>): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const [clave, t] of Object.entries(shape)) {
    properties[clave] = aJsonSchema(t)
    if (!t.isOptional()) required.push(clave)
  }
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false }
}

/**
 * Conversión mínima zod → JSON Schema para los tipos que usan las herramientas
 * (evita depender de otra librería; se prueba en tests/agente.test.ts).
 */
export function aJsonSchema(t: z.ZodTypeAny): JsonSchema {
  const d = def(t)
  const envoltorios = ["ZodOptional", "ZodDefault", "ZodEffects", "ZodBranded", "ZodReadonly"]
  if (envoltorios.includes(d.typeName)) {
    const interno = d.innerType ?? d.schema
    if (!interno) return {}
    const base = aJsonSchema(interno)
    return conDescripcion(d.typeName === "ZodDefault" && d.defaultValue ? { ...base, default: d.defaultValue() } : base, d)
  }
  switch (d.typeName) {
    case "ZodString": return conDescripcion({ type: "string" }, d)
    case "ZodNumber": return conDescripcion({ type: "number" }, d)
    case "ZodBoolean": return conDescripcion({ type: "boolean" }, d)
    case "ZodNull": return { type: "null" }
    case "ZodLiteral": return conDescripcion({ const: d.value }, d)
    case "ZodEnum": return conDescripcion({ type: "string", enum: [...(d.values ?? [])] }, d)
    case "ZodNullable": return conDescripcion({ anyOf: [aJsonSchema(d.innerType as z.ZodTypeAny), { type: "null" }] }, d)
    case "ZodArray": return conDescripcion({ type: "array", items: aJsonSchema(d.type as z.ZodTypeAny) }, d)
    case "ZodRecord": return conDescripcion({ type: "object", additionalProperties: aJsonSchema(d.valueType as z.ZodTypeAny) }, d)
    case "ZodObject": return conDescripcion(objeto((d.shape as () => Record<string, z.ZodTypeAny>)()), d)
    default: return {}
  }
}

export function argsAJsonSchema(args: Record<string, z.ZodTypeAny>): JsonSchema {
  return objeto(args)
}
