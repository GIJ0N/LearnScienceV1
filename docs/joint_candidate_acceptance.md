# Aceptación real acotada de la candidata conjunta

`tools/accept_joint_candidate.py` ejecuta las funciones activas de `app_legacy.py` con Gemini real. Solo se usa con autorización explícita. No lo importa el servidor y no añade endpoints ni cambia política pedagógica. `tools/accept_joint_policy.js` permite aplicar los resultados mediante las funciones de producción de `app.js`; simula el DOM, **no es una prueba de navegador**. No copia un motor pedagógico.

## Estado y presupuesto

El directorio fijo hermano del worktree, `../learnscience-joint-acceptance/`, contiene el perfil sintético, SQLite, solicitudes, respuestas del proveedor, resultados normalizados y un contador SQLite separado. Debe permanecer fuera de Git. No usar una base personal, borrar el contador, cambiar de directorio para recuperar presupuesto ni ejecutar llamadas por otra ruta durante esta aceptación.

El contador reserva cada solicitud en una transacción antes de abrir la conexión HTTPS. Máximo total: **10**, incluidos errores, reintentos e interrupciones. Una reserva pendiente bloquea la reanudación; no hay comando de reinicio del presupuesto. Un fallo de transporte detiene la sesión, incluidos autenticación y cuota. Una respuesta requiere revisión antes de la siguiente llamada. Dos rechazos consecutivos del contrato, fuga, evidencia falsa o un hallazgo fatal bloquean llamadas posteriores. No hay reintentos automáticos.

La clave ya inyectada en `GEMINI_API_KEY` solo la consume el cliente activo; no inspeccionar el entorno ni copiarla a archivos. Si la configuración la inyecta bajo otro nombre, asignarla únicamente en el entorno del proceso mediante la configuración autorizada. El harness no almacena cabeceras, URLs de peticiones ni mensajes de errores del proveedor. Los resultados son datos sintéticos de aceptación, nunca material para un commit.

## Uso por operador

```text
python tools/accept_joint_candidate.py init
python tools/accept_joint_candidate.py status
python tools/accept_joint_candidate.py call make_criterion_activity /ruta/externa/actividad.json
python tools/accept_joint_candidate.py review 1 accepted "Justificación revisada"
```

Cada payload debe incluir el `profile_id` sintético creado por `init`. Operaciones disponibles: `make_criterion_activity`, `evaluate_criterion_activity`, `evaluate`, `repair_diagnosis`, `repair_teaching`. Los archivos `request-NN.json` distinguen `provider_content` de `server_result`, modelo, entrada y números exactos de solicitud. Un resultado de caché o «No sé» local no incrementa el contador. El contador mide intentos HTTP del cliente, no facturación ni procesamiento interno del proveedor.

Revisar la pregunta literalmente, opciones, referencia privada autorizada, feedback y procedencia antes de elegir `accepted`, `contract_rejected`, `leak`, `false_evidence` o `fatal`. Los dos últimos hallazgos y la fuga detienen la aceptación. Si una operación rechaza el contenido, revisar el archivo externo antes de cualquier reintento. No aprobar una reserva interrumpida.

La acción `policy /ruta/externa/paso.json` carga el perfil de la SQLite sintética y aplica una acción de `app.js`: `criterion`, `parent`, `diagnosis`, `teach`, `checkpoint`, `apply` o `snapshot`. Requiere una meta sintética activa con nodo padre `n1` y su lección independiente; puede tener prerrequisito `n0`. `parent` usa el intento estable `joint-parent`; cada reparación obtiene sus identidades de producción. `diagnosis` recibe `plan` y evaluación del padre; `teach` recibe `package`. `checkpoint` recibe respuesta y opcionalmente `help: true` solo en GUIDED; debe guardarse antes de pedir evaluación. `apply` recibe la evaluación obtenida y prueba aplicar dos veces el mismo checkpoint sin duplicar evidencia. No añadir estados de evaluación inventados para completar el recorrido.

Cada paso prueba mapa sin mutación ni red, identidades únicas y recarga durable tras normalización de servidor. `snapshot` verifica además que no cambia la revisión SQLite. El fichero externo `policy-latest.json` conserva el resultado completo. La ayuda registrada es metadato del cliente, no una salida de Gemini. Las dimensiones, permisos, transiciones y suficiencia proceden de la política local. La fase o el campo `independent` por sí solos no acreditan éxito integral.

## Dictamen y límites

Informar por separado pruebas offline, integración real y navegador. Registrar SHA, cambios, comandos/versiones, solicitudes exactas, revisión humana de contenido, bloqueos y límites. No declarar un reintento padre, transferencia o cierre del episodio si no se ejecutaron; conservar el checkpoint real al agotar presupuesto. Una sesión verifica integración, **no eficacia pedagógica**, calibración del evaluador ni novedad semántica. La prueba de instrucciones de generación es una regresión del contrato de prompt, no garantía de que todo contenido futuro sea inequívoco.

La regresión del harness se ejecuta sin red con `python tests/accept_joint_candidate.test.py`. La reversión consiste en dejar de usar el worktree aislado; conservar el contador y las SQLite externas para auditoría. No abrir datos personales ni migrarlos para esta prueba.
