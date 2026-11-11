# Enseñanza directa (`direct_teaching_v1`)

## Problema

En el flujo principal, una respuesta «No sé» devuelve `UNKNOWN` con `error_type:'lack_of_exposure'`
(el servidor la reconoce sin llamar al modelo), la interfaz muestra un aviso y repite la misma
pregunta. La persona se queda sin enseñanza.

## Propósito

Que un «No sé» declarado abra una explicación corta dirigida a **esa** pregunta y después vuelva a ella.

## Decisión de interfaz (Paso 0)

`renderQuestion` no tenía botón «No sé»: solo funcionaba si la persona lo escribía en la caja de
respuesta. Con autorización del dueño se añade un botón secundario «No sé» que envía exactamente el
texto «No sé» por la misma ruta de evaluación (`/api/evaluate`, sin modelo). El texto escrito sigue
funcionando igual.

## Servidor

- `DIRECT_VERSION='direct_teaching_v1'`; los ítems del `check` llevan prefijo `direct-`.
- `POST /api/teach/direct` `{profile_id, goal_id, node_id, goal, name, question:{prompt, reference, kind}}` →
  `{schema_version, needs:[1..3], steps:[2..4]{body}, worked:{prompt, steps:[2..5]}, check:<ítem público>, content_check}`.
- Validación local: conteos de `needs`, `steps` y `worked.steps`; cada `body` de 20 a 450 caracteres;
  `worked.prompt` distinto de la pregunta original; `check` pasa `_build_choice_item(…, DIRECT_VERSION)`
  y su enunciado es distinto del original; ni los pasos ni el ejemplo contienen el criterio interno
  (`reference`) cuando mide 20 caracteres o más.
- `audit_content` (falla abierta) sobre pasos + ejemplo + clave; un reintento con el motivo; si falla de
  nuevo, `ValueError` en español y **no se guarda nada**.
- El ítem del `check` se guarda con `save_placement_items`. `POST /api/teach/direct/answer` →
  `_answer_choice_item(data, DIRECT_VERSION)`: un ítem `direct-` no se responde por otras rutas ni al revés.

## Cliente

- Disparo: en `commitTransition`, cuando `event.result==='UNKNOWN'` **y** `result.error_type==='lack_of_exposure'`,
  en las fases `COMPREHENSION`, `GUIDED`, `INDEPENDENT`, `INTEGRATE` y `REVIEW`.
  Se crea `s.direct={version, node_id, phase, question_prompt, source_attempt_id, status:'pending', stage:0, package}`
  y el evento `{type:'DIRECT_TEACHING', node_id, phase, source_attempt_id, at}`.
  En `REVIEW` el calendario **no cambia** (regla vigente para `UNKNOWN`).
  Un `UNKNOWN` con otro `error_type` (evaluación incierta) conserva el comportamiento anterior.
- Una sola enseñanza directa por pregunta y visita: un segundo «No sé» ofrece «Ver la lección completa» o
  «Seguir con otro tema», sin segunda llamada.
- `directTeachingView`: «Lo que hace falta para responder» → pasos uno por pantalla → ejemplo resuelto →
  `check` (opción con confianza, formativo) → «Volver a la pregunta».
- `TEACHING_EXPOSURE` al mostrar el primer paso (una vez); `{type:'DIRECT_CHECK', node_id, item_id, attempt_id, status, learner_confidence, at}` al responder.
- Al volver: `s.direct=null` y `s.hints=max(s.hints,1)`: la respuesta siguiente a esa pregunta cuenta **con ayuda**.
- Si la ruta falla: `s.direct=null`, nota «No pude preparar la explicación ahora.» y botones
  «Ver la lección completa» y «Reintentar».

## Qué cuenta como evidencia

Ninguna nueva. `UNKNOWN` sigue sin ser positivo. `DIRECT_CHECK` es formativo: no toca cobertura, calendario
ni panel. La respuesta posterior a la pregunta original queda marcada con ayuda (no independiente); la
independencia exige otra pregunta, más tarde. Leer la explicación es exposición, no desempeño.

## Compatibilidad y rollback

Campos y eventos aditivos. El código anterior ignora `s.direct` y los eventos nuevos. Sin migración de SQLite.

## Fuera de alcance

Apoyarse en las fuentes del aprendiz (`grounded_sources_v1`), enseñanza directa dentro de los episodios de
reparación y las fases `DIAGNOSTIC`/`CONFIRMATION`/`CONTEXT`.

## Sin validar

Todo se prueba con un modelo simulado; la calidad real de la explicación solo se conoce con Gemini real.
