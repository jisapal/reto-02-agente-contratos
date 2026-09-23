type Datos = Record<string, unknown>

const texto = (v: unknown): string => (v === null || v === undefined ? "—" : String(v))
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Resumen de una línea de cada herramienta, para mostrar en el chat. */
export function resumirResultado(nombre: string, crudo: string): { ok: boolean; resumen: string } {
  let r: { ok?: boolean; data?: Datos; error?: string }
  try { r = JSON.parse(crudo) as typeof r } catch { return { ok: false, resumen: "respuesta no interpretable" } }
  if (r.ok !== true) return { ok: false, resumen: `error: ${r.error ?? "desconocido"}` }
  const d = r.data ?? {}
  switch (nombre) {
    case "contratos_leer_buzon":
      return { ok: true, resumen: `${texto(d["total_pendientes"])} mensajes pendientes` }
    case "contratos_extraer":
      return { ok: true, resumen: `${texto(d["id_contrato"])} · ${texto(d["cliente"])} · ${texto(d["valor"])} ${texto(d["moneda"])}` }
    case "contratos_validar": {
      const revision = lista(d["requiere_revision"])
      return { ok: true, resumen: `${texto(d["clasificacion"])}${revision.length ? ` · en revisión: ${revision.join(", ")}` : ""}` }
    }
    case "contratos_registrar":
      return { ok: true, resumen: `${texto(d["accion"])} ${texto(d["id_contrato"] ?? "")}`.trim() }
    case "contratos_alertas":
      return { ok: true, resumen: `vencen ${lista(d["vencen"]).length} · pólizas pendientes ${lista(d["polizas_pendientes"]).length} · registrados desde corte ${lista(d["registrados_desde_corte"]).length}` }
    default:
      return { ok: true, resumen: JSON.stringify(d).slice(0, 120) }
  }
}
