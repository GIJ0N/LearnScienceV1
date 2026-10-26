# Repair teaching v2

`repair_teaching_v2` extiende el flujo activo de `RepairEpisode`. Conserva el diagnóstico, los límites, los contratos de actividad, la separación de evidencia padre/hijo y la política de transferencia de v1.

## Flujo

El servidor genera primero únicamente hipótesis y comprobaciones diagnósticas. Una respuesta `PARTIAL` o `MISCONCEPTION` puede confirmar la hipótesis asociada; `CORRECT` la rechaza y `UNKNOWN` conserva incertidumbre. Si al terminar no existe una laguna `CONFIRMED`, el episodio cierra como `PARTIAL` y no presenta una hipótesis sospechada como conocimiento ausente.

Después de seleccionar una laguna confirmada, el cliente solicita otro paquete ligado exactamente a `selected_gap.gap_id`. El paquete contiene explicación, ejemplo resuelto distinto, ampliación opcional, CHECK, GUIDED, INDEPENDENT, una actividad independiente alternativa, pistas guiadas, reintento del padre y transferencia.

```text
DIAGNOSING → TEACH → CHECK → GUIDED → INDEPENDENT → PARENT_RETEST → TRANSFER_CHECK
```

En TEACH el usuario puede abrir la explicación, comprobar primero, pausar o reanudar. Un CHECK correcto permite continuar sin haber abierto el contenido. Leer no crea evidencia. GUIDED nunca acredita independencia. Si INDEPENDENT recibió ayuda o no fue correcto, la siguiente comprobación usa la actividad alternativa; ocultar una pista no convierte el intento anterior en independiente.

## Persistencia y exposición

El episodio conserva `plan_version`, `plan_gap_id`, `teaching_package`, `teaching_status`, `teaching_progress`, `independent_retries`, `independent_index` y `attempt_checkpoint`. El checkpoint guarda respuesta y evaluación antes de aplicar la transición. Reaplicar un checkpoint `APPLIED` no crea otro evento.

`CONTENT_EXPOSURE` registra explicación, ejemplo, ampliación, pista o feedback realmente mostrados. `content_id` evita duplicar la misma presentación por una recarga o render repetido. No es evidencia positiva. Solo actualiza `last_exposure_at` cuando `selected_gap.node_id` identifica de forma explícita el mismo nodo de un repaso; no se propaga al padre ni a otros prerrequisitos.

## Validación

El backend y el cliente exigen versión conocida, laguna confirmada coincidente, campos completos, familias y dimensiones compatibles con cada rol, preguntas normalizadas distintas y una alternativa independiente. Se rechaza una copia textual del padre o una respuesta protegida dentro del ejemplo o las pistas. Esta comparación no garantiza diferencia semántica: la aceptación con contenido real debe revisar posibles paráfrasis y filtraciones.

La generación fallida deja `teaching_status=ERROR` y ofrece un reintento explícito. No registra evidencia ni avanza la etapa.

## Compatibilidad y rollback

La ausencia de `plan_version` conserva la interpretación `microtutoring_repair_episode_v1`. No se inventan enseñanza, exposiciones ni fechas históricas. Una versión desconocida se conserva y puede abandonarse, pero no se ejecuta.

Un rollback de creación puede dejar de abrir episodios v2 manteniendo su lector. Volver a una versión que desconozca TEACH no garantiza reanudar episodios v2 activos; para un rollback completo se debe restaurar un respaldo anterior. No se convierten paquetes v2 a v1 de forma silenciosa.

## Validación manual

Con un perfil y SQLite aislados, provoca un fallo que permita confirmar una laguna. Comprueba que la segunda solicitud contiene el `gap_id` seleccionado; revisa la explicación y el ejemplo antes de mostrarlos; solicita una pista en GUIDED; usa ayuda en el primer INDEPENDENT y confirma que aparece otra actividad. Recarga antes y después de evaluar, verifica un solo `attempt_id`, vuelve al padre y confirma que su respuesta original permanece. Esta prueba valida integración; no demuestra eficacia pedagógica.
