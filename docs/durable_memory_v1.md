# Memoria durable y perfiles locales v1

Ruta guarda la memoria de aprendizaje en SQLite. La base predeterminada es `data/ruta-memory.sqlite3`; `RUTA_DB_PATH` permite usar una ubicación aislada para pruebas. SQLite es la fuente de verdad después de crear o seleccionar un perfil. El navegador conserva únicamente el identificador del perfil seleccionado y estado transitorio de interfaz.

Un perfil local separa su documento de progreso, preferencias explícitas e intentos. No es una cuenta ni un mecanismo de autenticación. Cada meta, sesión, evento y episodio queda asociado al `profile_id`. La tabla `attempts` es una proyección consultable del ledger: conserva pregunta, respuesta, evaluación, ayuda, dimensiones observadas y el evento completo. La clave `(profile_id, attempt_id)` preserva la idempotencia.

## Migración y compatibilidad

Los datos v4 de `localStorage` no se leen ni se migran automáticamente. La persona debe crear un perfil vacío y elegir **Importar datos v4 de este navegador**. Antes de escribir, el servidor valida IDs, relaciones, referencias y duplicados. La importación copia el documento, añade asociación de perfil y registra un hash; repetir exactamente la misma importación es un no-op. El original de `localStorage` no se borra ni se modifica.

Los campos ausentes en datos legacy se interpretan de forma conservadora. En particular, eventos sin dimensiones observadas y coberturas sin evidencia no reciben evidencia positiva. La política de evidencia, `sufficient()` y los umbrales de dominio no cambian.

## Respaldo y restauración

**Exportar respaldo durable** fuerza primero el vaciado de la cola de escritura. Si existe un fallo pendiente, la exportación se bloquea para evitar presentar una copia antigua como actual. El archivo contiene versión, perfil, preferencias, documento completo y revisión. La restauración es explícita, valida el documento y reemplaza solamente la memoria del perfil seleccionado dentro de una transacción.

## Uso de memoria por el tutor

Al generar una microlección, el frontend envía `profile_id`, `goal_id` y `node_id`. El servidor recupera como máximo cinco intentos del mismo perfil, meta y nodo, junto con preferencias explícitas. El prompt recibe únicamente ese contexto acotado. La respuesta incluye `memory_reason` y `memory_sources` con los `attempt_id` usados, y la interfaz muestra por qué se eligió la actividad. La ausencia de historial produce una razón explícita y no inventa antecedentes.

## Sesión breve y preferencias

**Tengo siete minutos** utiliza el mismo motor pedagógico. Prioriza un repaso vencido; si no existe, reanuda la siguiente habilidad pendiente. Guarda la razón y el punto de sesión, y **Pausar y volver a la ruta** conserva ese estado. El texto no promete una duración exacta.

Las preferencias son booleanos explícitos: contexto de ingeniería, ejemplos concretos y preguntas antes de la explicación. No se derivan perfiles psicológicos ni estilos de aprendizaje.

## Prueba manual aislada

1. Define `RUTA_DB_PATH` con una ruta temporal y arranca `python app_legacy.py`.
2. Abre un perfil de navegador separado y crea dos perfiles locales.
3. Crea una meta en el primer perfil, avanza una actividad y reinicia el servidor. Confirma que se reanuda la misma sesión y que **Mi aprendizaje** muestra pregunta, respuesta y evaluación.
4. Cambia al segundo perfil y confirma que no aparecen metas ni intentos del primero.
5. Con un perfil vacío, importa una copia v4 dos veces. La segunda debe informar que no duplicó datos y el dato v4 original debe permanecer intacto.
6. Exporta, crea otro perfil vacío y restaura el archivo. Comprueba metas, sesión e historial.
7. Activa **Tengo siete minutos**, pausa y vuelve a entrar; confirma que la sesión conserva el punto elegido y su razón.

La calidad de las respuestas reales de Gemini solo puede validarse con `GEMINI_API_KEY`. Las pruebas automatizadas sustituyen la generación y no constituyen una validación del proveedor.

## Regreso a la versión anterior

Antes de volver a una versión sin SQLite, exporta un respaldo durable de cada perfil. La versión anterior puede seguir usando el store v4 original porque la importación no lo modifica. El progreso creado únicamente en SQLite no es legible por la versión anterior; consérvalo mediante los respaldos y no borres `data/ruta-memory.sqlite3`. Volver a esta versión y restaurar el respaldo recupera ese trabajo. No existe una conversión automática de SQLite hacia `localStorage`.
