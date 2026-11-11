# Salidas cuando la reparación no ayuda (`stuck_exits_v1`)

## Problema

Una reparación empieza con preguntas de diagnóstico. Si la persona no sabe, el diagnóstico termina sin laguna
confirmada, el episodio se cierra como `PARTIAL` y vuelve a la pregunta original sin haber enseñado nada.
Además, dentro de una reparación activa no había una salida clara desde el inicio de la meta.

## Paso 0 (hallazgos)

- Un episodio se cierra como `PARTIAL` **sin enseñanza** en solo dos puntos de `transitionRepairEpisode`
  (rama `DIAGNOSING`): cuando no se puede seleccionar una laguna prioritaria y, en el plan
  `repair_teaching_v2`, cuando la laguna seleccionada no quedó `CONFIRMED`. El plan anterior a v2 continúa a
  `REPAIRING` y enseña. Otros cierres `PARTIAL` (pausas, `popContext`, importaciones) no se tocan.
- El único «Abandonar episodio» preexistente vive en la vista del contexto para planes desconocidos y llama a
  `closeRepairEpisode(goal, episode, 'ABANDONED', razón)`. Se factoriza en `abandonRepairEpisode`, que usan ahora
  ese botón y el nuevo.
- No cambian los contratos de `RepairEpisode`.

## Cliente

- Cuando el episodio se cierra por uno de esos dos puntos, se guarda
  `s.stuck={version:'stuck_exits_v1', node_id, phase, question_prompt, question:{prompt,reference,kind}, episode_id, source_attempt_id, at}`
  a partir de `parent_question`, `parent_node_id`, `parent_context_snapshot` y `parent_attempt_id` del episodio.
- En la pantalla del tema y de la fase donde se hizo la pregunta original aparece, encima de ella:
  «El diagnóstico no encontró la causa. ¿Te lo enseño paso a paso?» con «Enséñamelo» y «Ahora no».
  La oferta nombra la pregunta («Sobre: …») porque, en una confirmación, la pregunta visible puede ser otra nueva.
- «Enséñamelo» abre la enseñanza directa (T1) para la pregunta del episodio, con `source_attempt_id` igual al intento
  que abrió la reparación, y borra `s.stuck`.
- En el inicio de la meta, con una reparación activa que tiene episodio abierto, junto a «Continuar reparación» se
  añade «Abandonar reparación» (llama a `abandonRepairEpisode`). Una reparación pendiente de diagnóstico que aún no
  tiene episodio no se puede abandonar desde ahí (no hay episodio que cerrar).
- Evento `{type:'STUCK_OFFER', node_id, episode_id, accepted:true|false, at}` al responder la oferta.
- `s.stuck` se borra al contestar esa pregunta, al elegir otro tema (`chooseNext`) y al responder la oferta.

## Qué cuenta como evidencia

Ninguna. Cerrar o abandonar no crea evidencia positiva ni cambia cobertura; la enseñanza directa sigue las reglas de
`docs/direct_teaching_v1.md`.

## Compatibilidad y rollback

Campos y eventos aditivos; el código anterior ignora `s.stuck` y `STUCK_OFFER`. Sin migración.
