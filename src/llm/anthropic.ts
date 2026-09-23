import {
  ErrorLLM, type AdaptadorLLM, type MensajeLLM, type PeticionLLM, type RespuestaLLM,
} from "./adapter"

type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }
type MensajeAnthropic = { role: "user" | "assistant"; content: string | Bloque[] }

type RespuestaAnthropic = {
  content?: Bloque[]
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { message?: string }
}

const MAX_TOKENS_SALIDA = 4096
const MAX_CARACTERES_RESULTADO = 30_000

function aMensajesAnthropic(mensajes: MensajeLLM[]): MensajeAnthropic[] {
  return mensajes.map((m): MensajeAnthropic => {
    if (m.rol === "user") return { role: "user", content: m.texto }
    if (m.rol === "tool") {
      return {
        role: "user",
        content: m.resultados.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.contenido.slice(0, MAX_CARACTERES_RESULTADO) })),
      }
    }
    const bloques: Bloque[] = []
    if (m.texto.trim() !== "") bloques.push({ type: "text", text: m.texto })
    for (const l of m.llamadas) bloques.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.args })
    return { role: "assistant", content: bloques.length > 0 ? bloques : [{ type: "text", text: "(sin texto)" }] }
  })
}

function mensajeDeEstado(estado: number, detalle: string): string {
  if (estado === 401 || estado === 403) return "El servidor no tiene una clave válida para el proveedor de lenguaje (revisa ANTHROPIC_API_KEY)."
  if (estado === 429) return "El proveedor de lenguaje está limitando las solicitudes. Espera unos segundos y reintenta."
  if (estado >= 500) return "El proveedor de lenguaje no está disponible en este momento. Reintenta en un momento."
  return `El proveedor rechazó la solicitud (HTTP ${estado}): ${detalle}`
}

export function crearAnthropic(opciones: { apiKey: string; modelo: string; timeoutMs: number }): AdaptadorLLM {
  return {
    proveedor: "anthropic",
    modelo: opciones.modelo,
    async enviar(p: PeticionLLM): Promise<RespuestaLLM> {
      if (!opciones.apiKey) throw new ErrorLLM("Falta configurar ANTHROPIC_API_KEY en el servidor.")
      const cuerpo = {
        model: opciones.modelo,
        max_tokens: MAX_TOKENS_SALIDA,
        system: p.sistema,
        messages: aMensajesAnthropic(p.mensajes),
        tools: p.herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.parametros })),
        ...(p.permitirHerramientas ? {} : { tool_choice: { type: "none" } }),
      }
      const control = new AbortController()
      const temporizador = setTimeout(() => control.abort(), opciones.timeoutMs)
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": opciones.apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify(cuerpo),
          signal: control.signal,
        })
        const json = (await res.json().catch(() => ({}))) as RespuestaAnthropic
        if (!res.ok) throw new ErrorLLM(mensajeDeEstado(res.status, json.error?.message ?? res.statusText))
        const bloques = json.content ?? []
        return {
          texto: bloques.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim(),
          llamadas: bloques.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, nombre: b.name, args: b.input }] : [])),
          uso: { entrada: json.usage?.input_tokens ?? 0, salida: json.usage?.output_tokens ?? 0 },
        }
      } catch (e) {
        if (e instanceof ErrorLLM) throw e
        if (e instanceof Error && e.name === "AbortError") throw new ErrorLLM(`El proveedor de lenguaje no respondió en ${Math.round(opciones.timeoutMs / 1000)} s (timeout).`)
        throw new ErrorLLM("No se pudo contactar al proveedor de lenguaje. Revisa la conexión del servidor.")
      } finally {
        clearTimeout(temporizador)
      }
    },
  }
}
