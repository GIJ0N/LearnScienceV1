# Arquitectura de LearnScienceV1 (estado observado: noviembre 2026, commit 36d9632)

Verifica contra el código si el repo avanzó; esto es un mapa, no la fuente de verdad.

## Archivos

| Archivo | Papel |
|---|---|
| `app_legacy.py` | Entrada activa. Servidor `ThreadingHTTPServer` en 127.0.0.1:8765, `ROUTES`, prompts a Gemini, validadores, `HTML` con el JS incrustado, `--self-test`. |
| `app.js` | Fuente editable del frontend. Debe ser idéntico al `<script>` de `HTML` (`tools/check_parity.py`). |
| `memory_store.py` | `DurableMemory` (SQLite): perfiles, stores con revisión, intentos, imports, actividades/evaluaciones por criterio. `LocalDatabaseServerLock` impide dos servidores sobre la misma base. |
| `*_service.py`, `schemas.py`, `gemini_client.py`, `config.py` | División mecánica no conectada. No activar sin plan aprobado. |
| `docs/` | Contratos por área (`evidence_policy_v1.md` es la regla de suficiencia), `learning_science.md` (fundamento), `validation.md` (comandos). |
| `tests/` | Python con SQLite temporal y proveedor controlado; Node para lógica de `app.js`. |
| `tools/` | Paridad, benchmark de criterios, semillas de demo, aceptación acotada. |

## Rutas (POST, JSON)

- Mapa: `/api/map` (`make_coverage_map`), `/api/map/update`
- Lección: `/api/lesson` (`make_lesson`, plantilla de 7 partes adaptada por `lesson_adaptation`: initial / repair / scaffold / consolidate)
- Evaluación: `/api/evaluate` (CORRECT / PARTIAL / MISCONCEPTION + `error_type` + pista mínima; "no sé" → UNKNOWN), `/api/confirmation`
- Repaso diferido: `/api/review`
- Microtutoría / reparación: `/api/micro/start`, `/api/micro/repair`, `/api/context/create|step|zoom|status`
- Criterios: `/api/criteria/activity`, `/api/criteria/evaluate` (opción múltiple con clave privada en servidor + explicación separada)
- Perfil: `/api/profiles/list`, `/api/profile/create|delete|load|save|preferences|history|import|export|restore`
- GET `/` (HTML), `/api/health`

`gemini(prompt, schema, max_tokens)` aplica límite diario local (`DAILY_CALL_LIMIT`), usa
`responseSchema` y lanza `ValueError` legible ante 429, timeout o salida incompleta.

## Flujo de evidencia

respuesta → evaluación del modelo (propuesta) → validación local del contrato → evento de
evidencia (`attempt_id`, `activity_id`, `node_id`, resultado, error, ayuda, independencia,
variante novedosa, dimensiones observadas, versiones) → suficiencia derivada →
`coverage.status`, dashboard, `verified()`, `nextNode()`.

`level` es solo navegación por etapas; no declara dominio.

## Tablas SQLite

`metadata`, `profiles`, `stores` (JSON con revisión, conflicto si la revisión es antigua),
`attempts`, `imports`, `criterion_activities`, `criterion_evaluations`.
