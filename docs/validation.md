# Validación reproducible

Este repositorio mantiene `app_legacy.py` como entrada de compatibilidad. La CI valida esa entrada y las dos suites JavaScript sin cambiar la lógica pedagógica ni iniciar servicios externos.

## Requisitos locales

- Node.js 14 o posterior por la sintaxis de `app.js` (la CI usa Node.js 22 LTS).
- Python 3.7 o posterior por las clases HTTP usadas por `app_legacy.py` (la CI usa Python 3.12).
- No hay `package.json`, `requirements.txt` ni `pyproject.toml`; las validaciones usan únicamente la biblioteca estándar de Node.js y Python.

No se ha declarado una versión mínima formal del proyecto. Las versiones anteriores son el límite práctico derivado del código; la matriz reproducible y revisada es Node.js 22 y Python 3.12.

## Comandos completos

Desde la raíz del repositorio:

```text
python tests/prompt_quality.test.py
python tests/prompt_bench.test.py
node tests/map_areas.test.js
python tests/map_areas_backend.test.py
node tests/expert_panel.test.js
node tests/knowledge_graph.test.js
python tests/knowledge_graph_backend.test.py
node tests/spaced_practice.test.js
python tests/spaced_practice_backend.test.py
node tests/step_lessons.test.js
python tests/step_lessons_backend.test.py
python tests/llm_provider.test.py
node tests/placement.test.js
node tests/qa_round1.test.js
node tests/content_trust.test.js
python tests/content_trust_backend.test.py
node tests/error_hunt.test.js
python tests/error_hunt_backend.test.py
node tests/teach_beto.test.js
python tests/teach_beto_backend.test.py
node tests/real_world_challenges.test.js
python tests/real_world_challenges_backend.test.py
node tests/qa_round2.test.js
python tests/qa_round2_backend.test.py
node tests/qa_round3.test.js
python tests/qa_round3_backend.test.py
node tests/qa_round4.test.js
python tests/qa_round4_backend.test.py
node tests/usage_report.test.js
python tests/reported_items_backend.test.py
node tests/reported_items.test.js
python tests/local_confirmation_backend.test.py
node tests/local_confirmation.test.js
python tests/challenge_photos_backend.test.py
python tests/choice_balance_backend.test.py
python tests/private_network_access.test.py
python tests/usage_telemetry.test.py
node tests/challenge_photos.test.js
node tests/qa_round5.test.js
node tests/qa_round6.test.js
python tests/placement_backend.test.py
node tests/learner_signals.test.js
python tests/learner_signals_backend.test.py
node tests/evidence_policy.test.js
node tests/evidence_sufficiency.test.js
python tests/evidence_confirmation.test.py
python tests/adaptive_lesson.test.py
python tests/reachable_dimensions.test.py
node tests/delayed_review.test.js
python tests/delayed_review_backend.test.py
python tests/durable_memory.test.py
node tests/durable_memory_frontend.test.js
node tests/insecure_context_ids.test.js
node tests/microtutoring_repair_episode.test.js
node tests/repair_teaching_v2.test.js
python tests/repair_teaching_backend.test.py
node tests/repair_diagnosis_recovery.test.js
python tests/repair_diagnosis_recovery_backend.test.py
node tests/graded_hints.test.js
python tests/graded_hints_backend.test.py
node --check app.js
python app_legacy.py --self-test
python -m py_compile app_legacy.py
python tools/check_parity.py
python tests/check_parity.test.py
python tests/evaluate_data_delimiters.test.py
python tests/integration_novelty.test.py
node tests/integration_novelty.test.js
node tests/placement_skip_review.test.js
node tests/placement_production.test.js
python tests/placement_production.test.py
node tests/prerequisite_review.test.js
python tests/prerequisite_review.test.py
node tests/expert_staleness.test.js
node tests/selector_confidence.test.js
python tests/local_production_backend.test.py
node tests/local_production.test.js
python tests/faded_examples_backend.test.py
node tests/faded_examples.test.js
node tests/open_answer_trust.test.js
node tests/daily_session.test.js
python tests/expert_profile_backend.test.py
node tests/expert_profile.test.js
python tests/practice_difficulty.test.py
node tests/practice_difficulty.test.js
python tests/grounded_sources_backend.test.py
node tests/grounded_sources.test.js
python tests/direct_teaching_backend.test.py
node tests/direct_teaching.test.js
node tests/stuck_exits.test.js
python tests/teaching_ladder_backend.test.py
node tests/teaching_ladder.test.js
python tests/judge_model.test.py
node tests/judge_model.test.js
python tests/judge_calibration.test.py
node tests/adaptive_schedule.test.js
python tests/adaptive_schedule_backend.test.py
node tests/study_plan.test.js
node tests/visual_theme.test.js
node tests/lesson_ui.test.js
node tests/path_ui.test.js
node tests/motivation.test.js
node tests/nav_menu.test.js
node tests/mobile_polish.test.js
python tools/ensure_playwright.py
node tests/browser_smoke.test.js
node tests/qa_round8.test.js
```

`python tools/check_parity.py` extrae el valor de `HTML` con el parser AST de Python y exige una única pareja `<script>...</script>`. Compara `app.js` con ese bloque en una representación canónica LF: convierte únicamente `CRLF` y `CR` aislados en `LF`, sin ignorar espacios, tabulaciones, comillas, etiquetas ni ningún otro byte.

Git almacena los archivos de este repositorio con LF, pero un checkout de Windows con `core.autocrlf=true` puede materializar `app.js` con CRLF. La canonicalización evita que ese detalle del checkout produzca un falso fallo de paridad. Una diferencia de contenido, incluso de un solo carácter, sigue terminando con código distinto de cero e informa las longitudes canónicas, el primer byte distinto y su contexto.

`python tests/check_parity.test.py` verifica los casos LF/CRLF, diferencias reales de caracteres o longitud, etiquetas ausentes o ambiguas y escapes UTF-8 decodificados por el literal Python.

`python tests/reachable_dimensions.test.py` simula sin red el generador activo, normaliza mapa y microlección en el backend y entrega las preguntas a `app.js`. Verifica para `variables`, `units`, `equation_manipulation` y `method_selection` el recorrido contrato → evaluación simulada → evento → evidencia → cobertura, además de los casos negativos de familia, rol, ayuda, `UNKNOWN`, idempotencia, reparación hija y datos legacy. También fuerza contratos dirigidos incompatibles y comprueba que el rechazo deja la cobertura intacta, conserva `target_dimension` y ofrece un reintento explícito de una sola solicitud.

`python tests/durable_memory.test.py` usa una base SQLite temporal. Verifica persistencia tras reinicio, aislamiento de perfiles, respuesta y evaluación completas, conflicto de revisión sin sobreescritura, importación idempotente sin evidencia inventada, exportación/restauración y contexto de memoria acotado con procedencia. `node tests/durable_memory_frontend.test.js` verifica el error visible de escritura, su recuperación, la asociación de perfil y la pausa de una sesión breve sin escribir el progreso completo en `localStorage`.

`node tests/repair_teaching_v2.test.js` recorre diagnóstico, selección de laguna, enseñanza, omisión mediante CHECK, ayuda guiada, retirada de apoyo, actividad independiente alternativa, retorno al padre, pausa, recarga, checkpoint e idempotencia. `python tests/repair_teaching_backend.test.py` usa respuestas controladas y valida los dos contratos del generador y la persistencia durable. Ninguna de estas pruebas llama a Gemini.

`node tests/repair_diagnosis_recovery.test.js` verifica error de red, contrato inválido, reintento, doble clic, respuesta tardía, recarga, pausa y fallos de persistencia del diagnóstico inicial. `python tests/repair_diagnosis_recovery_backend.test.py` valida que el estado pendiente solo pueda apuntar al intento y actividad padre existentes. Un diagnóstico pendiente no es un episodio y no añade evidencia.

`python tests/criterion_assessment.test.py` y `node tests/criterion_assessment_frontend.test.js` cubren la vertical `criterion_assessment_v1`: actividad de opción múltiple con explicación separada, clave privada solo en el servidor, evaluación determinista de la opción, explicación `NOT_EVALUATED` cuando el proveedor controlado no responde, ayuda que impide independencia, idempotencia por `attempt_id` y persistencia compatible. Estas pruebas usan respuestas controladas y no validan eficacia pedagógica ni Gemini real.

`python tests/criterion_durability.test.py` comprueba el contrato privado completo en SQLite aislado, borradores tras reinicio, recuperación de evaluaciones ya persistidas, rechazo de fingerprints distintos, reserva concurrente, recuperación explícita de una reserva cuyo propietario pertenece a un proceso anterior, rechazo de respuestas tardías del propietario anterior, aislamiento por perfil/meta, exportación sin claves, restauración sin contrato privado, eliminación por cascada y compatibilidad con stores legacy. El registro `PENDING` no mantiene una transacción abierta durante la llamada al proveedor: la misma instancia no puede iniciar una segunda evaluación, pero una instancia nueva reclama el mismo `attempt_id` y fingerprint. Si el proceso cae durante la llamada, la recuperación no garantiza que el proveedor se ejecutara una sola vez; sí evita duplicar evidencia y evita que una respuesta tardía sobrescriba la evaluación recuperada.

`node tests/graded_hints.test.js` y `python tests/graded_hints_backend.test.py` cubren `graded_hints_v1` (`docs/graded_hints_v1.md`): el evento registra `hint_level_max` (0-5), cualquier pista —incluida P0— impide independencia en el evento, la suficiencia, el cierre de reparación y `validate_store`, los valores ilegibles se tratan como 5, la huella de criterio solo cambia cuando hay nivel, y los eventos legacy sin el campo no reciben un nivel inventado. Usan proveedor controlado y SQLite temporal; no validan Gemini real ni navegador.

`python tests/criterion_server_lock.test.py` usa procesos reales y SQLite temporales. Comprueba que una segunda instancia no puede servir la misma base mientras el primer proceso conserva el handle bloqueado, que la caída abrupta libera el bloqueo, que el mismo intento puede recuperarse después, que dos solicitudes del servidor activo no ejecutan dos evaluaciones, que bases distintas funcionan simultáneamente y que una respuesta HTTP perdida no duplica la evaluación. El bloqueo cubre una SQLite local en un solo equipo; no es un protocolo distribuido.

`node tests/repair_acceptance_controlled.test.js` completa un episodio sintético con diagnóstico confirmado, enseñanza, reintento padre y transferencia novedosa, y comprueba la recarga sin duplicados. `python tests/repair_persistence_acceptance.test.py` usa SQLite temporal y un servidor de prueba que confirma el commit antes de cerrar la respuesta HTTP; la siguiente escritura con revisión antigua recibe conflicto y la recarga conserva exactamente el único intento comprometido. Estas son comprobaciones HTTP/SQLite controladas, no aceptación visual de navegador.

La misma secuencia se ejecuta en `.github/workflows/ci.yml`. Si falta una suite, falla un comando o no se puede usar la versión fijada de Node.js/Python, el paso correspondiente termina con error y el job falla. No se silencian errores ni se convierten en advertencias.

## Respuestas simuladas y Gemini

Las suites automatizadas usan respuestas locales simuladas. `python app_legacy.py --self-test` también sustituye la llamada de red y la clave de Gemini dentro de la prueba; no necesita `GEMINI_API_KEY` y no evalúa respuestas reales. La CI no configura, imprime ni envía ninguna clave y no inicia servicios externos.

Una validación `BLOCKED` significa que una prueba no se pudo ejecutar por falta de navegador, permisos, credenciales o un servicio externo. Debe informarse como `BLOCKED`, nunca como `PASS`. Las pruebas de navegador completo, recarga real, consola y Gemini real no forman parte de esta CI.

## Aceptación manual de `criterion_assessment_v1`

- Sin proveedor pueden comprobarse el arranque, `/api/health`, perfiles sintéticos, recarga de datos existentes, exportación pública, mapa de solo lectura y las suites automatizadas.
- La conservación visual de selección y explicación requiere una actividad sintética ya precargada en una SQLite temporal. El repositorio todavía no incluye un harness visual que la cargue y controle el evaluador desde el navegador.
- Crear una meta, generar una nueva actividad y evaluar semánticamente su explicación usan el proveedor configurado. No forman parte de una prueba local sin API.
- La aceptación visual end-to-end queda `NO EJECUTADA` hasta disponer de ese harness o autorización expresa para Gemini real. Las pruebas HTTP/SQLite controladas no deben presentarse como aceptación visual.

Arranque aislado que no usa la base habitual:

```powershell
cd <worktree>
$env:PORT = '8897'
$env:RUTA_DB_PATH = Join-Path $env:TEMP 'criterion-assessment-review.sqlite3'
python app_legacy.py
```

## Limitaciones conocidas

- No hay una prueba completa de navegador en CI.
- No se evalúan respuestas reales de Gemini.
- La detección de novedad de microtutoría es textual y conservadora; no afirma equivalencia semántica total.
- La detección de copias en ejemplos y pistas también es textual. Una aceptación con Gemini debe revisar manualmente que el ejemplo no filtre la solución del padre ni de la actividad independiente.
- Los servicios modulares extraídos todavía no son la ruta ejecutable principal.
- `config.py` y `gemini_client.py` conservan errores de sintaxis legacy preexistentes en `main`; quedan fuera de esta validación y no se modifican.

## Lista previa a un merge

Un PR debe mostrar todas las suites, `node --check`, el self-test y la compilación de `app_legacy.py` en PASS, además de la comprobación de paridad. También debe demostrar que no cambió la aplicación fuera de su alcance, que no añadió secretos ni dependencias innecesarias y que la documentación describe las limitaciones como `BLOCKED` cuando corresponde. La revisión humana debe comprobar los contratos de evidencia, la idempotencia, la persistencia legacy y las rutas de RepairEpisode; esta CI no sustituye esas revisiones.

## Prueba manual de una dimensión dirigida

1. Inicia `python app_legacy.py` con una configuración válida de Gemini.
2. Crea una meta cuyo mapa requiera claramente una de las cuatro dimensiones, por ejemplo resolución dimensional para `units`.
3. En el dashboard confirma que la dimensión aparece requerida y `UNKNOWN`.
4. Elige “No sé; enséñamelo” si aparece el diagnóstico inicial y avanza hasta práctica guiada e independiente.
5. En las herramientas del navegador comprueba que `/api/lesson` recibió `target_dimension` y devolvió el `kind` canónico con una única `observable_dimensions`.
6. Tras un resultado independiente correcto, confirma que solo esa dimensión recibe evidencia y cambia de estado. Una respuesta `UNKNOWN` o una familia incompatible debe dejarla sin evidencia positiva.


## Suficiencia v2

La regresión `adaptive_cycle.test.js` ahora finaliza naturalmente: el fixture responde también al guardado posterior a la respuesta tardía y restaura `fetch`; cinco ejecuciones consecutivas terminaron con código 0.

Las suites Python se compararon en el padre `05bbd8289d0494c2cef94491382af100f9bda6fb` y en el integrado `196f394acc6b5105753c2971c0511c9c3c164f82`: ambas pasan en el padre y ambas fallaron inicialmente en el integrado por regresiones de integración en `app_legacy.py`. Tras restaurar selectivamente sus capacidades, las dos suites pasan en el integrado.

La validación histórica del checkout limpio fue parcial respecto al workflow: omitió `node tests/adaptive_cycle.test.js`. La comprobación actual del fixture configura un perfil sintético, espera de forma acotada la pregunta y el contexto de reparación, y conserva la expectativa `session.mode === "CONTEXT"`.

Las pruebas nuevas cubren dos preguntas independientes, exclusión de ayuda/duplicados, correcciones, demora mínima de memoria, visita limitada y continuación provisional. El recorrido HTTP usa la ruta activa `/api/confirmation` y SQLite temporal; comprueba recarga, exportación y restauración de la sesión pendiente. La generación y evaluación del proveedor siguen simuladas; estas pruebas no validan aprendizaje humano ni novedad semántica.

## Microlecciones adaptadas según evidencia durable

Cuando un usuario solicita volver a aprender, se genera una microlección nueva usando hasta cinco intentos recientes almacenados en SQLite para el nodo y, si existe, la dimensión objetivo. Un error reciente elige refuerzo, una respuesta asistida elige apoyo gradual, un acierto independiente elige consolidación y la evidencia ausente o legacy incompleta conserva enseñanza inicial. Esta adaptación solo modifica el contenido y muestra su razón: no acredita dominio ni sustituye los contratos de evidencia v2. El proveedor real todavía requiere prueba manual.

## Repaso diferido verificable

El flujo registra un primer repaso desde un intento correcto de integración
aceptado para el nodo. La programación es idempotente y conserva el intento
de origen, la fecha de origen, la última exposición conocida, el vencimiento,
las fechas de presentación y respuesta, la ayuda y `delayed_review_v1`.

`required` sigue significando que una dimensión debe ser suficiente según
Evidence Policy v1; no implica independencia configurable por meta. La
independencia se exige según la política por dimensión. La programación o la
espera no acreditan dominio. La interfaz distingue práctica inmediata,
recuperación diferida observada y demora no verificable. Los datos legacy sin
ancla temporal quedan en la última categoría y no reciben evidencia inventada.

Para probarlo sin esperar un día, ejecuta `node tests/delayed_review.test.js`.
La prueba inyecta un reloj local y comprueba el estado antes, en y después del
vencimiento, ayuda, fechas inválidas o futuras, contratos dirigidos y
persistencia de los campos en una normalización v4. El reloj del equipo no se
modifica y el resultado no demuestra retención humana.

`node tests/learner_signals.test.js` y `python tests/learner_signals_backend.test.py` cubren `learner_signals_v1`: confianza ausente como `null`, matriz de calibración, que la confianza no concede independencia ni cambia cobertura, rechazo de confianza inválida antes de llamar al proveedor, «No sé» sin señal, contexto del evaluador y de la microlección, y eventos legacy sin señales. Usan respuestas controladas; no validan Gemini real ni el navegador.

`node tests/placement.test.js` y `python tests/placement_backend.test.py` cubren `placement_v1`: entrada por el tema más avanzado, división de lo pendiente, deducción hacia prerrequisitos solo con acierto seguro, laguna hacia dependientes, conflicto, repregunta de temas frágiles, temas con evidencia previa excluidos, saltos que no conceden dominio y se revocan, idempotencia, una sola llamada por lote, clave privada en servidor, corrección sin proveedor, aislamiento por perfil y meta y borrado en cascada. Usan respuestas controladas; no validan Gemini real ni el navegador.

`python tests/prompt_quality.test.py` y `python tests/prompt_bench.test.py` cubren `prompt_quality_v1`: la compuerta de calidad de preguntas (repetidas, «todas las anteriores», correcta delatada por longitud, enunciado que revela la respuesta, sin falsos positivos con variables), que los cinco prompts generadores incluyan las reglas, el banco en modo reproducción con 8 casos sintéticos (cumplimiento, sesgos antes de barajar, costo en llamadas y tokens) y que corra sin red ni claves.

`node tests/map_areas.test.js` y `python tests/map_areas_backend.test.py` cubren `map_areas_v1`: creación en dos llamadas con la primera área abierta, límites y duplicados de áreas, renombrado de ids por área, dependencias hacia temas existentes, fusión de temas repetidos, rechazo de ciclos/ids/prerrequisitos inválidos, expansión que solo agrega sin tocar lo existente ni conceder evidencia, apertura automática no bloqueante, reintento con espera y que el mapa plano anterior siga igual.

`node tests/expert_panel.test.js` cubre `expert_panel_v1`: las 7 capas con sus umbrales (`none`/`partial`/`met`), que `UNKNOWN`, el diagnóstico, las auditorías, la ayuda y otros temas no cuenten donde no deben, calibración con respuestas decisivas, sobreconfianza e infraconfianza, etiquetas y siguiente paso, y que el panel sea de solo lectura.

`node tests/knowledge_graph.test.js` y `python tests/knowledge_graph_backend.test.py` cubren `knowledge_graph_v1`: validación local de proposiciones y cadenas (duplicados, premisas inválidas, topes), deduplicación por enunciado normalizado solo dentro de la meta, procedencia acumulada, extracción que no bloquea ni marca como hecha si falla, composición generada solo desde cadenas guardadas (nunca de otra meta o perfil), corrección sin proveedor, aislamiento entre versiones de pregunta y ausencia de `EVIDENCE`.

`node tests/spaced_practice.test.js` y `python tests/spaced_practice_backend.test.py` cubren `spaced_practice_v1`: tabla de peldaños según ayuda y confianza, tope de la escalera, selección intercalada (vencidos primero, sin temas sin exposición, mínimo dos), ninguna creación de `EVIDENCE`, un acierto que no sube el peldaño, retroceso parcial que nunca atrasa un vencimiento, idempotencia por `attempt_id`, contrato de generación con clave privada y aislamiento entre versiones de pregunta.

`node tests/step_lessons.test.js` y `python tests/step_lessons_backend.test.py` cubren `step_lessons_v1`: ciclo predecir → enseñar → comprobar, reparación con tope de 2 y paso `unresolved`, ninguna creación de `EVIDENCE`, idempotencia por `attempt_id`, reinicio si la lección cambia, pasos inválidos descartados (menos de 2 → respaldo), corrección sin proveedor, aislamiento entre diagnóstico y pasos, y reparación que toma la idea errónea del servidor y rechaza aciertos o respuestas inexistentes.

`python tests/llm_provider.test.py` cubre el cambio de proveedor: contrato HTTP de Anthropic (cabeceras, modelo, herramienta forzada, esquema en JSON Schema), que todos los esquemas de la app sean objetos en raíz, salida truncada y estructura faltante rechazadas, errores en español sin eco de la clave, cuota compartida y proveedor por defecto Gemini. Usa una red simulada; no contacta a ningún proveedor.

## Ronda QA 1 (`fix/qa-round-1`)
Corrige lo hallado en la prueba real con Gemini: `maxOutputTokens` con margen para tokens de razonamiento (causa del `MAX_TOKENS`); la lección por pasos que falla ya no se desactiva para siempre (aviso visible y botón para reintentar); el diagnóstico solo deduce prerrequisitos con ≥2 aciertos directos y termina en una pantalla de resultados; las áreas muestran ✓ solo con verificación y ≈ si se saltaron por diagnóstico; la etiqueta experta pasa a «Iniciando» con avance parcial; el prompt exige español correcto y ejemplos exactos. `node tests/qa_round1.test.js` cubre lo verificable sin proveedor real. No sustituye una segunda prueba en el navegador ni una revisión semántica de las preguntas.

## Contenido confiable (`content_trust_v1`)
`python tests/content_trust_backend.test.py` y `node tests/content_trust.test.js` cubren: auditoría de contenido que falla abierta y se marca como no verificada; una regeneración de la lección con los errores detectados y descarte si la segunda también falla; descarte solo de las preguntas señaladas del diagnóstico; pistas por pregunta en 3 niveles que nunca revelan la clave; reportes «Esto está mal» guardados y borrados en cascada; profundidad del mapa (curiosidad, sólido, profesional, experto) en ambos prompts; guardados agrupados con el último estado; etiquetas traducidas. Usan respuestas controladas con `CONTENT_VERIFY` activado solo en esta prueba. No miden si la auditoría de Gemini real detecta errores de física: eso necesita la segunda prueba QA con temas distintos.

## Encuentra el error (`error_hunt_v1`)
`python tests/error_hunt_backend.test.py` y `node tests/error_hunt.test.js` cubren: contrato local de la solución (3 a 6 pasos numerados consecutivos desde 1; cada opción cita un paso existente o es la única opción «ningún paso tiene error»), soluciones limpias que el servidor decide y una clave coherente con el tipo pedido, clave privada, descarte de ítems mal formados o repetidos, descarte de los señalados por la auditoría, corrección sin proveedor, idempotencia por `attempt_id`, aislamiento por versión, disponibilidad con un solo tema, evento `DISCRIMINATION` con `variant: 'error_hunt'`, corrección escrita calificada con rúbrica (provisional, idempotente, solo tras un diagnóstico correcto, rechazada en soluciones limpias), evento `ERROR_FIX` ignorado por el panel experto y ausencia total de `EVIDENCE`. Usan respuestas controladas; no miden si Gemini real escribe errores bien escondidos ni si el paso señalado es de verdad el erróneo (eso depende del verificador y del reporte «Esto está mal»).

## Enséñale a Beto (`teach_beto_v1`)
`python tests/teach_beto_backend.test.py` y `node tests/teach_beto.test.js` cubren: creencia e idea correcta privadas (el cliente solo recibe la apertura), auditoría de contenido al crear la actividad, estados válidos del turno, tope de 4 intercambios con cierre automático, respuesta de Beto que filtra la idea correcta rechazada sin guardar nada, idempotencia por `attempt_id` y conflicto con otro texto, aislamiento por meta y por versión, evento `BETO_SESSION` provisional que `expertOutcome` ignora, ausencia de `EVIDENCE`, y repaso que solo se adelanta (nunca se retrasa) cuando Beto no queda convencido. Usan respuestas controladas; no miden si Gemini real inventa creencias falsas verosímiles ni si califica bien una explicación: eso necesita una prueba real con temas distintos.

## Retos del mundo real (`real_world_challenges_v1`)
`python tests/real_world_challenges_backend.test.py` y `node tests/real_world_challenges.test.js` cubren: contrato del reto (2–6 pasos, 2–3 campos, 10–45 min), filtro local de seguridad, auditoría de contenido, tarea oculta hasta bloquear la predicción en el servidor, informe que exige predicción previa, puertas locales antes del modelo, valoración provisional e idempotente, INSUFFICIENT sin evento, NOT_SUPPORTED que solo adelanta el repaso, nunca EVIDENCE. Diseño en `docs/real_world_challenges_v1.md`.

## Ronda QA 2 (`fix/qa-round-2`)
`python tests/qa_round2_backend.test.py` y `node tests/qa_round2.test.js` cubren los hallazgos de la primera prueba con Gemini real: Encuentra el error normaliza pasos en negritas o en una sola línea, ya no penaliza la opción fija «ningún paso» al medir la longitud, reintenta una vez con los motivos y los informa si falla; la pista 3 se descarta si reutiliza los números de la pregunta; el reto reintenta una vez ante contrato, seguridad o auditoría y acepta mediciones cortas con dígito (p. ej. «20»); Beto no da por convencido con una sola línea; ninguna etiqueta interna llega a pantalla; la pista de la práctica de criterios nunca queda muda y siempre cuenta como ayuda. No se probó de nuevo con Gemini real (BLOCKED en el sandbox).

## Ronda QA 3 (`fix/qa-round-3`)
`node tests/qa_round3.test.js` y `python tests/qa_round3_backend.test.py` cubren la segunda prueba con Gemini real: la auditoría de Beto sabe que la creencia es falsa a propósito y Beto reintenta una vez con el motivo (además se corrigió un error que hacía fallar en silencio la auditoría cuando recibía contexto); los enunciados conservan los saltos de línea («Paso 1:» en su propia línea); la pista de criterios se ve junto al aviso «Ayuda usada» y se recupera al recargar; la práctica de criterios sobrevive a la recarga; etiquetas de reparación, fases y dimensiones en español; el mapa explica por qué faltan prácticas mientras hay una en curso; «Esto está mal» confirma el reporte; el estado «Corrigiendo…» ya no se queda pegado mientras se guarda; los retos piden materiales coherentes con los pasos y marcan datos inverosímiles como insuficientes. No se volvió a probar con Gemini real (BLOCKED en el sandbox).

## Ronda QA 4 (`fix/qa-round-4`)
`node tests/qa_round4.test.js` y `python tests/qa_round4_backend.test.py` cubren la tercera prueba con Gemini real: el historial ya no asigna a un intento de criterios la pregunta vigente de la lección (el intento guarda su propia pregunta) y resume su evaluación por criterio; la pantalla «Resultado por criterio» y el historial no muestran códigos (`option_choice`, `SATISFIED`, `recognition`, `deterministic_option_key`); razones guardadas antes de la corrección («El intento mostró conceptual») se muestran traducidas; «Listo.» se apaga a los 3 s; una práctica terminada ya no aparece como «en curso»; si falla la microlección se muestra el motivo; «¿Hay un error?» va en su propia línea; los retos exigen papel y lápiz si hay que anotar, comparan los números explícitamente y aceptan una medición de un dígito; la observación de criterios se dirige a la persona en segunda persona. No se volvió a probar con Gemini real (BLOCKED en el sandbox).

## Informe de uso (`feat/usage-report`)
`node tests/usage_report.test.js` cubre `usageReport`: meta vacía o sin campos sin lanzar; retención por 5 franjas con porcentaje solo si n ≥ 3 y repasos con ayuda excluidos; modalidades con lo provisional marcado y las vacías omitidas; días activos, eventos de 7 días, repasos vencidos y contenidos reportados; la meta no se muta; el JSON no incluye respuestas escritas; la página `report` se restaura al recargar. Diseño en `docs/usage_report_v1.md`. No se probó con Gemini real: es solo lectura de datos locales.

## Preguntas reportadas (`feat/reported-items`)
`python tests/reported_items_backend.test.py` y `node tests/reported_items.test.js` cubren: «Esto está mal» en el diagnóstico excluye la pregunta en el servidor (`excluded_items`); una pregunta excluida no se puede responder (`ITEM_EXCLUDED`) pero un intento ya registrado se repite igual (la evidencia previa no se retira); reportar desde otra meta, con otro tipo o con un id desconocido no excluye nada; otro perfil no se ve afectado; el extracto reportado se añade a lo que el generador debe evitar; borrar el perfil borra las exclusiones; el botón solo aparece en el diagnóstico y la pregunta reportada sale de la cola sin contar como respuesta. Diseño en `docs/reported_items_v1.md`.

## Confirmación local (`feat/local-confirmation`)

`python tests/local_confirmation_backend.test.py` y `node tests/local_confirmation.test.js` cubren: la pregunta de confirmación nace con prefijo `conf-` y guarda su origen; origen o tema inválidos fallan sin llamar al modelo; un primer intento inválido se reintenta con el motivo («Corrección») y dos fallos no guardan nada; una observación de la auditoría descarta y reintenta; la calificación es local e idempotente y una pregunta de otra actividad no se responde por esta ruta; `startMixed(goal,'confirm',src)` exige origen y rechaza una segunda confirmación del mismo intento; el resultado crea `CONFIRMATION` (nunca `EVIDENCE`); reto CORRECT + confirmación CORRECT da transferencia `met`, reto PARCIAL da `partial`, sin reto de origen o solo el reto no cambia la capa; Beto o corrección confirmados suman comprensión y «No lo sé» no suma; un fallo adelanta el repaso. Diseño en `docs/local_confirmation_v1.md`.

## Fotos en los retos (`feat/challenge-photos`)

`python tests/challenge_photos_backend.test.py` y `node tests/challenge_photos.test.js` cubren: sin fotos la llamada al modelo no cambia (`images=None`); fotos válidas (JPEG, PNG, WebP) llegan al modelo y su base64 no aparece ni en el resultado ni en la base; más de 2, tipo no permitido, base64 inválido, firma incorrecta, vacía o > 1 MB se rechazan sin llamar al modelo; cambiar la foto con el mismo `attempt_id` es conflicto; `_gemini_call` y `_anthropic_call` ponen la imagen antes del texto (sin red); el cliente valida el payload, muestra el aviso de privacidad y no guarda las fotos en la meta ni en `localStorage`. Diseño en `docs/real_world_challenges_v1.md`.

## Ajustes de la ronda QA 5 (`fix/qa-round-5`)

`node tests/qa_round5.test.js` cubre: si Gemini no devuelve la pregunta del diagnóstico (respuesta vacía o error), la app reintenta una vez sola antes de mostrar el mensaje, con un máximo de dos llamadas; con una pregunta ya lista no llama al modelo; una pregunta usada o reportada no cuenta como disponible. También comprueba que las vistas de cobertura (lista del objetivo, «Ahora», cobertura del perfil, mapa de habilidades y sus registros) usan etiquetas en español para las dimensiones (`conceptual`, `interpretation`, `equation_manipulation`…) y no las claves técnicas. El historial de «Aprendizaje» es del perfil completo por diseño («Historial auditable del perfil seleccionado»), mientras que el Informe es de la meta activa: por eso sus contadores de ayuda pueden diferir. Los identificadores `attempt-…` se mantienen dentro del desplegable de auditoría «Registros de la habilidad».

## Ajustes de la ronda QA 6 (`fix/qa-round-6`)

Causa comprobada del fallo «No pude preparar una pregunta» tras «Esto está mal»: la acción posterior al reporte se ejecutaba dentro de la tarea «Enviando reporte…», que mantenía la app ocupada, y la tarea de pedir otra pregunta se descartaba sin llamar al servidor (por eso no había ninguna petición fallida). `reportButton` ahora ejecuta esa acción cuando la tarea de envío ya terminó, y solo si el envío tuvo éxito. `node tests/qa_round6.test.js` lo reproduce (falla si se restablece el orden anterior). El mensaje de rechazo de `/api/confirmation` ahora indica la familia y dimensión pedidas y las recibidas, sin añadir reintentos automáticos (la prueba `evidence_confirmation` sigue exigiendo una sola llamada).

## Ajustes de la ronda QA 7 (`fix/qa-round-7`)

- Diagnóstico: si la revisión de contenido descarta **todas** las preguntas de un lote, se regenera una vez con el motivo (mismo patrón que lecciones y retos); si se descarta solo una parte, no se reintenta. Máximo 4 llamadas (generar, auditar, generar, auditar). Lo cubren `tests/content_trust_backend.test.py`.
- Comprobación de evidencia: la prueba real mostró que el modelo escribía la dimensión en el campo de familia («pedí explanation / conceptual; recibí conceptual / conceptual»). El prompt ahora separa los dos campos explícitamente. El contrato y la regla de una sola llamada no cambian (`tests/evidence_confirmation.test.py`).
- «Aprendizaje» aclara que las modalidades nuevas se resumen en «Informe» (su historial viene de las respuestas guardadas en el servidor).

## Opciones sin pistas de longitud (`fix/choice-balance`)

La respuesta correcta se descarta si es claramente la opción más larga: al menos 12 caracteres y 25 % más larga que la opción incorrecta más larga (`CHOICE_LONGEST_GAP`, `CHOICE_LONGEST_RATIO`). Se suma a la regla anterior (el doble del promedio). Las opciones cortas, como cifras, nunca se descartan por longitud, y en Encuentra el error la opción fija «no hay error» no cuenta para la comparación. El prompt pide que cada opción incorrecta tenga la misma precisión, vocabulario y estructura que la correcta, que al menos una sea tan larga y específica como ella, y que la correcta no sea la única con cifras, unidades o matices. Como la regla es más estricta, el diagnóstico (también cuando falla el contrato, no solo la revisión), la práctica intercalada y la composición se regeneran una vez con el motivo del descarte, igual que lecciones, retos, Encuentra el error y confirmaciones; máximo dos generaciones. La lección por pasos conserva su respaldo (la explicación completa). Lo cubren `tests/choice_balance_backend.test.py`, `tests/prompt_quality.test.py`, `tests/qa_round2_backend.test.py` y `tests/prompt_bench.test.py` (los casos sintéticos «bien formados» se reequilibraron).

## Acceso en red privada (`feat/private-network-access`)

`python tests/private_network_access.test.py` comprueba que sin configurar nada el servidor queda igual (solo `127.0.0.1` y su origen), que `LEARNSCIENCE_HOST` y `LEARNSCIENCE_ORIGINS` añaden solo orígenes exactos, que los valores inválidos detienen el arranque, y con un servidor HTTP real que otro origen recibe 403 salvo que esté en la lista. Diseño en `docs/private_network_access_v1.md`.

## Telemetría de uso (`feat/usage-telemetry`)

`python tests/usage_telemetry.test.py` comprueba con respuestas simuladas que cada llamada al modelo deja una fila en `llm_calls` con tokens de entrada, salida y razonamiento (Gemini y Anthropic); que sin `usageMetadata` la fila queda con `NULL` y la llamada funciona; que un 429 o una salida incompleta se registran con `ok=0`; que un error al registrar nunca rompe la llamada; que el rechazo por límite o por falta de clave no se registra; que la tabla no guarda clave, prompt ni perfil; que tras reiniciar sobre la misma SQLite el contador diario parte de las filas guardadas y nunca baja; y que `/api/usage/summary` agrupa por ruta y acota los días. Diseño en `docs/usage_telemetry_v1.md`. No se probó con Gemini real ni en navegador: el bloque «Costo de IA» del informe es solo lectura y no se ejercitó en pantalla.

## Respuesta como dato (`fix/evaluate-data-delimiters`)

`python tests/evaluate_data_delimiters.test.py` captura el prompt que recibe el modelo en `evaluate`, `micro_start`, `micro_repair`, `repair_diagnosis` y `micro_zoom` y comprueba que una respuesta que intenta dar órdenes aparece solo entre `<<< >>>`, que un `>>>` o `<<<` escrito por la persona se elimina y no puede cerrar el cerco, y que «No sé» sigue devolviendo `UNKNOWN` sin llamar al modelo. No hay contrato nuevo de evidencia. No se probó con Gemini real: una instrucción dentro del cerco reduce, pero no elimina, el riesgo de que un modelo la obedezca.

## Novedad en la integración (`feat/integration-novelty`)

`python tests/integration_novelty.test.py` y `node tests/integration_novelty.test.js` comprueban que `_lesson_from_raw` declara novedad solo con `novelty_basis` de al menos 15 caracteres y un enunciado distinto de `check`, `guided` e `independent`; que sin base, con base corta o con el mismo enunciado no se añade ningún campo; que la base se acota; que el esquema y el prompt la piden solo en la integración; y, en JS, que una integración correcta sin ayuda con novedad cuenta como variante nueva independiente, que con ayuda no es independiente, que un rol guiado no obtiene transferencia y que una lección legacy conserva el contrato actual. Diseño en `docs/integration_novelty_v1.md`. No se probó con Gemini real: no sabemos aún con qué frecuencia el modelo declara una novedad verdadera.

## Repaso de temas saltados (`feat/placement-skip-review`)

`node tests/placement_skip_review.test.js` comprueba que al terminar el diagnóstico seis temas saltados reciben seis repasos con vencimientos repartidos entre 1 y 5 días y un evento `PLACEMENT_REVIEW_SCHEDULED` cada uno; que un tema con repaso previo no cambia; que sin temas saltados no se programa nada; y que programar no cambia `verified()`, la cobertura ni los eventos de evidencia. Diseño en `docs/placement_skip_review_v1.md`. No se probó en navegador ni con Gemini real.

## Caducidad del panel experto (`feat/expert-staleness`)

`node tests/expert_staleness.test.js` (con reloj simulado) comprueba que una capa cumplida hace 61 días pasa a `stale` y la etiqueta del tema baja, que a los 59 sigue `met`, que el repaso correcto a 10 días es parcial y a 30 cumplido, que un repaso sin ayuda reciente evita la caducidad de retención y uno con ayuda no, que sin eventos la capa es `none`, que los eventos sin fecha no caducan, que la discriminación también caduca y que el panel no escribe eventos. `tests/expert_panel.test.js` actualizó sus umbrales de retención (7 → 30 y 1 → 7 días). Diseño en `docs/expert_panel_v1.md`. No se probó en navegador.

## Confianza en el selector (`feat/selector-confidence`)

`node tests/selector_confidence.test.js` comprueba que un fallo con confianza 90 produce `REPAIR` con el motivo nuevo; que con confianza 30 la decisión no cambia; que un acierto posterior, una evaluación supersedida o un evento legacy sin `learner_signal_version` desactivan la regla; que un `UNKNOWN` posterior no la borra; que la reparación abierta conserva prioridad (`RESUME_REPAIR`); y que el selector no modifica sus entradas. Diseño en `docs/selector_confidence_v1.md`. No se probó en navegador.

## Producción corregida localmente (`feat/local-production`)

`python tests/local_production_backend.test.py` y `node tests/local_production.test.js` comprueban con modelo simulado la corrección numérica (tolerancia del 2 %, unidad normalizada, coma decimal, número correcto con unidad distinta = fallo `units`, sin valor = `UNKNOWN`) y de orden (dos pasos intercambiados = fallo; pasos publicados barajados); que la clave no sale en la respuesta pública; la idempotencia por `attempt_id` y el conflicto con otra respuesta; el rechazo de ítems de otra meta, otro perfil u otra versión; `applicable:false` y la auditoría fallida dos veces sin guardar nada; y, en JS, la disponibilidad, el respaldo de numérico a orden, el registro como `EVIDENCE` independiente por el camino central con `evaluator_trust:'deterministic'`, que el fallo cuenta y `UNKNOWN` no suma, que un tema sin la dimensión en su cobertura no acredita ninguna y un humo de la vista. Diseño en `docs/local_production_v1.md`. No se probó con Gemini real ni en navegador.

## Ejemplo que se desvanece (`feat/faded-examples`)

`python tests/faded_examples_backend.test.py` y `node tests/faded_examples.test.js` comprueban con modelo simulado que el paquete (resuelto + huecos) se valida y guarda con ids `fade-`, sin clave pública; que 2 o 6 pasos, 0 o 3 huecos, un hueco que no pasa el filtro de calidad, enunciados iguales, pasos vacíos y la auditoría fallida dos veces rechazan todo sin guardar nada; que un ítem `fade-` no se responde por otras rutas ni al revés; y, en JS, que en modo `consolidate`, `repair` o sin modo no se pide, que un fallo de la ruta o un paquete inválido deja la lección continuar sin aviso, que el ejemplo se puede saltar y que responder huecos registra `FADED_STEP` sin ningún `EVIDENCE`, ni cobertura ni repasos. Diseño en `docs/faded_examples_v1.md`. No se probó con Gemini real ni en navegador.

`node tests/open_answer_trust.test.js` comprueba que los aciertos calificados solo por el modelo exigen un ancla local (sin ancla no es suficiente; con ancla sí; una contradicción posterior la invalida), que los eventos anteriores y los deterministas cuentan como hoy, y que el marcador `TRUST` no es intento, acierto ni contradicción.

`node tests/daily_session.test.js` comprueba que el plan diario es determinista, que respeta reparación abierta y poca cuota, que un tema sin enseñanza no entra en práctica mixta ni de cálculo, que cambiar de fecha crea un plan nuevo conservando el anterior en eventos, y que construir o saltar el plan no cambia cobertura, `verified()` ni calendario.

## Perfil de experto por dominio

`python tests/expert_profile_backend.test.py` y `node tests/expert_profile.test.js` comprueban con modelo simulado que el perfil se rechaza con 3 o 9 competencias, nombres repetidos, `area_ids` vacío o ajeno, riesgo inválido y criterio fuera de 20–220 caracteres; que una competencia con un área sin abrir nunca es «Demostrada», que una capa caducada no cuenta, y que `EXTERNAL_VALIDATION` no cambia `verified()`, cobertura ni capas.

## Fuentes del aprendiz

`python tests/grounded_sources_backend.test.py` y `node tests/grounded_sources.test.js` comprueban con modelo simulado que una cita ausente del fragmento o de menos de 20 caracteres se descarta (y sin citas válidas el estado es `uncited`), que una fuente de otro perfil o meta nunca se recupera, que el texto de la fuente queda dentro de `<<< >>>` sin delimitadores propios, los límites de longitud y de 20 fuentes, el duplicado, la recuperación determinista, el borrado en cascada y que sin fuentes el prompt no cambia. En JS, las tres insignias y que ninguna operación escribe evidencia.

## QA ronda 8: etiquetas en español, selector seguro y tamaño de fuentes

`node tests/qa_round8.test.js` comprueba que todos los tipos de error del evaluador tienen etiqueta en español (sin «attention» visible). `selector_confidence.test.js` cubre ahora que un fallo seguro en un tema posterior al primer pendiente repara ese tema, y `grounded_sources.test.js` que una fuente corta no se rotula «1 mil caracteres».

## Enseñanza directa (`feat/direct-teaching`, fase 5 T1)

`python tests/direct_teaching_backend.test.py` y `node tests/direct_teaching.test.js` comprueban con modelo simulado que el paquete (ideas, pasos, ejemplo análogo y comprobación) se valida y guarda con ids `direct-`, sin clave pública; que 1 o 5 pasos, ideas vacías o de más de tres, pasos fuera de 20–450 caracteres, un ejemplo con el enunciado de la pregunta, un paso que contiene el criterio interno, una comprobación que no pasa el filtro de calidad o que repite la pregunta, y la auditoría fallida dos veces rechazan todo sin guardar nada (una sola falla reintenta con el motivo); que la pregunta y el criterio viajan entre `<<< >>>`; y que un ítem `direct-` no se responde por otras rutas ni al revés, ni desde otro perfil o meta. En JS: que el botón «No sé» existe en las fases de práctica y no en el diagnóstico ni la confirmación; que un «No sé» declarado crea `s.direct` y `DIRECT_TEACHING` con el `UNKNOWN` como único `EVIDENCE`; que un `UNKNOWN` con otro `error_type` conserva el comportamiento anterior; que la enseñanza avanza un paso por pantalla y `DIRECT_CHECK` no crea `EVIDENCE`; que, tras volver, el acierto a esa pregunta no es independiente (la línea base sin enseñanza sí lo es); que en `REVIEW` el calendario no cambia; que un segundo «No sé» ofrece la lección completa sin otra llamada; y que un fallo de la ruta o un paquete mal formado deja la sesión utilizable. Diseño en `docs/direct_teaching_v1.md`. No se probó con Gemini real ni en navegador.

## Salidas cuando la reparación no ayuda (`feat/stuck-exits`, fase 5 T2)

`node tests/stuck_exits.test.js` comprueba con modelo simulado que un diagnóstico de reparación terminado sin laguna confirmada (cierre `PARTIAL`) deja `s.stuck` con el intento padre y ofrece «Enséñamelo» sin crear `EVIDENCE` extra; que aceptar abre la enseñanza directa de esa pregunta con `source_attempt_id` del intento que abrió la reparación y registra `STUCK_OFFER` con `accepted:true` (y `false` con «Ahora no»); que una laguna confirmada, `closeRepairEpisode` directo o un abandono no ofrecen nada; que contestar la pregunta o elegir otro tema borra la oferta; y que «Abandonar reparación» desde el inicio de la meta deja el mismo estado (episodio, pila de contextos, sesión, eventos, evidencia y cobertura) que el «Abandonar episodio» existente, y no aparece sin episodio abierto. Diseño en `docs/stuck_exits_v1.md`. No se probó con Gemini real ni en navegador.

## Ejemplo con huecos tras la explicación completa (`feat/faded-after-explanation`, fase 5 T3)

`node tests/faded_examples.test.js` cubre ahora, además de lo anterior, que con la explicación completa y modo `initial` o `scaffold` «Ahora lo intento» pide el ejemplo antes de la comprobación (y que saltarlo o terminarlo lleva a ella sin volver a ofrecerlo); que en modo `consolidate`, `repair` o sin modo no se pide; que un ejemplo ya hecho, saltado o visto no se repite; y que un fallo de la ruta o un paquete inválido pasa a la comprobación sin aviso de error. Diseño en `docs/faded_examples_v1.md`. No se probó con Gemini real ni en navegador.

## Plan de estudios (`feat/study-plan`, fase 5 T4)

`node tests/study_plan.test.js` comprueba con estado sintético que `studyPlan(goal, at)` es determinista y no escribe nada; que un tema con prerrequisito sin completar queda `locked` con `missing` y pasa a `ready` al completarlo (o al continuar con pendientes, sin declarar dominio); que `next` coincide con `selectTutorAction` y, si este no devuelve tema, cae al primer `ready`; que un tema saltado por diagnóstico es `skipped` y nunca `done`; que un repaso vencido se marca (`review` o `review_due`); que una meta sin áreas es un solo grupo «Ruta» y los temas fuera de toda área abierta no se pierden; que `unlocks` nunca supera 3 ni incluye dependientes indirectos; que la vista muestra la recomendación, los estados en palabras y, al elegir un tema bloqueado, «Te conviene primero» con «Ir a» y «Aprender este de todos modos» sin `confirm()`; que este último solo añade `PLAN_OVERRIDE` (más la decisión del tutor) y deja cobertura, `verified()` y repasos intactos; y que el inicio de la meta resume el plan y enlaza a la página completa. Diseño en `docs/study_plan_v1.md`. No se probó en navegador.

## Sistema visual v2 (`feat/visual-theme-v2`, fase 5 T5)

`node tests/visual_theme.test.js` comprueba que los 14 tokens existen con los valores del plan en el tema claro y en el oscuro; que los pares de texto (`--ink`/`--bg`, `--ink`/`--surface`, `--muted`/`--surface`, `--on-go`/`--go`, `--bad`/`--bad-bg`, `--sun`/`--surface`, `--info`/`--surface`) cumplen contraste WCAG ≥ 4.5 en ambos; que `VISUAL_CSS` incluye `prefers-reduced-motion`, `:focus-visible`, altura táctil de 44 px y la regla de 640 px; que toda clase asignada con `className=` en `app.js` tiene estilo; que el estilo se instala una sola vez con id `ruta-visual-v2`; y que el selector de tema recuerda la elección, ignora valores inválidos, no se rompe si `localStorage` lanza y no modifica la meta. No valida el aspecto real en un navegador.

## Pantalla de lección (`feat/lesson-ui`, fase 5 T6)

`node tests/lesson_ui.test.js` comprueba que `lessonProgress` devuelve las cinco etapas en orden sin marcar `done` ninguna posterior a la actual y una sola etapa en los demás modos; que `verdictInfo` mapea `CORRECT`→`.good`, `PARTIAL`→`.bad` «Casi: falta una parte», `MISCONCEPTION`→`.bad` «No es correcto» y cualquier otro estado (incluido `UNKNOWN`) →`.unknown` «Sin evaluar», con el feedback íntegro; que la sesión muestra el progreso en texto, mueve «Cobertura», «Por qué se eligió» y «Adaptación» a «Por qué esta actividad» y conserva todos los textos y botones de antes; que tras responder solo «Continuar» es principal; y que el hito solo aparece tras un acierto con el tema verificado, dice «Completado con apoyo» si hubo ayuda, no aparece tras `PARTIAL`, `MISCONCEPTION`, `UNKNOWN` ni sin verificación, queda obsoleto con evidencia posterior y no escribe eventos al cerrarlo. No valida el aspecto real en un navegador.

## Inicio como camino (`feat/path-ui`, fase 5 T7)

`node tests/path_ui.test.js` comprueba que el inicio de la meta tiene exactamente un nodo `is-next`, el recomendado por `studyPlan`, con el único botón principal «Seguir: <tema>»; que un tema con prerrequisito sin completar es `is-locked`, uno verificado `is-done` y uno saltado `is-skipped` y nunca `is-done`; que las áreas sin abrir van al final atenuadas con «≈N temas»; que el orden es encabezado, camino, «Más práctica» plegado y cifras; que todos los botones del inicio anterior (lista medida con el código de T6) siguen en el árbol; que la línea se dibuja una sola vez por carga; y que pintar el inicio no escribe evidencia. No valida el aspecto real en un navegador.

## Racha y meta diaria (`feat/motivation`, fase 5 T8)

`node tests/motivation.test.js` comprueba qué cuenta como respuesta de estudio (aciertos y fallos sí; exposición, «No sé», auditoría, correcciones y eventos de registro no); la racha (3 respuestas por día, un hueco por cada 7 días, dos huecos cercanos la rompen, hoy sin estudiar no rompe, racha rota vuelve a 1, cruce de medianoche con fecha local, varias metas suman); la meta diaria 5/10/20 con valores inválidos rechazados y guardada solo en `store.motivation` sin tocar las metas; la pantalla (racha en la navegación, anillo, selector, hito una vez por día y sin escribir eventos, sin las palabras «dominio», «nivel» ni «experto»); y que plan y cobertura no cambian. No valida la sensación de uso en un teléfono.

## Navegación plegable en móvil (`fix/mobile-nav`)

`node tests/nav_menu.test.js` (DOM simulado) comprueba que todos los botones de navegación de antes (Perfiles, Metas, Aprendizaje, Preferencias, Plan, Ruta y mapa, Nivel experto, Fuentes, Informe, Tema: …) siguen en el árbol con su texto, ahora dentro de `.nav-links`; que existe «Menú» con `aria-expanded='false'` y `aria-controls`; que al pulsarlo pasa a `'true'` y el contenedor gana `is-open`; que cada botón de navegación lleva a su página (`aria-current`) y cierra el menú, incluso el de la página actual; que «Reintentar guardado» es hijo directo de la barra, fuera de `.nav-links`, para que siga visible en móvil; y que alternar el menú no modifica la meta, no añade eventos y no guarda nada.

`node tests/browser_smoke.test.js` arranca `tools/serve_controlled_demo.py` (SQLite en `os.tmpdir()`, puerto libre, proveedor controlado, sin Gemini) y abre el perfil «DEMO VISUAL SINTÉTICA» en Chromium real con Playwright. En 390×844 comprueba: sin errores de página ni de consola, sin desplazamiento horizontal, barra no fija, cerrada en una sola fila (≤ 80 px) y sin cubrir más del 15 % del alto tras `scrollTo(0,1400)` (también con el menú abierto), «Plan» oculto hasta pulsar «Menú» y cerrado de nuevo al navegar, todos los botones de `.nav-links` con el menú abierto de al menos 44 × 44 px, Enter sobre «Menú» que alterna y deja el foco en el botón, el menú que se cierra al navegar desde el contenido («Seguir: …») y exactamente un botón principal visible en el inicio. En 1280×900 comprueba «Plan» visible, «Menú» oculto y barra fija. Mata el servidor al terminar, también si falla. Si Playwright no está disponible, falla con un mensaje claro y no se omite.

`python tools/ensure_playwright.py` prepara la prueba de navegador: con `CI=true` (GitHub Actions) instala Playwright (versión fijada, 1.63.0) y Chromium; en local solo verifica que Playwright se resuelva. Así `run_ci.py` ejecuta localmente cada línea `run:` sin instalar nada. No validan iPhone/Safari real ni un teléfono físico.

## Escalera de enseñanza (`feat/teaching-ladder`)

`python tests/teaching_ladder_backend.test.py` y `node tests/teaching_ladder.test.js` comprueban con proveedor simulado y SQLite temporal que: el peldaño 2 de `/api/teach/direct` con `avoid` rechaza un paso cuyo cuerpo normalizado coincide (también en el segundo paso), reintenta una vez con el motivo y, si falla de nuevo, no guarda nada; que el peldaño 3 devuelve `{model_answer, why:[2..4]}` válido, usa el criterio interno, no guarda ítems y rechaza conteos o longitudes inválidos, y la auditoría fallida dos veces; que `rung` inválido, `avoid` que no es lista o con más de 6 elementos se rechazan sin llamar al modelo; que los campos ausentes dan exactamente el comportamiento del peldaño 1; y que «no entiendo», «no lo entiendo», «no sé cómo empezar», «no tengo idea», «no me acuerdo» y «no recuerdo» (con o sin acentos y con puntuación final) devuelven `UNKNOWN`/`lack_of_exposure` sin llamar al modelo mientras que frases parecidas dentro de una respuesta más larga sí se evalúan. En JS: la secuencia «No sé» x3 sube 1, 2, 3 sin repetir y el cuarto solo ofrece «Seguir con otro tema»; otra pregunta empieza en 1 y la escalera se reinicia en una visita nueva; una evaluación incierta no sube; `directFull` sube; un check fallado ofrece «Explícamelo de otra forma» con la idea errónea; el tope de intentos ofrece el peldaño 3 tras un fallo y no tras un acierto; el cierre `PARTIAL` desde `REPAIRING` y `PARENT_RETEST` deja la oferta con la opción extra; los pasos no resueltos muestran hasta dos botones; el fallo de la ruta no avanza, no guarda ni revela la referencia; la respuesta posterior a cada peldaño cuenta con ayuda y nunca es independiente; `REVIEW` no mueve el calendario; el peldaño 3a ofrece el prerrequisito y el 3b reprograma y regenera la lección solo al salir; el ejemplo con huecos existente se ofrece tras el peldaño 2; no se crea ningún `EVIDENCE` nuevo y un estado sin `s.ladder` se carga. Diseño en `docs/teaching_ladder_v1.md`. No se probó con Gemini real ni en navegador (solo `browser_smoke`, que no alcanza estos generadores).

Revisión de `feat/teaching-ladder`: además, el servidor rechaza sin llamar al modelo un peldaño 3 sin `reference` o cuyo enunciado coincide con un ítem de clave privada del perfil (y no bloquea por ítems de otro perfil), y comprueba que `misconception` llega entre `<<< >>>`, truncado a 300 caracteres y sin delimitadores inyectados en los peldaños 2 y 3. En JS: tras el 3b la pregunta se invalida al mostrarse la respuesta (no al salir), salir por navegación (`newVisit`) y volver con el mismo enunciado deja la respuesta con ayuda >=3, `hint_level_max` máximo e `is_independent:false` (también en `REVIEW`), `goal.ladder_shown` sobrevive a guardar, tiene tope y no afecta a metas antiguas, un reintento tras un peldaño 1 o 2 sigue con ayuda; «No lo entendí; vuelve al ejemplo», «No recuerdo» y el fallo de un repaso abren la escalera (con el calendario de `REVIEW` por las reglas vigentes); tras un 3a se permite el 3b solo si el prerrequisito ya no falta; «Ir a ese tema» no marca ayuda a la primera respuesta del prerrequisito; y un `s.direct` antiguo `repeat` o sin pregunta se descarta. Mutaciones comprobadas: quitar la defensa de `prepareRecord`, y no invalidar al mostrar el 3b, hacen fallar `teaching_ladder.test.js`. Los tests existentes no cambiaron en esta revisión.

`python tests/judge_model.test.py` y `node tests/judge_model.test.js` comprueban con `urlopen` simulado y SQLite temporal que: sin variables los tres roles usan `GEMINI_MODEL` (misma URL y `judge_model` igual al modelo base); `LEARNSCIENCE_JUDGE_MODEL` enruta `evaluate` y `micro_step` y `LEARNSCIENCE_AUDIT_MODEL` enruta `audit_content`, mientras la generación sigue con el modelo base y el rol no se filtra a llamadas posteriores; todas las funciones de juicio usan `judge_gemini`; un nombre de modelo inválido se rechaza sin llamar al proveedor (juez con error, auditoría falla abierta con constancia); un fallo del juez no reintenta con el modelo barato, no devuelve veredicto y en el criterio de explicación queda `NOT_EVALUATED` sin `judge_model` ni `CORRECT`; el fallo del auditor conserva la forma abierta y suma a `audit_failed_open`; la clave no se imprime; `/api/models` no expone secretos. `tools/sample_for_review.py` no modifica la base (hash y mtime), no mezcla perfiles, no inventa `judge_model` en datos anteriores y respeta `--n`. En JS: `prepareRecord` copia `judge_model` válido al evento, no lo inventa, no cambia independencia ni resultado, descarta valores inválidos y las líneas/avisos de pantalla cubren el caso «mismo modelo». Diseño en `docs/judge_model_v1.md`. No se probó con Gemini real ni en navegador.

Revisión de `feat/judge-model`: además, `prepareRecord` no copia `judge_model` a una corrección manual (`_source`/`_actor`), `validate_store` descarta `judge_model` inválido sin rechazar el evento, el servidor aborta al arrancar con variables de rol inválidas, un fallo del juez configurado en el criterio de explicación libera la reserva `PENDING` (nada guardado y el mismo `attempt_id` se puede reintentar; una evaluación `EVALUATED` no se libera), los envoltorios de rol restauran el rol previo (anidados y con excepción) y un test estático obliga a clasificar cada llamada a `gemini`/`judge_gemini`/`audit_gemini`. La herramienta de muestra ordena por más reciente (oferta activa de la escalera primero, `time_ns` normalizado), tolera bases antiguas y valores nulos, rechaza `--out` que sea la base o termine en `.sqlite3`/`.sqlite`/`.db` y rotula quién calificó cada intento. Mutaciones comprobadas: no restaurar el rol, no liberar la reserva y copiar `judge_model` en la corrección manual hacen fallar los tests.

`node tests/adaptive_schedule.test.js` comprueba (cliente, sin proveedor ni navegador) que sin historial suficiente (0 o 1 repaso válido, datos legacy sin campos nuevos) el intervalo coincide con la escalera `[1,3,7,14,30,60,90]`; que los aciertos independientes diferidos estiran el intervalo (más si llegó tarde, menos si el tema es difícil) y los fallos lo acortan sin volver siempre a 1 día; los límites duros (mínimo 1 día, máximo 180 o `schedule_config.max_days`); que la ayuda, `UNKNOWN`, el repaso inmediato, la auditoría, el acierto frágil, los intentos sin `attempt_id` y los duplicados no cambian nada y una corrección sustituye al evento original; el aislamiento por meta/perfil; el factor personal (1,0 con menos de 20 repasos vencidos, 0,6–1,6, los anticipados no cuentan); el determinismo (también con eventos en otro orden); que responder un repaso real vía `applyResult` fija la fecha y el motivo, que `UNKNOWN` no cambia nada y que un intento duplicado se rechaza; que el crédito jerárquico solo pospone la fecha de prerrequisitos directos de la misma meta (no cambia peldaño, historial, pregunta, cobertura ni crea `EVIDENCE`, deja `REVIEW_DEFERRED` con `creates_evidence:false`, es idempotente, acotado y no actúa con fallo, ayuda, acierto frágil, repaso inmediato, fuera de ventana ni con prerrequisitos de otra meta); que el tope diario no pierde repasos, prioriza por retraso relativo y por prerrequisitos de lo que se estudia, conserva el orden anterior cuando no hay desborde, descuenta lo respondido hoy, respeta `daily_cap` y no reescribe `due`, y que sesión de hoy y panel/informe lo muestran sin escribir nada. Mutaciones comprobadas: aceptar ayuda, aceptar `UNKNOWN`, contar duplicados, que el crédito cambie el peldaño del prerrequisito, que un fallo dé crédito, quitar el tope diario, quitar el mínimo de 20 repasos, quitar el máximo de días y que el fallo no baje el intervalo hacen fallar el test. Diseño en `docs/adaptive_schedule_v1.md`. No valida el ajuste con memoria real de personas ni el aspecto en navegador.

Revisión de `feat/adaptive-schedule`: además, `tests/adaptive_schedule.test.js` comprueba que una corrección manual de un repaso que deja de ser acierto válido revoca los aplazamientos (`REVIEW_DEFERRAL_REVOKED`, sin `node_id`, `creates_evidence:false`) y devuelve la fecha original, que el evento corregido conserva los campos temporales y sigue en el modelo como fallo y que la nota se borra; que el selector con tope toma el primer repaso ofrecible aunque los primeros de la cola tengan exposición reciente, que el selector, `buildDailyPlan` y `startBrief` abren el mismo primer repaso y que con el cupo agotado el selector automático no ofrece repaso pero «siete minutos» sí; que `deferrals`/`schedule_note` malformados se sanean al importar; que el motivo no se muestra desfasado tras `lapseReview`, `ladderReschedule` ni un cambio de fecha; que el cupo diario no cuenta dos veces correcciones ni auditoría; el envejecimiento en días absolutos; que un prerrequisito aplazado respondido en su fecha original se evalúa contra ella (`AFTER_DUE`, `due_at` original) y entra al factor personal; que 3 fallos + 8 aciertos limpios se recupera (`stretch ≥ 1`), solo pesan las últimas 12 entradas y el factor personal no pasa de 1,25; y que el informe no cuenta repasos de nodos inexistentes. `python tests/adaptive_schedule_backend.test.py` comprueba con SQLite temporal que el servidor descarta sin rechazar `deferrals` y `schedule_note` malformados (no lista, `[null]`, números inválidos), acota longitudes, conserva los válidos en la ida y vuelta y sigue rechazando referencias a nodos inexistentes. Mutaciones comprobadas: no revocar aplazamientos, no copiar los campos temporales, quitar el envejecimiento, evaluar contra el `due` aplazado y mostrar el motivo sin comprobar la fecha hacen fallar el test.

## Fórmulas y «Explora la relación» (`feat/rich-content`, `rich_content_v1`)

`node tests/rich_content.test.js` y `python tests/rich_content_backend.test.py` comprueban, con DOM simulado extendido (`createElementNS`, `createTextNode`; los demás tests no cambian), proveedor controlado y SQLite temporal, que: el convertidor de LaTeX acotado produce la estructura MathML exacta (fracciones, sub/superíndices, raíces, griegas, `\cdot \times \pm \le \ge \neq \approx \Delta \sum \int`, `\left…\right`, `\text{}`, `^\circ`) con `alttext` igual al LaTeX original y sin `aria-label`; que lo no soportado, mal balanceado, demasiado largo o sin `createElementNS` devuelve `null` y el texto se muestra idéntico; que `$` huérfano, precios (`$5 y $6`), `\$` y fórmulas inválidas mezcladas con válidas se tratan sin romper nada; que el texto sin `$` sale igual que con `E()`; que el texto del aprendiz (historial, respuestas) no se interpreta y ninguna llamada a `X(...)` usa campos del aprendiz; que `compact` es idéntico al de main (texto del aprendiz y JSON de memoria con `$` o precios se cortan en plano) y que `compact_rich`/`richClip` (mismos resultados en Python y JS) solo retroceden ante una fórmula abierta cercana y válida, nunca devuelven vacío y se usan solo en una lista cerrada de campos de contenido generado; que `echo $HOME/$USER`, `$x=$y;`, `grep ^a$|^b$`, `pre` y `backticks` no se interpretan, que `\frac12x`, `x^10` y `(x_1,2)` se convierten por token, que más de 24 fórmulas y los caracteres de control/formato dejan el texto literal; que el evaluador respeta precedencia (`-2^2`, `2^3^2`), lista blanca de funciones, rechaza `constructor`, `__proto__`, `window`, `this`, `a.b`, `x[0]`, llamadas a funciones no permitidas, multiplicación implícita, expresiones largas o muy anidadas, identificadores no declarados, y devuelve no finito (sin lanzar) en división por cero, con paridad Python/JS en `0^-1`, `(-1)^(1/0)`, `1/(0^-1)`, `min(1,0^-1)` y dígitos de ancho completo; que el evaluador de Python da los mismos resultados que el de JavaScript sobre los mismos casos (se ejecuta Node desde el test); que `exploreValidate`/`validate_explore` exigen 1–4 variables, nombres válidos y no reservados, todas usadas, `min<value<max` estricto, rangos finitos y salida finita y variable en una rejilla; que el validador rechaza `1/(x-1.3)` y `tan(x)` (muestreo por variable), pasos que no dividen el rango, valores fuera de la malla y enteros JSON gigantes, mide el tamaño igual en Python y JS, y la predicción local exige segmento monótono, sin cambio de signo y variable positiva (`1000+0.1*x`, no monótono y valor 0); que `make_explore` exige un perfil existente, aplica el tope diario por perfil, sigue esquema → validador → `audit_content` → un reintento con el motivo → error en español sin guardar nada, y responde «no aplica» sin reintentar; que el texto de la meta/tema/lección llega al modelo con `_as_data`; que los esquemas JSON no cambiaron y los diez generadores incluyen la nota del subconjunto; que `validate_store` valida cada bloque una sola vez (caché por hash) y, junto con `normalizeGoal`, descarta un `explore` malformado, enorme o con id largo sin rechazar el almacén, conservan los válidos y no persisten el árbol compilado; que la calificación numérica local da lo mismo con y sin `$` en enunciado y desarrollo, rechaza unidades con `$` o `\` y no interpreta `$60$` como número; y que la interfaz sigue predecir → explorar → comprobar: la respuesta correcta de la predicción la calcula el cliente, `EXPLORE_VIEWED` y `EXPLORE_PREDICTION` llevan `creates_evidence:false`, se registran una sola vez por bloque, y no crean `EVIDENCE`, ni cambian cobertura, `verified()`, última exposición ni la meta diaria (`studyAnswers`). Diseño en `docs/rich_content_v1.md`. No se probó con Gemini real ni en Safari.

`node tests/browser_smoke.test.js` añade, en Chromium real a 390×844 y sobre la lección preparada en la página (la semilla del demo no cambia), que una fórmula produce elementos `math` con tamaño real y namespace MathML (incluida una `<mfrac>` y una de bloque), que lo no soportado y un precio se ven tal cual, que no hay desplazamiento horizontal con fórmulas ni con la exploración, que los deslizadores miden ≥ 44 px, que la gráfica SVG cabe en pantalla y usa tokens del tema (el trazo cambia en el tema oscuro), que el teclado mueve el deslizador y que no hay errores de consola. No valida Safari ni iPhone reales.

Mutaciones comprobadas (`feat/rich-content`): aceptar identificadores no declarados (evaluador JS y Python), que `EXPLORE_PREDICTION` declare `creates_evidence:true`, que el historial del aprendiz pase por `X`, que `richClip`/`compact` no corten antes de una fórmula partida, que `validate_store` no sanee `explore`, que `EXPLORE_PREDICTION` cuente como respuesta de estudio, que un fallo de conversión devuelva un `<math>` vacío, que `compact` vuelva a cortar en una fórmula, que `_pow` no imite `Math.pow` o `NUMBER_RE` acepte dígitos Unicode, que se quite la guarda de lección sustituida, que `make_explore` no reintente con el motivo y que el validador no exija `min<value<max` hacen fallar los tests.

## Caso práctico y validación de un mentor (`feat/authentic-performance`, `authentic_performance_v1`)

`python tests/authentic_performance_backend.test.py` y `node tests/authentic_performance.test.js` comprueban, con proveedor controlado (juez y auditor simulados), SQLite temporal y funciones de `app.js` en Node con DOM simulado, que: el generador del caso sigue esquema, validador estricto, `audit_content`, un reintento con el motivo y error en español sin guardar nada; la rúbrica por etapa, la respuesta modelo y las etiquetas irrelevantes viven solo en servidor y no aparecen en ninguna respuesta, exportación ni almacén (se buscan cadenas centinela en todas las salidas); solo hay un caso activo por meta (índice único parcial); la calificación por etapa es idempotente, en orden y rechaza respuestas conflictivas; las citas del juez se verifican contra el texto del aprendiz y, si no coinciden, el criterio baja a «no evaluable»; un juez caído no deja veredicto y permite reintentar con el mismo `attempt_id`; el texto del aprendiz siempre va dentro de `_as_data`; ver la respuesta modelo cierra el caso; en el cliente una etapa solo genera evidencia sin ayuda y con veredicto válido (nunca con «No sé», `UNKNOWN`, ayuda ni dimensión alterada), nunca como transferencia, varias etapas del mismo caso cuentan como una sola observación y la calificación del modelo sin ancla local no llega a suficiente; el paquete para el mentor es HTML autocontenido con todo escapado, sin rúbrica ni respuesta modelo; el código de verificación (HMAC con secreto local) se liga al contenido guardado; y `MENTOR_ATTESTATION` no cambia cobertura, independencia, capas, racha ni calendario, el panel distingue «sin validar», «validado por mentor (declarado)», «con observaciones» y «vencido» (60 días, una fecha futura no alarga la vigencia), y la edición y anulación dejan rastro sin borrar. Diseño y límites en `docs/authentic_performance_v1.md`: la atestación no impide validarte a ti mismo. No se probó con Gemini real ni en navegador.

Revisión del supervisor (misma rama): las mismas dos pruebas cubren además el panel sin ancla local, el MAC de la atestación (falta, alterado, otra instalación, fechas futuras, `goal_id`, revisiones duplicadas o sobre anuladas), la evidencia de caso contrastada con el servidor (rechazo si no coincide; sin verificar si el caso no existe aquí), casos casi repetidos, la carrera de dos solicitudes, fugas del juez, citas copiadas del enunciado, la conciliación de todos los casos del historial y el informe de reto insuficiente.

## Alojamiento, inicio de sesión opcional y recordatorios (`feat/hosting-ready`, `hosting_ready_v1`)

`python tests/hosting_ready.test.py` (servidor HTTP real en un hilo, SQLite temporal, `urlopen` bloqueado: sin red) y `node tests/hosting_ready.test.js` (script real de la pantalla de login y `app.js` con DOM simulado) comprueban que: el servidor se niega a arrancar (proceso real, código 2) en `0.0.0.0`, `::` o una IP pública sin `LEARNSCIENCE_AUTH=required`, y con `required` sin contraseña o con un valor inválido, y que el arranque por defecto sigue sirviendo sin cookie ni Origin; el modo `off` es idéntico a antes (POST sin Origin 200, Origin ajeno 403, `/api/health` completo, CSP y cabeceras sin cambios, login 400); el hash es PBKDF2-SHA256 ≥ 600 000 iteraciones con sal aleatoria, la verificación es en tiempo constante y rechaza formatos rotos, una contraseña de 11 caracteres se rechaza, `--set-password` usa `getpass`, no acepta no coincidentes ni cortas y cierra todas las sesiones; el login correcto da cookie `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` (con `Secure` solo tras `LEARNSCIENCE_TRUST_PROXY=1` y `X-Forwarded-Proto: https`), en SQLite solo se guarda el hash del token, la caducidad es deslizante, logout y cambio de contraseña invalidan, el límite de intentos por IP crece, bloquea incluso con la contraseña correcta y se olvida; que **todas** las rutas de `ROUTES` y una lista de GET devuelven 401 sin sesión, las listas públicas son exactamente las revisadas, la pantalla de login no contiene nada del JS de la app y `/api/health` sin sesión es `{"ok":true}`; CSRF (Origin obligatorio y permitido con sesión); y para el calendario: iCalendar válido (solo CRLF, líneas ≤ 75 octetos plegadas sin partir UTF-8, texto escapado, `UID` estables y únicos, `DTSTAMP`, `VALARM`, `RRULE`), repasos agrupados por día desde `reviews[].due` guardados (vencidos en hoy, nodos inexistentes y fechas inválidas ignorados), centinelas del aprendiz y el `profile_id` ausentes, ocultar nombre, token ≥ 128 bits guardado como hash y nunca devuelto, 404 genérico para tokens inválidos, regenerar y desactivar revocan, aislamiento por perfil, borrado de perfil, límite de sondeo y el token enmascarado en el registro. También: hora flotante sin `Z`/`TZID` igual a ambos lados de un cambio de horario, conversión de fechas con el desfase del cliente, manifiesto, iconos PNG válidos (192, 512, 180) y SVG, metadatos de instalación, ausencia de service worker y CSP sin relajar. En Node: «Cerrar sesión» solo con auth activo (menú y perfiles), 401 con recarga, panel «Recordatorios» (payload con hora, días, zona y ocultar nombre; enlace `webcal://`; regenerar con confirmación; desactivar; el enlace no se vuelve a mostrar), el aviso al abrir (solo con repasos vencidos, sin estudio hoy, descartable, no escribe eventos) y estilos de las clases nuevas.

`node tests/browser_smoke.test.js` añade, en Chromium a 390×844 y sin configurar nada, que la app carga sin pantalla de login, `/api/auth/status` dice `off`, hay manifiesto, `apple-touch-icon` y los dos `theme-color`, no existe «Cerrar sesión» y el panel de recordatorios no desborda.

Mutaciones comprobadas: quitar la protección por defecto de una ruta, permitir POST sin Origin con auth activo, no revocar sesiones al cambiar la contraseña, poner `Secure` sin confiar en el proxy, no escapar el texto del `.ics`, no plegar líneas, incluir un dato del aprendiz en el `.ics`, aceptar un token revocado y aceptar `0.0.0.0` sin auth hacen fallar los tests.

Sin validar: un iPhone real (suscripción al calendario, «Añadir a pantalla de inicio», refresco periódico), el Calendario de iOS real con `webcal://` por HTTP, HTTPS real detrás de un proxy (cookie `Secure`, `X-Forwarded-*`), la imagen de Docker (no se construyó) y un servidor alojado de verdad. El flujo login → app → cerrar sesión se comprobó una vez a mano en Chromium contra el servidor real, no en CI. Diseño en `docs/hosting_ready_v1.md` y `docs/hosting_v1.md`.

Revisión del supervisor (misma rama): las mismas pruebas cubren además: el volumen global de fallos solo ralentiza (el dueño entra tras 25 fallos ajenos; sustituye al antiguo bloqueo global), el bloqueo duro por IP con LRU de 10 000, la reserva del intento antes de verificar (60 peticiones simultáneas: como mucho 5 verificaciones; límite de 2 PBKDF2 concurrentes y 429 con la reserva liberada), la cookie `ruta_device` (HMAC, atributos, contador propio, exención del bloqueo por IP, falsificada o rotada al cambiar la contraseña), el calendario (token válido siempre servido tras fallos propios y ajenos, `?query` ignorada), `X-Forwarded-*` ignorado de un par no confiable y creído de uno de confianza, el arranque sin auth (loopback y 100.64/10 sí; 192.168/10/172.16/fc00 solo con `LEARNSCIENCE_ALLOW_LAN_WITHOUT_AUTH=1`; `0.0.0.0` nunca), el aviso de proxy en modo `off`, el aviso de contraseña en claro, la cookie `__Host-ruta_session` con `Secure` (variable o origen `https://`), `SameSite=Lax`, caducidad absoluta de 90 días, `POST /api/logout/all`, `X-Frame-Options`/`frame-ancestors`, la validación de `Host` (positivos: enlazado, loopback, localhost, origen declarado; negativos: rebinding) y el ancla del `.ics` con servidor en UTC y cliente en America/Monterrey de noche. **`OwnerTailscaleScenario` fija el uso del dueño** (Host y Origin con la IP de Tailscale enlazada: página, API, creación de perfil, manifiesto, calendario; localhost; sitio ajeno y host ajeno bloqueados). En Node: solo `https://` en el panel con origen HTTPS y «Cerrar todas las sesiones» con confirmación.

Mutaciones de la revisión: volver a bloquear con el contador global, no reservar el intento antes de verificar, creer `X-Forwarded-For` de cualquier par, permitir 192.168.x sin auth sin la variable, no validar `Host`, quitar el tope absoluto de sesión, no servir siempre un token válido y no exigir `https://` en el prefijo `__Host-` hacen fallar los tests.

## Copia de seguridad diaria y prueba de calendario con reloj fijo (`feat/lote1-backup-tests`, `backup_v1`)

`python tests/backup.test.py` (SQLite temporal con espacios y acentos en la ruta, servidor HTTP real en un hilo, sin red ni proveedor) comprueba: copia verificada y consistente con un hilo escribiendo a la vez (pares de filas siempre completos), `integrity_check` fallido descarta la copia y conserva la anterior, detección real de una base corrupta, rotación a 14 sin tocar archivos ajenos (nombres parecidos, subcarpeta, archivo fuera de la carpeta), una vez por ejecución y solo con la última copia de más de 24 h, un fallo de copia nunca lanza y el servidor sigue respondiendo, hilo daemon, carpeta por defecto fuera del repo, permisos 0600 (solo Unix), no toma `LocalDatabaseServerLock`, `/api/backup/status` exige sesión y no filtra rutas ni nombres, y las copias no se sirven por HTTP ni entran en las exportaciones JSON. `node tests/hosting_ready.test.js` cubre el texto de la línea «Última copia».

`tests/hosting_ready.test.py::test_profile_isolation` ya no usa `datetime.date.today()`: inyecta el instante fijo `NOW_MS` en la creación de ajustes y en la construcción del calendario y compara con `20261116`.

Mutaciones comprobadas: quitar la verificación de integridad, aflojar el patrón de nombre de la rotación, conservar 13 en vez de 14, ignorar la regla de 24 h, crear la copia con 0644; cada una hizo fallar su prueba y se restauró. Cambiar la fecha esperada del calendario a otro día hace fallar la prueba de aislamiento.

Sin validar: Windows real (permisos heredados de la carpeta, rutas reales, base en uso por el servidor del PC del dueño), un servidor que lleve semanas sin reiniciarse, el disco lleno de verdad, y un navegador real para la línea de Preferencias.

## Producción en el diagnóstico (`feat/placement-production`, `placement_production_v1`)

`node tests/placement_production.test.js` comprueba la regla de estado (opción múltiple correcta + producción correcta => `held`; opción múltiple correcta + producción fallida, pendiente o no disponible => `fragile`; producción sola, también dos correctas, nunca `held` ni propaga y se rechaza), el arreglo aparte (`p.productions` frente a `p.answers`), la inferencia `heldInf` bloqueada, el evento (`evidence_role:'diagnostic'`, `is_independent:false`, `counts_as_learning_failure:false`, `contradicts_sufficiency:false`, `evaluator_trust:'model_single'`, `policy_version`), que `lastFailure` no se reinicia ni la producción cuenta como éxito independiente (con control: un fallo de aprendizaje real sí), duplicados, cuota agotada y juez caído a `fragile` sin romper el diagnóstico (una sola generación), lote único con tope de 3, la salida «seguir solo con opción múltiple» (sin dominio y con repaso programado) y la compatibilidad con diagnósticos anteriores. `python tests/placement_production.test.py` comprueba 1 generación + 1 auditoría por lote con tope de 3, cuota agotada y juez caído sin guardar nada, rúbrica ausente de la respuesta, de la exportación y de `profile_load`, feedback que copia la rúbrica sustituido, eco, respuesta corta y «no sé» sin llamar al juez, duplicado idempotente, una sola calificación por pregunta, otro perfil, inyección (respuesta entre `<<< >>>`, `>>>` eliminado) y rutas registradas. `tests/judge_model.test.py` clasifica `make_placement_production_items` (generación) y `answer_placement_production` (juez). Los tests existentes `placement.test.js` y `placement_skip_review.test.js` quitan el plan de producción tras `startPlacement` para seguir cubriendo el contrato de solo opción múltiple.

`tests/rich_content_backend.test.py` sube la lista cerrada de líneas con `compact_rich` de 27 a 29 (enunciado abierto y comentario del juez, decisión explícita).

Revisión del supervisor: nuevos tests de «seguir solo con opción múltiple» (caso d/a/b/c: sigue `fragile` y no propaga), lote `ready` con pregunta solo para `e`, evidencia previa sin producciones, reconsulta con el mismo `attempt_id`, tope y reserva en el servidor (incluidas dos hilos con `attempt_id` distintos que califican una sola vez), parafraseo de la rúbrica, auditoría abierta y motivo con Anthropic.

Mutaciones de la revisión (todas hicieron fallar su prueba y se restauraron): saltar deja `held` lo pendiente, lote `ready` que bloquea en el primer pendiente, producción como evidencia previa, sin reconsulta por tiempo de espera, sin tope de lote en el servidor, sin reserva antes del juez, sin liberar la reserva si el juez falla, sin comparar palabras, lote conservado con auditoría abierta y fallo del juez sin normalizar.

Mutaciones comprobadas (rompe, falla, restaura): permitir `held` con producción sola, guardar las producciones en `p.answers`, dejar que la producción reinicie `lastFailure`, filtrar la rúbrica en la respuesta pública, no bloquear la inferencia `heldInf`, no sustituir un comentario que copia la rúbrica, quitar el tope de 3 y permitir recalificar la misma pregunta con otro `attempt_id`.

Sin validar: Gemini real (calidad de las rúbricas y del juez, tasa de falsos negativos con respuestas legítimas), navegador (la pantalla se probó solo con un DOM simulado) y el efecto pedagógico de pedir la respuesta abierta.

## Dificultad adaptativa de la práctica (`feat/practice-difficulty`, `practice_difficulty_v1`)

`python tests/practice_difficulty.test.py` (SQLite temporal, proveedor controlado con contador de llamadas, sin red; las reglas de `app.js` se ejecutan con historias sintéticas mediante el puente `tests/practice_difficulty_runner.js`) y `node tests/practice_difficulty.test.js` comprueban: sin historial = `standard` y prompt idéntico al de antes; `/api/confirmation`, `make_production_item` y `make_lesson` aceptan `base`, `standard` y `challenge` y rechazan cualquier otro valor con error en español antes de llamar al modelo y sin guardar nada; que una práctica `base` no suma para `sufficient()` (ni sola ni mezclada) y que los eventos sin banda cuentan como antes; que un desafío sin suficiencia previa se registra como `standard` y su fallo sí contradice (también con `activityEvidence` a solas), y que un fallo en `base`, `standard` o sin banda reinicia `lastFailure`, quita la suficiencia y abre reparación; que con suficiencia un fallo en `challenge` no borra aciertos, no cambia `sufficient()`, no abre reparación ni el aviso por confianza alta, pero sí queda como dato para la banda; ayuda, `UNKNOWN`, duplicados y correcciones manuales no suben ni cuentan dos veces; la tabla de transiciones (muestra mínima 3, ventana 5, sube con ≥ 85 %, sale de `base` con ≥ 80 %, baja con ≤ 50 %, incluida la secuencia `FFSSSFSSS` que ya no se queda en `base`) y la histéresis de 2 evidencias (no oscila y no encadena dos cambios); que la profundidad de `lesson_adaptation` gana sobre la banda (`base` solo con `repair`/`scaffold`, `challenge` nunca en una lección); que cada petición sigue haciendo una sola llamada al proveedor y que ni el juez ni la auditoría se llaman de más (`practice_band` y `lesson_band` no llaman al modelo, por lo que `tests/judge_model.test.py` no cambia); que el cliente envía `base` en confirmación y producción y que el evento lo conserva con `difficulty_policy_version`; la línea «Nivel: …» con su motivo, como texto plano; y que `validate_store` tolera eventos sin banda, descarta bandas inválidas sin inventar ninguna, restaura un respaldo y no mezcla perfiles. Diseño en `docs/practice_difficulty_v1.md`.

Revisión del supervisor, también con prueba: una producción `base` correcta no crea ancla local; el panel experto no cuenta `base` como independencia y no se ofrece «Confirma con una pregunta rápida» tras un acierto `base`; los motivos «Subiste/Bajaste» solo con cambio efectivo dentro de la ventana; una lección en caché con banda caducada se regenera en `TEACH` (una vez, sin bucle, y no a mitad de la práctica); y `validate_store` retira la exención de contradicción cuando descarta una banda.

Mutaciones comprobadas (rompe, falla, restaura): que `base` cuente para `sufficient()`, que la ayuda suba la banda, que un fallo en `challenge` cambie `sufficient()`, quitar la histéresis, que una producción `base` cree ancla, que el panel cuente `base`, que la exención valga sin suficiencia previa, que la lección acepte la banda sin respetar `lesson_adaptation` y quitar la lista cerrada de valores.

Sin validar: Gemini real (si el modelo distingue de verdad una pregunta `base` de una `standard` o `challenge`, y la calidad de esas preguntas), navegador (la línea de nivel solo se probó con un DOM simulado) y el efecto pedagógico sobre la retención. Los umbrales (ventana 5, mínimo 3, 85 %/50 %, histéresis 2) son valores de ingeniería sin calibrar con datos reales.

## prerequisite_review_v1 (lote 4a, revisión de prerrequisitos desde errores)

`node tests/prerequisite_review.test.js` comprueba (cliente, sin red ni navegador): un solo fallo con `error_type='prerequisite'` no dispara y deja el salto de P intacto; dos fallos de aprendizaje en intentos distintos sí (evento `PREREQUISITE_REVIEW` sin `node_id`, `creates_evidence:false`, P deja de estar saltado y su repaso se adelanta, sin `EVIDENCE`, cobertura ni dominio en P y sin borrar `PLACEMENT_SKIP`); no cuentan los fallos de diagnóstico, `UNKNOWN`, otro `error_type`, duplicados ni los anteriores a un acierto independiente de X; la corrección manual que anula el disparador revoca (`PREREQUISITE_REVIEW_REVOKED`, sin `node_id`), devuelve el salto y la fecha del repaso, y una corrección fallo→fallo cuenta un solo intento; sin arista X→P no hay propuesta ni se crean aristas; otra meta, otro perfil y eventos de otro perfil no ven la propuesta; datos legacy sin `events`/`reviews` no fallan; en el plan P pasa a `ready`, X y su dependiente no quedan `locked` con evidencia propia, la frase llana no tiene números y el selector pone P antes que X solo cuando hay propuesta; el contador de llamadas al modelo queda en 0. `python tests/prerequisite_review.test.py` (SQLite temporal) repite los casos del disparador con la lógica real de `app.js` mediante `tests/prerequisite_review_runner.js`, comprueba cero llamadas al modelo (con `gemini` parcheado para fallar), que el servidor tolera y conserva los eventos sin `node_id`, que exportar y restaurar los conserva, que otro perfil no los ve y que los datos legacy sin propuesta se validan sin inventar nada.

Tests existentes cambiados: `tests/placement.test.js` (bloque «Skips are revoked…»): antes afirmaba que **un** fallo con `error_type='prerequisite'` en `c` reabría `b`; ahora afirma que un fallo ya no lo reabre y que dos intentos distintos sí, porque la regla única de `prerequisite_review_v1` sustituye a la de un fallo. El resto de tests existentes no cambió.

Mutaciones comprobadas (rompe, falla, restaura): que el disparador sea 1 fallo, que el evento lleve `node_id`, que la propuesta cree `EVIDENCE` en P, que X quede `locked` con evidencia propia, que la corrección no revoque y que se adivine P sin arista hacen fallar los tests. Diseño en `docs/prerequisite_review_v1.md`.

Corrección `feat/prerequisite-review-fix` (revisión de Opus): `tests/prerequisite_review.test.js` añade casos para un P a la vez en el orden del mapa (`[zeta, alfa, x]` con `x.prerequisites=['zeta','alfa']` ofrece solo `zeta`; `alfa` solo con fallos nuevos), revocar X1 sin deshacer el adelanto mientras X2 siga activa (`restored:false`; al revocar X2 se restaura), fallo en episodio de reparación que no cuenta (M9), acierto con ayuda que no reinicia el conteo (M11), P con dominio sin propuesta (M5), acierto independiente en banda `base` que no reinicia y en `standard` sí, y propuesta huérfana inerte (sin selector ni eventos nuevos). Mutaciones comprobadas (rompe, falla, restaura): quitar el filtro `repair_episode` en `prqFailures`, permitir acierto con ayuda, quitar `!verified` en `prqCandidates`, quitar el filtro de banda `base`, ordenar por `at`/`proposal_id`, restaurar siempre al revocar, quitar `prqOfferable` y revocar huérfanas.

Sin validar: Gemini real (si `error_type='prerequisite'` es fiable en el juez), navegador (solo se probó con DOM simulado), qué prerrequisito falla de verdad cuando X tiene varios.

## mobile_polish_v1 (lote 5, pulido para iPhone)

`node tests/mobile_polish.test.js` comprueba (cliente, DOM simulado, sin red ni navegador): el borrador de la respuesta abierta se guarda con la clave `ls-draft:<profile_id>:<activity_id>`, se restaura al volver, se conserva si el envío falla y se borra al enviar con éxito; un borrador de otro perfil no aparece ni se mezcla; un `localStorage` que lanza no rompe la página; el borrador no genera llamadas al servidor (contador de `fetch`), ni eventos, ni entra en la meta ni en la petición de evaluación. También hace comprobaciones textuales de `VISUAL_CSS` (cuatro `env(safe-area-inset-*)`, `min-height:44px;min-width:44px` y `font-size:16px` en el bloque de 600 px) y de `viewport-fit=cover` en `app_legacy.py`. Una prueba textual no prueba el aspecto real.

Mutaciones comprobadas (rompe, falla, restaura): quitar el borrado al enviar con éxito y quitar el perfil de la clave. Ambas hacen fallar el test (se probaron sobre copias de `app.js` con `LS_APP_JS`).

Sin validar: Safari/iPhone real (muesca, teclado, zoom al enfocar), Gemini real y otros anchos de teléfono. Ver `docs/mobile_polish_v1.md`.

## Informe de calibración del juez (`judge_calibration_v1`)

`python tests/judge_calibration.test.py` (SQLite temporal con eventos sintéticos, sin red ni proveedor) comprueba que `tools/judge_calibration.py`: calcula el acuerdo juez↔confirmación local y el desacuerdo, cuenta la corrección manual aparte (no como evaluación ni acuerdo), nunca cuenta `UNKNOWN` (del juez o de la confirmación) ni campos ausentes de datos anteriores como acuerdo, agrupa los eventos sin `judge_model` como «unknown (dato anterior)», marca «insuficiente» sin porcentaje toda celda con menos de 30 casos, no incluye texto de respuestas ni de preguntas ni el id de perfil en claro (solo hash corto), no modifica la base (hash antes y después) y rechaza `--out` igual a la base. Mutaciones comprobadas (rompe, falla, restaura): contar `UNKNOWN` como acuerdo, quitar la marca de insuficiente (`MIN_CELL=0`) e imprimir el id de perfil en claro hacen fallar el test. Diseño en `docs/judge_calibration_v1.md`. Sin validar: datos reales (pocos casos todavía) ni Gemini real.
