import { z } from "zod"

export const PAISES = ["CO", "EC", "PE", "PA", "HN"] as const
export const MONEDAS = ["COP", "USD", "PEN", "PAB", "HNL"] as const
export const ESTADOS_POLIZA = ["vigente", "pendiente", "vencida", "no_aplica"] as const
export const UMBRAL_CONFIANZA = 0.8
export const FECHA_CORTE = "2026-05-30"
export const DIAS_ALERTA_VENCIMIENTO = 60

export const COLUMNAS = [
  "id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda",
  "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza", "estado_poliza",
  "comercial", "ruta_sharepoint", "fecha_registro", "fuente",
] as const
export type Columna = (typeof COLUMNAS)[number]
export type FilaMaestro = Record<Columna, string>

export const CAMPOS_CONTRATO = [
  "id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda",
  "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza", "estado_poliza",
] as const
export type CampoContrato = (typeof CAMPOS_CONTRATO)[number]

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato YYYY-MM-DD")

export const ContratoSchema = z.object({
  id_contrato: z.string().nullable().describe("Número del contrato tal como aparece en el documento"),
  cliente: z.string().nullable().describe("Razón social de la contraparte (no Periferia)"),
  nit_cliente: z.string().nullable().describe("Identificador tributario sin dígito de verificación ni puntos"),
  pais: z.enum(PAISES).nullable(),
  objeto: z.string().nullable().describe("Objeto del contrato, máx. 200 caracteres"),
  valor: z.number().nullable().describe("Valor sin separadores; 0 si es por demanda"),
  valor_indeterminado: z.boolean().default(false),
  moneda: z.enum(MONEDAS).nullable(),
  fecha_inicio: fechaIso.nullable(),
  fecha_fin: fechaIso.nullable(),
  requiere_poliza: z.boolean().nullable(),
  tipo_poliza: z.array(z.string()).default([]),
  estado_poliza: z.enum(ESTADOS_POLIZA).nullable(),
  es_otrosi: z.boolean().default(false).describe("true si el documento es un otrosí/modificación"),
  notas: z.array(z.string()).default([]),
  confianza: z.record(z.string(), z.number().min(0).max(1)).describe("Confianza [0,1] por campo"),
})
export type Contrato = z.infer<typeof ContratoSchema>

export type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado"

export type Comercial = { email: string; nombre: string; region: string }

/** Error esperado (de negocio o de entrada): la herramienta lo convierte en { ok: false, error }. */
export class ErrorNegocio extends Error {}
