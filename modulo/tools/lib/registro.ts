import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  agregarHistorial, guardarMaestro, leerMaestro, leerProcesados, marcarProcesado, rutas,
} from "./almacen"
import { adjuntoContrato, leerComerciales, leerCorreo, type Adjunto, type Correo } from "./buzon"
import { slugCliente } from "./texto"
import { ErrorNegocio, type Contrato, type FilaMaestro } from "./tipos"
import { validarContrato, type Diferencias, type Validacion } from "./validacion"

export type ResultadoRegistro = {
  id_contrato: string | null
  accion: "insertado" | "actualizado" | "duplicado_omitido" | "rechazado"
  ruta_archivo?: string
  cambios?: Diferencias
  motivo?: string
}

const ID_SEGURO = /^[A-Za-z0-9_-]+$/
const OBLIGATORIOS = ["cliente", "nit_cliente", "pais", "objeto", "valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza"] as const

/** Evita que un valor del documento se interprete como fórmula al abrir el CSV en Excel. */
const sanear = (s: string) => (/^[=+\-@]/.test(s) ? `'${s}` : s)

function idAutomatico(maestro: FilaMaestro[], anio: string): string {
  const n = maestro.filter((f) => f.id_contrato.startsWith(`AUTO-${anio}-`)).length + 1
  return `AUTO-${anio}-${String(n).padStart(3, "0")}`
}

function copiarAdjunto(dir: string, correo: Correo, adjunto: Adjunto, destinoRelativo: string): void {
  const r = rutas(dir)
  const destino = join(r.sp, destinoRelativo)
  mkdirSync(dirname(destino), { recursive: true })
  copyFileSync(join(r.buzon, correo.id, adjunto.nombre), destino)
}

function insertar(dir: string, correo: Correo, adjunto: Adjunto, c: Contrato, v: Validacion, maestro: FilaMaestro[]): ResultadoRegistro {
  const faltan = OBLIGATORIOS.filter((k) => c[k] === null)
  if (faltan.length > 0) {
    throw new ErrorNegocio(`Faltan campos obligatorios incluso con confirmación: ${faltan.join(", ")}. Corrige el contrato con los valores que indique el usuario.`)
  }
  const inicio = c.fecha_inicio ?? ""
  const id = c.id_contrato ?? idAutomatico(maestro, inicio.slice(0, 4))
  if (!ID_SEGURO.test(id)) throw new ErrorNegocio(`id_contrato con caracteres no permitidos: "${id}"`)
  const requierePoliza = c.requiere_poliza === true
  const carpeta = `Contratos/${inicio.slice(0, 4)}/${slugCliente(c.cliente ?? "") || "sin-nombre"}`
  const ruta = `${carpeta}/${id}.${adjunto.ext || "bin"}`
  const fila: FilaMaestro = {
    id_contrato: id, cliente: sanear(c.cliente ?? ""), nit_cliente: c.nit_cliente ?? "", pais: c.pais ?? "",
    objeto: sanear(c.objeto ?? "").slice(0, 200), valor: String(c.valor ?? 0), moneda: c.moneda ?? "",
    fecha_inicio: inicio, fecha_fin: c.fecha_fin ?? "", requiere_poliza: String(requierePoliza),
    tipo_poliza: requierePoliza ? c.tipo_poliza.join(";") : "", estado_poliza: requierePoliza ? "pendiente" : "no_aplica",
    comercial: sanear(v.comercial.nombre ?? `No registrado (${v.comercial.email})`), ruta_sharepoint: ruta,
    fecha_registro: correo.fecha.slice(0, 10), fuente: "buzon",
  }
  copiarAdjunto(dir, correo, adjunto, ruta)
  guardarMaestro(dir, [...maestro, fila])
  agregarHistorial(dir, { ts: new Date().toISOString(), id_contrato: id, accion: "insertado", cambios: {}, mensaje_id: correo.id })
  return { id_contrato: id, accion: "insertado", ruta_archivo: ruta }
}

function actualizar(dir: string, correo: Correo, adjunto: Adjunto, c: Contrato, v: Validacion, maestro: FilaMaestro[]): ResultadoRegistro {
  const fila = maestro.find((f) => f.id_contrato === v.id_contrato_existente)
  if (!fila || !v.diferencias) throw new ErrorNegocio("No se encontró la fila a actualizar en el maestro")
  for (const [campo, cambio] of Object.entries(v.diferencias)) {
    if (campo in fila) (fila as Record<string, string>)[campo] = cambio.despues
  }
  const carpeta = dirname(fila.ruta_sharepoint)
  const sufijo = c.es_otrosi ? "otrosi" : "actualizacion"
  const previos = existsSync(join(rutas(dir).sp, carpeta))
    ? readdirSync(join(rutas(dir).sp, carpeta)).filter((n) => n.startsWith(`${fila.id_contrato}-${sufijo}-`)).length
    : 0
  const ruta = `${carpeta}/${fila.id_contrato}-${sufijo}-${previos + 1}.${adjunto.ext || "bin"}`
  copiarAdjunto(dir, correo, adjunto, ruta)
  guardarMaestro(dir, maestro)
  agregarHistorial(dir, { ts: new Date().toISOString(), id_contrato: fila.id_contrato, accion: "actualizado", cambios: v.diferencias, mensaje_id: correo.id })
  return { id_contrato: fila.id_contrato, accion: "actualizado", ruta_archivo: ruta, cambios: v.diferencias }
}

function cerrarSinEscribir(dir: string, mensajeId: string, clasificacion: string, r: ResultadoRegistro): ResultadoRegistro {
  marcarProcesado(dir, mensajeId, { ts: new Date().toISOString(), clasificacion, accion: r.accion, id_contrato: r.id_contrato })
  return r
}

/** HU-4: única herramienta que escribe. Revalida por su cuenta: no confía en la clasificación que traiga el modelo. */
export function registrarContrato(dir: string, mensajeId: string, contrato: Contrato | undefined, confirmado: boolean): ResultadoRegistro {
  if (leerProcesados(dir)[mensajeId]) throw new ErrorNegocio(`El mensaje ${mensajeId} ya fue procesado; no se registra dos veces`)
  const correo = leerCorreo(dir, mensajeId)
  const adjunto = adjuntoContrato(dir, correo)
  if (!adjunto) {
    return cerrarSinEscribir(dir, mensajeId, "rechazado", { id_contrato: null, accion: "rechazado", motivo: "El mensaje no trae un contrato adjunto (RN4)" })
  }
  if (!contrato) throw new ErrorNegocio("Falta el argumento contrato: obtenlo con contratos_extraer")
  const maestro = leerMaestro(dir)
  const v = validarContrato(contrato, maestro, correo.de, leerComerciales(dir))
  if (v.clasificacion === "rechazado") {
    return cerrarSinEscribir(dir, mensajeId, "rechazado", { id_contrato: contrato.id_contrato, accion: "rechazado", motivo: v.motivo })
  }
  if (v.clasificacion === "duplicado") {
    return cerrarSinEscribir(dir, mensajeId, "duplicado", { id_contrato: v.id_contrato_existente ?? null, accion: "duplicado_omitido", motivo: v.motivo })
  }
  if (v.requiere_revision.length > 0 && !confirmado) {
    throw new ErrorNegocio(`requiere revisión: ${v.requiere_revision.join(", ")}. Pide confirmación al usuario y reintenta con confirmado=true.`)
  }
  const resultado = v.clasificacion === "nuevo"
    ? insertar(dir, correo, adjunto, contrato, v, maestro)
    : actualizar(dir, correo, adjunto, contrato, v, maestro)
  marcarProcesado(dir, mensajeId, { ts: new Date().toISOString(), clasificacion: v.clasificacion, accion: resultado.accion, id_contrato: resultado.id_contrato })
  return resultado
}
