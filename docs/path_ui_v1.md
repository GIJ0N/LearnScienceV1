# Inicio de la meta como camino (`path_ui_v1`)

## Propósito

Que al abrir la meta se vea el camino y el siguiente paso, no una lista de botones. Es solo presentación:
pinta `studyPlan` (T4) y no cambia el selector, la cobertura, el calendario ni ninguna regla de evidencia.

## Cliente

- `pathView(box, plan, goal, canStart = true, primary = true)` (el plan fija `pathView(box, plan)`; se añaden `goal` y los
  indicadores porque los nodos necesitan sus acciones): una sección `.path-area` por grupo con su nombre y un `<ol class="path">`.
  Cada tema es `<li class="path-node is-done|is-skipped|is-review|is-ready|is-locked">` más `is-next` solo en el recomendado
  (`is-next` se suma a su estado real: un tema saltado nunca recibe `is-done`). Nombre y estado van en texto.
- El nodo `next` es el único con botón principal: «Seguir: <tema>» (`chooseNext` con `reselect` y `newVisit`, igual que
  «Empezar lo recomendado»). Los demás se abren al pulsarlos (`<details class="path-more">`) y muestran las acciones de T4
  (necesitas antes, te prepara para, «Estudiar este tema», «Aprender este de todos modos»).
- Áreas sin abrir al final, atenuadas (`.is-pending`), con «≈N temas» y su botón «Abrir ahora».
- Orden del inicio de la meta: (1) título y acciones principales del encabezado y «Sesión de hoy»; (2) «Tu camino»
  (con «Te recomiendo seguir con…», «Por qué» y «Ver el plan completo»); (3) «Más práctica» plegado en `<details class="more-practice">`;
  (4) las cifras (`goal-stats`); después, como antes, áreas, mapa, cobertura y respaldo.
- Una sola acción principal: con un siguiente paso disponible, «Seguir aprendiendo», «Sesión de hoy», «Empezar lo recomendado» y
  los botones de «Más práctica» pasan a `.quiet`. Con reparación activa o bloqueada por otra meta, no hay «Seguir» principal
  del camino y se conserva «Continuar reparación» / «Volver a la reparación de …».
- Movimiento: la línea del camino se dibuja hasta el nodo `next` **una vez por carga de la página** (`is-drawing`; después `is-drawn`
  sin animación). `prefers-reduced-motion` la anula. La línea solo marca la posición del siguiente paso: no representa dominio.
- Móvil: nodos y resúmenes de al menos 44 px; el camino ocupa todo el ancho.

## Qué cuenta como evidencia

Nada. No hay eventos nuevos; pintar el inicio no escribe nada.

## Desviaciones respecto al plan

- `planSummary` ya no se usa en el inicio (sus filas pendientes las cubre el camino); la función y «Ver el plan completo» se conservan.
- El nodo `next` no muestra «Estudiar este tema» (lo sustituye «Seguir: <tema>»); todos los botones del inicio anterior
  siguen en el árbol salvo ese duplicado.
- «Más práctica» ya existía como `div` dentro del encabezado (`dailyHero`); ahora es `<details>` y se coloca después del camino.

## Compatibilidad y rollback

Sin cambios de datos ni de rutas. Revertir el commit restaura el inicio anterior.

## Sin validar

Aspecto, longitud de la pantalla con metas grandes y la animación en un navegador y teléfono reales.
