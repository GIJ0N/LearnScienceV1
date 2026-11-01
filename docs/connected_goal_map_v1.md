# Mapa conectado entre metas v1

La vista **Metas** presenta una red gradual: primero las metas, después el mapa existente de una meta y, en el detalle de una habilidad, sus conexiones explícitas con habilidades de otras metas.

Una relación `goal_relation_v1` conserva ID, perfil, extremos `(goal_id, node_id)`, tipo, explicación, procedencia, fecha y estado (`proposed`, `confirmed` o `rejected`). Los tipos disponibles son `prerequisite`, `shared_principle`, `application`, `analogy` y `related_candidate`.

## Límites de política

- La identidad incluye meta y nodo; dos nodos llamados igual o con el mismo ID local no se fusionan.
- Crear, confirmar, rechazar o explorar una conexión no crea evidencia ni modifica cobertura.
- Una propuesta no se convierte en prerrequisito obligatorio y una analogía no declara equivalencia.
- Las relaciones de prerrequisito cíclicas se rechazan.
- Si falta un extremo al restaurar datos, la referencia se conserva como `missing` y no se reasigna por nombre.
- Al eliminar una meta desde la interfaz se eliminan también sus relaciones. Al eliminar el perfil, SQLite elimina todo el store del perfil.
- Si otra meta conserva una reparación activa, su mapa puede explorarse, pero la nueva práctica queda bloqueada hasta volver a la reparación.

La generación automática de relaciones y la expansión temática no forman parte de esta versión. La relación manual es la única vía de escritura y requiere una explicación revisable.
