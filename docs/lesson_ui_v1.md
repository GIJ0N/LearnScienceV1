# Pantalla de lección (`lesson_ui_v1`)

## Propósito

Que cada pantalla pida una sola cosa, que se vea cuánto falta y que el veredicto sea claro. Es solo
presentación: no cambia ningún veredicto, regla de evidencia, calendario ni cobertura.

## Paso 0: textos que rodean una pregunta (todos siguen alcanzables)

Flujo principal (`session()`): «Actividad principal» / «Reparación activa», título de la meta, «Sesión breve…» y
«Pausar y volver a la ruta», «Ahora te conviene… / Por qué: …», «Continuar con pendientes», «Ahora: tema · acción»,
«Cobertura: …», oferta de confirmación rápida, oferta de «Estás atascado», la pregunta, caja de respuesta, caja de
razonamiento, confianza, «Compartir mi intento», «No sé», feedback, «Pista», «Continuar», «Corregir evaluación»,
«Esto está mal», «Dame una pista», «No lo entendí; vuelve al ejemplo». En TEACH: «Una idea a la vez», «Ejemplo»,
«Error habitual», fuente/citas, «Regenerar con mis fuentes», «Por qué se eligió», «Adaptación», «Ahora lo intento».
Las opciones tipo tarjeta solo existen en `renderPlacementItem` (colocación y el `check` de enseñanza directa);
`renderQuestion` es de respuesta abierta.

## Cliente

- `lessonProgress(goal, nodeId)` (pura): `TEACH` «Aprender», `COMPREHENSION` «Comprobar», `GUIDED` «Con apoyo»,
  `INDEPENDENT` «Por tu cuenta», `INTEGRATE` «Aplicar». Otros modos devuelven una sola etapa con su `HUMAN_LABELS`.
  Nunca marca `done` una etapa posterior a la actual.
- `.lesson-progress`: texto «Tema · Etapa N de 5: etiqueta» y barra segmentada (el texto lleva la información, no el color).
- `<details class="why">` «Por qué esta actividad»: contiene «Ahora te conviene / Por qué», «Cobertura:»,
  «Por qué se eligió» y «Adaptación». Las ofertas con botón (confirmación rápida, regenerar con fuentes) quedan fuera, visibles.
- `.option-card`: opciones de `renderPlacementItem` como tarjetas pulsables con `.is-selected` y `aria-pressed`.
  No se marca la correcta antes de responder; la selección usa el color `--info`, no el de acierto.
- `.verdict` + `.good` (solo `CORRECT`) / `.bad` (`PARTIAL`, `MISCONCEPTION`) / `.unknown` (todo lo demás, incluido `UNKNOWN`).
  Primera línea: «Correcto», «Casi: falta una parte», «No es correcto», «Sin evaluar»; después el feedback y la pista, sin modificar.
  Entra con una animación de 180 ms (anulada con `prefers-reduced-motion`).
- Una acción principal: tras responder, «Compartir mi intento» pasa a `.quiet`; «Continuar» es la principal.
- `.milestone`: ver abajo.

## Hito (`.milestone`)

Estado solo en memoria (`milestone`), no se guarda ni crea eventos. Se fija en `commitTransition` cuando:
(a) `INTEGRATE` termina con `CORRECT` **y el tema ya está verificado** (la rama que llama a `finishPractice`), o
(b) un repaso (`REVIEW`) se responde `CORRECT`. Muestra «Tema completado» o, si la respuesta usó ayuda
(`help_used > 0`), «Completado con apoyo»; los aciertos sin ayuda desde la última exposición; y la fecha del próximo repaso.
No aparece tras fallo, `UNKNOWN` ni sin verificación. Mientras está activo la pantalla muestra solo el hito
con el botón «Seguir». Se considera obsoleto si llega un `EVIDENCE` posterior (`milestoneActive`) y se limpia en cada `commitTransition`.

## Qué cuenta como evidencia

Nada. Ningún evento nuevo; el registro de evidencia es el de antes.

## Desviaciones respecto al plan

- El hito en `INTEGRATE` exige que el tema esté verificado; si aún falta confirmación, el flujo sigue a la confirmación
  sin declarar «Tema completado» (evita presentar como completado algo sin evidencia suficiente).
- El veredicto con panel se aplica a `renderQuestion` (flujo principal); `renderPlacementItem` conserva su texto de
  corrección y solo gana tarjetas de opción.

## Compatibilidad y rollback

Sin cambios de datos ni de rutas. Revertir el commit restaura la pantalla anterior.

## Sin validar

Aspecto y ritmo reales en navegador y teléfono; el hito y el veredicto en vivo con un modelo real.
