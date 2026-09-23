import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Proyecto temporal con una copia de fixtures/: cada prueba trabaja aislada. */
export function proyectoTemporal(): string {
  const dir = mkdtempSync(join(tmpdir(), "reto02-"))
  cpSync(join(RAIZ, "fixtures"), join(dir, "fixtures"), { recursive: true })
  cpSync(join(RAIZ, "agent"), join(dir, "agent"), { recursive: true })
  cpSync(join(RAIZ, "src", "knowledge"), join(dir, "src", "knowledge"), { recursive: true })
  return dir
}

export function agregarMensaje(dir: string, id: string, correo: object, adjuntos: Record<string, string>): void {
  const carpeta = join(dir, "fixtures", "reto-02", "buzon", id)
  mkdirSync(carpeta, { recursive: true })
  writeFileSync(join(carpeta, "correo.json"), JSON.stringify({ id, de: "lgomez@periferia-ficticia.com", para: "contratos@periferia-ficticia.com", asunto: "prueba", fecha: "2026-09-01T10:00:00-05:00", cuerpo: "", adjuntos: Object.keys(adjuntos), ...correo }))
  for (const [nombre, texto] of Object.entries(adjuntos)) writeFileSync(join(carpeta, nombre), texto)
}

export type Resp = { ok: boolean; data?: any; error?: string }

export async function llamar(
  herramienta: { execute: (a: unknown, c: { directory: string; sessionId: string }) => Promise<string> },
  dir: string, args: object = {},
): Promise<Resp> {
  return JSON.parse(await herramienta.execute(args, { directory: dir, sessionId: "test" })) as Resp
}
