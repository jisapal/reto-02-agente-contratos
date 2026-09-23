import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { test } from "node:test"
import { correrTurno, type DepsTurno } from "../src/agent/loop"
import { AlmacenSesiones } from "../src/agent/sesiones"
import { cargarConfig } from "../src/agent/config"
import { cargarHerramientas } from "../src/agent/herramientas"
import { ErrorLLM, type AdaptadorLLM, type PeticionLLM, type RespuestaLLM } from "../src/llm/adapter"
import { crearServidor } from "../src/server"
import { proyectoTemporal } from "./helpers"

const uso = { entrada: 10, salida: 5 }
const llamada = (id: string, nombre: string, args: object) => ({ id, nombre, args })
const texto = (t: string): RespuestaLLM => ({ texto: t, llamadas: [], uso })

/** Adaptador guionado: entrega respuestas en orden y guarda las peticiones que recibió. */
function guion(pasos: (RespuestaLLM | Error)[]): AdaptadorLLM & { peticiones: PeticionLLM[] } {
  const peticiones: PeticionLLM[] = []
  let i = 0
  return {
    proveedor: "guion", modelo: "test", peticiones,
    async enviar(p) {
      peticiones.push(structuredClone(p))
      const paso = pasos[Math.min(i++, pasos.length - 1)]
      if (paso instanceof Error) throw paso
      return paso ?? texto("fin")
    },
  }
}

function deps(dir: string, adapter: AdaptadorLLM, maxIteraciones = 25): DepsTurno {
  return { adapter, herramientas: cargarHerramientas(), esquemas: [], sistema: "test", directory: dir, config: { maxIteraciones, maxTokensSesion: 10_000 } }
}

const marca = (id: string) => ({ mensaje_id: id })

test("CA3: el modelo no puede confirmar en el mismo turno en que detectó la revisión", async () => {
  const dir = proyectoTemporal()
  const sesiones = new AlmacenSesiones(dir)
  const s = sesiones.obtenerOCrear("s1")
  // Turno 1: valida, intenta registrar con confirmado=true (trampa) y luego pregunta.
  // Para armar validar/registrar necesitamos el contrato: lo tomamos de una extracción real.
  const ext = JSON.parse(await cargarHerramientas().get("contratos_extraer")!.execute(marca("msg-006"), { directory: dir, sessionId: "x" })).data
  const adapter = guion([
    { texto: "", llamadas: [llamada("b", "contratos_validar", { mensaje_id: "msg-006", contrato: ext })], uso },
    { texto: "", llamadas: [llamada("c", "contratos_registrar", { mensaje_id: "msg-006", contrato: ext, confirmado: true })], uso },
    texto("¿Confirmas valor 0 y fecha fin 2027-08-31?"),
  ])
  const t1 = await correrTurno(s, "procesa el buzón", deps(dir, adapter))
  assert.equal(t1.needsConfirmation, true)
  assert.equal(t1.toolCalls[1]?.bloqueado, true, "el registro con confirmado=true se bloquea en el mismo turno")
  assert.match(t1.toolCalls[1]?.resultado ?? "", /Confirmación humana requerida/)
  assert.equal(readFileSync(join(dir, "out/sharepoint/maestro-contratos.csv"), "utf8").trim().split("\n").length, 9)

  // Turno 2: la analista confirma → ahora sí se registra y se limpia el estado de confirmación.
  const adapter2 = guion([
    { texto: "", llamadas: [llamada("d", "contratos_registrar", { mensaje_id: "msg-006", contrato: { ...ext, valor: 0, fecha_fin: "2027-08-31" }, confirmado: true })], uso },
    texto("Registrado."),
  ])
  const t2 = await correrTurno(s, "confirmo el valor 0 y la fecha fin 2027-08-31", deps(dir, adapter2))
  assert.equal(t2.toolCalls[0]?.ok, true)
  assert.equal(t2.needsConfirmation, false)
})

test("CA1: al llegar al tope de iteraciones cierra con lo hecho y lo pendiente, sin herramientas", async () => {
  const dir = proyectoTemporal()
  const s = new AlmacenSesiones(dir).obtenerOCrear("s2")
  const adapter = guion([{ texto: "", llamadas: [llamada("x", "contratos_leer_buzon", {})], uso }])
  const pasosFinales: RespuestaLLM = texto("Hice 3 pasos; falta procesar el resto.")
  let n = 0
  const original = adapter.enviar.bind(adapter)
  adapter.enviar = async (p) => (p.permitirHerramientas ? original(p) : (n++, pasosFinales))
  const t = await correrTurno(s, "procesa", deps(dir, adapter, 3))
  assert.equal(t.toolCalls.length, 3)
  assert.equal(n, 1, "una llamada final con permitirHerramientas=false")
  assert.match(t.respuesta, /falta procesar/)
})

test("CA5: un error del proveedor se muestra en claro y la sesión sigue viva", async () => {
  const dir = proyectoTemporal()
  const s = new AlmacenSesiones(dir).obtenerOCrear("s3")
  const t1 = await correrTurno(s, "hola", deps(dir, guion([new ErrorLLM("El proveedor de lenguaje no respondió en 60 s (timeout).")])))
  assert.match(t1.respuesta, /⚠️.*timeout/)
  const t2 = await correrTurno(s, "otra vez", deps(dir, guion([texto("Aquí estoy.")])))
  assert.equal(t2.respuesta, "Aquí estoy.")
  const roles = s.mensajes.map((m) => m.rol)
  assert.deepEqual(roles, ["user", "assistant", "user", "assistant"], "los roles siguen alternando")
})

test("un argumento inválido del modelo vuelve como error de herramienta, no rompe el turno", async () => {
  const dir = proyectoTemporal()
  const s = new AlmacenSesiones(dir).obtenerOCrear("s4")
  const adapter = guion([{ texto: "", llamadas: [llamada("z", "contratos_alertas", { hoy: 5 })], uso }, texto("Necesito la fecha en formato YYYY-MM-DD.")])
  const t = await correrTurno(s, "alertas", deps(dir, adapter))
  assert.equal(t.toolCalls[0]?.ok, false)
  assert.match(t.toolCalls[0]?.resumen ?? "", /Argumentos inválidos/)
  assert.match(t.respuesta, /YYYY-MM-DD/)
})

test("tope de tokens por sesión", async () => {
  const dir = proyectoTemporal()
  const s = new AlmacenSesiones(dir).obtenerOCrear("s5")
  s.tokens = 10_000
  const t = await correrTurno(s, "hola", deps(dir, guion([texto("no debería llamarse")])))
  assert.match(t.respuesta, /tope de tokens/)
})

test("API: chat, historial, salud sin claves, validación y clave de acceso", async () => {
  const dir = proyectoTemporal()
  const config = { ...cargarConfig({}), accessKey: "secreto", apiKey: "sk-ant-NO-DEBE-SALIR" }
  const servidor = crearServidor({ config, adapter: guion([texto("Listo.")]), directory: dir, esquemas: [] })
  await new Promise<void>((ok) => servidor.listen(0, ok))
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
  const cab = { "content-type": "application/json", "x-access-key": "secreto" }
  try {
    const salud = await (await fetch(`${base}/api/health`)).text()
    assert.match(salud, /"ok":true/)
    assert.ok(!salud.includes("sk-ant"), "la clave nunca aparece en la API")
    assert.equal((await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401)
    assert.equal((await fetch(`${base}/api/chat`, { method: "POST", headers: cab, body: JSON.stringify({ sessionId: "a b", message: "x" }) })).status, 400)
    const r = await fetch(`${base}/api/chat`, { method: "POST", headers: cab, body: JSON.stringify({ sessionId: "demo1", message: "hola" }) })
    const cuerpo = (await r.json()) as { reply: string; toolCalls: unknown[]; needsConfirmation: boolean }
    assert.equal(cuerpo.reply, "Listo.")
    assert.equal(cuerpo.needsConfirmation, false)
    const h = (await (await fetch(`${base}/api/sessions/demo1`, { headers: cab })).json()) as { turnos: unknown[] }
    assert.equal(h.turnos.length, 1)
    assert.equal((await fetch(`${base}/api/sessions/no-existe`, { headers: cab })).status, 404)
    const portada = await fetch(`${base}/`)
    assert.equal(portada.status, 200)
    assert.match(portada.headers.get("content-type") ?? "", /text\/html/)
    assert.match(await portada.text(), /<!doctype html>/i)
  } finally {
    servidor.close()
  }
})
