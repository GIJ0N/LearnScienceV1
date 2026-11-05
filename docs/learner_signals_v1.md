# Señales del aprendiz v1 — confianza declarada y razonamiento en voz alta

## Propósito

Una respuesta correcta o incorrecta es un solo bit. Para elegir bien la siguiente intervención el tutor necesita saber también **qué tan seguro estaba el aprendiz** y **cómo lo pensó**. Esta versión captura ambas señales en cada actividad evaluada desde `renderQuestion` y las conserva con el evento de evidencia.

Las señales son **datos de decisión, no evidencia de dominio**. No cambian `result`, `is_independent`, `is_novel_variant`, `counts_as_learning_failure`, cobertura, `verified()` ni `nextNode()`.

## Captura

- **Confianza declarada**: selector opcional con «sin indicar» por defecto y valores 10, 30, 50, 70, 90 y 100 %. Representa la probabilidad que el aprendiz asigna a que su respuesta sea correcta. «Sin indicar» se guarda como `null`, nunca como 0 ni 50: un valor por defecto sin tocar no se confunde con uno elegido.
- **Razonamiento en voz alta**: campo de texto opcional («¿Cómo lo razonaste? ¿Qué dudas tienes?»), acotado a 1 200 caracteres.

## Campos nuevos del evento `EVIDENCE`

| Campo | Tipo | Notas |
|---|---|---|
| `learner_confidence` | entero 0–100 o `null` | Valores fuera de rango se descartan en el cliente; el servidor los rechaza con 400. |
| `reasoning_text` | texto ≤ 1 200 | Vacío cuando no se escribió. |
| `calibration_signal` | ver tabla | `null` sin confianza o con resultado `UNKNOWN`. |
| `learner_signal_version` | `learner-signals-v1` | Marca qué eventos llevan señales; los eventos anteriores no lo tienen. |

`calibration_signal` (umbrales: alta ≥ 70, baja ≤ 40):

| | Confianza alta | Intermedia | Confianza baja |
|---|---|---|---|
| `CORRECT` | `solid` | `tentative` | `fragile` |
| `PARTIAL` / `MISCONCEPTION` | `committed_misconception` | `uncertain_error` | `honest_gap` |

«No sé» (`UNKNOWN`) no lleva señal: es una laguna, no una respuesta incorrecta.

## Usos permitidos

1. **Evaluador** (`/api/evaluate`): recibe el razonamiento para diagnosticar el error y elegir la pista, con la instrucción explícita de calificar el intento y no la elocuencia. Recibe la confianza solo para nombrar la idea errónea cuando el intento es incorrecto con confianza alta; el prompt declara que no cambia el `status`.
2. **Memoria pertinente** (`relevant_memory`): añade `learner_confidence` y `calibration_signal` a las fuentes que las tienen, y prioriza como motivo un error con confianza alta (posible idea errónea consolidada).
3. **Microlección** (`make_lesson`): el contexto acotado de intentos recientes incluye confianza, señal y un extracto del razonamiento cuando existen.
4. **Historial**: muestra la confianza declarada junto al intento.

## Fuera de alcance (siguientes versiones)

- Priorizar repasos por `fragile` o `committed_misconception`.
- Curva de calibración visible para el aprendiz.
- Señales en actividades por criterio, repaso diferido y episodios de reparación (hoy guardan `null`).

## Compatibilidad y rollback

No hay migración: el evento completo ya se persiste en `attempts.event_json`. Los eventos legacy cargan sin cambios y se distinguen por la ausencia de `learner_signal_version`; no se rellenan valores. Revertir el cambio deja los campos nuevos en los eventos guardados, pero ningún cálculo depende de ellos.
