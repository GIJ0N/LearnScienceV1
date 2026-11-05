# Diagnóstico inicial por acotamiento

Hoy `make_lesson` arranca "desde nivel cero" cuando no hay evidencia previa. Eso es
seguro pero caro: un adulto que busca material avanzado casi siempre domina lo básico.
El diagnóstico debe producir dos medidas precisas, porque su precisión es el techo de la
calidad del plan.

## 1. Meta concreta

"Quiero entender redes neuronales" puede significar diez metas distintas. Pregunta hasta
que sea concreta: ¿para qué?, ¿qué quieres poder hacer?, ¿con qué nivel de profundidad?
Si el aprendiz no conoce el terreno, registra que la meta empieza con orientación; no le
pidas que dibuje el mapa.

Estas preguntas no tienen respuesta correcta: no son evidencia.

## 2. Hebras

Desde la meta, razona de qué depende la lección: cada dependencia es una hebra
(p. ej., para "entender backpropagation": derivadas, regla de la cadena, álgebra
matricial, qué es una función de pérdida). Las hebras son los nodos-raíz candidatos del mapa.

## 3. Búsqueda binaria en cada hebra

Para cada hebra busca un **piso** (algo que acierta con seguridad) y un **techo** (algo
que falla o no sabe). Cada pregunta se elige con la evidencia anterior:

- Entra cerca de lo más difícil que la meta necesita, no en lo básico. Un fallo te baja.
- Correcto + confianza alta → sube la dificultad bruscamente.
- Correcto + confianza baja o razonamiento flojo → frágil: sube suave y caracteriza.
- Incorrecto → baja el techo y estrecha.
- Un fallo es una coordenada, no un veredicto: desliz, laguna y error conceptual se ven
  iguales. Sondea alrededor; los errores conceptuales importan más.
- Las hebras se informan entre sí: si una sale alta, no abras la vecina muy abajo.
- Una hebra que nunca falla no está terminada: escala hasta que falle.
- Ninguna pregunta de relleno; no repreguntes territorio ya acotado.

## 4. Resultado

Por hebra: nombre, piso, techo, errores conceptuales detectados, desde dónde construir.
Ese resultado alimenta el mapa (`make_coverage_map`) y el modo de adaptación
(`lesson_adaptation`) en vez de asumir nivel cero.

## Encaje con la evidencia

Las respuestas del diagnóstico **son** desempeño real, pero sin enseñanza previa y con
pocas preguntas por hebra. Opción conservadora recomendada: registrarlas como eventos de
fase `diagnostic`, permitir que poden lo que se enseña (saltar lo que ya sostiene) y que
cuenten como evidencia inicial de suficiencia solo si cumplen las reglas normales
(independiente, sin ayuda, contrato que soporta independencia). Nunca deben marcar dominio
de un nodo por estar "debajo" de algo acertado: la inferencia descendente decide el plan,
no la cobertura. Decide esto con el dueño y fíjalo en `docs/diagnostic_v1.md`.

## Contrato sugerido para el modelo

Una pregunta por turno: `{strand, difficulty_rank, prompt, options?, reference, misconception_by_option?}`.
El servidor guarda piso/techo por hebra y decide cuándo una hebra está acotada; el modelo
no declara el fin del diagnóstico por sí solo.
