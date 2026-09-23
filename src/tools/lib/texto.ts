const PALABRAS_MENORES = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en"])
const SUFIJO_SOCIETARIO = /\s+(S\.?\s*A\.?\s*S\.?|S\.?\s*A\.?\s*C\.?|S\.?\s*A\.?|S\.?\s*de\s*R\.?\s*L\.?|LTDA\.?)\s*$/i

export function sinTildes(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

/** "INDUSTRIAS DELTA S.A.S." → "Industrias Delta S.A.S." */
export function tituloRazonSocial(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .map((palabra, i) => {
      if (palabra.includes(".")) return palabra.toUpperCase()
      const minus = palabra.toLowerCase()
      if (i > 0 && PALABRAS_MENORES.has(minus)) return minus
      return minus.charAt(0).toUpperCase() + minus.slice(1)
    })
    .join(" ")
}

export function slugCliente(cliente: string): string {
  return sinTildes(cliente.replace(SUFIJO_SOCIETARIO, ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function bigramas(s: string): string[] {
  const t = sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  const sal: string[] = []
  for (let i = 0; i < t.length - 1; i++) sal.push(t.slice(i, i + 2))
  return sal
}

/** Coeficiente de Dice sobre bigramas de caracteres, en [0, 1]. */
export function similitud(a: string, b: string): number {
  const x = bigramas(a)
  const y = bigramas(b)
  if (x.length === 0 || y.length === 0) return 0
  const conteo = new Map<string, number>()
  for (const g of x) conteo.set(g, (conteo.get(g) ?? 0) + 1)
  let comunes = 0
  for (const g of y) {
    const n = conteo.get(g) ?? 0
    if (n > 0) {
      comunes++
      conteo.set(g, n - 1)
    }
  }
  return (2 * comunes) / (x.length + y.length)
}
