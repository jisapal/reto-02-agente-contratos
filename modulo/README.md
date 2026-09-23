# Módulo reutilizable: agente de registro de contratos

Archivo generado por `npm run build:modulo`; no se edita a mano (se edita en `agent/` y `src/`).

- `agent.md`: system prompt (comportamiento). Permisos: `edit: deny`, `bash: deny`.
- `skill/registro-contratos/SKILL.md`: conocimiento del proceso.
- `tools/contratos.ts`: cada export se publica como `contratos_<export>` (leer_buzon, extraer, validar, registrar, alertas).

Uso de las herramientas sin servidor: `await tool.execute(args, { directory, sessionId })` devuelve un string JSON `{ ok, data | error }`.
La carpeta de trabajo (`directory`) contiene `fixtures/reto-02/` y es donde se escribe `out/`. Única dependencia: `zod` (^3.23).
