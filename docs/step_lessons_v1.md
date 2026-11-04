# Lección de un paso a la vez v1 (`step_lessons_v1`)

## Propósito

Hoy la fase de enseñanza muestra de una vez explicación, ejemplo y error habitual, y solo después pregunta. Un error se descubre tarde y no se sabe en qué parte de la explicación ocurrió. Esta versión reemplaza esa pantalla por una secuencia corta de **pasos**, cada uno con el ciclo **predecir → enseñar → comprobar**, y repara en el momento si la comprobación falla.

La plantilla actual no se elimina: es el respaldo si no se pueden generar pasos válidos, y las fases posteriores (comprobación, práctica guiada, independiente, integración) siguen siendo las que producen evidencia.

## Ciclo de cada paso

1. **Predicción** (pregunta abierta, opcional con «No sé»): apunta al problema que el paso resuelve sin revelar la respuesta. Es *exposición*, no desempeño: no se califica.
2. **Enseñanza**: se muestra primero la resolución de la predicción (qué es cierto y por qué) y después el cuerpo del paso, máximo ~110 palabras, con el motivo de por qué alguien llegaría ahí.
3. **Comprobación**: opción múltiple sobre un caso nuevo, con confianza y razonamiento opcionales. Se corrige en el servidor, sin proveedor y al instante, con la idea errónea que suele producir la opción elegida.
4. **Reparación** si falla: se genera una explicación distinta del mismo paso (otro ángulo o ejemplo) apuntando a esa idea errónea, más una comprobación nueva. Máximo **2 reparaciones** por paso; después el paso queda `unresolved`, se registra y la lección continúa para que la comprobación posterior y la práctica lo vuelvan a medir.

## Qué cuenta como evidencia

**Nada de esto crea eventos `EVIDENCE`.** Las comprobaciones de paso miden conocimiento recién expuesto (activo), así que son formativas: deciden si se avanza o se repara dentro de la lección, no si hay dominio.

| Evento | Contenido | Efecto en dominio |
|---|---|---|
| `PREDICTION` | texto, confianza | Ninguno |
| `STEP_CHECK` | paso, intento, resultado, confianza, señal de calibración, reparaciones | Ninguno |
| `STEP_UNRESOLVED` | paso, ideas erróneas vistas | Ninguno; queda visible |
| `TEACHING_EXPOSURE` (existente) | uno por cuerpo mostrado | Mantiene la política de retención |

El dominio sigue saliendo solo de las actividades posteriores con su contrato actual. Las señales de confianza se usan igual que en `learner_signals_v1`: datos de decisión.

## Contratos

`POST /api/lesson/steps` → `{profile_id, goal_id, node_id, goal, name, parent, explanation, example, common_error}` → `{steps:[{step_id, predict:{prompt}, resolution, body, check:{item_id,node_id,prompt,options}}]}`. De 2 a 6 pasos; cada comprobación se valida y baraja como en el diagnóstico y su clave se guarda en el servidor.

`POST /api/lesson/step/answer` → `{profile_id, goal_id, item_id, attempt_id, selected_option_id|null, learner_confidence?, reasoning?}` → mismo resultado que el diagnóstico. Solo acepta preguntas de `step_lessons_v1`: una pregunta de diagnóstico no se puede responder por aquí ni al revés.

`POST /api/lesson/step/repair` → `{profile_id, goal_id, node_id, item_id, attempt_id, goal, name, body}` → `{body, check}`. El servidor toma la idea errónea de la respuesta ya registrada; el cliente no puede inventarla.

## Compatibilidad y rollback

Se reutilizan las tablas `placement_items` y `placement_answers` (almacén privado de preguntas con clave); no hay tablas nuevas. `lesson.steps` y `session.step` son campos opcionales: una lección sin `steps` se muestra como antes. Revertir deja eventos `PREDICTION`/`STEP_CHECK` que nada más lee.

## Fuera de alcance

Que `relevant_memory` use los resultados de paso para adaptar la siguiente lección, predicciones graduadas por el servidor y pasos Socráticos con respuesta abierta.
