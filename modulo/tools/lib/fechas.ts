const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

/** Devuelve YYYY-MM-DD si la fecha existe en el calendario; null si no. */
export function aIso(anio: number, mes: number, dia: number): string | null {
  const f = new Date(Date.UTC(anio, mes - 1, dia))
  const valida = f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia
  return valida ? f.toISOString().slice(0, 10) : null
}

export function esFechaIso(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m !== null && aIso(Number(m[1]), Number(m[2]), Number(m[3])) !== null
}

function partes(iso: string): [number, number, number] {
  const [a, m, d] = iso.split("-").map(Number)
  return [a ?? 0, m ?? 0, d ?? 0]
}

export function ultimoDiaMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

/** Suma meses conservando el día (recortado al último día del mes destino). */
export function sumarMeses(iso: string, n: number): string {
  const [a, m, d] = partes(iso)
  const total = a * 12 + (m - 1) + n
  const anio = Math.floor(total / 12)
  const mes = (total % 12) + 1
  return aIso(anio, mes, Math.min(d, ultimoDiaMes(anio, mes))) ?? iso
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000)
}

/** Fechas del estilo "primero (1) de agosto de 2026". Las inexistentes se reportan como errores. */
export function extraerFechas(texto: string): { fechas: string[]; errores: string[] } {
  const fechas: string[] = []
  const errores: string[] = []
  const re = /\((\d{1,2})\)\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/gi
  for (const m of texto.matchAll(re)) {
    const mes = MESES[(m[2] ?? "").toLowerCase()]
    const iso = mes ? aIso(Number(m[3]), mes, Number(m[1])) : null
    if (iso) fechas.push(iso)
    else errores.push(m[0])
  }
  return { fechas, errores }
}

export type FirmaContrato = { iso: string | null; mes?: { anio: number; mes: number } }

/** Fecha de firma: completa ("a los treinta (30) días del mes de julio de 2026") o solo mes/año. */
export function fechaFirma(texto: string): FirmaContrato {
  const completa = /\((\d{1,2})\)\s+d[ií]as?\s+del?\s+mes\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i.exec(texto)
  if (completa) {
    const mes = MESES[(completa[2] ?? "").toLowerCase()]
    const iso = mes ? aIso(Number(completa[3]), mes, Number(completa[1])) : null
    if (iso) return { iso }
  }
  const parcial = /en\s+el\s+mes\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i.exec(texto)
  const mes = parcial ? MESES[(parcial[1] ?? "").toLowerCase()] : undefined
  if (parcial && mes) return { iso: null, mes: { anio: Number(parcial[2]), mes } }
  return { iso: null }
}
