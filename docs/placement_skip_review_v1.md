# Repaso de los temas saltados por el diagnóstico (`placement_skip_review_v1`)

Para que un tema saltado no quede como dominio silencioso.

## Regla

Al terminar el diagnóstico (`finishPlacement`), cada tema que recibe `PLACEMENT_SKIP` (bases `probed` e `inferred`) recibe un repaso
programado con el mecanismo existente (`schedule`). Para el tema `i`-ésimo saltado, en el orden del mapa, el vencimiento es
`ahora + (1 + i % 5)` días: los repasos se reparten entre 1 y 5 días en vez de caer todos juntos. Cada programación registra
`{type:'PLACEMENT_REVIEW_SCHEDULED', node_id, due, at}`.

Si el tema ya tenía un repaso, no se modifica ni se registra evento.

## Evidencia

Ninguna. Programar un repaso no cambia `verified()`, la cobertura ni el conteo de habilidades con evidencia. El repaso usa el flujo
existente: un fallo lleva a enseñar y revoca el salto según `placement_v1`; un acierto cuenta con las reglas de `delayed_review_v1`.

## Compatibilidad y rollback

Solo añade repasos y un tipo de evento. Los diagnósticos ya terminados no se tocan. Revertir deja de programar repasos nuevos; los ya
programados siguen siendo repasos válidos.

## Límites

Si el aprendiz nunca abre los repasos, el tema sigue saltado y sin comprobar (se muestra como «≈ saltada»). Esta tarea no cambia esa
presentación.
