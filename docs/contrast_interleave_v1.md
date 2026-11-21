# Contraste e intercalado dirigido v1 (`contrast_interleave_v1`)

## Propósito

La práctica intercalada (`spaced_practice_v1`, sección B) mezcla temas que la persona ya sostiene. Hoy la elección de temas sigue el calendario: primero el repaso vencido, luego la exposición más antigua. Esta versión añade dos cosas acotadas:

- **Intercalado dirigido (B):** en la sesión de práctica intercalada, los temas *confundibles* se ordenan antes que por fecha.
- **Contraste (A y C):** cada distractor de una pregunta de discriminación puede enlazar al tema con el que se confunde, usando un `node_id` o `chain_id` real del grafo de la meta. Al responder, la app muestra esa comparación y la registra como exposición formativa.

## Lo que NO cambia

El intercalado y el contraste **no son evidencia**. No cambian, ni en el cliente ni en el servidor:

- `EVIDENCE`, `sufficient()`, `independentSuccesses`, `writtenDeterministic`, el juez, `TRUST` y la cobertura.
- El calendario (`nextReviewStep`, `reviews`) y la última exposición (`lastExposure`).
- La identidad de intentos, la idempotencia de `DISCRIMINATION` y el aislamiento por perfil.

## B. Orden de la práctica intercalada

- Un tema es **confundible** si aparece en algún evento `CONTRAST_SHOWN` del mismo goal, como `node_id` o como `confused_node_id`.
- En la sesión `discrimination`, `mixedCandidates` ordena primero los temas confundibles y después aplica el orden previo (repaso vencido, exposición más antigua, id). Las demás sesiones (`composition`, `error_hunt`, `confirm`) no cambian.
- Los ítems recibidos se ordenan según el orden de los temas de la sesión, de modo que la práctica respeta la prioridad.
- Si no hay eventos de contraste, el orden es el de antes.

## A. Enlaces de contraste (servidor)

`POST /api/practice/discriminate`: cada opción puede llevar `confused_with`, un `node_id` o `chain_id` del grafo de la meta, con el tema al que se parece esa idea errónea. Es opcional. `DISC_SCHEMA` lo declara; la confirmación reutiliza el mismo esquema y lo ignora.

Referencias válidas, leídas del almacén y no del cliente:

- `node_id` de la meta en el store del perfil.
- `chain_id` de `load_graph(profile_id, goal_id)`, mapeado a su `node_id`.

Reglas:

1. Una opción con `confused_with` no vacío debe resolver a una referencia válida, y el tema resultante debe ser distinto del tema de la pregunta. Si no, **se descarta la pregunta completa** (el par) y se registra el motivo en el reintento existente. Nada parcial se guarda.
2. Una pregunta sin `confused_with` se valida como antes: sin par, sin contraste.
3. Si quedan menos de `DISC_MIN` preguntas válidas tras el reintento, se lanza `ValueError` y no se guarda nada.
4. Si el perfil no existe en el almacén, no hay referencias y por tanto no hay enlaces; la generación sigue como antes y el perfil se valida al guardar.

Ítem público: solo si hay al menos un enlace válido aparece `contrast`, una lista de `{pair_id, confused_ref, confused_node_id}` con un `pair_id` por tema confundido distinto. Sin enlaces, el ítem conserva exactamente sus claves anteriores. La clave de respuesta y las confusiones privadas no cambian y no revelan la opción correcta.

## C. Exposición formativa (cliente y almacén)

Tras responder una pregunta con `contrast`, la app muestra «Compara con: …» con los nombres de los temas enlazados y emite un evento por par:

```
CONTRAST_SHOWN {version:'contrast_interleave_v1', node_id, pair_id, confused_node_id, confused_ref, attempt_id, at, creates_evidence:false}
```

- `CONTRAST_SHOWN` **no** entra en `EXPOSURE_TYPES`, `TEACHING_REF_TYPES` ni `isStudyAnswer`.
- `validate_store` fuerza `creates_evidence=false` y rechaza un `confused_node_id` que no sea un tema de la meta, igual que ya se hace con `node_id`.
- Se emite una sola vez por `attempt_id` y `pair_id`.

## Compatibilidad y rollback

- Sin tablas nuevas. Los ítems sin `contrast` y los eventos anteriores no cambian.
- Una versión anterior lee `CONTRAST_SHOWN` como un tipo desconocido sin efecto. Su `creates_evidence:false` no la convierte en evidencia.
- Revertir devuelve el orden por fecha; los eventos quedan sin uso.

## Pruebas

- `tests/contrast_interleave.test.js` (cliente, sin navegador): orden confundible antes que fecha; sin contraste, orden igual que antes; `CONTRAST_SHOWN` no afecta `lastExposure`, `isStudyAnswer` ni `EXPOSURE_TYPES`; sin par no se emite nada.
- `tests/contrast_interleave_backend.test.py` (SQLite temporal, proveedor controlado): sin enlace no hay `contrast`; enlace inventado rechazado sin guardar nada; enlace al propio tema rechazado; enlace a nodo y a cadena válidos; `validate_store` fuerza `creates_evidence=false`; `confused_node_id` inválido rechazado.
- Mutaciones: quitar `creates_evidence=false` en `validate_store`; quitar el validador de enlaces. Ambas deben fallar, y después se restauran.

## Fuera de alcance

- Contraste en otros flujos (lección, reparación, repaso, composición, reparación de errores, confirmación).
- Cambiar la evaluación de `DISCRIMINATION` en el panel de pericia o en la práctica diaria: existe una inconsistencia previa (ver reporte de la rama); no se corrige aquí.
- Gemini real y navegador real: no se validan en esta versión.
