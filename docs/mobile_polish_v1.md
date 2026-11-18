# Pulido para iPhone (`mobile_polish_v1`)

## Propósito

Que la app se use sin fricción en un iPhone: nada queda bajo la muesca, los toques aciertan, Safari no hace zoom al
enfocar un campo y una respuesta a medio escribir no se pierde si la página se recarga o se cambia de app.
Es presentación y comodidad local: no toca evidencia, eventos, cobertura ni calendario.

## Qué cambia

1. **Safe-area.** `VISUAL_CSS` usa `env(safe-area-inset-top/right/bottom/left)`: relleno lateral y superior en `body`,
   relleno inferior en `main` y desplazamiento de la barra superior fija (`.app-nav`) y del aviso `#status`. Las
   barras de la app son solo superiores (no hay barra de navegación inferior); el área inferior protege el final del contenido.
   Para que `env()` valga algo distinto de 0 hace falta `viewport-fit=cover`: el documento principal (`HTML` en `app_legacy.py`)
   **no** lo usaba, así que se añade a su `<meta name="viewport">`. Sin muesca todos los `env()` valen 0 y el escritorio no cambia.
2. **Objetivos táctiles de 44 px.** En `@media(max-width:600px)`: `min-height:44px;min-width:44px` para botones, pestañas de la
   navegación (`.nav-button`, `.nav-toggle`), `summary`, enlaces dentro de `.box`/`.app-nav` y etiquetas de recordatorios.
   Los enlaces pasan a `inline-flex` para poder tener alto. El escritorio no cambia.
3. **Campos a 16 px.** En el mismo bloque, `input, textarea, select` (y los campos con reglas propias más específicas) usan
   `font-size:16px`, el mínimo con el que Safari no amplía la página al enfocar.
4. **Borrador local de respuesta abierta.** En el flujo principal (`renderQuestion`, el cuadro «Tu idea y por qué») el texto se
   guarda mientras se escribe en `localStorage` con la clave `ls-draft:<profile_id>:<activity_id>` (si la pregunta no trae
   `activity_id` se usa `<nodo>:<fase>:<hash del enunciado>`, para que sea estable al volver). Todo va en `try/catch`.
   Se restaura al volver a la actividad y se borra cuando `/api/evaluate` responde con éxito. Un envío fallido lo conserva.
   Sin perfil o sin actividad no hay clave: nunca hay borrador global. Tope de 4000 caracteres.
5. Sin `innerHTML` con datos; no se añadieron clases nuevas (no hay `className=` nuevo).

## Qué NO cambia

- Un borrador **nunca es evidencia**: no se envía al servidor, no se guarda en la base ni en la meta, no pasa por
  `commitRecord`, `applyResult` ni los eventos, y no cuenta como intento, ayuda ni exposición.
- Escribir no crea llamadas de red. Solo el envío que ya existía llama a `/api/evaluate`, con el mismo cuerpo de antes.
- Aislamiento por perfil: un borrador del perfil A no aparece en el perfil B.
- Servidor, esquemas, políticas y veredictos sin cambios.

## Límites

- Sin probar en Safari ni iPhone reales (muesca, barra de direcciones dinámica, teclado, zoom). Solo hay pruebas de texto
  sobre el CSS y de DOM simulado sobre el borrador.
- El borrador vive en el navegador de ese dispositivo: no se sincroniza entre dispositivos y se pierde si se borra el almacenamiento del sitio.
- Solo cubre el cuadro de respuesta del flujo principal. Quedan fuera: producción del diagnóstico, reparación, casos reales,
  «Enséñale a Beto», mentor y el campo opcional de razonamiento.
- Un borrador de una actividad que nunca se envía queda guardado hasta que se envíe esa actividad o se limpie el navegador.

## Compatibilidad y rollback

Sin cambios de datos ni de rutas. Revertir el commit quita el CSS, el meta y el borrador; los borradores ya guardados quedan
como claves `ls-draft:*` inertes en el navegador.
