# Señales del aprendiz: confianza y razonamiento en voz alta

Hoy `confidence` en app.js describe la confianza del sistema sobre cobertura, no la del
aprendiz. Capturar la del aprendiz es de las mejoras más baratas y con más señal.

## Confianza declarada (0–100 %)

En cada respuesta evaluable, el aprendiz indica la probabilidad de que su respuesta sea
correcta. Leerla contra el veredicto:

| | Confianza alta | Confianza baja |
|---|---|---|
| **Correcto** | Sólido: avanzar | Frágil o suerte: un refuerzo, no celebración |
| **Incorrecto** | **Error conceptual comprometido** — la señal más fuerte: nombrar la grieta y reenseñar alrededor | Laguna honesta o casi-acierto: corrección pequeña |

- En opción múltiple con n opciones, el azar es 1/n. Confianza ≤ azar en la opción elegida
  significa que cree que su elección es errónea: es honestidad, no error.
- "No sé" no lleva confianza: es una laguna, nunca una respuesta incorrecta (el repo ya lo
  trata como `UNKNOWN`).
- Ausente ≠ 0. No confundas un valor por defecto sin tocar con uno elegido.

**Calibración** como producto: con el tiempo, muestra al aprendiz su curva (cuando dice 80 %,
¿acierta 80 %?). Saber lo que uno sabe es parte de ser experto.

**Encaje con la evidencia:** la confianza es un dato de decisión. No debe sumar ni restar
dominio por sí sola. Usos legítimos: elegir siguiente intervención (refuerzo, sondeo del
error), priorizar repasos (correcto + baja confianza → repasar antes), detectar errores
conceptuales para reparación.

## Razonamiento en voz alta

Un campo libre junto a cada respuesta ("piensa en voz alta: cómo lo razonas, qué dudas
tienes"), por texto o dictado, sin filtrar. Es el dato primario de la sesión: una respuesta
es un bit; el razonamiento es el cuadro completo —qué busca primero, qué da por obvio,
dónde adivina—.

- Un acierto con un modelo confuso es una alarma; un fallo con razonamiento sano es progreso.
- Cada razonamiento actualiza el modelo del aprendiz y puede mostrar que el plan está mal.
- En práctica, el razonamiento es lo que permite elegir el peldaño de pista correcto.

**Encaje con el repo:** `criterion_assessment_v1` ya separa opción y explicación; generaliza
ese patrón (`reasoning_text` opcional en el intento, acotado con `compact`, pasado al
evaluador y a `relevant_memory`). El evaluador puede usarlo para clasificar el fallo, pero
un razonamiento vacío nunca debe penalizar ni un razonamiento elocuente acreditar.
