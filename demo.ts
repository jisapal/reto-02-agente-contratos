/**
 * Verificación sin modelo: procesa los 6 mensajes del buzón llamando directamente a las herramientas.
 *   bun install && bun run demo.ts        (o: npm install && npm run demo)
 */
import { rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as contratos from "./src/tools/contratos"
import type { Contrato } from "./src/tools/lib/tipos"

const directory = dirname(fileURLToPath(import.meta.url))
const ctx = { directory, sessionId: "demo" }
const HOY = "2026-09-03"

type Respuesta<T> = { ok: true; data: T } | { ok: false; error: string }
type Buzon = { mensajes: { id: string; asunto: string; tiene_contrato: boolean; motivo?: string }[] }
type Validado = { clasificacion: string; id_contrato_existente?: string; requiere_revision: string[]; detalle_revision: { campo: string; valor: string; confianza: number; motivo: string }[]; advertencias: string[] }
type Registrado = { id_contrato: string | null; accion: string; ruta_archivo?: string; motivo?: string }
type Alertas = { ruta: string; vencen: unknown[]; polizas_pendientes: unknown[]; registrados_desde_corte: unknown[] }

async function llamar<T>(fn: (a: never, c: typeof ctx) => Promise<string>, args: object): Promise<Respuesta<T>> {
  return JSON.parse(await fn(args as never, ctx)) as Respuesta<T>
}

const linea = (s = "") => console.log(s)
const titulo = (s: string) => { linea(); linea(`━━ ${s} ${"━".repeat(Math.max(0, 70 - s.length))}`) }

async function procesar(id: string, asunto: string): Promise<void> {
  titulo(`${id} · ${asunto}`)
  const ext = await llamar<Contrato>(contratos.extraer.execute, { mensaje_id: id })
  if (!ext.ok) {
    const cierre = await llamar<Registrado>(contratos.registrar.execute, { mensaje_id: id })
    linea(`  extracción : ${ext.error}`)
    linea(`  acción     : ${cierre.ok ? `${cierre.data.accion} — ${cierre.data.motivo}` : cierre.error}`)
    return
  }
  const val = await llamar<Validado>(contratos.validar.execute, { mensaje_id: id, contrato: ext.data })
  if (!val.ok) { linea(`  validación : ERROR ${val.error}`); return }
  const v = val.data
  linea(`  clasificación : ${v.clasificacion}${v.id_contrato_existente ? ` (contra ${v.id_contrato_existente})` : ""}`)
  linea(`  en revisión   : ${v.requiere_revision.length ? v.requiere_revision.join(", ") : "—"}`)
  for (const d of v.detalle_revision) linea(`      · ${d.campo} = ${JSON.stringify(d.valor)}  (${d.motivo})`)
  for (const a of v.advertencias) linea(`  advertencia   : ${a}`)
  const reg = await llamar<Registrado>(contratos.registrar.execute, { mensaje_id: id, contrato: ext.data })
  linea(reg.ok
    ? `  acción        : ${reg.data.accion}${reg.data.ruta_archivo ? ` → ${reg.data.ruta_archivo}` : ""}`
    : `  acción        : SIN REGISTRAR — ${reg.error}`)
}

async function main(): Promise<void> {
  rmSync(join(directory, "out"), { recursive: true, force: true })
  const buzon = await llamar<Buzon>(contratos.leer_buzon.execute, {})
  if (!buzon.ok) throw new Error(buzon.error)
  titulo(`Buzón: ${buzon.data.mensajes.length} mensajes pendientes`)
  for (const m of buzon.data.mensajes) linea(`  ${m.id}  contrato=${m.tiene_contrato ? "sí" : "no"}  ${m.asunto}`)

  for (const m of buzon.data.mensajes) await procesar(m.id, m.asunto)

  titulo("msg-006 · segunda pasada con confirmación humana")
  const ext = await llamar<Contrato>(contratos.extraer.execute, { mensaje_id: "msg-006" })
  if (!ext.ok) throw new Error(ext.error)
  linea('  Usuario: "confirmo el valor 0 y la fecha fin 2027-08-31"')
  const corregido: Contrato = { ...ext.data, valor: 0, fecha_fin: "2027-08-31" }
  const reg = await llamar<Registrado>(contratos.registrar.execute, { mensaje_id: "msg-006", contrato: corregido, confirmado: true })
  linea(reg.ok ? `  acción        : ${reg.data.accion} → ${reg.data.ruta_archivo}` : `  acción        : ERROR ${reg.error}`)

  titulo(`Alertas (hoy = ${HOY})`)
  const al = await llamar<Alertas>(contratos.alertas.execute, { hoy: HOY })
  if (!al.ok) throw new Error(al.error)
  linea(`  vencen ≤ 60 días         : ${al.data.vencen.length}`)
  linea(`  pólizas pendientes       : ${al.data.polizas_pendientes.length}`)
  linea(`  registrados desde corte  : ${al.data.registrados_desde_corte.length}`)
  linea(`  reporte                  : ${al.data.ruta}`)

  const resto = await llamar<Buzon>(contratos.leer_buzon.execute, {})
  linea(); linea(`Mensajes pendientes al final: ${resto.ok ? resto.data.mensajes.length : "?"}`)
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })
