# Plan de estudios (`study_plan_v1`)

## Propósito

Que el tutor proponga **el orden** en que conviene aprender y explique por qué, como un plan de estudios universitario
(un tema prepara al siguiente), sin quitar la libertad de elegir. Solo cliente; sin llamadas al modelo.

## Funciones puras

`studyPlan(goal, at)` →
`{version:'study_plan_v1', next:{node_id, reason}|null, remaining, groups:[{area_id, name, status:'open'|'pending', estimated_topics?, topics:[{node_id, name, state, missing:[{id,name}], unlocks:[{id,name}], review_due, continued}]}]}`

- **Grupos:** las áreas de `goalAreas(goal)` en su orden. Una meta sin áreas tiene un solo grupo «Ruta». Un área sin abrir
  (`status!=='expanded'`) es un grupo `pending` con `estimated_topics` (por defecto 8, como `areaEstimate`) y sin temas.
  Los temas que no pertenecen a ninguna área abierta van a un grupo final «Otros temas» (no se pierde ninguno).
- **Orden de los temas:** el de `relevant(goal)`.
- **`state`** (con esta prioridad): `done` (`verified`); `skipped` (`placementSkipped`); `review` (repaso vencido según
  `learningState`, el mismo cálculo del selector); `locked` (algún prerrequisito no cumple `readyToAdvance`); `ready`.
- **`missing`:** los prerrequisitos que no cumplen `readyToAdvance`.
- **`unlocks`:** hasta 3 temas que tienen a este como prerrequisito directo, en el orden de `relevant`.
- **`review_due`:** marca aditiva (no es un estado nuevo): un tema `done` o `skipped` con repaso vencido sigue siendo `done`/
  `skipped`, pero el plan lo dice, porque el selector lo propondrá. **`continued`:** el tema se continuó con pendientes
  (`CURRICULUM_CONTINUED`); sigue sin contar como dominio.
- **`next`:** el `node_id` y el `reason` de `selectTutorAction(goal, at, {reselect:true})`. **No** se duplica la lógica del
  selector. Si no devuelve un tema del plan, el primer `ready`.
- **`remaining`:** temas que no están `done` ni `skipped`, más la suma de `estimated_topics` de las áreas sin abrir.
- Construir el plan **no escribe nada** (ni eventos, ni sesión, ni calendario).

## Cliente

- Página «Plan» en la navegación de la meta (`page='plan'`) y el mismo contenido, resumido, en el inicio de la meta.
- Cabecera: «Te recomiendo seguir con: <tema>» + el motivo + botón «Empezar lo recomendado»
  (`chooseNext(goal,{reselect:true,newVisit:true})`).
- Por grupo, una lista ordenada. Cada tema muestra su estado en palabras («Hecho», «Saltado por diagnóstico»,
  «Repaso pendiente», «Listo para empezar», «Te conviene esperar»), «Necesitas antes: A, B» si tiene `missing`
  y «Te prepara para: X, Y» si tiene `unlocks`.
- Elegir un tema `locked` **no usa `confirm()`**: muestra en la misma fila «Te conviene primero: A, B» con «Ir a A»
  (foco en el primer faltante) y «Aprender este de todos modos». El segundo registra
  `{type:'PLAN_OVERRIDE', node_id, missing:[ids], at}` y usa la entrada de foco existente
  (`chooseNext(goal,{focus,reselect:true,newVisit:true})`).
- Área sin abrir: «≈N temas · se abre al terminar el área anterior» y el botón existente «Abrir ahora».
- «Ruta y mapa» (la red de habilidades) no cambia.

## Qué cuenta como evidencia

Ninguna. El plan no cambia el selector, la cobertura ni el calendario. `PLAN_OVERRIDE` es un registro de la elección
de la persona: no concede ni retira dominio y no entra al selector ni al panel de experto.

## Compatibilidad y rollback

Evento y página aditivos; el código anterior ignora `PLAN_OVERRIDE` y la página `plan` (si se restaura una página guardada
desconocida, vuelve al inicio). Sin migración.

## Fuera de alcance

Reordenar el mapa con el modelo, calendario por semanas con fechas, y cambiar cómo el selector elige.
