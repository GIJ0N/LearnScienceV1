# Ejemplo que se desvanece (`faded_examples_v1`)

Pasar de leer a resolver sin salto, solo para quien lo necesita.

## Contrato

`POST /api/lesson/faded` `{profile_id, goal_id, node_id, goal, name, explanation, example}` →
`{schema_version, worked:{prompt, steps:[3..5]}, faded:{prompt, steps:[{text}|{blank:true, check:<ítem público>}]}}`.

- El modelo crea dos problemas con la misma estructura y datos distintos: uno resuelto (3 a 5 pasos con su porqué) y otro con 1 o 2 huecos.
- Cada hueco es una pregunta de opción múltiple de clave privada (3 o 4 opciones, cada incorrecta con su `misconception`), construida con
  `_build_choice_item(…, FADE_VERSION)` (id `fade-…`), así que pasa el filtro de calidad de opciones. El servidor baraja las opciones.
- El texto del paso que se oculta nunca sale en la respuesta pública: solo la pregunta.
- Rechazo del paquete completo si: algún problema no tiene de 3 a 5 pasos; hay 0 o más de 2 huecos; un hueco no pasa el filtro de calidad
  o no nombra las ideas erróneas; los enunciados son iguales (`normalized_repair_text`); un paso está vacío.
- Patrón obligatorio: esquema → validador local → `audit_content` (falla abierta) → un reintento con el motivo → error en español sin
  guardar nada. El cliente omite la fase si hay error.
- `POST /api/lesson/faded/answer` corrige con `_answer_choice_item(…, FADE_VERSION)`: determinista, idempotente por `attempt_id`, sin modelo.
  Un ítem `fade-` no se responde por `/api/placement/answer` (ni por las otras rutas) ni al revés; otra meta u otro perfil → rechazo.

## Cliente

- Se ofrece al terminar la lección por pasos y antes de la comprobación **y**, desde la fase 5 (T3), también tras la explicación completa: «Ahora lo intento» lleva primero al ejemplo (`lesson.faded_requested`) y, al terminar o saltar, a la comprobación. Solo si `lesson.adaptation_mode` es `initial` o `scaffold`
  (nunca `consolidate` ni `repair`, ni lecciones sin modo).
- Estado en `lesson.faded`: `undefined` = no pedido; `null` = no disponible. Si la ruta falla o el paquete no es válido, `lesson.faded=null`,
  la lección sigue como hoy, sin aviso de error y sin reintentos automáticos.
- Vista: primero el ejemplo resuelto completo (registra `TEACHING_EXPOSURE`), después el ejemplo con huecos, un hueco a la vez como pregunta.
  Cada respuesta registra `{type:'FADED_STEP', node_id, item_id, attempt_id, status, learner_confidence}`.
- «Saltar ejemplo» siempre visible; al saltar o terminar, no vuelve a ofrecerse.

## Evidencia

Ninguna. Los huecos son formativos: no crean `EVIDENCE`, no tocan la cobertura ni el calendario de repasos, y `FADED_STEP` no cuenta en el panel
de nivel experto ni en la calibración. Ver el ejemplo es exposición, no desempeño.

## Compatibilidad y rollback

Campos y tipo de evento aditivos. Las lecciones ya guardadas no cambian. Revertir quita la fase; los eventos `FADED_STEP` ya guardados se ignoran.

## Límites

No se ofrece dos veces en la misma lección: si el ejemplo ya se vio (hecho, saltado o `faded_exposed`) tras la lección por pasos, la explicación completa no lo repite. La calidad pedagógica del ejemplo depende del modelo y del auditor
(que falla abierto). No se mide si el ejemplo con huecos mejora el aprendizaje: eso exige datos de uso reales.

## Fase 5 (T3): tras la explicación completa

- Cuando la lección por pasos falla la revisión de contenido y se muestra la explicación completa, el ejemplo ya no se pierde: se ofrece con las mismas reglas (modos `initial` y `scaffold`; `faded===null` es no disponible y no se reintenta; «Saltar ejemplo» siempre visible; un fallo de la ruta continúa sin aviso).
- Sigue siendo formativo: sin `EVIDENCE`, cobertura ni calendario.
