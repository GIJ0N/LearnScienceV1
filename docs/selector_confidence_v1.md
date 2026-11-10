# El selector usa el error con confianza alta (`selector_confidence_v1`)

Un error cometido con seguridad se repara antes de seguir.

## Regla

- `learningState` añade `committed_misconception`: verdadero si el último resultado de aprendizaje efectivo del tema (evento `EVIDENCE`
  con `evidence_role='learning'`, sin evaluaciones supersedidas ni episodios de reparación hijos, ignorando `UNKNOWN`) no es correcto y
  tiene `calibration_signal === 'committed_misconception'` (fallo con confianza declarada ≥ 70 %). Si hay un acierto posterior, es falso.
- Solo cuentan eventos nuevos con `learner_signal_version`. Los eventos legacy no se reinterpretan.
- `selectTutorAction`: en la rama que ya devolvía `REPAIR` por dificultad actual, ahora también se devuelve `REPAIR` cuando
  `committed_misconception` es verdadero, con el motivo «Respondiste con mucha seguridad algo incorrecto: lo revisamos antes de avanzar.»
  Si no hay una dimensión con dificultad, `target_dimension` es `null`.
- No cambia el orden de prioridades (reparación abierta, reanudar, límite de visita, repaso vencido, prerrequisito con dificultad,
  reparación…) ni los límites de visita.

## Evidencia

Ninguna. Es una decisión de ruta: no crea ni cambia evidencia, ni acredita dominio. La confianza declarada sigue siendo un dato para decidir
la siguiente intervención (`learner_signals_v1`).

## Compatibilidad y rollback

Campo derivado en memoria; no se guarda. Revertir devuelve el selector anterior. Las decisiones ya registradas no cambian.

## Límites

Si el fallo ya contradecía la evidencia de una dimensión, el selector ya elegía `REPAIR`; la regla nueva sirve sobre todo cuando el fallo seguro
no quedó reflejado en la cobertura. Una confianza ≥ 70 % es un umbral de ingeniería, no un diagnóstico de la persona.
