# Novedad declarada en la pregunta de integración (`integration_novelty_v1`)

Para que el flujo principal pueda producir evidencia de transferencia de forma legítima, sin que el servidor la invente.

## Contrato

- La pregunta de integración del esquema de lección admite `novelty_basis` (opcional): una frase que dice qué cambia
  (contexto, representación o decisión). El prompt pide una integración en un contexto o representación que **no** aparezca
  en la explicación, el ejemplo ni las otras preguntas.
- Tras limpiar la lección, el servidor marca `is_novel_variant=true`, `supports_transfer=true` y conserva `novelty_basis`
  solo si **ambas** condiciones se cumplen: `novelty_basis` tiene al menos 15 caracteres, y el enunciado de la integración
  (normalizado) es distinto del de `check`, `guided` e `independent`. Si no, no se añade ninguno de los tres campos.
- `novelty_basis` se acota a 300 caracteres.

## Evidencia

Sin cambios en la política. `activityContract` ya lee `is_novel_variant` y `supports_transfer` de la pregunta. Una integración
correcta, sin ayuda y con novedad declarada cuenta como variante nueva independiente (regla ya vigente). Con ayuda sigue sin ser
independiente. Un rol guiado nunca obtiene transferencia. Sin `novelty_basis` todo queda como hoy.

## Compatibilidad y rollback

Campos aditivos. Las lecciones ya guardadas no cambian y se leen igual. Revertir deja de declarar novedad; no hay datos que migrar.

## Límites

La declaración la hace el modelo y el servidor solo verifica que haya una justificación y que el enunciado sea distinto: no
comprueba que de verdad sea un contexto nuevo. Por eso sigue siendo evidencia, no certeza de transferencia; la transferencia
duradera exige además sus propias evidencias.
