import { extraerFechas, fechaFirma, sumarMeses, ultimoDiaMes, aIso } from "./fechas"
import { tituloRazonSocial } from "./texto"
import {
  CAMPOS_CONTRATO, ErrorNegocio, MONEDAS, type CampoContrato, type Contrato,
} from "./tipos"

type Pais = NonNullable<Contrato["pais"]>

const PAIS_POR_PALABRA: [RegExp, Pais][] = [
  [/ecuador|quito|guayaquil/i, "EC"],
  [/per[uú](?![a-z])|\blima\b/i, "PE"],
  [/panam[aá]/i, "PA"],
  [/honduras|tegucigalpa|san pedro sula/i, "HN"],
  [/colombia|bogot[aá]|medell[ií]n|barranquilla|\bcali\b|cartagena/i, "CO"],
]

const TIPOS_POLIZA: [RegExp, string][] = [
  [/cumplimiento/i, "cumplimiento"],
  [/calidad/i, "calidad"],
  [/salarios|prestaciones/i, "salarios_prestaciones"],
  [/responsabilidad civil/i, "responsabilidad_civil"],
  [/buen manejo|anticipo/i, "buen_manejo_anticipo"],
]

function contratoVacio(esOtrosi: boolean): Contrato {
  return {
    id_contrato: null, cliente: null, nit_cliente: null, pais: null, objeto: null,
    valor: null, valor_indeterminado: false, moneda: null, fecha_inicio: null, fecha_fin: null,
    requiere_poliza: null, tipo_poliza: [], estado_poliza: null, es_otrosi: esOtrosi, notas: [],
    confianza: Object.fromEntries(CAMPOS_CONTRATO.map((c) => [c, 0])),
  }
}

function fijar<K extends CampoContrato>(c: Contrato, campo: K, valor: Contrato[K], confianza: number): void {
  c[campo] = valor
  c.confianza[campo] = confianza
}

function parrafos(texto: string): string[] {
  return texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

/** Párrafo de una cláusula: "SEGUNDA. VALOR. …" en contratos, "…cláusula SEGUNDA (VALOR)…" en otrosíes. */
function clausula(texto: string, nombre: string): string | undefined {
  const encabezado = new RegExp(`^[\\wÁÉÍÓÚ]+\\.\\s*${nombre}\\.`, "i")
  const referencia = new RegExp(`\\(${nombre}\\)`, "i")
  return parrafos(texto).find((p) => encabezado.test(p) || referencia.test(p))
}

function aplicarId(texto: string, c: Contrato): void {
  const m = /\bNo\.?\s*([A-Z]{1,4}-[A-Z0-9]+(?:-[A-Z0-9]+)*)/.exec(texto)
  if (m?.[1]) fijar(c, "id_contrato", m[1], 1)
  else c.confianza["id_contrato"] = 0.6
}

const RE_PARTE = /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .&-]{2,}?),\s*(?:identificad[oa] con\s+)?(NIT|RUC)\s+([\d.-]+)/g

function normalizarIdentificador(bruto: string): string {
  const sinPuntos = bruto.replace(/\.+$/, "").replace(/\./g, "")
  return /^\d{9}-\d$/.test(sinPuntos) ? sinPuntos.slice(0, 9) : sinPuntos.replace(/-/g, "")
}

function detectarPais(zona: string, tipoId: string): [Pais | null, number] {
  for (const [re, pais] of PAIS_POR_PALABRA) if (re.test(zona)) return [pais, 0.95]
  return tipoId === "NIT" ? ["CO", 0.75] : [null, 0]
}

function aplicarContraparte(texto: string, c: Contrato): void {
  const partes = [...texto.matchAll(RE_PARTE)]
  const parte = partes.find((m) => !/PERIFERIA/i.test(m[1] ?? ""))
  if (!parte || parte.index === undefined) return
  fijar(c, "cliente", tituloRazonSocial(parte[1] ?? ""), 0.95)
  fijar(c, "nit_cliente", normalizarIdentificador(parte[3] ?? ""), 0.95)
  const resto = texto.slice(parte.index)
  const hasta = resto.search(/PERIFERIA/i)
  const zona = resto.slice(0, hasta > 0 ? hasta : 300)
  const [pais, conf] = detectarPais(zona, parte[2] ?? "")
  fijar(c, "pais", pais, conf)
}

function aplicarObjeto(texto: string, c: Contrato): void {
  const p = clausula(texto, "OBJETO")
  if (!p) return
  const cuerpo = p.replace(/^[\wÁÉÍÓÚ]+\.\s*OBJETO\.\s*/i, "")
  const limpio = cuerpo.replace(/^EL CONTRATISTA\s+(?:se obliga a\s+(?:ejecutar\s+)?|prestará\s+(?:el\s+)?)/i, "")
  const capitalizado = limpio.charAt(0).toUpperCase() + limpio.slice(1)
  const objeto = capitalizado.length <= 200 ? capitalizado : `${capitalizado.slice(0, 199).replace(/\s+\S*$/, "")}…`
  fijar(c, "objeto", objeto, 0.9)
}

function parseMonto(s: string): number | null {
  const t = s.replace(/[.,]$/, "")
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."))
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ""))
  if (/^\d+([.,]\d{1,2})?$/.test(t)) return Number(t.replace(",", "."))
  return null
}

type Moneda = (typeof MONEDAS)[number]

function esMonedaConocida(m: string): m is Moneda {
  return (MONEDAS as readonly string[]).includes(m)
}

function aplicarValor(texto: string, c: Contrato): void {
  const p = clausula(texto, "VALOR")
  if (!p) return
  for (const m of p.matchAll(/\(([A-Z]{3})\s*\$?\s*(\d[\d.,]*)\)/g)) {
    const moneda = m[1] ?? ""
    if (!esMonedaConocida(moneda)) throw new ErrorNegocio(`Moneda desconocida "${moneda}" en la cláusula de valor`)
    const valor = parseMonto(m[2] ?? "")
    if (valor === null) throw new ErrorNegocio(`Valor no interpretable: "${m[2]}"`)
    fijar(c, "valor", valor, 0.95)
    fijar(c, "moneda", moneda, 0.95)
    return
  }
  if (/no tiene un valor determinad|valor indeterminado|por demanda/i.test(p)) {
    fijar(c, "valor", 0, 0.5)
    c.valor_indeterminado = true
    c.notas.push("Contrato sin valor determinado (por demanda / órdenes de servicio): se propone valor 0, requiere confirmación.")
    const otra = /\((COP|USD|PEN|PAB|HNL)\s*\$?\s*\d[\d.,]*\)/.exec(texto)
    if (otra?.[1] && esMonedaConocida(otra[1])) {
      fijar(c, "moneda", otra[1], 0.85)
      c.notas.push(`Moneda ${otra[1]} inferida de otra cláusula del mismo documento (no de la de valor).`)
    }
  }
}

function derivarPorMeses(texto: string, c: Contrato, meses: number, fechaCorreo: string | undefined): void {
  const firma = fechaFirma(texto)
  let inicio: string | null = firma.iso
  let confInicio = 0.9
  if (!inicio && firma.mes) {
    const { anio, mes } = firma.mes
    const prefijo = `${anio}-${String(mes).padStart(2, "0")}`
    const usaCorreo = fechaCorreo?.startsWith(prefijo) === true
    inicio = usaCorreo ? (fechaCorreo ?? null) : aIso(anio, mes, ultimoDiaMes(anio, mes))
    confInicio = usaCorreo ? 0.6 : 0.5
    c.notas.push(`La firma solo indica mes y año (${prefijo}): se asumió ${inicio} (${usaCorreo ? "fecha del correo" : "último día del mes"}).`)
  }
  if (!inicio) return
  fijar(c, "fecha_inicio", inicio, confInicio)
  fijar(c, "fecha_fin", sumarMeses(inicio, meses), confInicio >= 0.9 ? 0.85 : 0.5)
  c.notas.push(`Plazo de ${meses} meses contados desde la firma: fecha_fin = fecha_inicio + ${meses} meses.`)
}

function aplicarPlazo(texto: string, c: Contrato, fechaCorreo: string | undefined): void {
  const p = clausula(texto, "PLAZO")
  if (!p) return
  const zona = c.es_otrosi ? (p.split(/quedar[áa]\s+as[ií]:?/i)[1] ?? p) : p
  const { fechas, errores } = extraerFechas(zona)
  if (errores.length > 0) throw new ErrorNegocio(`Fecha inválida en el plazo: ${errores.join("; ")}`)
  const ultima = fechas[fechas.length - 1]
  if (c.es_otrosi) {
    if (ultima) fijar(c, "fecha_fin", ultima, 0.95)
    return
  }
  const [inicio, fin] = fechas
  if (inicio && fin) {
    const coherente = fin > inicio
    fijar(c, "fecha_inicio", inicio, 0.95)
    fijar(c, "fecha_fin", fin, coherente ? 0.95 : 0.4)
    if (!coherente) c.notas.push("La fecha de fin no es posterior a la de inicio.")
    return
  }
  const meses = /\((\d{1,2})\)\s+mes(?:es)?/i.exec(p)
  if (meses?.[1]) derivarPorMeses(texto, c, Number(meses[1]), fechaCorreo)
}

function aplicarPoliza(texto: string, c: Contrato): void {
  const p = parrafos(texto).find((x) => /p[óo]liza/i.test(x))
  if (c.es_otrosi) {
    const garantias = parrafos(texto).find((x) => /p[óo]liza|garant[íi]a/i.test(x))
    if (garantias !== undefined && /ampli/i.test(garantias)) {
      fijar(c, "estado_poliza", "pendiente", 0.9)
      c.notas.push("El otrosí exige ampliar la vigencia de las garantías: la póliza queda pendiente de ampliación.")
    }
    return
  }
  if (!p) {
    fijar(c, "requiere_poliza", false, 0.95)
    fijar(c, "estado_poliza", "no_aplica", 0.95)
    c.confianza["tipo_poliza"] = 0.95
    return
  }
  if (/cada orden de servicio/i.test(p)) {
    fijar(c, "requiere_poliza", false, 0.85)
    fijar(c, "estado_poliza", "no_aplica", 0.85)
    c.confianza["tipo_poliza"] = 0.85
    c.notas.push("La póliza está condicionada a órdenes de servicio individuales: no aplica al contrato marco, se gestiona por orden.")
    return
  }
  fijar(c, "requiere_poliza", true, 0.95)
  fijar(c, "estado_poliza", "pendiente", 0.95)
  const tipos = TIPOS_POLIZA.filter(([re]) => re.test(p)).map(([, t]) => t)
  fijar(c, "tipo_poliza", tipos, tipos.length > 0 ? 0.9 : 0.4)
}

/** Extracción determinista. Lo que no aparece en el texto queda en null con confianza 0 (nunca se inventa). */
export function extraerDeTexto(texto: string, fechaCorreo?: string): Contrato {
  if (texto.trim() === "") throw new ErrorNegocio("El texto del documento está vacío")
  const c = contratoVacio(/^\s*OTROS[ÍI](?![A-Za-zÁÉÍÓÚ])/i.test(texto))
  aplicarId(texto, c)
  aplicarContraparte(texto, c)
  aplicarObjeto(texto, c)
  aplicarValor(texto, c)
  aplicarPlazo(texto, c, fechaCorreo)
  aplicarPoliza(texto, c)
  return c
}
