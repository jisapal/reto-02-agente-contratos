import { z } from "zod"
import { asegurarSalida, registrarLog } from "./almacen"
import { ErrorNegocio } from "./tipos"

export type Ctx = { directory: string; sessionId: string }
type Forma = Record<string, z.ZodType>
export type Args<F extends Forma> = z.infer<z.ZodObject<F>>

export type Herramienta = {
  description: string
  args: Forma
  execute: (args: unknown, ctx: Ctx) => Promise<string>
}

function resumir(valor: unknown): string {
  const s = JSON.stringify(valor) ?? ""
  return s.length > 200 ? `${s.slice(0, 200)}…` : s
}

function idMensaje(args: unknown): string | null {
  const id = (args as { mensaje_id?: unknown } | null)?.mensaje_id
  return typeof id === "string" ? id : null
}

/**
 * Arma una herramienta con el contrato del reto: valida con zod, nunca lanza,
 * devuelve un string JSON { ok, data | error } y deja rastro en out/log.jsonl (RN7).
 */
export function herramienta<F extends Forma>(
  nombre: string,
  def: { description: string; args: F; run: (args: Args<F>, ctx: Ctx) => unknown | Promise<unknown> },
): Herramienta {
  return {
    description: def.description,
    args: def.args,
    async execute(crudo: unknown, ctx: Ctx): Promise<string> {
      let respuesta: { ok: true; data: unknown } | { ok: false; error: string }
      const parsed = z.object(def.args).safeParse(crudo ?? {})
      if (!parsed.success) {
        const detalle = parsed.error.issues.map((i) => `${i.path.join(".") || "argumentos"}: ${i.message}`).join("; ")
        respuesta = { ok: false, error: `Argumentos inválidos: ${detalle}` }
      } else {
        try {
          asegurarSalida(ctx.directory)
          respuesta = { ok: true, data: await def.run(parsed.data as Args<F>, ctx) }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          respuesta = { ok: false, error: e instanceof ErrorNegocio ? msg : `Error inesperado: ${msg}` }
        }
      }
      try {
        registrarLog(ctx.directory, {
          ts: new Date().toISOString(), herramienta: `contratos_${nombre}`, mensaje_id: idMensaje(crudo),
          ok: respuesta.ok, resumen: resumir(respuesta.ok ? respuesta.data : respuesta.error),
        })
      } catch { /* el log nunca debe romper la herramienta */ }
      return JSON.stringify(respuesta)
    },
  }
}
