import { COLUMNAS, type FilaMaestro } from "./tipos"

export function parseCsv(texto: string): string[][] {
  const filas: string[][] = []
  let fila: string[] = []
  let celda = ""
  let entreComillas = false
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]
    if (entreComillas) {
      if (ch === '"' && texto[i + 1] === '"') { celda += '"'; i++ }
      else if (ch === '"') entreComillas = false
      else celda += ch
    } else if (ch === '"') entreComillas = true
    else if (ch === ",") { fila.push(celda); celda = "" }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++
      fila.push(celda); celda = ""
      filas.push(fila); fila = []
    } else celda += ch
  }
  if (celda !== "" || fila.length > 0) { fila.push(celda); filas.push(fila) }
  return filas.filter((f) => f.some((c) => c !== ""))
}

export function csvAFilas(texto: string): FilaMaestro[] {
  const [encabezado, ...cuerpo] = parseCsv(texto)
  if (!encabezado) return []
  return cuerpo.map((valores) => {
    const fila = {} as FilaMaestro
    for (const col of COLUMNAS) fila[col] = valores[encabezado.indexOf(col)] ?? ""
    return fila
  })
}

function celda(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function filasACsv(filas: FilaMaestro[]): string {
  const lineas = [COLUMNAS.join(",")]
  for (const f of filas) lineas.push(COLUMNAS.map((c) => celda(f[c])).join(","))
  return lineas.join("\n") + "\n"
}
