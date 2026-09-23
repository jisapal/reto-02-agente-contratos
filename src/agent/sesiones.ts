import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { MensajeLLM } from "../llm/adapter"

export type EventoTool = {
  id: string
  nombre: string
  args: unknown
  ok: boolean
  bloqueado: boolean
  resumen: string
  resultado: string
  ms: number
}

export type Turno = {
  ts: string
  usuario: string
  respuesta: string
  toolCalls: EventoTool[]
  needsConfirmation: boolean
}

export type Pendiente = { turno: number; campos: string[] }

export type Sesion = {
  id: string
  creada: string
  mensajes: MensajeLLM[]
  turnos: Turno[]
  /** mensaje_id → campos en revisión aún sin confirmar. Vacío = nada esperando al usuario. */
  pendientes: Record<string, Pendiente>
  turno: number
  tokens: number
  ocupada: boolean
}

export const ID_SESION = /^[A-Za-z0-9_-]{1,64}$/
const MAX_SESIONES = 200

export class AlmacenSesiones {
  private readonly sesiones = new Map<string, Sesion>()
  constructor(private readonly directory: string) {}

  obtenerOCrear(id: string): Sesion {
    const existente = this.sesiones.get(id)
    if (existente) return existente
    if (this.sesiones.size >= MAX_SESIONES) {
      const masVieja = this.sesiones.keys().next().value
      if (masVieja !== undefined) this.sesiones.delete(masVieja)
    }
    const nueva: Sesion = { id, creada: new Date().toISOString(), mensajes: [], turnos: [], pendientes: {}, turno: 0, tokens: 0, ocupada: false }
    this.sesiones.set(id, nueva)
    return nueva
  }

  /** Historial completo: de memoria si está, y si no del archivo que se guarda en out/sessions/. */
  historial(id: string): Pick<Sesion, "id" | "creada" | "turnos" | "tokens" | "pendientes"> | null {
    const s = this.sesiones.get(id)
    if (s) return { id: s.id, creada: s.creada, turnos: s.turnos, tokens: s.tokens, pendientes: s.pendientes }
    const ruta = join(this.directory, "out", "sessions", `${id}.json`)
    return existsSync(ruta) ? (JSON.parse(readFileSync(ruta, "utf8")) as ReturnType<AlmacenSesiones["historial"]>) : null
  }

  persistir(s: Sesion): void {
    try {
      const carpeta = join(this.directory, "out", "sessions")
      mkdirSync(carpeta, { recursive: true })
      const { id, creada, turnos, tokens, pendientes } = s
      writeFileSync(join(carpeta, `${id}.json`), JSON.stringify({ id, creada, turnos, tokens, pendientes }))
    } catch { /* la persistencia es opcional: la sesión sigue en memoria */ }
  }

  limpiar(): void {
    this.sesiones.clear()
  }
}
