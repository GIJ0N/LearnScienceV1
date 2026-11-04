# Mapa de habilidades y evidencia

La vista de «Mi ruta» representa los prerrequisitos existentes y permite consultar
las dimensiones y los IDs de intentos. No es una red neuronal ni un nuevo modelo
de dominio. Las flechas significan dependencia curricular; no transmiten evidencia.

`evidenceMapSnapshot()` es una proyección de solo lectura. Reutiliza
`deriveCoverage()` e `independentSuccesses()` sin cambiar sus umbrales. Mostrar o
seleccionar un nodo no guarda datos, no genera actividades y no modifica la
reparación o sesión activa. El historial distingue alcance, ayuda y dimensiones.
La vista no muestra las referencias privadas de respuesta.

El SVG sirve para mapas pequeños y permite zoom, desplazamiento, búsqueda y
selección con ratón o teclado. El detalle se mantiene fuera del lienzo y los mismos
nodos aparecen como botones en una alternativa de lista. Más de 40 nodos se
presentan como lista para evitar una visualización ilegible. Datos sin contrato no
reciben uno por visualizarse; dependencias inválidas se advierten y ciclos se
muestran sin flechas. La cobertura textual y los controles anteriores permanecen
disponibles.

La leyenda describe estados de evidencia, no una puntuación neuronal. Solo se
dibujan las relaciones de prerrequisito almacenadas; no se fabrican relaciones
conceptuales. Buscar, enfocar, ampliar o mover el lienzo modifica únicamente el
estado efímero de la vista.

## Validación

```text
node tests/evidence_map.test.js
python tests/visual_demo_seed.test.py
node --check app.js
python tools/check_parity.py
python tests/check_parity.test.py
```

La suite comprueba paridad de la proyección con la política, ausencia de propagación,
ayuda, alcance hijo, UNKNOWN, duplicados, legacy, ciclos, texto no ejecutable,
relaciones exclusivamente reales, búsqueda, teclado, zoom y ausencia de escrituras
al explorar. También se debe ejecutar el workflow completo.

Para aceptación de navegador, usar `PORT` y `RUTA_DB_PATH` con origen y SQLite de
prueba separados. `tools/seed_visual_demo.py --db <ruta-nueva-fuera-del-repo>`
crea dos perfiles y una actividad sintéticos sin proveedor y se niega a sobrescribir
una ruta existente. Seleccionar la meta sintética, abrir «Mi ruta», seleccionar nodos
por ratón y teclado, comparar dimensiones e intentos y recargar. Verificar que la
revisión durable, sesión e historial no cambiaron solo por consultar el mapa.

## Compatibilidad y reversión

No hay migración de datos, nuevos campos persistentes, nuevos proveedores ni copia
de código de LearnHarness. La base de esta entrega es la candidata acumulada
`d5530b5495feecc8005b9fcca15ddc4a048ac17b`, no el `main` anterior. Revertir
únicamente los cambios de esta vista y sus pruebas restaura la presentación anterior
sin tocar SQLite.

La actividad existente de opción múltiple con explicación conserva su contrato,
idempotencia y feedback por criterio; esta entrega solo integra su presentación con
la navegación. Un grafo proposicional global sigue fuera de alcance.
