# Plan y ciclo de enseñanza

## Plan — el árbol mínimo

Con meta y borde medidos, el plan es el conjunto más pequeño de proposiciones, con la
menor profundidad de derivación, que lleva de lo que sostiene a la meta:

- No reenseñar lo que el diagnóstico mostró que sostiene.
- No enseñar lo que queda fuera del camino a la meta, por interesante que sea.
- Identificar las verdades incondicionales en la base. Prueba de estrés: ¿esta raíz es
  realmente aceptable tal cual *para este aprendiz*, o es un teorema disfrazado que
  deriva de algo más simple? Si deriva, bájala y extiende el mapa. Una raíz mal elegida
  corrompe todo lo que cuelga de ella.
- Los nodos del mapa son hitos, no capítulos. Un nodo puede tomar uno o cinco pasos.
- El mapa es una hipótesis: se reescribe cuando la enseñanza revela algo distinto
  (falta un cimiento, sobra un nodo). Reescribir es normal.
- Presenta el enfoque en prosa breve y pide confirmación antes de enseñar.

En el repo, `make_coverage_map` + `validated_map` ya generan el grafo; falta alimentarlo
con el resultado del diagnóstico y permitir reestructuración durante la sesión.

## Enseñar — un paso de razonamiento a la vez

La plantilla actual de `make_lesson` (explicación de 70 palabras, ejemplo, error común,
comprobación, guiado, independiente, integración) entrega varios pasos y luego varias
preguntas. El ciclo recomendado es más fino:

**predecir → aprendiz predice → enseñar el paso resolviendo su predicción → comprobar → reaccionar → siguiente predicción**

1. **Un paso, un hecho.** Si necesita dos explicaciones, son dos pasos.
2. **Presentación por paso, no por ritual.** Una verdad incondicional se afirma llanamente.
   Un paso derivado se construye desde lo que sostiene: expositivo (el tutor narra el
   descubrimiento) o socrático (plantea el problema motivador y deja que el aprendiz intente
   descubrir). Socrático por defecto cuando puede razonarlo; expositivo cuando está fuera de
   su alcance o el aprendiz tiene poca energía.
3. **Descubrimiento motivado.** ¿Por qué estamos haciendo esto? ¿Qué problema obliga a este
   paso? ¿Qué llevaría a alguien a probar esta fórmula? Nada aparece de la nada.
4. **Sin meta-narración.** Nada de "ahora estableceré X y luego lo conectaré con Y". La
   conexión se teje en la prosa; cada frase instala comprensión o es sobrecarga.
5. **Comprobación tras cada paso.** Un fallo significa que el paso no aterrizó: diagnostica,
   repara y refuerza antes de construir encima. Las reparaciones no se apresuran con un muro
   de texto; se construyen igual, paso a paso.

## Las dos preguntas tienen trabajos distintos

| | Predicción | Comprobación |
|---|---|---|
| Momento | Antes de enseñar el paso | Después de enseñarlo |
| Objetivo | Motivar; que intente descubrir | Dato para decidir: seguir, reparar, reaclarar |
| ¿Respondible con lo visto? | No hace falta | Sí, siempre |
| ¿Evidencia? | No (exposición) | Sí, según la política |
| Tras responder | Abrir la enseñanza resolviendo su intento: qué predijo, qué es cierto y por qué | Continuar o reparar |

Omite la predicción cuando no hay paso siguiente que anticipar (cierre, reparación pura),
pero que omitirla no se vuelva costumbre.

## Qué debe ser una comprobación

- Respondible razonando desde lo visto en la sesión; si no hay ruta, es una moneda al aire.
- Nunca repetir las palabras de arriba (eso es copiar, no evidencia).
- Preferir aplicar a un caso nuevo, predecir o extender. El recuerdo puro es el último recurso.
- Cada opción incorrecta = la respuesta bajo un modelo mental erróneo concreto. Así un fallo
  nombra el error. En respuesta abierta, sus propias palabras lo revelan.
- Un acierto con suerte no es nada; un fallo honesto es oro.

## Encaje en el repo

Implementación incremental sugerida: añadir un modo `step` a `/api/lesson` (o una ruta
`/api/lesson/step`) que devuelva `{step_kind: foundation|derived, mode: socratic|expository,
predict?, body, check}`, mantener la plantilla actual como respaldo, y registrar las
predicciones como exposición (sin `supports_independence`). Las comprobaciones siguen el
flujo de evidencia existente.
