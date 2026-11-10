# Telemetría de uso (`usage_telemetry_v1`)

Para saber cuántos tokens gasta cada flujo y que el contador diario de llamadas sobreviva a un reinicio del servidor.

## Qué se guarda

Tabla `llm_calls` en la SQLite existente (`CREATE TABLE IF NOT EXISTS`, sin migración destructiva):
`call_id`, `day` (fecha local ISO), `provider`, `model`, `route` (la ruta HTTP que originó la llamada),
`input_tokens`, `output_tokens`, `thinking_tokens` (pueden ser `NULL`), `latency_ms`, `ok` (1/0), `created_at`.

No lleva `profile_id`, ni texto de prompts o respuestas, ni claves. Son solo conteos y tiempos.

## Qué se registra

- Cada llamada real al proveedor, exitosa o no (HTTP 429/401, tiempo agotado, salida incompleta): `ok=0` y tokens `NULL`
  cuando el proveedor no los informó.
- Gemini: `usageMetadata` → `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`.
- Anthropic: `usage` → `input_tokens`, `output_tokens`; `thinking_tokens` queda `NULL`.
- Una llamada rechazada por el límite diario local o por falta de clave no llegó al proveedor y no se registra.
- El registro nunca rompe una llamada: cualquier error al escribirlo se ignora.

## Contador diario

Al arrancar, `CALLS[hoy] = max(CALLS[hoy], llamadas registradas hoy)`. Reiniciar el servidor ya no devuelve el contador a cero.
`_consume_quota` no cambia.

## Lectura

- `/api/health` añade `tokens_today: {input, output, thinking}` (0 si no hay datos).
- `POST /api/usage/summary` con `days` (1–30, por defecto 7) → `{days: [{day, route, calls, input_tokens, output_tokens, thinking_tokens}]}`.
- La pestaña de informe muestra «Costo de IA (7 días)». Si la petición falla, no se muestra nada.

## Evidencia

Ninguna: no es evidencia de aprendizaje y no toca la política ni los perfiles.

## Compatibilidad y rollback

Tabla aditiva. Revertir el código deja la tabla sin uso; no hay datos que migrar ni restaurar.

## Límites

Los tokens son los que informa el proveedor; si no los informa, quedan sin dato. El contador de ruta sale de la ruta HTTP, así que
llamadas hechas fuera de una petición (pruebas, scripts) quedan como `unknown`.
