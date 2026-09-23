import { registrarLog } from "../tools/lib/almacen"
import type { Herramienta } from "../tools/lib/herramienta"
import { ErrorLLM, type AdaptadorLLM, type EsquemaHerramienta, type LlamadaHerramienta } from "../llm/adapter"
import type { Config } from "./config"
import { resumirResultado } from "./resumen"
import type { EventoTool, Sesion, Turno } from "./sesiones"

export type DepsTurno = {
  adapter: AdaptadorLLM
  herramientas: Map<string, Herramienta>
  esquemas: EsquemaHerramienta[]
  sistema: string
  directory: string
  config: Pick<Config, "maxIteraciones" | "maxTokensSesion">
}

const MAX_RESULTADO_UI = 6000

function bloquear(nombre: string, mensajeId: string): string {
  return JSON.stringify({
    ok: false,
    error: `Confirmación humana requerida (CA3): los campos en revisión de ${mensajeId} se detectaron en este mismo turno. Termina el turno con una pregunta explícita al usuario y usa confirmado=true solo después de que responda.`,
    herramienta: nombre,
  })
}

function idDe(args: unknown): string {
  const id = (args as { mensaje_id?: unknown } | null)?.mensaje_id
  return typeof id === "string" ? id : ""
}

/** Mantiene la lista de mensajes con revisión humana pendiente a partir de lo que devuelven las herramientas. */
function seguirPendientes(sesion: Sesion, nombre: string, args: unknown, crudo: string): void {
  const id = idDe(args)
  if (!id) return
  const r = JSON.parse(crudo) as { ok: boolean; data?: { requiere_revision?: string[]; accion?: string }; error?: string }
  if (nombre === "contratos_validar" && r.ok) {
    const campos = r.data?.requiere_revision ?? []
    if (campos.length === 0) delete sesion.pendientes[id]
    else if (!sesion.pendientes[id]) sesion.pendientes[id] = { turno: sesion.turno, campos }
  } else if (nombre === "contratos_registrar") {
    if (r.ok) delete sesion.pendientes[id]
    else if (/^requiere revisión/.test(r.error ?? "") && !sesion.pendientes[id]) {
      sesion.pendientes[id] = { turno: sesion.turno, campos: [(r.error ?? "").replace(/^requiere revisión: /, "").split(".")[0] ?? ""] }
    }
  }
}

async function ejecutar(ll: LlamadaHerramienta, sesion: Sesion, deps: DepsTurno): Promise<{ evento: EventoTool; crudo: string }> {
  const inicio = Date.now()
  const args = ll.args
  const pendiente = sesion.pendientes[idDe(args)]
  const confirmaEnMismoTurno = ll.nombre === "contratos_registrar"
    && (args as { confirmado?: unknown } | null)?.confirmado === true
    && pendiente?.turno === sesion.turno
  let crudo: string
  if (confirmaEnMismoTurno) {
    crudo = bloquear(ll.nombre, idDe(args))
    registrarLog(deps.directory, { ts: new Date().toISOString(), herramienta: ll.nombre, mensaje_id: idDe(args), ok: false, resumen: "bloqueado: confirmación humana requerida" })
  } else {
    const herramienta = deps.herramientas.get(ll.nombre)
    crudo = herramienta
      ? await herramienta.execute(args, { directory: deps.directory, sessionId: sesion.id })
      : JSON.stringify({ ok: false, error: `Herramienta desconocida: ${ll.nombre}` })
    seguirPendientes(sesion, ll.nombre, args, crudo)
  }
  const { ok, resumen } = resumirResultado(ll.nombre, crudo)
  const evento: EventoTool = {
    id: ll.id, nombre: ll.nombre, args, ok, bloqueado: confirmaEnMismoTurno, resumen,
    resultado: crudo.length > MAX_RESULTADO_UI ? `${crudo.slice(0, MAX_RESULTADO_UI)}…` : crudo, ms: Date.now() - inicio,
  }
  return { evento, crudo }
}

async function cerrarPorTope(sesion: Sesion, deps: DepsTurno): Promise<string> {
  sesion.mensajes.push({ rol: "user", texto: `[Sistema] Alcanzaste el tope de ${deps.config.maxIteraciones} iteraciones. Responde ahora, sin llamar herramientas, con lo que ya hiciste y lo que falta por hacer.` })
  const r = await deps.adapter.enviar({ sistema: deps.sistema, mensajes: sesion.mensajes, herramientas: deps.esquemas, permitirHerramientas: false })
  sesion.tokens += r.uso.entrada + r.uso.salida
  sesion.mensajes.push({ rol: "assistant", texto: r.texto, llamadas: [] })
  return r.texto
}

/** Un turno del agente: prompt → modelo → herramientas → … → respuesta, con tope de iteraciones y de tokens. */
export async function correrTurno(sesion: Sesion, mensajeUsuario: string, deps: DepsTurno): Promise<Turno> {
  sesion.turno += 1
  sesion.mensajes.push({ rol: "user", texto: mensajeUsuario })
  const toolCalls: EventoTool[] = []
  let respuesta = ""
  try {
    let terminado = false
    for (let i = 0; i < deps.config.maxIteraciones && !terminado; i++) {
      if (sesion.tokens >= deps.config.maxTokensSesion) {
        respuesta = "Esta sesión alcanzó su tope de tokens. Reinicia la demo para empezar una nueva."
        sesion.mensajes.push({ rol: "assistant", texto: respuesta, llamadas: [] })
        terminado = true
        break
      }
      const r = await deps.adapter.enviar({ sistema: deps.sistema, mensajes: sesion.mensajes, herramientas: deps.esquemas, permitirHerramientas: true })
      sesion.tokens += r.uso.entrada + r.uso.salida
      sesion.mensajes.push({ rol: "assistant", texto: r.texto, llamadas: r.llamadas })
      if (r.llamadas.length === 0) { respuesta = r.texto; terminado = true; break }
      const resultados = []
      for (const ll of r.llamadas) {
        const { evento, crudo } = await ejecutar(ll, sesion, deps)
        toolCalls.push(evento)
        // El modelo recibe el resultado completo; la UI, uno recortado.
        resultados.push({ id: ll.id, nombre: ll.nombre, contenido: crudo })
      }
      sesion.mensajes.push({ rol: "tool", resultados })
    }
    if (!terminado) respuesta = await cerrarPorTope(sesion, deps)
  } catch (e) {
    const detalle = e instanceof ErrorLLM ? e.message : "Ocurrió un error inesperado en el servidor."
    respuesta = `⚠️ ${detalle} La sesión sigue activa: puedes reintentar tu mensaje.`
    sesion.mensajes.push({ rol: "assistant", texto: respuesta, llamadas: [] })
  }
  const turno: Turno = {
    ts: new Date().toISOString(), usuario: mensajeUsuario, respuesta, toolCalls,
    needsConfirmation: Object.keys(sesion.pendientes).length > 0,
  }
  sesion.turnos.push(turno)
  return turno
}
