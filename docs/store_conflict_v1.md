# Conflicto entre pestañas (`store_conflict_v1`)

## Propósito

Dos pestañas abiertas con el mismo perfil se pisaban. La segunda guardaba y subía la revisión; la primera quedaba obsoleta y su guardado fallaba con «La memoria cambió en otra sesión». Antes, esa pestaña reenviaba la misma revisión vieja con «Reintentar guardado» y nunca funcionaba, y sus intentos vivían solo en la memoria JS hasta que se recargaba o cerraba la página. Este cambio hace visible el conflicto y evita que la pestaña obsoleta sobrescriba o pierda nada sin que el aprendiz decida.

## Qué cambia

1. **Código de conflicto en el servidor.** `memory_store.py` antepone `STORE_CONFLICT: ` al error de revisión. `app_legacy.py` responde ese caso con `{"error": "...", "code": "STORE_CONFLICT"}` (HTTP 400, texto sin el prefijo). Los demás errores de validación no llevan `code`. El control optimista y `expected_revision` no cambian.
2. **Cliente sin reintento a ciegas.** Ante `STORE_CONFLICT`, `save()` no vuelve a enviar nada mientras el perfil esté en conflicto. En lugar de «Reintentar guardado» aparece una barra con el aviso «Otra pestaña guardó cambios de este perfil. Tienes N intentos sin guardar.» y dos acciones:
   - **Descargar cambios no guardados**: baja un JSON con el estado local de esta pestaña. No se importa, no se fusiona y no se envía al servidor.
   - **Recargar desde el disco**: pide confirmación («Se descartarán los N intentos sin guardar en esta pestaña. ¿Continuar?») y solo entonces carga el perfil desde el servidor.
   «Reintentar guardado» sigue apareciendo para errores que no son conflicto, como la red.
3. **Aviso al cerrar.** Mientras haya cambios sin guardar o un guardado en curso, hay un listener `beforeunload` que pide confirmación. Se quita cuando no quedan cambios pendientes.
4. **Borrador hasta el guardado durable.** Al responder `/api/evaluate`, el borrador `ls-draft:<perfil>:<actividad>` queda marcado para ese intento, pero no se borra. Se borra solo cuando un guardado exitoso contiene el intento en la memoria. Si el guardado falla, el borrador se conserva.

## Qué NO hace

- No fusiona cambios de las dos pestañas ni elige un ganador («gana el último»).
- No reenvía la revisión nueva ni `expected_revision: null`: eso borraría la evidencia de la otra pestaña, porque la proyección `attempts` hace DELETE + INSERT.
- No cambia evidencia, reglas de suficiencia, `TEACHING_EXPOSURE`, `validate_store`, la proyección `attempts` ni qué cuenta en «Aprendizaje».
- El borrador sigue siendo solo del navegador: no es evidencia, no se envía al servidor y no cuenta como intento.

## Límites

- **Dos pestañas siguen siendo posibles.** Este cambio solo hace seguro el conflicto; no impide que existan. El arreglo de raíz es un escritor único por perfil (BroadcastChannel o localStorage), que cambia el comportamiento de la app y queda pendiente de decisión del usuario.
- El intento que solo existía en la pestaña obsoleta se conserva en el archivo descargado, pero no en el disco hasta que el aprendiz decida cargarlo. La app no lo reimporta sola.
- El conteo «N intentos» cuenta los eventos `EVIDENCE` de la memoria local cuyo `attempt_id` no estuvo en el último guardado confirmado. Los cambios que no son intentos (preferencias, sesión) no se cuentan.
- El aviso y el borrador se verificaron con DOM simulado en Node, no en un navegador real.

## Verificación

- Automática: `python tests/store_conflict_backend.test.py` y `node tests/store_conflict.test.js`, ambos en `.github/workflows/ci.yml` y en `docs/validation.md`.
- A mano, con dos pestañas del mismo perfil:
  1. Abrir el perfil en la pestaña A y en la pestaña B.
  2. Responder y guardar en la pestaña B.
  3. Responder en la pestaña A. Debe aparecer la barra de conflicto y el aviso de cierre si intentas salir.
  4. Usar «Descargar cambios no guardados» y comprobar que el JSON contiene solo lo de la pestaña A.
  5. Usar «Recargar desde el disco», cancelar la confirmación y comprobar que nada cambia; repetir aceptando y comprobar que aparece lo guardado por B.

## Compatibilidad y reversión

Sin cambios de esquema ni de datos. Las respuestas de error sin conflicto no cambian. Revertir el commit quita la barra, el listener y la liberación del borrador; los borradores ya guardados quedan como claves `ls-draft:*` sin usar, como antes.
