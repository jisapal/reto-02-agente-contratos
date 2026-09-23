# Reto 02 · Agente conversacional "Registro de Contratos Vigentes"

Agente de chat (front + backend + herramientas + LLM) que actúa como punto único de recepción de contratos: lee el buzón, extrae, clasifica (nuevo / actualización / duplicado / rechazado), pide confirmación humana en lo dudoso, registra en el maestro, archiva y genera alertas. El diseño y las decisiones están en [SOLUCION.md](SOLUCION.md).

## Probar

- **Link público:** `<URL del despliegue>`  ·  **Clave de acceso:** `<ACCESS_KEY>`  _(completar al desplegar; ver "Despliegue")_
- Prompt de demo (botón "Ejecutar el prompt de ejemplo" en el chat):
  > Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.

  Después: `confirmo el valor 0 y la fecha fin 2027-08-31` → `msg-006` queda registrado.

## Levantar en local (un comando)

Requisitos: Node 20+ (probado en 22).

```bash
npm install
cp .env.example .env      # y pega tu ANTHROPIC_API_KEY
npm run dev               # http://localhost:3000
```

Con Docker: `docker compose up --build` (usa el mismo `.env`).

Sin clave el servidor arranca igual y el chat avisa que falta configurarla; `demo.ts` no necesita modelo.

## Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Clave del modelo. Solo vive en el backend; nunca en el front, el repo, los logs ni la API |
| `LLM_PROVIDER` / `LLM_MODEL` | `anthropic` / `claude-sonnet-5` | Proveedor y modelo |
| `PORT` | `3000` | Puerto HTTP |
| `ACCESS_KEY` | vacío | Si se define, la API exige la cabecera `x-access-key` (el front la pide al abrir) |
| `MAX_ITERATIONS` | `25` | Tope de iteraciones herramienta→modelo por turno (CA1) |
| `MAX_TOKENS_SESSION` | `200000` | Tope de tokens por sesión |
| `LLM_TIMEOUT_MS` | `60000` | Timeout al proveedor |
| `RATE_LIMIT_PER_MIN` | `20` | Peticiones por minuto por IP |

## `demo.ts` (sin modelo)

```bash
npm run demo
```

Reinicia `out/`, procesa los 6 mensajes del buzón llamando a las herramientas directamente, hace la segunda pasada de `msg-006` con `confirmado: true` y deja `out/alertas.md`. Es determinista (salvo timestamps).

## Tests y tipos

```bash
npm test            # 24 tests (node:test): herramientas, ciclo del agente, API, módulo
npm run typecheck   # tsc --noEmit, strict, sin any
```

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model, protegido }` (sin claves) |
| `GET` | `/api/maestro` · `/api/alertas` | Maestro en `out/` y reporte de alertas |
| `POST` | `/api/reset` | Reinicia `out/` para repetir la demo |

Si `ACCESS_KEY` está definido, todas las rutas `/api/*` (salvo `/api/health`) exigen `x-access-key`.

## Estructura

```
agent/prompt.md                      comportamiento (system prompt)
src/knowledge/registro-contratos.md  conocimiento del proceso
src/tools/contratos.ts (+ lib/)      ejecución: cada export → contratos_<export>
src/llm/                             adaptador de proveedor (+ anthropic.ts)
src/agent/                           ciclo del agente, sesiones, config
src/server.ts                        API HTTP + estáticos
web/index.html                       front de chat (HTML plano, sin build)
modulo/                              bonus: agente empaquetado (generado, ver abajo)
fixtures/  out/                      entrada (no se modifica) / salida generada
```

## Bonus: `modulo/`

`npm run build:modulo` genera `modulo/` desde las mismas fuentes que usa la app (`agent/prompt.md`, `src/knowledge/`, `src/tools/`); `tests/modulo.test.ts` falla si se desincroniza. Ver `modulo/README.md`.

## Despliegue

Incluye `Dockerfile` y `render.yaml` (Render, plan gratuito): crear un Web Service desde el repo, definir `ANTHROPIC_API_KEY` y `ACCESS_KEY` como secretos y usar `/api/health` como health check. Cualquier plataforma que corra el Dockerfile sirve (Fly.io, Railway, Azure Container Apps). `out/` se crea desde los fixtures al primer uso y "Reiniciar demo" lo restaura; en el plan gratuito el disco es efímero, lo cual no afecta la demo.
