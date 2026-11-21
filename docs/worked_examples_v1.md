# Ejemplos resueltos y apoyo por pericia (`worked_examples_v1`)

## L4a: inversión por pericia (implementado)

### Propósito

Una lección con pasos y ejemplos resueltos ayuda a un aprendiz que aún no domina el tema. Si el aprendiz ya lo domina o lo está practicando con banda `challenge`, esa lección es ruido. L4a decide por lección si se muestra el apoyo completo (`full`) o el apoyo reducido (`lean`).

### Decisión

- `teachingSupport(goal, id, lesson)` es una función pura que devuelve `{support, reasons}`.
- `lean` requiere al menos una señal y ningún veto:
  - `adaptation_mode === 'consolidate'`;
  - colocación `held` o `inferred_held`;
  - banda de práctica `challenge`;
  - acierto independiente en la dimensión objetivo `lesson.target_dimension` (no en otra).
- Vetos (anulan `lean` y dejan `full`): modos `repair` y `scaffold`; último intento del tema `UNKNOWN` (incluido «No sé; enséñamelo») o con `lack_of_exposure`; fallo de aprendizaje posterior a la creación de la lección; revisión o desbloqueo (`unskip`) de prerrequisito activa en el tema; `support_optin`; pasos ya iniciados; lección guardada sin `support` (legado, comportamiento de hoy).
- La decisión se congela en `lesson.support` (con `support_reasons` y `support_at`) en la primera visita. Repintar no la recalcula.
- Retorno a `full` (una sola dirección, con `support_returned=true` y `support_optin=true`): un fallo posterior o un «No sé» tras `lean` lo provocan. «No lo entendí» y `directFull` también lo hacen aunque la lección aún no esté congelada, y escriben el registro `full` si no existe.
- Ventana del fallo posterior: desde la primera creación de la lección del tema (`first_created_at`, recuperada del `TEACHING_SUPPORT` guardado) o desde el último acierto, lo que proteja más. Regenerar la lección no reinicia la ventana.
- Un único `TEACHING_SUPPORT` por lección (clave `lesson_created_at`); cambiar la decisión lo actualiza en lugar de duplicarlo.
- Evento `TEACHING_SUPPORT` `{version:'worked_examples_v1', node_id, support, reasons, creates_evidence:false}`, uno por lección nueva. No está en `EXPOSURE_TYPES`, `TEACHING_REF_TYPES` ni `isStudyAnswer`. `validate_store` fuerza `creates_evidence=false`.

### Vista

- `lean`: no se piden pasos; el ejemplo va en un `<details>` cerrado «Ver un ejemplo resuelto»; no se ofrecen ejemplos con huecos (`fadedAllowed` es falso); «Ahora lo intento» pasa a la comprobación; «Prefiero ir paso a paso» deja `full`, marca `support_optin` y pide pasos con `learner_requested`.
- `full`: sin cambios respecto a la versión anterior.

### Servidor

`POST /api/lesson/steps` calcula `lesson_adaptation(relevant_memory(...), target_dimension)`. Si el resultado es `consolidate` y no llega `learner_requested=true`, responde `{code:'STEPS_NOT_NEEDED', steps:[]}` sin llamar al modelo. El cliente trata esa respuesta en silencio. Si la decisión de full no tenía veto, pasa a `lean` y actualiza el registro con el motivo `servidor_consolidate`. Si tenía veto (fallo posterior, «No sé», opt-in, retorno o lección legada), se mantiene `full` y la lección se muestra sin pasos, sin aviso y sin volver a pedirlos.

### Evidencia

Ninguna. El apoyo y su decisión no crean `EVIDENCE`, no cambian cobertura, calendario, `lastExposure`, `delayedReference` ni la racha. Ver `docs/evidence_policy_v1.md` (nota L4a).

### Compatibilidad y reversión

Campos y evento aditivos. Las lecciones guardadas antes de L4a quedan `full`. Revertir deja los `TEACHING_SUPPORT` guardados sin efecto, porque ningún código de evidencia los lee.

### Límites

- La decisión usa señales que ya existen (colocación, banda, acierto independiente) y no mide si `lean` mejora el aprendizaje.
- `lean` depende de datos previos del tema; un tema nuevo siempre es `full`.

## L4b: ejemplo resuelto con gemelos, porqués y escalera (implementado)

### Propósito

Mostrar un problema resuelto con sus porqués y después pedir al aprendiz gemelos del mismo problema con huecos, retirando la ayuda peldaño a peldaño. Todo es formativo: nada de esto es evidencia de dominio.

### Servidor (`app_legacy.py`)

- `POST /api/lesson/worked` (`make_worked_set`): genera un conjunto `wexs-` con un problema resuelto (3–5 pasos; 4–5 en `procedure`), 2–3 porqués de opción múltiple (3–4 opciones, cada incorrecta con su idea errónea) y 3–4 gemelos cuyos dos últimos pasos son huecos. Tipos: `numeric` (valor, unidad y pregunta ocultos), `procedure` (opción múltiple en los huecos; el problema solo ordena los pasos) y `concept` (opción múltiple).
- Validación local (`_validated_worked`): el número de pasos coincide entre el ejemplo y cada gemelo; solo los dos últimos son huecos; el valor oculto no aparece como número en el enunciado ni en los pasos del gemelo (regla `shown` con frontera numérica: `_number_shown`); enunciados distintos entre sí y de las prácticas de la lección (`_too_close` con `avoid` y la lección guardada vía `_case_goal`). Esquema → validador → `audit_content` → un reintento con el motivo → error en español. Nunca se guarda nada parcial: el conjunto y sus porqués se escriben en una sola llamada a `save_placement_items`.
- Público: `{schema_version, set_id, node_id, kind, worked:{prompt, steps:[{text, why?}]}, twins:[{index, prompt}]}`. Nunca lleva claves, valores ni pasos de los gemelos.
- Sin modelo y antes de llamarlo: `WORKED_NOT_NEEDED` si la adaptación es `consolidate` y no llega `learner_requested`.
- `POST /api/lesson/worked/open` (`open_worked_blank_set`): abre un gemelo en un peldaño. Peldaño 1 oculta el último paso; 2 los dos últimos; 3 es el problema solo (numérico: resultado final con `expected_unit`; `procedure`: ordenar los pasos barajados; `concept`: opción múltiple del último paso). La apertura es única: el id determinista `wexo-<set>-<index>` es el candado (PK de `placement_items`). Otro peldaño devuelve la apertura original; ante `IntegrityError` se vuelve a leer.
- `POST /api/lesson/worked/answer` (`answer_worked_item`): calificación determinista. Choice con `_answer_choice_item`; numérico con `_grade_numeric` (tolerancia del 2 % y unidad); orden con `_grade_order`. Evaluador `worked-local-v1`. Solo cuenta la primera respuesta de cada ítem (`first_per_item` en `record_placement_answer`); las siguientes devuelven la primera con `already_answered`.
- `POST /api/lesson/worked/why` y `POST /api/lesson/worked/why/open`: porqué de opción múltiple (mismo cálculo) y porqué abierto. El texto (1–600) se registra antes de revelar la justificación de referencia y nunca va a `/api/evaluate` ni al modelo.
- Todas las rutas validan `profile_id` y `goal_id`, comprueban `schema_version` y `wex_role` de cada ítem (`set`, `why`, `blank`, `open`) y no mezclan ítems entre perfiles ni metas.
- `_ordering_steps` (extraído de `_build_production_item`) y `_grade_numeric`/`_grade_order` (extraídos de `answer_production_item`) mantienen el comportamiento de la producción local; sus pruebas siguen verdes.
- `validate_store`: `WORKED_WHY` (texto ≤600) y `WORKED_LADDER_END` fuerzan `creates_evidence=false`.
- Los prompts de `worked`, de los gemelos y del ejemplo antiguo entran en el corpus de distancia de `_transfer_near_texts`.

### Cliente (`app.js`)

- `workedAllowed(l)`: solo para lecciones con `adaptation_mode` `initial` o `scaffold`, sin `lean`. Una lección nueva (`worked` y `faded` indefinidos) pide `/api/lesson/worked` una sola vez; una lección con `faded` definido (objeto o `null`) sigue el flujo antiguo. `fadedAllowed` es falso cuando `worked` está definido.
- Los cuatro puntos de llamada (ensayo «Ahora lo intento», cierre de la lección por pasos, comprobación en TEACH y el peldaño 2 de la escalera) usan `workedStage` antes del flujo antiguo.
- `workedLadder(goal, set)` es pura. Lee solo los `FADED_STEP` del conjunto y los cierres. Empieza en peldaño 1; una apertura completa (2 huecos en peldaño 2; 1 en los demás) con todos los aciertos sube (máximo 3, y el 3 acertado es `solo_correct`); un fallo o «No sé» baja (mínimo 1). Dos fallos seguidos en peldaño 1 dan `needs_teaching`. Un cierre registrado manda.
- `whyMode(goal, nodeId)` es pura: abierto tras dos aciertos de menú seguidos con ítems distintos; vuelve al menú tras «Dije otra cosa». Solo cuenta la primera respuesta de cada ítem.
- Huecos: `applyWorkedBlank` registra `FADED_STEP` con `worked_version`, `set_id`, `twin_index`, `rung`, `blank_kind` y `step_index`. No llama a `markReviewExposure`, no crea `EVIDENCE` ni llama a `applyProductionResult`/`createTrustAnchor`.
- `needs_teaching` (`workedNeedsTeaching`): registra `WORKED_LADDER_END`, marca el conjunto como hecho y devuelve la lección a paso a paso con `learner_requested` (`returnToFullSupport`).
- «Ya puedo solo» (`workedSelfSkip`): registra `WORKED_LADDER_END` con `reason:'self_skip'` y abre el problema solo (peldaño 3) del siguiente gemelo.
- Exposición formativa: al mostrar el ejemplo, `noteTeachingExposure` una vez; al retomarlo otro día, `recordFormativeExposure` con `worked_example`; al revelar la solución de un gemelo, `recordFormativeExposure` con `worked_examples` (deduplicado).
- La petición de un conjunto se marca en vuelo (`workedInFlight`). Un fallo deja `worked=null` (nunca guardado a medias) y no se reintenta solo.
- La interfaz usa `E`, `X` y `B`; no hay `innerHTML`. Las opciones se pintan con `renderPlacementItem`; los huecos numéricos y de orden tienen su propio renderizador táctil (`wex-slot`, entradas de 44 px).

### Evidencia

Ninguna. Los huecos, el problema solo y los porqués no crean `EVIDENCE`, `TRUST`, cobertura, calendario ni ancla. No entran en `EXPOSURE_TYPES` (`WORKED_WHY`), `TEACHING_REF_TYPES` ni `writtenDeterministic`, y su `evaluator_version` (`worked-local-v1`) no es `local-production`. Los huecos del ejemplo con `worked_version` no cuentan para la racha (`isStudyAnswer`). Ver `docs/evidence_policy_v1.md` (nota L4b).

### Compatibilidad y reversión

Ítems `wex-`, `wexs-` y `wexo-` nuevos y otro `schema_version`: `produce`, `faded` y `placement` los rechazan y viceversa. Eventos aditivos. `/api/lesson/faded` se mantiene. Las lecciones guardadas con `faded` siguen igual. Revertir deja los ítems y eventos sin efecto: ningún código de evidencia los lee.

### Límites y pendiente de validar

- Validado con proveedor controlado (respuestas simuladas): no hay llamadas reales a Gemini.
- Sin validar: navegador real y móvil (390 px), calidad del ejemplo con el modelo real, y si la escalera mejora la retención (requiere uso real).
- El peldaño de cada apertura lo pide el cliente y el servidor no comprueba la progresión: no da crédito extra porque la calificación de cada hueco es determinista y la apertura es única por gemelo.
- Cobertura parcial de algunos casos de §6 de la especificación: el sondeo de transferencia que coincide con un gemelo rechazado, la exposición diferida «mismo día no confirma» y el formato MathML de `$..$` en los enunciados no tienen prueba propia.
- La respuesta grande (más llamadas y latencia) se degrada a `worked=null` si falla.
