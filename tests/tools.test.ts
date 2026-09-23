import assert from "node:assert/strict"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import * as t from "../src/tools/contratos"
import { extraerDeTexto } from "../src/tools/lib/extraccion"
import { agregarMensaje, llamar, proyectoTemporal } from "./helpers"

const maestro = (dir: string) => readFileSync(join(dir, "out/sharepoint/maestro-contratos.csv"), "utf8").trim().split("\n")

test("HU-1: lista 6 mensajes y marca la cotización como sin contrato", async () => {
  const dir = proyectoTemporal()
  const r = await llamar(t.leer_buzon, dir)
  assert.equal(r.data.mensajes.length, 6)
  const m5 = r.data.mensajes.find((m: { id: string }) => m.id === "msg-005")
  assert.equal(m5.tiene_contrato, false)
  assert.equal(m5.clasificacion_preliminar, "rechazado")
})

test("HU-2: extrae msg-001 con confianza y sin inventar campos", async () => {
  const dir = proyectoTemporal()
  const r = await llamar(t.extraer, dir, { mensaje_id: "msg-001" })
  assert.equal(r.data.id_contrato, "CT-2026-015")
  assert.equal(r.data.cliente, "Industrias Delta S.A.S.")
  assert.equal(r.data.nit_cliente, "890900111")
  assert.equal(r.data.valor, 265000000)
  assert.equal(r.data.moneda, "COP")
  assert.equal(r.data.fecha_inicio, "2026-08-01")
  assert.equal(r.data.fecha_fin, "2027-07-31")
  assert.deepEqual(r.data.tipo_poliza, ["cumplimiento"])
  assert.ok(Object.values(r.data.confianza as Record<string, number>).every((c) => c >= 0 && c <= 1))
})

test("extrae valores en USD con formato anglosajón y RUC de Ecuador", async () => {
  const dir = proyectoTemporal()
  const r = await llamar(t.extraer, dir, { mensaje_id: "msg-002" })
  assert.equal(r.data.valor, 120000)
  assert.equal(r.data.moneda, "USD")
  assert.equal(r.data.pais, "EC")
  assert.equal(r.data.nit_cliente, "1790012345001")
  assert.equal(r.data.requiere_poliza, false)
})

test("msg-006: valor por demanda y plazo en meses quedan en revisión y no se registran", async () => {
  const dir = proyectoTemporal()
  const ext = await llamar(t.extraer, dir, { mensaje_id: "msg-006" })
  const val = await llamar(t.validar, dir, { mensaje_id: "msg-006", contrato: ext.data })
  assert.equal(val.data.clasificacion, "nuevo")
  assert.ok(val.data.requiere_revision.includes("valor"))
  assert.ok(val.data.requiere_revision.includes("fecha_fin"))
  assert.equal(val.data.comercial.conocido, false)
  const reg = await llamar(t.registrar, dir, { mensaje_id: "msg-006", contrato: ext.data })
  assert.equal(reg.ok, false)
  assert.match(reg.error ?? "", /requiere revisión/)
  assert.equal(maestro(dir).length, 9, "el maestro no cambia (encabezado + 8 filas)")
})

test("msg-006 confirmado: se registra y queda procesado", async () => {
  const dir = proyectoTemporal()
  const ext = await llamar(t.extraer, dir, { mensaje_id: "msg-006" })
  const reg = await llamar(t.registrar, dir, { mensaje_id: "msg-006", contrato: { ...ext.data, valor: 0, fecha_fin: "2027-08-31" }, confirmado: true })
  assert.equal(reg.ok, true)
  assert.equal(reg.data.accion, "insertado")
  assert.ok(existsSync(join(dir, "out/sharepoint", reg.data.ruta_archivo)))
  const otra = await llamar(t.registrar, dir, { mensaje_id: "msg-006", contrato: ext.data, confirmado: true })
  assert.equal(otra.ok, false, "no se registra dos veces el mismo mensaje")
})

test("O2 / RN2: el otrosí actualiza la fila existente, conserva historial y no borra la póliza", async () => {
  const dir = proyectoTemporal()
  const ext = await llamar(t.extraer, dir, { mensaje_id: "msg-003" })
  assert.equal(ext.data.es_otrosi, true)
  const reg = await llamar(t.registrar, dir, { mensaje_id: "msg-003", contrato: ext.data })
  assert.equal(reg.data.accion, "actualizado")
  const fila = maestro(dir).find((l) => l.startsWith("CT-2026-011")) ?? ""
  assert.match(fila, /520000,PEN,2026-05-02,2027-11-01,true,cumplimiento;responsabilidad_civil,pendiente/)
  assert.equal(maestro(dir).length, 9, "no agrega filas")
  const hist = readFileSync(join(dir, "out/sharepoint/historial.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  assert.deepEqual(Object.keys(hist[0].cambios).sort(), ["estado_poliza", "fecha_fin", "valor"])
})

test("RN1: el reenvío de un contrato ya registrado es duplicado y no escribe", async () => {
  const dir = proyectoTemporal()
  const ext = await llamar(t.extraer, dir, { mensaje_id: "msg-004" })
  const val = await llamar(t.validar, dir, { mensaje_id: "msg-004", contrato: ext.data })
  assert.equal(val.data.clasificacion, "duplicado")
  const reg = await llamar(t.registrar, dir, { mensaje_id: "msg-004", contrato: ext.data })
  assert.equal(reg.data.accion, "duplicado_omitido")
  assert.equal(maestro(dir).length, 9)
  assert.equal(existsSync(join(dir, "out/sharepoint/historial.jsonl")), false)
})

test("RN4: la cotización se rechaza y queda procesada", async () => {
  const dir = proyectoTemporal()
  const ext = await llamar(t.extraer, dir, { mensaje_id: "msg-005" })
  assert.equal(ext.ok, false)
  const reg = await llamar(t.registrar, dir, { mensaje_id: "msg-005" })
  assert.equal(reg.data.accion, "rechazado")
  const buzon = await llamar(t.leer_buzon, dir)
  assert.equal(buzon.data.mensajes.length, 5)
})

test("RN6: el fixture del maestro no se modifica", async () => {
  const dir = proyectoTemporal()
  const ruta = join(dir, "fixtures/reto-02/maestro-contratos.csv")
  const antes = readFileSync(ruta, "utf8")
  const ext = await llamar(t.extraer, dir, { mensaje_id: "msg-001" })
  await llamar(t.registrar, dir, { mensaje_id: "msg-001", contrato: ext.data })
  assert.equal(readFileSync(ruta, "utf8"), antes)
  assert.ok(statSync(join(dir, "out/sharepoint/maestro-contratos.csv")).size > antes.length)
})

test("RN7: cada llamada deja rastro en out/log.jsonl", async () => {
  const dir = proyectoTemporal()
  await llamar(t.leer_buzon, dir)
  await llamar(t.extraer, dir, { mensaje_id: "msg-001" })
  const lineas = readFileSync(join(dir, "out/log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  assert.deepEqual(lineas.map((l) => l.herramienta), ["contratos_leer_buzon", "contratos_extraer"])
  assert.equal(lineas[1].mensaje_id, "msg-001")
})

test("HU-5: alertas con fecha de referencia determinista", async () => {
  const dir = proyectoTemporal()
  const r = await llamar(t.alertas, dir, { hoy: "2026-09-03" })
  assert.deepEqual(r.data.vencen.map((v: { id_contrato: string }) => v.id_contrato), ["CT-2026-009", "CT-2026-004"])
  assert.deepEqual(r.data.polizas_pendientes.map((v: { id_contrato: string }) => v.id_contrato), ["CT-2026-004"])
  assert.ok(readFileSync(join(dir, "out/alertas.md"), "utf8").includes("## 3. Registrados desde el corte"))
  const mala = await llamar(t.alertas, dir, { hoy: "03/09/2026" })
  assert.equal(mala.ok, false)
})

test("HU-6: errores legibles, sin lanzar", async () => {
  const dir = proyectoTemporal()
  assert.equal((await llamar(t.extraer, dir, { mensaje_id: "msg-999" })).ok, false)
  assert.equal((await llamar(t.extraer, dir, {})).ok, false)
  assert.match((await llamar(t.extraer, dir, { mensaje_id: "../../etc/passwd" })).error ?? "", /inválido/)
  agregarMensaje(dir, "msg-100", {}, { "contrato.txt": "   \n" })
  const vacio = await llamar(t.extraer, dir, { mensaje_id: "msg-100" })
  assert.equal(vacio.ok, false)
  const buzon = await llamar(t.leer_buzon, dir)
  assert.ok(buzon.data.mensajes.length >= 7, "un mensaje malo no impide listar el resto")
})

test("HU-6: fecha inexistente y moneda desconocida devuelven error, no datos", () => {
  const base = "CONTRATO No. CT-2026-900\n\nEntre ACME S.A.S., NIT 800.111.222-3, con domicilio en Bogotá (EL CONTRATANTE), y PERIFERIA IT GROUP S.A.S., NIT 900.123.456-7.\n\nPRIMERA. OBJETO. Prestar servicios.\n\nSEGUNDA. VALOR. El valor es de (XYZ 1.000.000).\n\nTERCERA. PLAZO. Desde el uno (1) de enero de 2026 hasta el treinta y uno (31) de febrero de 2027."
  assert.throws(() => extraerDeTexto(base), /Moneda desconocida/)
  const fecha = base.replace("(XYZ 1.000.000)", "(COP $1.000.000)")
  assert.throws(() => extraerDeTexto(fecha), /Fecha inválida/)
})

test("RN2: mismo NIT con objeto casi idéntico y sin número se trata como actualización", async () => {
  const dir = proyectoTemporal()
  const texto = "CONTRATO DE PRESTACIÓN DE SERVICIOS\n\nEntre CLÍNICA SAN RAFAEL S.A., NIT 890.903.456-1, con domicilio en Medellín (EL CONTRATANTE), y PERIFERIA IT GROUP S.A.S., NIT 900.123.456-7.\n\nPRIMERA. OBJETO. Mesa de servicio TI nivel 1 y 2\n\nSEGUNDA. VALOR. Valor total (COP $250.000.000), IVA incluido.\n\nTERCERA. PLAZO. Desde el quince (15) de mayo de 2026 hasta el catorce (14) de noviembre de 2026."
  agregarMensaje(dir, "msg-101", {}, { "contrato.txt": texto })
  const ext = await llamar(t.extraer, dir, { mensaje_id: "msg-101" })
  assert.equal(ext.data.id_contrato, null)
  const val = await llamar(t.validar, dir, { mensaje_id: "msg-101", contrato: ext.data })
  assert.equal(val.data.clasificacion, "actualizacion")
  assert.equal(val.data.id_contrato_existente, "CT-2026-012")
  assert.equal(val.data.diferencias.valor.despues, "250000000")
})

test("seguridad: un id_contrato con separadores de ruta no se acepta al registrar", async () => {
  const dir = proyectoTemporal()
  const ext = await llamar(t.extraer, dir, { mensaje_id: "msg-001" })
  const reg = await llamar(t.registrar, dir, { mensaje_id: "msg-001", contrato: { ...ext.data, id_contrato: "../../evil" } })
  assert.equal(reg.ok, false)
  assert.equal(existsSync(join(dir, "evil.txt")), false)
})
