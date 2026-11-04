# Fundamentos de esta habilidad v1

`skill_foundation_v1` añade contenido conceptual revisable al detalle de una habilidad sin convertirlo en evidencia de aprendizaje.

Cada fundamento pertenece a un `profile_id`, `goal_id` y `node_id`. El servidor asigna su `foundation_id`; cada edición crea una revisión nueva y conserva las anteriores. La procedencia distingue escritura manual, propuesta del modelo, sesión identificada o referencia aportada. «Aceptado» significa que el usuario decidió utilizar ese contenido, no que esté científicamente verificado ni aprendido.

Las microlecciones recuperan del almacenamiento autorizado hasta tres fundamentos aceptados de la habilidad actual. El cliente no puede sustituirlos mediante el payload. La respuesta conserva los IDs y revisiones utilizados, pero no claves ni referencias privadas de evaluación. Mostrar un fundamento dentro de una microlección registra una sola `FOUNDATION_EXPOSURE` acotada a esa habilidad; explorar el mapa, crear, editar o aceptar contenido no registra exposición ni concede evidencia.

Las metas antiguas cargan con una lista vacía. La exportación pública conserva fundamentos y procedencia pública para restaurarlos en otro perfil, reasignando únicamente el propietario mediante la validación existente. No existe un respaldo privado nuevo. Revertir la función requiere retirar el panel, las rutas y el uso en la lección; los datos adicionales permanecen inertes y no alteran `sufficient()`, los umbrales ni el selector pedagógico.

La generación está conectada al cliente de modelo existente, pero en esta entrega solo se valida con proveedor controlado. La aceptación con Gemini real queda pendiente.
