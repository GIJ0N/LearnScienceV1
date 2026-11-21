# evidence_hardening_v1

Endurece las reglas de evidencia que antes permitían dominio con una confirmación de opción múltiple o con una práctica copiada del ejemplo. No cambia SQLite, `memory_store.py`, el juez, `MIN_INDEPENDENT_SUCCESSES`, `due` ni las exenciones de dificultad.

## Qué cambia

1. **Ancla con respuesta escrita calificada localmente.** Una confirmación `OPEN_ANSWER` correcta ya no crea ancla; queda formativa. Solo `createTrustAnchor` con `source='PRODUCTION'` y `basis` `numeric` u `ordering` (≥4 pasos) escribe `TRUST_ANCHOR` con `anchor_basis` y `anchor_policy_version='evidence_hardening_v1'`. La práctica de cálculo se prueba primero; el orden solo si el cálculo no aplica. Banda `base` no ancla. El servidor fuerza banda `standard` para `purpose='anchor'`.
2. **Anclas antiguas degradadas al leer.** `isHardAnchor` exige origen `PRODUCTION` y la versión nueva. Los marcadores anteriores no cuentan para suficiencia, panel ni cobertura. `sufficient(d,opts)` y `deriveCoverage(c,opts)` aceptan `acceptLegacyAnchors` solo para medir impacto. Nada se borra ni se reescribe.
3. **Pregunta independiente distinta del ejemplo.** Al generar una lección, la práctica independiente o de integración que contiene el enunciado del ejemplo, o comparte al menos 70 % de sus términos con él, queda con `supports_independence=false` y `example_overlap=true`. Frente a `check` y `guided` solo se comparan igualdad normalizada y contención de al menos 20 caracteres; las cifras distintas no bastan.
4. **Hito «aciertos sin ayuda».** Cuenta solo evidencia `CORRECT`, `is_independent===true`, sin ayuda, no corregida y con `attempt_id` único desde la última enseñanza. Sin aciertos muestra «Aún sin aciertos por tu cuenta en esta visita».
5. **Exposición formativa.** `EXPOSURE_TYPES` incluye los tipos actuales, los legacy y `FORMATIVE_EXPOSURE`. Los flujos que ya escriben su evento (intercalado, composición, confirmación, corrección de error, comprobación directa, comprobación de pasos, retirada gradual, reporte de reto) solo marcan `review.last_exposure_at` y `exposure_before_response`. `FORMATIVE_EXPOSURE` aparece para Beto (una vez por sesión) y para el compromiso de predicción de un reto. No crea `EVIDENCE` ni cambia `due`.
6. **Ancla sin repetición.** Un fallo de ancla enfría el tema hasta una nueva enseñanza o 24 horas. `ANCHOR_UNAVAILABLE` se escribe una vez por nodo; la oferta muestra «Intentar de nuevo» una sola vez.
7. **Aviso de política.** `hardeningImpact` lista los temas que pasarían de cerrados a por confirmar. «Seguir con la ruta» escribe un `CURRICULUM_CONTINUED` por tema afectado y un `POLICY_NOTICE_ACK`; dos clics no duplican nada.

## Eventos nuevos

| Tipo | Campos principales | Evidencia |
|---|---|---|
| `TRUST_ANCHOR` (nuevo formato) | `anchor_basis`, `ordering_steps`, `anchor_policy_version`, `source='PRODUCTION'` | Ancla, no EVIDENCE |
| `FORMATIVE_EXPOSURE` | `source`, `ref_id`, `exposure_version` | No |
| `ANCHOR_UNAVAILABLE` | `kinds`, `retry_used`, `policy_version` | No |
| `POLICY_NOTICE_ACK` | `policy_version`, `at` | No |
| `EVIDENCE` de producción | `purpose`, `anchor_for_attempt_id` | Sí, con las reglas de siempre |

`memory_store.validate_store` no conoce estos tipos y no necesita cambios: solo rechaza `CONTENT_EXPOSURE` sin `episode_id`, y estos eventos no lo usan. Las pruebas de `tests/evidence_hardening_store.test.py` lo verifican.

## Límites conocidos

- La similitud léxica no detecta paráfrasis. Una práctica que cambia las palabras del ejemplo pasa como independiente.
- La comparación con `check` y `guided` solo marca igualdad o contención; la plantilla repetida con otras cifras no se marca.
- La decisión de ancla por orden es una señal menor que la de cálculo; por eso el cálculo va primero.
- Para temas no cuantitativos sin producción posible, el aviso dice que la práctica no aplica y el tema queda por confirmar. Mostrar un texto distinto para ese caso requiere conocer la disponibilidad antes de avisar; queda pendiente.
- Un fallo de producción cuenta como contradicción de suficiencia. La interfaz lo advierte antes de empezar, pero la regla es la misma que antes.
- `short_answer` queda para L2.

## Compatibilidad y reversión

- Los temas cerrados con anclas antiguas más aciertos del modelo pasan a `PARTIALLY_UNDERSTOOD`; el aviso lo explica. Repasos y calendarios conservan su estado.
- Para volver a una versión anterior: guardar y exportar respaldo antes. La versión anterior no entiende `FORMATIVE_EXPOSURE`, `ANCHOR_UNAVAILABLE` ni `POLICY_NOTICE_ACK`; los ignora, pero no recupera las anclas sin versión que esta versión no creó.

## Pruebas

Ver `docs/validation.md`, sección `evidence_hardening_v1`. Las pruebas de función usan respuestas controladas y SQLite temporal. No se llamó a Gemini real ni a un navegador.

## Mutaciones comprobadas

Rompe, confirma el fallo y restaura: filtro de origen en `createTrustAnchor`, filtro de versión en `isHardAnchor`, mínimo de 4 pasos, comparación con el enunciado del ejemplo, filtro de independencia del hito, exposición formativa del reto y tipos legacy de `EXPOSURE_TYPES`.


## Nota de versión L2a (C-a, C-b, C-c)

- C-a: solo una práctica de propósito `anchor` crea ancla local, y `createTrustAnchor` exige `meta.purpose === 'anchor'`. La práctica normal correcta ya no crea ancla.
- C-b: cuando el ancla no está disponible tras un intento fallido, el aviso muestra el texto explícito `ANCHOR_UNAVAILABLE_NOTE` en lugar de un reintento vacío.
- C-c: `fetchProduction` pasa de `numeric` a `ordering` solo ante `PRODUCTION_NOT_APPLICABLE`. Una respuesta malformada devuelve falso sin marcar el tema como sin práctica.
- Sigue vigente la regla de ejemplo: un enunciado independiente que copia o casi copia el ejemplo se registra como práctica (`supports_independence` falso, `example_overlap` verdadero). Lo cubre `IndependentNotCopiedFromExample` en `tests/evidence_hardening_backend.test.py`.
- Ver `docs/delayed_mastery_v1.md` para el dominio diferido.
