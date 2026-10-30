# Integridad del evaluador y del mapa

Base: `1af3c0e5e22cd9818874599a8d405fc12823058d`. Rama local: `feat/tutor-integrity-v1`.

## Alcance implementado

- La explicación se evalúa contra pregunta, opciones, criterio y referencia privada persistidos. `criterion_description` y cualquier referencia del payload se ignoran. La explicación del alumno se serializa como datos; esto reduce ambigüedad pero no demuestra inmunidad del modelo a prompt injection.
- Una opción ajena al contrato se rechaza antes de reservar el intento o invocar al proveedor. La vertical admite exactamente los dos criterios obligatorios que realmente sabe evaluar.
- El generador solicita `explanation_reference` privada con fundamento, condiciones, alternativas y errores. Ausencia de referencia o copia literal de la descripción pública causa abstención sin llamar al modelo. No se puede garantizar automáticamente que cualquier otro texto sea semánticamente suficiente; el modelo puede abstenerse y queda pendiente revisión humana real.
- La elección tiene método `deterministic_option_key`; la explicación `provider_semantic`, `provider_unavailable` o `not_evaluated`; el global se deriva por política. Un juicio correcto con ayuda conserva SATISFIED, pero no independencia. El alcance sigue siendo reconocimiento y explicación, nunca producción libre.
- La ayuda efectiva es el máximo del payload y del checkpoint persistido del mismo intento. Ambos proceden de la aplicación cliente: no es autenticación contra un cliente malicioso ni detección de ayuda fuera de la app. Se registra la procedencia.
- El cliente guarda el `attempt_id` antes de solicitar evaluación, espera confirmación durable y verifica perfil, objeto de meta, actividad, intento y solicitud antes de aplicar la respuesta. Un fallo de guardado impide enviar. Tras recargar, EVALUATING se presenta como pendiente de recuperación, no como una solicitud cuya actividad aún se conoce.
- La identidad durable de una actividad es `(profile_id, activity_id)`. Para actividades nuevas el servidor asigna un UUID y descarta cualquier ID sugerido por el proveedor. Dentro de esa identidad, la meta, versión y contratos público y privado son inmutables: una repetición canónicamente equivalente conserva el registro y sus fechas; una diferencia produce `CRITERION_ACTIVITY_CONFLICT`. Una revisión requiere una identidad nueva.
- La comparación serializa objetos JSON con claves ordenadas y conserva el orden semántico de listas. El compare-and-insert se ejecuta bajo `BEGIN IMMEDIATE`, de modo que dos conexiones no pueden sustituir el contrato durante una carrera. La llamada al proveedor ocurre antes y fuera de esa transacción.
- El mapa conserva IDs válidos de hasta 40 caracteres. Rechaza duplicados, ciclos, autorreferencias y referencias ausentes, incluidas las de nodos filtrados. La cobertura toma identidad y prerrequisitos del mapa validado. No reasocia aristas por posición.
- Se conserva el límite del mapa inicial: 5–12 nodos válidos; el prompt pide 6–8. Más de 12 se rechaza explícitamente en vez de truncar relaciones. No se modifica ni reinterpreta un mapa personal ya guardado.

## Tabla del resultado global

| Condición | Global | Independencia |
|---|---|---|
| Ambos criterios SATISFIED | CORRECT | Solo formato/fase admitidos y ayuda cero |
| Algún SATISFIED o PARTIAL, pero no ambos satisfechos | PARTIAL | No equivale a éxito integral |
| Todos NOT_EVALUATED | UNKNOWN | No hay éxito |
| Resto | INCORRECT | No hay éxito |

En esta vertical la opción siempre se corrige determinísticamente. Por eso una opción correcta con explicación no evaluada produce PARTIAL, conservando NOT_EVALUATED en el criterio conceptual. No se modifican `sufficient()`, umbrales, roles, selector ni política de transferencia. Varios criterios siguen perteneciendo a un solo intento.

## Banco offline

`python tools/criterion_benchmark.py` ejecuta 21 casos, siete por dominio: fracciones, tensión superficial y lectura de código (sin ejecutar código del alumno). `tests/fixtures/criterion_benchmark_v1.json` separa respuesta, expectativa revisable y salida simulada. Los conteos miden aplicación de contratos, no exactitud de Gemini ni eficacia pedagógica. Las expectativas todavía no tienen revisión independiente de un experto.

`python tools/criterion_benchmark.py --real-review-template` emite únicamente una plantilla para una aceptación futura autorizada (máximo propuesto de 21 llamadas, sin limitador automático). No consume red ni requiere claves. No hay aceptación real realizada en esta entrega.

## Demostración sin proveedor real

Desde la raíz del worktree, en PowerShell:

```powershell
$demoDb = Join-Path $env:TEMP ('learnscience-integrity-' + [guid]::NewGuid().ToString('N') + '.sqlite3')
python tools/serve_controlled_demo.py --prepare --db $demoDb
python tools/serve_controlled_demo.py --resume --db $demoDb --port 8906 --semantic SATISFIED
```

Abrir `http://127.0.0.1:8906/`, elegir **DEMO VISUAL SINTÉTICA**, su meta y **Continuar opción + explicación**. El encabezado DEMOSTRACIÓN y el feedback indican que el juicio semántico es fijo: cualquier texto recibe el estado configurado. La elección sí atraviesa la clave determinista real. La demo elimina la clave del entorno de su propio proceso y sustituye el cliente antes de servir; producción no importa este harness ni tiene un endpoint/payload para activarlo.

1. Elegir la primera opción, escribir explicación, pedir pista y evaluar: SATISFIED no se degrada por ayuda, pero el evento no es independiente.
2. Para otro estado, detener con Ctrl+C y reiniciar con la misma `$demoDb` y puerto, cambiando `--semantic` a `PARTIAL`, `NOT_SATISFIED`, `NOT_EVALUATED`, `unavailable` o `invalid`. Crear **Practicar opción + explicación** para un intento nuevo; uno ya evaluado devuelve su resultado anterior por idempotencia.
3. Escribir un borrador, dejar terminar el guardado y recargar: abrir meta y continuar conserva opción, explicación y ayuda.
4. Reiniciar con `--hold-evaluation` en una terminal interactiva. Enviar; la terminal anuncia que la reserva está hecha y espera Enter. Detener ese proceso mientras espera. Reiniciar sin esa opción, recargar, abrir meta y continuar la evaluación: mismo intento. No iniciar dos servidores sobre la misma base.
5. Buscar y seleccionar nodos del mapa o usar la lista no crea evidencia. La sesión solo cambia mediante una acción de aprendizaje explícita.

La preparación rechaza bases existentes y rutas dentro del repositorio. Reanudar requiere el marcador de demo. No usar rutas personales. Esta demo no ofrece generación de metas, lecciones principales ni reparación: esas rutas fallan explícitamente, sin llamar a un modelo. Reparación y retorno al padre están cubiertos por las suites controladas existentes, **no por un recorrido visual completo nuevo**.

## Compatibilidad, límites y reversión

No hay migración SQLite ni cambios de esquema. Nuevos contratos guardan referencias completas en el JSON privado existente, fuera de respuestas públicas y exportaciones. La estructura no se filtra; el contenido libre del feedback de un modelo todavía requiere revisión humana para descartar filtraciones semánticas.

Contratos legacy conservan sus IDs y no se renombran. Si su JSON puede interpretarse, solo se reutiliza ante un contrato semánticamente equivalente; JSON ambiguo o una mutación se rechaza conservadoramente. Contratos que guardaban solo la descripción pública se abstienen en intentos nuevos; resultados ya persistidos se devuelven sin reevaluarlos ni inventar evidencia. Restaurar una exportación pública sigue sin recuperar contratos privados, conserva la respuesta y usa la recuperación conservadora existente.

Los originales y sus datos se conservan; para revertir la entrega local basta dejar de usar este nuevo worktree y volver al anterior, sin borrar bases ni cambios. No abrir datos nuevos con código anterior suponiendo idéntico juicio: el anterior rebajaba respuestas asistidas y no tenía el contexto semántico corregido. Preferir otra SQLite de prueba para comparar versiones.

La protección de identidad no prueba que una referencia generada sea científicamente correcta. Tampoco coordina identidades entre perfiles: el alcance incluye el perfil deliberadamente, por lo que el mismo texto de ID puede existir en perfiles distintos sin compartir contratos, intentos ni evidencia.

## Trabajo diferido

Hito 4 es parcial: harness de criterios y aceptación visual de borrador, asistencia, interrupción y mapa; falta harness/aceptación visual de reparación completa. Hitos 5 y 6 no se iniciaron para reservar validación, sin anunciar un mapa global implementado.

La futura relación entre metas debe usar extremos `{profile_id, goal_id, node_id}`, ID propio, tipo, explicación, procedencia, fecha y estado explícito. Debe almacenarse aparte de evidencia; importaciones con extremos ausentes deben quedar inválidas, nunca reasociarse por nombre. La expansión debe validar una propuesta antes de incorporarla y conservar IDs existentes. No hay cambios de dominio derivados de vínculos ni implementación parcial de estos contratos en esta entrega.
