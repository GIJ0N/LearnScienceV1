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
- Retorno a `full` (una sola dirección, con `support_returned=true`): un fallo posterior o un «No sé» tras `lean`, «No lo entendí» y `directFull` lo provocan.
- Evento `TEACHING_SUPPORT` `{version:'worked_examples_v1', node_id, support, reasons, creates_evidence:false}`, uno por lección nueva. No está en `EXPOSURE_TYPES`, `TEACHING_REF_TYPES` ni `isStudyAnswer`. `validate_store` fuerza `creates_evidence=false`.

### Vista

- `lean`: no se piden pasos; el ejemplo va en un `<details>` cerrado «Ver un ejemplo resuelto»; no se ofrecen ejemplos con huecos (`fadedAllowed` es falso); «Ahora lo intento» pasa a la comprobación; «Prefiero ir paso a paso» deja `full`, marca `support_optin` y pide pasos con `learner_requested`.
- `full`: sin cambios respecto a la versión anterior.

### Servidor

`POST /api/lesson/steps` calcula `lesson_adaptation(relevant_memory(...), target_dimension)`. Si el resultado es `consolidate` y no llega `learner_requested=true`, responde `{code:'STEPS_NOT_NEEDED', steps:[]}` sin llamar al modelo. El cliente trata esa respuesta en silencio: pasa a `lean` sin aviso de error ni `stepsUnavailable` permanente.

### Evidencia

Ninguna. El apoyo y su decisión no crean `EVIDENCE`, no cambian cobertura, calendario, `lastExposure`, `delayedReference` ni la racha. Ver `docs/evidence_policy_v1.md` (nota L4a).

### Compatibilidad y reversión

Campos y evento aditivos. Las lecciones guardadas antes de L4a quedan `full`. Revertir deja los `TEACHING_SUPPORT` guardados sin efecto, porque ningún código de evidencia los lee.

### Límites

- La decisión usa señales que ya existen (colocación, banda, acierto independiente) y no mide si `lean` mejora el aprendizaje.
- `lean` depende de datos previos del tema; un tema nuevo siempre es `full`.

## L4b: pendiente (no implementado)

Ejemplos resueltos con gemelos (`/api/lesson/worked`), apertura única, porqués de opción múltiple y escalera de retirada gradual. Esta versión no crea esos endpoints ni los ítems `wex-`. Ver la especificación del director; se abrirá como lote separado.
