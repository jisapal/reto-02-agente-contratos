# Registro de contratos vigentes: cómo funciona el proceso

## Por qué existe
El maestro de contratos estuvo congelado desde el **2026-05-30**. Antes solo llegaban a administración los contratos que exigían póliza; no había buzón único ni área legal. Este agente es el punto único de recepción: nada debe quedar fuera del maestro, con o sin póliza.

## Actores
- **Comercial**: cierra el contrato y lo envía al buzón. No usa el agente.
- **Analista administrativa**: dueña del maestro y del seguimiento de pólizas. Conversa con el agente y confirma lo dudoso.
- **Gerencia**: lee el reporte de alertas.

## Clasificación de un mensaje
| Clasificación | Cuándo | Efecto |
|---|---|---|
| `nuevo` | No hay coincidencia en el maestro | Se inserta una fila |
| `actualizacion` | Mismo `id_contrato` (o mismo NIT y objeto con similitud ≥ 0.9) con algún dato distinto, o el documento es un otrosí | Se modifica la fila y se anota en `historial.jsonl` |
| `duplicado` | Mismo `id_contrato` y mismos valor, fecha de inicio y fecha de fin | No se escribe nada; se reporta |
| `rechazado` | Sin contrato adjunto (por ejemplo una cotización), sin partes ni objeto identificables, u otrosí de un contrato que no está en el maestro | No se escribe; se reporta con el motivo |

## Confianza y revisión humana
Cada campo extraído trae una confianza entre 0 y 1. Un campo con confianza **menor a 0.8**, un campo obligatorio ausente o un conflicto con el maestro (por ejemplo, mismo contrato con otro NIT) queda en `requiere_revision`. Con revisión pendiente no se registra hasta que la analista confirme.

Casos típicos de baja confianza:
- **Contrato marco o por demanda** sin valor determinado: el valor propuesto es 0 y debe confirmarse.
- **Plazo en meses sin fechas explícitas**: la fecha de fin se deriva de la firma y del plazo, y debe confirmarse.
- **Firma sin día** (solo mes y año): la fecha de inicio es una suposición.

## Pólizas
- Un contrato nuevo que exige póliza se registra con `estado_poliza = pendiente`; sin póliza, `no_aplica`.
- Un otrosí que amplía plazo o valor de un contrato con póliza deja la póliza en `pendiente` hasta que se amplíe la vigencia.
- Si la póliza se exige por cada orden de servicio (contrato marco), no aplica al contrato marco: se gestiona por orden.
- Estados posibles: `vigente`, `pendiente`, `vencida`, `no_aplica`.

## Remitentes
El correo del comercial se resuelve contra la lista de comerciales. Un remitente desconocido se reporta como advertencia pero no bloquea el registro.

## Alertas
`contratos_alertas` recibe la fecha de referencia (`hoy`) y produce `out/alertas.md` con: contratos que vencen en 60 días o menos, contratos con póliza exigida y estado distinto de vigente, y contratos registrados o actualizados desde el corte del 2026-05-30. También lista los ya vencidos para revisar renovación o cierre.

## Archivo
Cada contrato se guarda en `Contratos/<año de inicio>/<cliente>/<id_contrato>.<ext>`. Los otrosíes se guardan junto al contrato original como `<id_contrato>-otrosi-N.<ext>`.
