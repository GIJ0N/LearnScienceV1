# Demostración visual controlada de reparación

Esta demostración usa la aplicación activa, contratos reales y SQLite durable, pero sustituye el proveedor por respuestas fijas dentro de un ejecutable separado. No llama a Gemini ni puede activarse desde una petición HTTP.

## Preparación

Usa una ruta nueva fuera del repositorio:

```powershell
$demoDb = Join-Path $env:TEMP ("learnscience-repair-visual-" + [guid]::NewGuid().ToString("N") + ".sqlite3")
python tools/serve_controlled_demo.py --prepare --db $demoDb
python tools/serve_controlled_demo.py --resume --db $demoDb --port 8907 --fail-once diagnose
```

Abre `http://127.0.0.1:8907/`, selecciona **DEMO VISUAL SINTÉTICA**, abre la meta y pulsa **Seguir aprendiendo**.

## Recorrido reproducible

1. Responde la actividad padre con `respuesta incorrecta` y acepta la evaluación.
2. El primer diagnóstico falla de forma controlada. Comprueba que el padre se conserva y pulsa **Reintentar diagnóstico**.
3. Responde el diagnóstico con `no comprendo` para confirmar la laguna sintética.
4. Prepara y abre la enseñanza. Leerla registra exposición, no evidencia positiva.
5. Responde CHECK con texto que contenga `correcta`.
6. En GUIDED pide una pista y responde con `correcta`. El historial debe mostrar resultado correcto y `ayuda 1`; no es evidencia independiente.
7. Responde INDEPENDENT, el reintento padre y la transferencia con texto que contenga `correcta`, sin pedir ayuda.
8. Recarga. Debe existir un solo episodio `COMPLETED`, sin diagnóstico pendiente y sin intentos duplicados.
9. Para comprobar abstención admitida por la política, responde exactamente `No sé`: se registra `UNKNOWN` sin evidencia positiva ni apertura automática de otra reparación.
10. En la actividad principal (fuera de una reparación) pulsa **No sé** o escribe `No sé`: se registra el mismo `UNKNOWN` sin evidencia positiva y, al continuar, se abre la enseñanza directa (`direct_teaching_v1`). El demo controlado no implementa `/api/teach/direct`, así que esa pantalla termina en «No pude preparar la explicación ahora.» con las opciones «Ver la lección completa» y «Reintentar».

Los textos `correcta`, `respuesta incorrecta` y `no comprendo` son controles explícitos del proveedor simulado; no demuestran calidad de evaluación semántica. Las claves y referencias privadas de la actividad por criterios permanecen en SQLite y no se incluyen en el perfil cargado por la interfaz.
