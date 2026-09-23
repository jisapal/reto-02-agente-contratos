import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import { timingSafeEqual } from "node:crypto"
import { dirname, extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { cargarConfig, type Config } from "./agent/config"
import { cargarHerramientas, esquemasParaLLM } from "./agent/herramientas"
import { correrTurno } from "./agent/loop"
import { AlmacenSesiones, ID_SESION } from "./agent/sesiones"
import { construirSistema } from "./agent/sistema"
import type { AdaptadorLLM, EsquemaHerramienta } from "./llm/adapter"
import { crearAdaptador } from "./llm"
import { asegurarSalida, leerMaestro, reiniciarSalida, rutas } from "./tools/lib/almacen"
import type { Herramienta } from "./tools/lib/herramienta"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const MAX_CUERPO = 64 * 1024
const MAX_MENSAJE = 2000

const CuerpoChat = z.object({
  sessionId: z.string().regex(ID_SESION, "sessionId inválido"),
  message: z.string().trim().min(1, "El mensaje está vacío").max(MAX_MENSAJE, `El mensaje supera ${MAX_MENSAJE} caracteres`),
})

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8",
}

export type DepsServidor = {
  config: Config
  adapter: AdaptadorLLM
  directory?: string
  herramientas?: Map<string, Herramienta>
  esquemas?: EsquemaHerramienta[]
}

function responder(res: ServerResponse, estado: number, cuerpo: unknown, tipo = "application/json; charset=utf-8"): void {
  const texto = typeof cuerpo === "string" || Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo)
  res.writeHead(estado, { "content-type": tipo, "x-content-type-options": "nosniff", "cache-control": "no-store" })
  res.end(texto)
}

async function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = []
  let total = 0
  for await (const parte of req) {
    total += (parte as Buffer).length
    if (total > MAX_CUERPO) throw new Error("cuerpo demasiado grande")
    partes.push(parte as Buffer)
  }
  return partes.length ? JSON.parse(Buffer.concat(partes).toString("utf8")) : {}
}

function claveValida(recibida: string | undefined, esperada: string): boolean {
  const a = Buffer.from(recibida ?? "")
  const b = Buffer.from(esperada)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function crearServidor(deps: DepsServidor): Server {
  const { config, adapter } = deps
  const directory = deps.directory ?? RAIZ
  const herramientas = deps.herramientas ?? cargarHerramientas()
  let esquemas = deps.esquemas
  const sesiones = new AlmacenSesiones(directory)
  const ventanas = new Map<string, number[]>()
  asegurarSalida(directory)

  const excedeLimite = (ip: string): boolean => {
    const ahora = Date.now()
    const recientes = (ventanas.get(ip) ?? []).filter((t) => ahora - t < 60_000)
    recientes.push(ahora)
    ventanas.set(ip, recientes)
    return recientes.length > config.limitePorMinuto
  }

  async function chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.socket.remoteAddress ?? "?").trim()
    if (excedeLimite(ip)) return responder(res, 429, { error: "Demasiadas solicitudes. Espera un minuto." })
    const parsed = CuerpoChat.safeParse(await leerCuerpo(req).catch(() => null))
    if (!parsed.success) return responder(res, 400, { error: parsed.error.issues.map((i) => i.message).join("; ") })
    const sesion = sesiones.obtenerOCrear(parsed.data.sessionId)
    if (sesion.ocupada) return responder(res, 409, { error: "La sesión está procesando un mensaje. Espera la respuesta." })
    sesion.ocupada = true
    try {
      esquemas ??= esquemasParaLLM(herramientas)
      const turno = await correrTurno(sesion, parsed.data.message, {
        adapter, herramientas, esquemas, directory, config, sistema: construirSistema(directory),
      })
      sesiones.persistir(sesion)
      responder(res, 200, { reply: turno.respuesta, toolCalls: turno.toolCalls, needsConfirmation: turno.needsConfirmation, tokens: sesion.tokens })
    } finally {
      sesion.ocupada = false
    }
  }

  function estatico(ruta: string, res: ServerResponse): void {
    const relativa = ruta === "/" ? "index.html" : normalize(ruta).replace(/^([/\\])+/, "")
    const archivo = join(RAIZ, "web", relativa)
    if (relativa.includes("..") || !archivo.startsWith(join(RAIZ, "web")) || !existsSync(archivo)) {
      return responder(res, 404, { error: "No encontrado" })
    }
    responder(res, 200, readFileSync(archivo), MIME[extname(archivo)] ?? "application/octet-stream")
  }

  async function api(req: IncomingMessage, res: ServerResponse, ruta: string): Promise<void> {
    if (req.method === "GET" && ruta === "/api/health") {
      return responder(res, 200, { ok: true, provider: adapter.proveedor, model: adapter.modelo, protegido: config.accessKey !== "" })
    }
    if (config.accessKey && !claveValida(req.headers["x-access-key"]?.toString(), config.accessKey)) {
      return responder(res, 401, { error: "Clave de acceso requerida" })
    }
    if (req.method === "POST" && ruta === "/api/chat") return chat(req, res)
    if (req.method === "POST" && ruta === "/api/reset") {
      reiniciarSalida(directory)
      sesiones.limpiar()
      return responder(res, 200, { ok: true })
    }
    if (req.method === "GET" && ruta === "/api/maestro") return responder(res, 200, { filas: leerMaestro(directory) })
    if (req.method === "GET" && ruta === "/api/alertas") {
      const archivo = rutas(directory).alertas
      return responder(res, 200, existsSync(archivo) ? readFileSync(archivo, "utf8") : "_Aún no se generó el reporte de alertas._", "text/markdown; charset=utf-8")
    }
    const sesion = /^\/api\/sessions\/([^/]+)$/.exec(ruta)
    if (req.method === "GET" && sesion?.[1]) {
      const historial = ID_SESION.test(sesion[1]) ? sesiones.historial(sesion[1]) : null
      return historial ? responder(res, 200, historial) : responder(res, 404, { error: "Sesión no encontrada" })
    }
    return responder(res, 404, { error: "Ruta no encontrada" })
  }

  return createServer((req, res) => {
    const ruta = new URL(req.url ?? "/", "http://localhost").pathname
    const tarea = ruta.startsWith("/api/") ? api(req, res, ruta) : Promise.resolve(estatico(ruta, res))
    tarea.catch(() => responder(res, 500, { error: "Error interno del servidor" }))
  })
}

function iniciar(): void {
  try { process.loadEnvFile(join(RAIZ, ".env")) } catch { /* sin .env: se usan las variables del entorno */ }
  const config = cargarConfig()
  const servidor = crearServidor({ config, adapter: crearAdaptador(config) })
  servidor.listen(config.puerto, () => {
    console.log(`Agente de contratos en http://localhost:${config.puerto}  (${config.proveedor} · ${config.modelo})`)
    if (!config.apiKey) console.warn("⚠ Falta ANTHROPIC_API_KEY: el chat responderá con un aviso hasta que la configures.")
  })
}

if (process.argv[1]?.endsWith("server.ts")) iniciar()
