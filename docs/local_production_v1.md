# Ítems de producción corregidos localmente (`local_production_v1`)

Practicar cálculo y secuencia sin juez de modelo. Es la primera evidencia firme **determinista** de producción: la corrección la hace
el servidor con una clave exacta, no un modelo.

## Contrato

**Generación** (`POST /api/practice/produce` `{profile_id, goal_id, goal, node:{id,name,outcome}, kind:'numeric'|'ordering'}`):

- `numeric`: un problema con una única respuesta numérica (`value`, `unit`, `solution`). El servidor exige `applicable` verdadero, `value`
  finito (no booleano), `unit` de 1 a 16 caracteres, al menos un dígito en el enunciado y que el enunciado no contenga el resultado.
- `ordering`: 3 a 6 pasos distintos (normalizados) de 8 a 160 caracteres, sin numerar ni empezar por «Paso». Los pasos se publican
  **barajados** con ids reasignados (`s1…`), nunca en el orden correcto.
- `applicable:false` → `PRODUCTION_NOT_APPLICABLE` sin reintento. Cualquier otro rechazo, o un problema señalado por `audit_content`,
  se reintenta una vez con el motivo; si falla otra vez, error en español y **no se guarda nada**.
- Público: `{schema_version, item_id (prod-…), node_id, kind, prompt, steps?}`. Privado (nunca sale): `value`, `tolerance_pct=2`, `unit`,
  `order`, `solution`. La unidad **no** se publica: pedirla forma parte de la práctica.

**Corrección** (`POST /api/practice/produce/answer` `{profile_id, goal_id, item_id, attempt_id, value?, unit?, order?, learner_confidence?}`):

- Numérico: acepta coma decimal. Correcto si `|x − v| ≤ max(|v|·2 %, 1e-9)` **y** la unidad normalizada coincide (minúsculas, sin espacios,
  `·`→`*`, `²`→`2`, `³`→`3`; «adimensional» equivale a vacío). Número correcto con unidad distinta → `MISCONCEPTION` `units`.
  Número incorrecto → `MISCONCEPTION` `arithmetic`. Sin valor → `UNKNOWN`. Texto que no es número → error, sin registrar.
- Orden: correcto solo si la lista es idéntica a la clave; si no, `MISCONCEPTION` `procedure`. Debe traer cada paso exactamente una vez.
- Resultado: `{status, node_id, kind, solution, correct_value?, correct_unit?, correct_order?, error_type, evaluator_version:'local-production-v1'}`.
  Idempotente por `attempt_id` con huella de la respuesta: la misma respuesta devuelve el mismo resultado; otra distinta, `PLACEMENT_ATTEMPT_CONFLICT`.
- Ítem de otra meta, de otro perfil o de otra versión (`placement-`, `disc-`…) → rechazo; y un ítem `prod-` no se responde por las otras rutas.

## Cliente

«Práctica de cálculo» aparece si hay un tema expuesto con repaso o verificado y no hay otra práctica activa (las demás prácticas tampoco
se ofrecen mientras esta está en curso). Pide `numeric`; si no aplica, `ordering`; si tampoco, «Este tema no admite este tipo de práctica».
Vista numérica: resultado, unidad y confianza opcional. Vista de orden: botones «Subir» y «Bajar». Sin pistas. «No sé» registra `UNKNOWN`.

## Evidencia

Es `EVIDENCE` por el camino central (`prepareRecord` + `commitRecord`) con la actividad del rol `independent_practice`, tipo
`calculation` o `procedure`, dimensión `direct_application` o `procedure`, sin ayuda, y con `evaluator_version:'local-production-v1'`,
`evaluator_trust:'deterministic'` y `learner_confidence`.

- Correcto y sin ayuda puede ser independiente en esa dimensión **solo si existe en la cobertura del tema** (la intersección actual decide).
  Si el tema no la tiene, el evento se guarda pero no acredita ninguna dimensión.
- Un fallo cuenta como fallo de aprendizaje.
- `UNKNOWN` nunca suma.
- No hay pistas: `help_used` es siempre 0.

## Compatibilidad y rollback

Tipos y campos aditivos. Revertir quita el botón y las rutas; los eventos ya guardados quedan como `EVIDENCE` normales.

## Límites

La unidad se pide sin decir en cuál se espera el resultado: un resultado correcto en otra unidad equivalente (por ejemplo kW frente a W)
se marca como fallo. La tolerancia (2 %) y las longitudes son valores de ingeniería. El problema lo propone el modelo y lo audita otra
llamada que falla abierta: la clave podría ser incorrecta aunque pase el filtro; por eso existe el botón de reporte de contenido para el resto
de actividades (esta práctica aún no lo incluye). Sin foto, tabla ni cálculo con varias respuestas.
