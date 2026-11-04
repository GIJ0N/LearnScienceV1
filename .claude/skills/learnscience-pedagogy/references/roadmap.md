# Camino a experto y roadmap priorizado

## Qué significa "experto" (criterios observables)

Un nodo no está dominado a nivel experto hasta que hay evidencia de:

1. **Comprensión:** explica por qué, no solo qué (deriva la idea desde sus bases).
2. **Independencia:** resuelve sin pistas.
3. **Retención:** recupera tras intervalos crecientes (días → semanas).
4. **Discriminación:** elige la idea correcta frente a confundibles.
5. **Composición:** encadena varias ideas en problemas largos.
6. **Transferencia lejana:** aplica en situaciones de otro dominio o problemas del mundo real.
7. **Calibración:** su confianza predice sus aciertos.

Las capas 1–3 y parte de 6 ya existen en la política de evidencia. 4, 5 y 7 son nuevas y
hacen la diferencia entre "aprobó el curso" y "experto".

## Roadmap (orden recomendado: impacto ÷ costo, respetando dependencias)

| # | Paso | Tamaño | Por qué ahora |
|---|---|---|---|
| 1 | ✅ (learner_signals_v1) Confianza 0–100 y campo de razonamiento en cada respuesta evaluable | S | Casi gratis; alimenta todo lo demás (diagnóstico, pistas, repaso) |
| 2 | ✅ (graded_hints_v1) Pistas graduadas P0–P5 (`help_used` numérico) + taxonomía de fallos de práctica | S–M | Mejora la honestidad de la independencia y la elección de la siguiente actividad |
| 3 | ✅ (placement_v1) Diagnóstico por acotamiento (piso/techo por hebra) antes del mapa | M | Mayor ganancia de velocidad: deja de enseñar desde cero a quien no lo necesita |
| 4 | ✅ (step_lessons_v1) Modo de lección paso a paso: predecir → enseñar → comprobar | M–L | Mayor ganancia de comprensión; mantener la plantilla actual como respaldo |
| 5 | ✅ (spaced_practice_v1; composición pendiente del paso 6) Programador de espaciado por habilidad + sesión de práctica intercalada (recuerdo/discriminación/composición) | M | Convierte comprensión en disponibilidad y retención |
| 6 | ✅ parcial (knowledge_graph_v1: extracción, cadenas y composición; pendiente que el diagnóstico lea el grafo y conexiones entre metas) Grafo de proposiciones y cadenas con procedencia, extraído tras cada sesión | L | Habilita reutilizar entre metas y material de práctica de composición |
| 7 | ✅ (expert_panel_v1) Panel de calibración y de "nivel experto" por nodo con las 7 capas | M | Hace visible el progreso real hacia experto |
| 8 | ✅ (map_areas_v1) Mapa por áreas que crece al avanzar (de 6–8 temas fijos a 40–100) | M–L | El mapa de 6–8 temas era una introducción, no un camino a experto |

Infraestructura transversal (hacer en paralelo, pequeña):

- Mover prompts largos a `prompts/<rol>/NN-*.md` con carga ordenada; permite iterar
  pedagogía sin tocar el literal HTML ni la lógica.
- Banco de evaluación de prompts con respuestas grabadas: para cada cambio de prompt,
  comparar salida validada en casos sintéticos (aprendiz novato, intermedio, con error
  conceptual) antes de gastar cuota de Gemini.
- Mantener `sync_embedded_js.py` + `run_ci.py` (skill `learnscience-dev`) en el flujo.

Cada paso: documento `docs/<area>_v1.md` primero, después código y tests, con decisión
explícita sobre qué cuenta como evidencia.
