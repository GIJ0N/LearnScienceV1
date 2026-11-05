# Mapa por áreas (`map_areas_v1`)

## Problema

El mapa se generaba de una sola vez con 6–8 temas y un tope de 12. Para «ir de nada a experto» eso es una introducción, no un campo. Una sola llamada tampoco puede describir bien 50 temas.

## Diseño

El mapa se construye en dos niveles y **crece mientras la persona avanza**:

1. **Áreas** (4 a 10): bloques grandes de la meta, en orden de aprendizaje, cada una con su resultado y una estimación de temas (5 a 12). Se genera al crear la meta junto con una nota de alcance («≈ N temas en total»).
2. **Temas** (5 a 12 por área): se generan al **abrir** un área. Al crear la meta se abre solo la primera, así que el inicio sigue siendo rápido (dos llamadas).

Una meta amplia llega así a 40–100 temas sin una llamada gigante, y una pequeña se queda en pocas áreas.

## Reglas locales (el modelo propone, el servidor decide)

- **Áreas**: nombre de ≥ 3 caracteres, sin duplicados por nombre normalizado, entre 4 y 10; si no, error y no se crea la meta.
- **Expansión**: ids locales (`n1`, `n2`…) se renombran a `<area>-<id>`; los temas nuevos pueden depender de temas ya existentes (ids exactos de la lista enviada) pero **ningún tema existente cambia nunca**, así que no pueden aparecer ciclos. Un tema nuevo cuyo nombre normalizado ya existe se **fusiona** con el existente (sus dependientes apuntan al existente) en vez de duplicarse. Mínimo 4 y máximo 12 temas por área.
- Los temas existentes que el cliente envía como contexto se acotan (200) y se validan: un prerrequisito que no está en la lista es un error.

## Cuándo se abre la siguiente área

- **Automático y sin bloquear**: cuando quedan ≤ 2 temas sin completar (verificados o continuados) en las áreas abiertas, se pide la siguiente área en segundo plano.
- **A mano**: el mapa muestra todas las áreas y «Abrir ahora» en las pendientes.
- Un fallo no rompe nada: el área sigue pendiente y se reintenta.

## Qué NO cambia

Abrir un área no concede dominio, no crea eventos de evidencia ni toca el calendario. Los temas nuevos entran sin evidencia (`UNKNOWN`); «Diagnosticar lo que ya sé» ya cubre temas sin evidencia, así que sirve para ubicar la nueva área. Las metas antiguas (sin `areas`) se comportan exactamente como antes.

## Contratos

`POST /api/map` → `{goal, context}` → `{nodes, coverage, map_version:2, areas:[{id,name,outcome,estimated_topics,status,node_ids}], scope}` (el área 1 ya viene `expanded`).
`POST /api/map/expand` → `{goal, context, area_id, areas:[{id,name,outcome}], existing_nodes:[{id,name,outcome}]}` → `{area_id, nodes, coverage}`.

## Compatibilidad y rollback

`goal.areas` es opcional; `make_map` plano se conserva. Revertir deja metas con `areas` y todos sus temas, que siguen funcionando como un mapa plano.

## Fuera de alcance

Reordenar o fusionar áreas ya abiertas, quitar temas, y diagnóstico por área antes de abrirla.
