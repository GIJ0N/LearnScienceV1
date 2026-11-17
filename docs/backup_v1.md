# Copia de seguridad diaria (`backup_v1`)

Contrato breve. Implementación: `backup.py`; arranque y `GET /api/backup/status` en `app_legacy.py`; panel en Preferencias (`app.js`). La copia no cambia evidencia, racha ni calendario: solo lee la base.

## Qué se copia
La base SQLite completa (la de `RUTA_DB_PATH`), con la API de backup de SQLite (`sqlite3.Connection.backup`) en un solo paso, que da una instantánea consistente aunque haya escrituras concurrentes. No se copia el archivo a mano ni se toma `LocalDatabaseServerLock`: es solo lectura.

La copia contiene todo lo que contiene la base: perfiles, historial, rúbricas privadas de los casos, **hash de la contraseña, sesiones y tokens del calendario**. Trátala como un secreto.

## Dónde
- `LEARNSCIENCE_BACKUP_DIR` si está definida.
- Si no, `backups/` junto a la base. Si esa carpeta cayera dentro del repositorio (base por defecto en `data/`), se usa `LearnScienceV1-backups/` junto al repositorio, nunca dentro.
- Si apuntas la variable dentro del árbol del repo, se crea un `.gitignore` con `*` en la carpeta; el repo además ignora `backups/`.
- Nombre: `ruta-backup-AAAAMMDDTHHMMSSZ.sqlite3` (hora UTC). Se usan rutas con `pathlib`; se prueba con espacios y acentos.

## Permisos
El archivo se crea con `0600` (y la carpeta con `0700`) en Unix, best effort. En Windows no se aplican: **el archivo hereda los permisos de la carpeta**; elige una carpeta solo tuya. Las copias nunca se sirven por HTTP ni entran en las exportaciones JSON.

## Verificación
Se escribe primero a un temporal `.tmp-ruta-backup-*.partial`. Se abre y se ejecuta `PRAGMA integrity_check`; solo si devuelve `ok` se renombra al nombre final. Si falla, se borra el temporal, se escribe el fallo en la terminal y la «última copia» sigue siendo la anterior. Nunca queda una copia sin verificar con nombre final.

## Rotación
Se conservan las 14 más recientes. Solo se borran archivos regulares de la propia carpeta de copias cuyo nombre cumple el patrón exacto (y temporales propios). Cualquier otro archivo se respeta.

## Programación
Al arrancar el servidor, en un hilo daemon, si la última copia tiene más de 24 h (o no hay), y como mucho una vez por ejecución. Un servidor que dura semanas sin reiniciarse no hace copias nuevas: reinícialo o programa una tarea externa. Un fallo se captura, se registra en la terminal y no impide arrancar ni responder.

## Estado en la interfaz
`GET /api/backup/status` (requiere sesión como cualquier GET de datos) devuelve solo `has_backup`, `recent`, `last_at`, `size_bytes`, `verified`, `count` y `last_attempt`; sin rutas ni nombres de archivo. Preferencias muestra «Última copia: fecha · verificada» o «Sin copia reciente».

## Restauración (solo manual)
1. Detén el servidor.
2. Copia el archivo verificado elegido sobre la base y borra `*.sqlite3-wal` y `*.sqlite3-shm` de la base si existen.
3. Arranca. Si la copia es antigua, ejecuta `python app_legacy.py --set-password` (cierra sesiones) y regenera los enlaces de calendario.

Límite de reversión: restaurar sustituye la base entera; lo escrito después de la copia se pierde. Antes de restaurar, guarda la base actual.

## Qué NO hace
- No restaura ni reescribe la base desde una copia, ni automática ni por HTTP.
- No cifra las copias ni las sube a ninguna parte (copia fuera de la máquina: tu responsabilidad).
- No hace copias periódicas con el servidor ya en marcha.
- No exporta ni importa perfiles (eso sigue siendo el JSON de la app).
- No ha sido probada en un Windows real con el servidor corriendo en el PC del dueño.
