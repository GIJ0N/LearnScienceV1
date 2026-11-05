---
name: learnscience-pedagogy
description: Doctrina de ciencias del aprendizaje para diseñar funciones, prompts y contratos de LearnAnything/LearnScienceV1 —diagnóstico inicial, secuencia de enseñanza, preguntas de comprobación, pistas, práctica espaciada e intercalada, confianza del aprendiz, mapa de conocimiento y camino a nivel experto. Úsala siempre que se diseñe o revise cómo el tutor diagnostica, enseña, pregunta, evalúa, practica o decide la siguiente actividad, al escribir o modificar un prompt de Gemini del tutor, o al comparar ideas con otros tutores como LearnHarness, aunque no se mencione la palabra "pedagogía".
---

# Pedagogía de LearnAnything

Objetivo del producto: llevar a alguien de cualquier punto de partida a dominio experto
real —comprensión, resolución independiente, retención y transferencia— con el menor
desperdicio de esfuerzo. La pregunta que guía cada diseño:

> ¿Cuál es la siguiente intervención más barata que más fortalece, o que más reduce la
> incertidumbre sobre, la capacidad más débil aún no demostrada?

No es "la siguiente pregunta" ni "la siguiente lección": es la siguiente **intervención**,
elegida con evidencia. `docs/learning_science.md` del repo desarrolla esa función de valor.

## Las cinco fases y su referencia

Lee solo la referencia de la fase que estás diseñando:

| Fase | Qué produce | Referencia |
|---|---|---|
| Diagnóstico | Meta concreta + borde de conocimiento por hebra (piso, techo, errores conceptuales) | `references/probe.md` |
| Plan | Árbol mínimo de dependencias desde lo que ya sostiene hasta la meta | `references/teaching-cycle.md` §Plan |
| Enseñanza | Un paso de razonamiento a la vez: predecir → enseñar → comprobar → reparar | `references/teaching-cycle.md` |
| Práctica | Recuperación sin señal, discriminación y composición, intercalada y espaciada, con escalera de pistas | `references/practice.md` |
| Señales del aprendiz | Confianza, razonamiento en voz alta, calibración | `references/calibration.md` |

Para el mapa persistente y conexiones entre metas: `references/knowledge-graph.md`.
Para el camino de principiante a experto y priorización del roadmap: `references/roadmap.md`.

## Principios transversales

1. **Medir antes de enseñar.** Enseñar lo que ya sabe es tiempo perdido; enseñar más allá
   de su borde no se fija. El diagnóstico define el punto de partida, y sigue midiendo
   durante toda la sesión: lo que el aprendiz expresa supera a lo que el plan supuso.
2. **Un paso, una comprobación.** Cada hecho nuevo se apoya en algo que ya sostiene, con un
   solo paso de razonamiento motivado, y se verifica antes de construir encima. Un error
   así aparece pequeño y localizado, no tres nodos después.
3. **Cimientos incondicionales y descubrimiento motivado.** Empieza por verdades que se
   aceptan tal cual (definiciones reales, afirmaciones universales); deriva lo demás
   mostrando por qué alguien habría llegado ahí. Lo arbitrario no se fija.
4. **El sistema absorbe la logística.** Qué aprender, en qué orden, de qué fuente: eso lo
   resuelve el tutor. El esfuerzo del aprendiz va al material, no a organizarse. No se trata
   de quitar dificultad: la lucha con el material es lo que fija.
5. **Dificultad deseable.** La práctica más útil se acierta con esfuerzo (≈85 % por evento
   de recuperación). Demasiado fácil no fortalece; imposible tampoco.
6. **Comprensión ≠ disponibilidad.** Entender un paso recién enseñado no garantiza que
   venga a la mente semanas después en otra situación. Por eso la práctica es una fase
   distinta, y la retención y la transferencia exigen evidencia propia.
7. **Honestidad del veredicto.** Nunca suavizar un error ni inflar un acierto: la
   calibración del aprendiz depende de ello.

## Cómo encaja con la política de evidencia

Todo lo anterior produce *decisiones*, y algunas actividades producen *evidencia*. Al
diseñar, declara explícitamente para cada actividad nueva:

- ¿Es exposición (explicación, ejemplo, predicción) o desempeño evaluable?
- ¿Puede ser independiente (`supports_independence`)? Las predicciones nunca lo son: se
  hacen antes de enseñar y adivinar es el objetivo.
- ¿Qué dimensiones observa realmente? No atribuyas dimensiones que la pregunta no mide.
- ¿Qué pasa con ayuda, "no sé", evaluación inválida o duplicado?

Si la respuesta a alguna es dudosa, la opción conservadora es: no cuenta como evidencia
positiva. Consulta `learnscience-dev` para implementarlo.

## Al escribir un prompt de Gemini para el tutor

- Pide la estructura que la fase exige (p. ej., un solo paso + una comprobación), no una
  plantilla fija que mezcle fases.
- Pasa la evidencia relevante (resultados recientes, ayuda, confianza, razonamiento) de
  forma acotada; el modelo decide mejor con el "por qué" del aprendiz que con aciertos.
- Exige que cada opción incorrecta de una pregunta corresponda a un modelo mental erróneo
  concreto, para que el fallo diagnostique.
- Valida en servidor todo lo que el prompt pide; el prompt no es un contrato.

## Sobre LearnHarness

LearnHarness (AGPL-3.0) inspiró varias ideas de estas referencias: diagnóstico por
acotamiento, ciclo predecir/comprobar, matriz de confianza, escalera de pistas, modos de
práctica y grafo de proposiciones. Las referencias las reformulan con palabras propias.
No copies texto literal de sus prompts o código al repo sin que el dueño acepte las
obligaciones de la AGPL; las ideas y métodos sí pueden adaptarse libremente.
