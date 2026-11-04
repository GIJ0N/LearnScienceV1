# Mapa de habilidades y evidencia

La vista de «Mi ruta» representa los prerrequisitos existentes y permite consultar
las dimensiones y los IDs de intentos. No es una red neuronal ni un nuevo modelo
de dominio. Las flechas significan dependencia curricular; no transmiten evidencia.

`evidenceMapSnapshot()` es una proyección de solo lectura. Reutiliza
`deriveCoverage()` e `independentSuccesses()` sin cambiar sus umbrales. Mostrar o
seleccionar un nodo no guarda datos, no genera actividades y no modifica la
reparación o sesión activa. El historial distingue alcance, ayuda y dimensiones.
La vista no muestra las referencias privadas de respuesta.

El SVG sirve para mapas pequeños; los mismos nodos tienen botones nativos para
teclado. Más de 40 nodos se presentan como lista. Datos sin contrato no reciben uno
por visualizarse; dependencias inválidas se advierten y ciclos se muestran sin
flechas. La cobertura textual y los controles anteriores permanecen disponibles.

## Validación

```text
node tests/evidence_map.test.js
node --check app.js
python tools/check_parity.py
python tests/check_parity.test.py
```

La suite comprueba paridad de la proyección con la política, ausencia de propagación,
ayuda, alcance hijo, UNKNOWN, duplicados, legacy, ciclos, texto no ejecutable y
ausencia de escrituras al explorar. También se debe ejecutar el workflow completo.

Para aceptación de navegador, usar `PORT` y `RUTA_DB_PATH` con origen y SQLite de
prueba separados. Seleccionar una meta sintética, abrir «Mi ruta», seleccionar nodos
por ratón y teclado, comparar dimensiones e intentos y recargar. Verificar que la
revisión durable, sesión e historial no cambiaron solo por consultar el mapa.

## Compatibilidad y reversión

No hay migración de datos, nuevos campos persistentes, nuevos proveedores ni copia
de código de LearnHarness. La base de esta entrega es la candidata `4b855d6`, no
main. El delta debe publicarse después de resolver su dependencia de PR #12.
Revertir únicamente los cambios de esta vista, su test y CI restaura la presentación
anterior sin tocar SQLite. No revertir la base de reparación con esta entrega.

Opción múltiple con explicación, grafo proposicional y evaluación por criterio son
entregas posteriores; este mapa no las implementa ni presupone su efectividad.
