import { z } from "zod"
import { listarIdsMensajes, adjuntoContrato, leerComerciales, leerCorreo } from "./lib/buzon"
import { leerMaestro, leerProcesados } from "./lib/almacen"
import { generarAlertas } from "./lib/alertas"
import { extraerDeTexto } from "./lib/extraccion"
import { herramienta } from "./lib/herramienta"
import { registrarContrato } from "./lib/registro"
import { ContratoSchema, ErrorNegocio } from "./lib/tipos"
import { validarContrato } from "./lib/validacion"

const mensaje_id = z.string().describe("Identificador del mensaje del buzón, por ejemplo msg-001")
const contrato = ContratoSchema.describe("Contrato tal como lo devolvió contratos_extraer (con las correcciones confirmadas por el usuario, si las hay)")

export const leer_buzon = herramienta("leer_buzon", {
  description: "Lista los mensajes pendientes del buzón de contratos (no procesados) indicando si traen un contrato adjunto.",
  args: {},
  run(_args, ctx) {
    const procesados = leerProcesados(ctx.directory)
    const pendientes = listarIdsMensajes(ctx.directory).filter((id) => !procesados[id])
    const mensajes = pendientes.map((id) => {
      try {
        const correo = leerCorreo(ctx.directory, id)
        const tiene_contrato = adjuntoContrato(ctx.directory, correo) !== null
        const base = { id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha, adjuntos: correo.adjuntos, tiene_contrato }
        if (tiene_contrato) return base
        const motivo = correo.adjuntos.length === 0 ? "sin adjuntos" : `los adjuntos (${correo.adjuntos.join(", ")}) no son un contrato`
        return { ...base, clasificacion_preliminar: "rechazado", motivo }
      } catch (e) {
        return { id, error: e instanceof Error ? e.message : String(e) }
      }
    })
    return { mensajes, total_pendientes: mensajes.length, ya_procesados: Object.keys(procesados).length }
  },
})

export const extraer = herramienta("extraer", {
  description: "Extrae del contrato adjunto a un mensaje sus datos estructurados con un nivel de confianza por campo.",
  args: { mensaje_id },
  run({ mensaje_id: id }, ctx) {
    const correo = leerCorreo(ctx.directory, id)
    const adjunto = adjuntoContrato(ctx.directory, correo)
    if (!adjunto) throw new ErrorNegocio(`El mensaje ${id} no trae un contrato adjunto: se clasifica como rechazado`)
    if (adjunto.texto === null) throw new ErrorNegocio(`El adjunto ${adjunto.nombre} no es texto plano; leer PDF no está soportado en esta versión`)
    return extraerDeTexto(adjunto.texto, correo.fecha.slice(0, 10))
  },
})

export const validar = herramienta("validar", {
  description: "Clasifica un contrato extraído como nuevo, actualización, duplicado o rechazado frente al maestro y lista los campos que requieren revisión humana.",
  args: { mensaje_id, contrato },
  run({ mensaje_id: id, contrato: c }, ctx) {
    const correo = leerCorreo(ctx.directory, id)
    return validarContrato(c, leerMaestro(ctx.directory), correo.de, leerComerciales(ctx.directory))
  },
})

export const registrar = herramienta("registrar", {
  description: "Registra en el maestro y archiva el contrato; si hay campos en revisión solo escribe con confirmado=true tras confirmación explícita del usuario.",
  args: {
    mensaje_id,
    contrato: contrato.optional().describe("Contrato de contratos_extraer; se puede omitir solo si el mensaje no trae contrato (se cierra como rechazado)"),
    confirmado: z.boolean().optional().describe("true únicamente si el usuario confirmó en su último mensaje los campos en revisión"),
  },
  run({ mensaje_id: id, contrato: c, confirmado }, ctx) {
    return registrarContrato(ctx.directory, id, c, confirmado === true)
  },
})

export const alertas = herramienta("alertas", {
  description: "Genera out/alertas.md con contratos que vencen en 60 días o menos, pólizas pendientes y contratos registrados desde el corte del 2026-05-30.",
  args: { hoy: z.string().describe("Fecha de referencia en formato YYYY-MM-DD") },
  run({ hoy }, ctx) {
    return generarAlertas(ctx.directory, hoy)
  },
})
