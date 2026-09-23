# SOLUCION.md · Reto 02 · Agente "Registro de Contratos Vigentes"

Autora: Juana Isabel Palmera Ortega · Proceso de selección Periferia IT Group (Líder de Ingeniería de Calidad)

## 1. Problema en una frase

El maestro de contratos vigentes está congelado desde el 2026-05-30 porque no existe un punto único de recepción: a administración solo llegan los contratos con póliza y la persona que los cargaba ya no está. Le duele a la analista administrativa (dueña del maestro), a finanzas (no puede facturar ni alertar vencimientos con datos completos) y a la compañía (contratos vencidos o sin póliza que nadie ve).

## 2. Arquitectura

```
 Navegador (web/index.html, HTML plano)
        │  POST /api/chat {sessionId, message}
        ▼
 src/server.ts  ── API HTTP nativa, clave de acceso, rate limit, estáticos
        │
        ▼
 src/agent/loop.ts ── ciclo del agente (tope de iteraciones, confirmación humana)
     │        ▲
     │        └── src/llm/adapter.ts ← anthropic.ts   (único lugar que conoce al proveedor)
     ▼
 src/tools/contratos.ts ── leer_buzon · extraer · validar · registrar · alertas
     │   (cada export → contratos_<export>, args validados con zod, nunca lanzan)
     ▼
 fixtures/ (solo lectura)  →  out/sharepoint/{maestro-contratos.csv, Contratos/<año>/<cliente>/…}
                              out/{historial.jsonl, log.jsonl, alertas.md, sessions/}
```

| Qué | Dónde vive |
|---|---|
| **Comportamiento** (reglas del agente, formato de respuesta) | `agent/prompt.md` |
| **Conocimiento** del proceso (clasificación, pólizas, alertas, archivo) | `src/knowledge/registro-contratos.md` |
| **Ejecución** (extracción, validación, escritura) | `src/tools/` |

El system prompt se arma en cada turno concatenando prompt + conocimiento (`src/agent/sistema.ts`): cambiar una regla de negocio no toca el servidor ni exige reiniciarlo.

## 3. Ciclo del agente

- **Bucle** (`src/agent/loop.ts`): envía historial + esquemas de herramientas al modelo; si responde con llamadas a herramientas las ejecuta, devuelve los resultados y repite; si responde con texto, termina el turno.
- **Tope de iteraciones (CA1)**: `MAX_ITERATIONS` (25). Al alcanzarlo, se hace una última llamada **sin herramientas** para que el agente cierre con lo hecho y lo pendiente. También hay tope de tokens por sesión (`MAX_TOKENS_SESSION`) y rate limit por IP.
- **Confirmación humana (CA3)** en dos capas: (1) `contratos_registrar` rechaza contratos con campos en `requiere_revision` si no llega `confirmado=true`; (2) el ciclo **bloquea por código** un `confirmado=true` en el mismo turno en que se detectó la revisión: el modelo no puede confirmarse a sí mismo, hace falta un mensaje nuevo del usuario. Test: `CA3: el modelo no puede confirmar…`.
- **Errores (CA5)**: un error de herramienta vuelve al modelo como `{ ok:false, error }`; un error o timeout del proveedor se muestra en claro y la sesión sigue viva.
- **Visibilidad (CA4)**: cada llamada aparece en el chat (nombre, argumentos, resultado, ms) y en `out/log.jsonl`. El front resalta con banner ámbar cuando espera confirmación.

## 4. Elección del modelo

- **Proveedor y modelo:** Anthropic, `claude-sonnet-5` (configurable con `LLM_MODEL`).
- **Por qué:** el modelo solo orquesta (elige herramientas, resume y pregunta); la extracción y las reglas son código determinista. Para ese trabajo basta un modelo de gama media con buen uso de herramientas; uno mayor no mejora la exactitud de los datos porque no son los que los producen. Es también el proveedor con el que trabajo a diario.
- **Costo por caso (estimación, no medición):** una corrida completa del buzón usa del orden de 8–12 llamadas al modelo con un contexto que crece hasta unos pocos miles de tokens (prompt + conocimiento ≈ 2–3k tokens, más resultados JSON de herramientas). Cuadra en decenas de miles de tokens de entrada y pocos miles de salida por 6 mensajes, es decir unos pocos miles de tokens por caso. **No la medí con la API real**; el costo en dinero sale de multiplicar por la tarifa vigente del modelo, y conviene verificarla en la consola del proveedor. `MAX_TOKENS_SESSION` acota el peor caso.

## 5. Estrategia de extracción

- **Sin modelo, con reglas** (`src/tools/lib/extraccion.ts`): partes (razón social y NIT/RUC del bloque de contratante, país por ciudad o palabras clave), objeto (recortado a 200 caracteres en límite de palabra), valor y moneda (COP/USD con distintos separadores decimales; una moneda no soportada es error de negocio), plazo (fechas explícitas, o firma + meses), póliza (requiere / tipos / estado; contrato marco con póliza por orden de servicio).
- **Confianza por campo:** no es una probabilidad de modelo sino una regla explícita: 0.95 para dato literal con formato inequívoco; 0.85–0.9 para dato normalizado o inferido con poco margen; **≤ 0.6** cuando se deriva (fecha fin = firma + meses) o el documento dice "por demanda" / valor indeterminado; 0 si no aparece (queda `null`, nunca se inventa). Menos de 0.8 → `requiere_revision` (RN5).
- **Dónde entra el modelo:** orquestar el flujo, explicar en lenguaje natural lo que devolvieron las herramientas, redactar la pregunta de confirmación y proponer correcciones que **el humano confirma**. **Dónde no entra:** ningún valor registrado sale del modelo, sale de la herramienta; el prompt prohíbe afirmar datos que no vengan de una herramienta (CA2) y el contenido de correos y contratos se trata como información, no como instrucciones (prompt injection).
- **Dedupe:** por `id_contrato`; sin id, por `nit_cliente` + similitud de objeto ≥ 0.9 (coeficiente de Dice sobre bigramas), como pide RN2. El NIT se compara antes que el nombre para evitar falsos duplicados por variaciones de razón social.

## 6. Regla de gobierno (propuesta)

1. **Canal único.** Buzón `contratos@<dominio-periferia>` (dirección por definir con TI). **Dueña del buzón y del maestro:** la analista administrativa; su suplente, definido por la Gerencia Administrativa. Si no hay área legal, esa es la respuesta a la pregunta abierta del PRD: el maestro tiene dueña nombrada, no queda "de todos".
2. **Obligación del comercial.** Enviar **todo** contrato firmado (no solo los que llevan póliza), sus otrosíes y actas de terminación, en PDF firmado con texto seleccionable, **dentro de 3 días hábiles desde la firma**. Asunto: `[CONTRATO] <Cliente> · <NIT> · <N.º de contrato>` (u `[OTROSÍ]`, `[TERMINACIÓN]`). Un contrato por correo.
3. **Acuse automático.** El agente responde al comercial **en menos de 15 minutos**: recibido y clasificado (nuevo / actualización / duplicado / rechazado) con el motivo, o "en revisión" con lo que falta. *(Propuesta: hoy el agente responde a la analista en el chat; el envío de acuses requiere conectar un servicio de correo.)*
4. **Excepciones y escalamiento.** Sin firma, sin valor o sin partes identificables → no se registra; el acuse pide el documento correcto. Si en 2 días hábiles no llega, se escala al gerente comercial de la región. Contratos con valor por demanda o plazo derivado quedan en revisión hasta que la analista confirma con el comercial.
5. **Cierre del gap jun–ago 2026.** Campaña única de 2 semanas: la analista pide a cada comercial la lista de contratos firmados entre el 2026-05-31 y el 2026-08-31, se cruza con facturación y órdenes de servicio del período, y los contratos se cargan en lote por el mismo buzón (el agente procesa el lote como cualquier otro). Se cierra con un reporte de contratos facturados sin registro.
6. **Indicador mensual.** **% de contratos con facturación en el mes que existen en el maestro** (meta ≥ 95 %), acompañado del tiempo mediano entre firma y registro (meta ≤ 3 días hábiles). Si el indicador cae, el proceso está muerto aunque el agente funcione.

## 7. Decisiones y trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Extracción **determinista** en las herramientas; el modelo orquesta | Que el LLM extraiga los campos con un prompt | Para valor, fechas y NIT importa más la reproducibilidad y poder testear que la flexibilidad; el riesgo de que el modelo "redondee" o infiera (PRD §10) desaparece. Costo: solo cubre las plantillas de los fixtures; en producción (contratos con otros formatos, escaneos) haría falta un extractor con modelo **detrás de la misma verificación de confianza**. |
| Confirmación humana **forzada en código** (bloqueo de auto-confirmación) | Confiar en que el prompt diga "pregunta antes de registrar" | Un prompt se puede ignorar o inyectar desde un correo; una regla en el ciclo, no. Costo: un turno más de conversación aunque el modelo tenga razón. |
| Servidor HTTP nativo de Node y front en HTML plano | Express/Fastify + React | Menos dependencias, arranque en segundos, superficie de ataque menor y cada línea explicable. Costo: routing y estáticos a mano; sin streaming (respuesta por turno completo). |
| Adaptador de LLM propio con un solo proveedor implementado | SDK oficial del proveedor / capa multi-proveedor | Un `fetch` con timeout y errores legibles cubre lo que se necesita y aísla el proveedor detrás de una interfaz. Costo: no hay streaming ni reintentos; agregar OpenAI es escribir un archivo más. |
| Maestro en **CSV** dentro de `out/sharepoint/` con parser propio | SQLite | El PRD define el maestro como CSV y el resultado tiene que poder abrirse en Excel. Costo: sin transacciones; se saneó el formulario CSV (`=`, `+`, `-`, `@`) al escribir. |
| `modulo/` **generado** por script y verificado con test | Carpeta copiada a mano o symlinks | Garantiza "las mismas piezas, no copias divergentes" y sobrevive a un zip; el test falla si se desincroniza. |
| `zod` 3 con conversor propio a JSON Schema | zod 4 (`z.toJSONSchema`) o `zod-to-json-schema` | Verifiqué el código contra zod 3.23; el conversor cubre los tipos usados y está probado. Costo: hay que ampliarlo si se usan tipos nuevos. |

## 8. Supuestos

- Los contratos llegan como texto (PDF con texto o `.txt` en los fixtures); el adjunto se detecta por su contenido (primera línea), no por el nombre del archivo. `contratos_leer_pdf` (P1) no se implementó.
- La **fecha de corte** del maestro es 2026-05-30; "vencen pronto" = ≤ 60 días desde la fecha de hoy indicada por la analista; los "registrados desde el corte" se cuentan por fecha de registro.
- Un remitente que no está en `comerciales.json` (caso `msg-006`) se reporta como advertencia pero no bloquea el registro.
- En `msg-006` el agente marca en revisión `valor`, `fecha_fin` **y `fecha_inicio`** (esta última se deriva del correo, no del contrato): un campo más que el ejemplo del PRD, por prudencia.
- Sesiones y salida (`out/`) son compartidas por instancia: pensado para una demo con una analista, no para varios usuarios simultáneos.
- El acuse automático al comercial (punto 3 de la regla de gobierno) es propuesta, no implementación.

## 9. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer el buzón | Hecho (fixtures locales) | Conector real a correo (Graph/IMAP), lectura de PDF y OCR para escaneos |
| HU-2 Extraer datos | Hecho (reglas para las plantillas de los fixtures) | Extractor con modelo para formatos nuevos, con la misma verificación de confianza |
| HU-3 Validar y clasificar | Hecho (RN1–RN5) | Umbrales de similitud calibrados con datos reales |
| HU-4 Registrar y archivar | Hecho (CSV + carpetas locales, versionado de otrosíes) | Escritura a SharePoint/base de datos con transacciones y control de concurrencia |
| HU-5 Alertar | Hecho (`out/alertas.md`) | Envío programado por correo/Teams |
| HU-6 Errores | Hecho (errores tipados, tests de caso malo) | Métricas y alertas operativas |
| Bonus `modulo/` | Hecho (generado + test de sincronía) | Probarlo dentro de una plataforma de agentes real |
| Despliegue | Dockerfile y `render.yaml` listos; **URL pendiente de completar en el README** | — |

**Verificación:** 24 tests pasan (herramientas, ciclo del agente con modelo simulado, API, módulo), `tsc --noEmit` sin errores y `demo.ts` reproduce la tabla de casos del PRD §7.4. **No pude ejecutar el flujo contra la API real de Anthropic desde el entorno de desarrollo (sin red)**: el ciclo se probó con un adaptador simulado que devuelve respuestas guionadas; la primera prueba con clave real es lo primero que hay que hacer tras desplegar.

## 10. Uso de IA

- **Claude (Anthropic)** como asistente de desarrollo en toda la construcción: lectura del PRD y los fixtures, diseño de la arquitectura, escritura de código y de tests, revisión visual del front y redacción de este documento. Yo definí el alcance (Reto 02), revisé y acepté las decisiones y puedo explicar cada módulo.
- **Bugs que la propia revisión y las pruebas encontraron en lo generado:** una expresión regular de otrosí que coincidía con "OTROSÍES"; una actualización por otrosí que borraba el tipo de póliza existente; un objeto truncado a mitad de palabra; el servidor estático que devolvía el HTML como JSON de un Buffer (los tests solo miraban el status; ahora comprueban el contenido); y la generación del JSON Schema de las herramientas, que dependía de una API de zod 4 que no estaba en la versión probada.
- **Descartado de lo propuesto:** usar el modelo para extraer los valores (por el riesgo de que redondee o infiera) y delegar la confirmación humana solo al prompt (por la posibilidad de inyección).

## 11. Riesgos de producción y mitigación

| Riesgo | Mitigación |
|---|---|
| Contratos escaneados o con formatos distintos a los fixtures | OCR + extractor con modelo detrás de la verificación de confianza y la confirmación humana; corpus de prueba real |
| Inyección de instrucciones desde correos o contratos | Contenido tratado como dato (prompt), herramientas sin shell ni rutas libres (path traversal probado en tests), única herramienta de escritura, confirmación forzada en código |
| Falsos duplicados o actualizaciones erróneas | Dedupe por NIT antes que por nombre, historial de cambios auditable, revisión humana en actualizaciones dudosas |
| Costo descontrolado / abuso del link | Topes de iteraciones y tokens, rate limit, `ACCESS_KEY`, alertas de gasto en la consola del proveedor |
| Concurrencia y pérdida de datos (CSV, disco efímero) | Base de datos o SharePoint con control de versión; backups; una cola por buzón |
| Datos personales y confidencialidad de contratos | Sin datos reales en el repo; en producción, cifrado, control de acceso por rol y retención definida con Legal/Seguridad |
| Un solo proveedor de modelo | Adaptador ya aislado; segunda implementación y prueba de regresión con `demo.ts` |
| El proceso no se usa | La regla de gobierno con dueña, plazo e indicador mensual (sección 6) |
