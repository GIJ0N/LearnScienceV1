# Proveedor de modelo intercambiable v1

## Qué cambia

Toda llamada al modelo sigue pasando por una sola función, `gemini(prompt, schema, max_tokens)`, así que los puntos de llamada, los esquemas y los validadores no cambian. Solo se elige el transporte:

| `LLM_PROVIDER` | Clave | Modelo | Estado |
|---|---|---|---|
| `gemini` (por defecto) | `GEMINI_API_KEY` | `GEMINI_MODEL` (por defecto `gemini-3.1-flash-lite`) | Igual que antes |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` (por defecto `claude-sonnet-5-5`) | Nuevo |

Para Anthropic la app pide la respuesta como una herramienta con `tool_choice` forzado. El esquema interno (en mayúsculas, estilo Gemini) se traduce a JSON Schema con `_json_schema`. Una respuesta truncada (`stop_reason: max_tokens`) o sin la herramienta se rechaza sin guardar progreso.

## Garantías

- La cuota diaria (`DAILY_CALL_LIMIT`) es compartida y se consume antes de cada llamada, igual en ambos proveedores.
- Una clave ausente falla antes de cualquier solicitud.
- Si el proveedor devuelve la clave en un mensaje de error, se oculta antes de mostrarlo.
- `/api/health` informa proveedor y modelo, nunca la clave.

## Límites

- No hay SDK: el transporte usa `urllib`, como el de Gemini, para no añadir dependencias.
- Los prompts se afinaron con Gemini. Con otro modelo conviene repetir las pruebas de calidad de cada flujo (diagnóstico, microlección, evaluación) antes de confiar en ellos.
- No se probó contra la API real de Anthropic en este entorno; las pruebas usan red simulada.

## Rollback

Quitar `LLM_PROVIDER=anthropic` (o ponerlo en `gemini`). No hay cambios de datos ni de esquema.
