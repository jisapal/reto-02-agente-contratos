import { writeFileSync } from "node:fs"
import { leerHistorial, leerMaestro, rutas } from "./almacen"
import { diasEntre, esFechaIso } from "./fechas"
import { DIAS_ALERTA_VENCIMIENTO, ErrorNegocio, FECHA_CORTE, type FilaMaestro } from "./tipos"

type ItemVence = { id_contrato: string; cliente: string; fecha_fin: string; dias_restantes: number; poliza: string }
type ItemPoliza = { id_contrato: string; cliente: string; tipo_poliza: string; estado_poliza: string; fecha_fin: string }
type ItemRegistro = { id_contrato: string; cliente: string; fecha_registro: string; fuente: string }
type ItemActualizado = { id_contrato: string; ts: string; cambios: string }

export type ResultadoAlertas = {
  ruta: string
  hoy: string
  vencen: ItemVence[]
  vencidos: ItemVence[]
  polizas_pendientes: ItemPoliza[]
  registrados_desde_corte: ItemRegistro[]
  actualizados_desde_corte: ItemActualizado[]
}

const celda = (v: string) => v.replace(/\|/g, "\\|")

function tabla(cabecera: string[], filas: string[][]): string {
  if (filas.length === 0) return "_Sin elementos._\n"
  const lineas = [`| ${cabecera.join(" | ")} |`, `|${cabecera.map(() => "---").join("|")}|`]
  for (const f of filas) lineas.push(`| ${f.map(celda).join(" | ")} |`)
  return lineas.join("\n") + "\n"
}

function itemVence(f: FilaMaestro, hoy: string): ItemVence {
  return {
    id_contrato: f.id_contrato, cliente: f.cliente, fecha_fin: f.fecha_fin,
    dias_restantes: diasEntre(hoy, f.fecha_fin),
    poliza: f.requiere_poliza === "true" ? f.estado_poliza : "no aplica",
  }
}

function calcular(maestro: FilaMaestro[], hoy: string, dir: string): Omit<ResultadoAlertas, "ruta" | "hoy"> {
  const conFin = maestro.filter((f) => esFechaIso(f.fecha_fin)).map((f) => itemVence(f, hoy))
  const vencen = conFin.filter((i) => i.dias_restantes >= 0 && i.dias_restantes <= DIAS_ALERTA_VENCIMIENTO)
    .sort((a, b) => a.dias_restantes - b.dias_restantes)
  const vencidos = conFin.filter((i) => i.dias_restantes < 0).sort((a, b) => b.dias_restantes - a.dias_restantes)
  const polizas_pendientes = maestro
    .filter((f) => f.requiere_poliza === "true" && f.estado_poliza !== "vigente")
    .map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, tipo_poliza: f.tipo_poliza, estado_poliza: f.estado_poliza, fecha_fin: f.fecha_fin }))
  const registrados_desde_corte = maestro
    .filter((f) => f.fecha_registro >= FECHA_CORTE)
    .map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_registro: f.fecha_registro, fuente: f.fuente }))
  const actualizados_desde_corte = leerHistorial(dir)
    .filter((h) => h.accion === "actualizado")
    .map((h) => ({ id_contrato: h.id_contrato, ts: h.ts, cambios: Object.entries(h.cambios).map(([k, v]) => `${k}: ${v.antes} → ${v.despues}`).join("; ") }))
  return { vencen, vencidos, polizas_pendientes, registrados_desde_corte, actualizados_desde_corte }
}

function markdown(hoy: string, r: Omit<ResultadoAlertas, "ruta" | "hoy">): string {
  const filaVence = (i: ItemVence) => [i.id_contrato, i.cliente, i.fecha_fin, String(i.dias_restantes), i.poliza]
  return [
    "# Reporte de alertas de contratos", "",
    `_Fecha de referencia: ${hoy} · Corte del maestro anterior: ${FECHA_CORTE}_`, "",
    `## 1. Contratos que vencen en ≤ ${DIAS_ALERTA_VENCIMIENTO} días`, "",
    tabla(["Contrato", "Cliente", "Fecha fin", "Días", "Póliza"], r.vencen.map(filaVence)),
    "### Ya vencidos (verificar renovación o cierre)", "",
    tabla(["Contrato", "Cliente", "Fecha fin", "Días", "Póliza"], r.vencidos.map(filaVence)),
    "## 2. Pólizas pendientes (requiere póliza y estado distinto de vigente)", "",
    tabla(["Contrato", "Cliente", "Tipo de póliza", "Estado", "Fecha fin"],
      r.polizas_pendientes.map((p) => [p.id_contrato, p.cliente, p.tipo_poliza, p.estado_poliza, p.fecha_fin])),
    `## 3. Registrados desde el corte (${FECHA_CORTE})`, "",
    tabla(["Contrato", "Cliente", "Fecha registro", "Fuente"],
      r.registrados_desde_corte.map((x) => [x.id_contrato, x.cliente, x.fecha_registro, x.fuente])),
    "### Actualizados (otrosíes y modificaciones)", "",
    tabla(["Contrato", "Momento", "Cambios"], r.actualizados_desde_corte.map((x) => [x.id_contrato, x.ts, x.cambios])),
  ].join("\n")
}

export function generarAlertas(dir: string, hoy: string): ResultadoAlertas {
  if (!esFechaIso(hoy)) throw new ErrorNegocio(`Fecha inválida para "hoy": "${hoy}" (usa YYYY-MM-DD)`)
  const resultado = calcular(leerMaestro(dir), hoy, dir)
  writeFileSync(rutas(dir).alertas, markdown(hoy, resultado))
  return { ruta: "out/alertas.md", hoy, ...resultado }
}
