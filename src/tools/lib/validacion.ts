import { similitud } from "./texto"
import {
  CAMPOS_CONTRATO, UMBRAL_CONFIANZA, type CampoContrato, type Clasificacion, type Comercial,
  type Contrato, type FilaMaestro,
} from "./tipos"

export type DetalleRevision = { campo: string; valor: string; confianza: number; motivo: string }
export type Diferencias = Record<string, { antes: string; despues: string }>

export type Validacion = {
  clasificacion: Clasificacion
  id_contrato_existente?: string
  motivo?: string
  requiere_revision: string[]
  detalle_revision: DetalleRevision[]
  diferencias?: Diferencias
  comercial: { email: string; nombre: string | null; conocido: boolean }
  advertencias: string[]
}

const REQUERIDOS: CampoContrato[] = [
  "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza",
]
const ACTUALIZABLES = ["valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza"] as const
const SIMILITUD_MINIMA = 0.9

export function aTexto(v: unknown): string {
  if (v === null || v === undefined) return ""
  return Array.isArray(v) ? v.join(";") : String(v)
}

export function resolverComercial(email: string, comerciales: Comercial[]) {
  const c = comerciales.find((x) => x.email.toLowerCase() === email.toLowerCase())
  return { email, nombre: c?.nombre ?? null, conocido: c !== undefined }
}

function buscarExistente(c: Contrato, maestro: FilaMaestro[]): FilaMaestro | undefined {
  const porId = c.id_contrato ? maestro.find((f) => f.id_contrato === c.id_contrato) : undefined
  if (porId) return porId
  if (!c.nit_cliente || !c.objeto) return undefined
  return maestro.find((f) => f.nit_cliente === c.nit_cliente && similitud(f.objeto, c.objeto ?? "") >= SIMILITUD_MINIMA)
}

function detalleConfianza(c: Contrato): DetalleRevision[] {
  const detalle: DetalleRevision[] = []
  const agregar = (campo: string, valor: unknown, motivo: string) =>
    detalle.push({ campo, valor: aTexto(valor), confianza: c.confianza[campo] ?? 0, motivo })
  for (const campo of CAMPOS_CONTRATO) {
    const valor = c[campo]
    const conf = c.confianza[campo] ?? 0
    if (valor === null && !c.es_otrosi && REQUERIDOS.includes(campo)) agregar(campo, valor, "no se encontró en el documento")
    else if (valor !== null && conf < UMBRAL_CONFIANZA && campo !== "tipo_poliza") agregar(campo, valor, `confianza ${conf} < ${UMBRAL_CONFIANZA}`)
  }
  if (c.id_contrato === null && !c.es_otrosi) agregar("id_contrato", null, "el documento no trae número: se asignaría AUTO-<año>-<secuencia>")
  if (c.requiere_poliza === true && c.tipo_poliza.length === 0) agregar("tipo_poliza", "", "exige póliza pero no se identificó el tipo")
  if (c.fecha_inicio && c.fecha_fin && c.fecha_fin <= c.fecha_inicio) agregar("fecha_fin", c.fecha_fin, "no es posterior a fecha_inicio")
  if (c.valor !== null && c.valor < 0) agregar("valor", c.valor, "valor negativo")
  return detalle
}

function calcularDiferencias(c: Contrato, existente: FilaMaestro): Diferencias {
  const dif: Diferencias = {}
  for (const campo of ACTUALIZABLES) {
    const nuevo = c[campo]
    if (nuevo === null) continue
    // Un otrosí que no habla de pólizas trae tipo_poliza vacío: eso es "sin dato", no "borrar los tipos".
    if (campo === "tipo_poliza" && c.tipo_poliza.length === 0 && c.requiere_poliza !== false) continue
    const antes = existente[campo]
    const despues = aTexto(nuevo)
    const igual = campo === "valor" ? Number(antes) === Number(nuevo) : antes === despues
    if (!igual) dif[campo] = { antes, despues }
  }
  const amplia = c.es_otrosi && c.estado_poliza === "pendiente" && existente.requiere_poliza === "true"
  if (amplia && existente.estado_poliza !== "pendiente") dif["estado_poliza"] = { antes: existente.estado_poliza, despues: "pendiente" }
  return dif
}

function esDuplicadoRN1(c: Contrato, existente: FilaMaestro): boolean {
  const comparables = [
    c.valor !== null ? Number(existente.valor) === c.valor : null,
    c.fecha_inicio !== null ? existente.fecha_inicio === c.fecha_inicio : null,
    c.fecha_fin !== null ? existente.fecha_fin === c.fecha_fin : null,
  ].filter((x): x is boolean => x !== null)
  return comparables.length === 3 && comparables.every(Boolean)
}

function conflictos(c: Contrato, existente: FilaMaestro): DetalleRevision[] {
  if (c.nit_cliente && existente.nit_cliente && c.nit_cliente !== existente.nit_cliente) {
    return [{ campo: "nit_cliente", valor: c.nit_cliente, confianza: c.confianza["nit_cliente"] ?? 0,
      motivo: `conflicto con el maestro: ${existente.id_contrato} figura con NIT ${existente.nit_cliente}` }]
  }
  return []
}

/** RN1–RN5: clasifica el contrato frente al maestro y lista lo que requiere revisión humana. */
export function validarContrato(
  c: Contrato, maestro: FilaMaestro[], remitente: string, comerciales: Comercial[],
): Validacion {
  const comercial = resolverComercial(remitente, comerciales)
  const advertencias = comercial.conocido ? [] : [`Remitente no registrado en comerciales.json: ${remitente}`]
  const base = { comercial, advertencias }

  if (!c.es_otrosi && !c.cliente && !c.objeto) {
    return { ...base, clasificacion: "rechazado", motivo: "El texto no contiene partes ni objeto identificables (RN4)", requiere_revision: [], detalle_revision: [] }
  }
  const existente = buscarExistente(c, maestro)
  if (!existente && c.es_otrosi) {
    return { ...base, clasificacion: "rechazado", motivo: `Otrosí de un contrato que no está en el maestro (${c.id_contrato ?? "sin número"}): registrar primero el contrato base`, requiere_revision: [], detalle_revision: [] }
  }
  if (!existente) {
    const detalle = detalleConfianza(c)
    return { ...base, clasificacion: "nuevo", requiere_revision: detalle.map((d) => d.campo), detalle_revision: detalle }
  }

  const diferencias = calcularDiferencias(c, existente)
  const duplicado = c.es_otrosi ? Object.keys(diferencias).length === 0 : esDuplicadoRN1(c, existente)
  if (duplicado) {
    return { ...base, clasificacion: "duplicado", id_contrato_existente: existente.id_contrato, motivo: "Mismo contrato y mismos valor y fechas que el maestro (RN1): no se escribe nada", requiere_revision: [], detalle_revision: [] }
  }
  const detalle = [...detalleConfianza(c).filter((d) => d.campo in diferencias || !c.es_otrosi), ...conflictos(c, existente)]
  const campos = [...new Set(detalle.map((d) => d.campo))]
  return { ...base, clasificacion: "actualizacion", id_contrato_existente: existente.id_contrato, requiere_revision: campos, detalle_revision: detalle, diferencias }
}
