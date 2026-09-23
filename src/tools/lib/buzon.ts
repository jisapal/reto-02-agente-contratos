import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { z } from "zod"
import { rutas } from "./almacen"
import { ErrorNegocio, type Comercial } from "./tipos"

const CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string().optional(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string().default(""),
  adjuntos: z.array(z.string()).default([]),
})
export type Correo = z.infer<typeof CorreoSchema>

export type Adjunto = { nombre: string; ext: string; texto: string | null }

export const ID_MENSAJE = /^[A-Za-z0-9_-]+$/

export function listarIdsMensajes(dir: string): string[] {
  const base = rutas(dir).buzon
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(base, e.name, "correo.json")))
    .map((e) => e.name)
    .sort()
}

export function leerCorreo(dir: string, mensajeId: string): Correo {
  if (!ID_MENSAJE.test(mensajeId)) throw new ErrorNegocio(`mensaje_id inválido: "${mensajeId}"`)
  const ruta = join(rutas(dir).buzon, mensajeId, "correo.json")
  if (!existsSync(ruta)) throw new ErrorNegocio(`No existe el mensaje ${mensajeId} en el buzón`)
  const parsed = CorreoSchema.safeParse(JSON.parse(readFileSync(ruta, "utf8")))
  if (!parsed.success) throw new ErrorNegocio(`correo.json de ${mensajeId} tiene un formato inválido`)
  return parsed.data
}

/** El texto solo se lee para adjuntos de texto plano; PDF y otros quedan con texto = null. */
export function leerAdjunto(dir: string, mensajeId: string, nombre: string): Adjunto {
  const seguro = basename(nombre)
  const ext = extname(seguro).slice(1).toLowerCase()
  const ruta = join(rutas(dir).buzon, mensajeId, seguro)
  const legible = ["txt", "md"].includes(ext) && existsSync(ruta)
  return { nombre: seguro, ext, texto: legible ? readFileSync(ruta, "utf8") : null }
}

/** Un documento es contrato si su primera línea lo dice (no se confía en el nombre del archivo). */
export function pareceContrato(adjunto: Adjunto): boolean {
  if (adjunto.texto === null) return /contrato|otros[ií]|adenda/i.test(adjunto.nombre)
  const primera = adjunto.texto.split("\n").find((l) => l.trim() !== "") ?? ""
  return /^\s*(CONTRATO|OTROS[ÍI]|ADENDA|MODIFICATORIO)/i.test(primera)
}

export function adjuntoContrato(dir: string, correo: Correo): Adjunto | null {
  for (const nombre of correo.adjuntos) {
    const adjunto = leerAdjunto(dir, correo.id, nombre)
    if (pareceContrato(adjunto)) return adjunto
  }
  return null
}

export function leerComerciales(dir: string): Comercial[] {
  return JSON.parse(readFileSync(rutas(dir).comerciales, "utf8")) as Comercial[]
}
