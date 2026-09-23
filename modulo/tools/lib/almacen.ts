import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { csvAFilas, filasACsv } from "./csv"
import type { FilaMaestro } from "./tipos"

/** Todas las rutas se resuelven desde la raíz del proyecto (ctx.directory), nunca absolutas. */
export function rutas(dir: string) {
  const out = join(dir, "out")
  const sp = join(out, "sharepoint")
  const fixtures = join(dir, "fixtures", "reto-02")
  return {
    out,
    sp,
    maestro: join(sp, "maestro-contratos.csv"),
    historial: join(sp, "historial.jsonl"),
    procesados: join(out, "procesados.json"),
    log: join(out, "log.jsonl"),
    alertas: join(out, "alertas.md"),
    fixtures,
    buzon: join(fixtures, "buzon"),
    maestroFixture: join(fixtures, "maestro-contratos.csv"),
    comerciales: join(fixtures, "comerciales.json"),
  }
}

/** RN6: la primera ejecución copia el maestro del fixture a out/sharepoint/. El fixture no se toca. */
export function asegurarSalida(dir: string): void {
  const r = rutas(dir)
  mkdirSync(r.sp, { recursive: true })
  if (!existsSync(r.maestro)) copyFileSync(r.maestroFixture, r.maestro)
}

export function reiniciarSalida(dir: string): void {
  rmSync(rutas(dir).out, { recursive: true, force: true })
  asegurarSalida(dir)
}

export function leerMaestro(dir: string): FilaMaestro[] {
  return csvAFilas(readFileSync(rutas(dir).maestro, "utf8"))
}

export function guardarMaestro(dir: string, filas: FilaMaestro[]): void {
  writeFileSync(rutas(dir).maestro, filasACsv(filas))
}

export type Procesado = {
  ts: string
  clasificacion: string
  accion: string
  id_contrato: string | null
}

export function leerProcesados(dir: string): Record<string, Procesado> {
  const ruta = rutas(dir).procesados
  if (!existsSync(ruta)) return {}
  return JSON.parse(readFileSync(ruta, "utf8")) as Record<string, Procesado>
}

export function marcarProcesado(dir: string, mensajeId: string, p: Procesado): void {
  const actual = leerProcesados(dir)
  actual[mensajeId] = p
  writeFileSync(rutas(dir).procesados, JSON.stringify(actual, null, 2))
}

export type LineaHistorial = {
  ts: string
  id_contrato: string
  accion: "insertado" | "actualizado"
  cambios: Record<string, { antes: string; despues: string }>
  mensaje_id: string
}

export function agregarHistorial(dir: string, linea: LineaHistorial): void {
  appendFileSync(rutas(dir).historial, JSON.stringify(linea) + "\n")
}

export function leerHistorial(dir: string): LineaHistorial[] {
  const ruta = rutas(dir).historial
  if (!existsSync(ruta)) return []
  return readFileSync(ruta, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LineaHistorial)
}

export type EntradaLog = { ts: string; herramienta: string; mensaje_id: string | null; ok: boolean; resumen: string }

/** RN7: cada ejecución de herramienta queda en out/log.jsonl. */
export function registrarLog(dir: string, entrada: EntradaLog): void {
  mkdirSync(rutas(dir).out, { recursive: true })
  appendFileSync(rutas(dir).log, JSON.stringify(entrada) + "\n")
}
