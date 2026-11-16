# Dónde correr Ruta (`hosting_v1`)

Guía práctica; el contrato técnico está en `docs/hosting_ready_v1.md`. Nada de esto se despliega solo: son pasos que ejecutas tú.

## Comparación honesta

| | 1. PC con Tailscale (hoy) | 2. Mini-servidor casero (Raspberry Pi) con Tailscale | 3. VPS o contenedor público con HTTPS |
|---|---|---|---|
| Coste | 0 | ~60–100 USD una vez + ~2 USD/año de luz | ~4–10 USD/mes |
| Disponibilidad | solo con la PC encendida y sin suspender | 24/7 | 24/7 |
| Privacidad | tus datos no salen de tu casa (salvo las llamadas al modelo) | igual | tus datos viven en una máquina ajena |
| Superficie de ataque | ninguna pública | ninguna pública (solo tu red Tailscale) | **internet entera**: inicio de sesión obligatorio y mantenimiento |
| Mantenimiento | nulo | actualizar el sistema de vez en cuando | actualizar, vigilar, renovar, respaldar |
| Recordatorios en el iPhone | solo si la PC está encendida | sí | sí |

**Recomendación: la opción 2.** Da disponibilidad continua sin exponer nada a internet y sin entregar tus datos a un tercero. Elige la 3 solo si necesitas entrar sin Tailscale (por ejemplo desde un equipo ajeno), y entonces el inicio de sesión es obligatorio.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `LEARNSCIENCE_HOST` | Dirección IPv4 donde escucha. Por defecto `127.0.0.1`. Con Tailscale, la IP `100.x.x.x`. Sin auth solo se permiten loopback y `100.64/10`; `192.168.x`/`10.x`/`172.16-31.x` exigen `LEARNSCIENCE_ALLOW_LAN_WITHOUT_AUTH=1` y `0.0.0.0`/IP pública exigen `LEARNSCIENCE_AUTH=required` (si no, el servidor se niega a arrancar). |
| `PORT` | Puerto (8765). |
| `LEARNSCIENCE_ORIGINS` | Orígenes permitidos extra, p. ej. `https://tutor.ejemplo.com`. Con auth activo, el Origin del navegador debe estar aquí (o ser el propio host:puerto). |
| `LEARNSCIENCE_AUTH` | `off` (por defecto) o `required`. |
| `LEARNSCIENCE_TRUST_PROXY` | `1` solo si hay un proxy tuyo delante que pone `X-Forwarded-Proto` y `X-Forwarded-For`; se usan únicamente si quien se conecta está en `LEARNSCIENCE_TRUSTED_PROXIES`. Sin proxy, déjalo vacío (un cliente podría falsificar esas cabeceras). |
| `LEARNSCIENCE_TRUSTED_PROXIES` | CIDR de tus proxies, separados por comas (p. ej. `172.18.0.0/16`). Por defecto loopback y redes privadas. |
| `LEARNSCIENCE_COOKIE_SECURE` | `1` si sirves por HTTPS (cookie `Secure` y nombre `__Host-ruta_session`); es automático si `LEARNSCIENCE_ORIGINS` trae un `https://`. |
| `LEARNSCIENCE_ALLOW_LAN_WITHOUT_AUTH` | `1` para arrancar sin contraseña en una red privada que no sea Tailscale. Léelo antes: una dirección privada puede ser alcanzable desde fuera (NAT de una nube, Docker `-p`, reenvío de puertos). |
| `RUTA_DB_PATH` | Ruta del archivo SQLite. |
| `GEMINI_API_KEY` (o `ANTHROPIC_API_KEY` con `LLM_PROVIDER=anthropic`) | Clave del modelo. **Siempre por variable de entorno o gestor de secretos; nunca en el repositorio, en la imagen ni en un archivo versionado.** |

La contraseña **no** es una variable: se fija con `python app_legacy.py --set-password` (mínimo 12 caracteres, se pide por `getpass`).

## Opción 1: seguir con la PC + Tailscale

Nada que cambiar si ya usas la IP de Tailscale (o `127.0.0.1`). Si en `main` escuchabas en `192.168.x` sin contraseña, ahora el servidor no arranca sin `LEARNSCIENCE_ALLOW_LAN_WITHOUT_AUTH=1` (o auth, o Tailscale). Ojo: `100.64.0.0/10` también es el rango CGNAT de algunos operadores; Tailscale asigna ahí, pero ese rango por sí solo no prueba que la red sea solo tuya. Si quieres recordatorios en el calendario del iPhone: Preferencias → Recordatorios → Activar, y suscribe el enlace (solo se actualiza con la PC encendida y Tailscale activo). Sigue sin contraseña: cualquiera dentro de tu red Tailscale puede usar la app. Si compartes la red Tailscale con otras personas, activa también `LEARNSCIENCE_AUTH=required`.

## Opción 2: Raspberry Pi (o cualquier mini-PC Linux) con Tailscale

1. Instala Raspberry Pi OS Lite (64 bits), actualiza (`sudo apt update && sudo apt full-upgrade`) y asegura SSH con clave.
2. Instala Tailscale (`curl -fsSL https://tailscale.com/install.sh | sh`, `sudo tailscale up`) y anota la IP `100.x.x.x` (`tailscale ip -4`).
3. Clona el repositorio en `/opt/ruta` con un usuario sin privilegios (`ruta`) y crea `/var/lib/ruta` para la base.
4. Fija la contraseña (recomendado): `RUTA_DB_PATH=/var/lib/ruta/ruta-memory.sqlite3 python3 app_legacy.py --set-password`.
5. Crea `/etc/ruta.env` (permisos `600`, dueño `ruta`) con:
   ```
   LEARNSCIENCE_HOST=100.x.x.x
   LEARNSCIENCE_AUTH=required
   RUTA_DB_PATH=/var/lib/ruta/ruta-memory.sqlite3
   GEMINI_API_KEY=...
   ```
6. Servicio `/etc/systemd/system/ruta.service`:
   ```
   [Unit]
   Description=Ruta
   After=network-online.target tailscaled.service
   [Service]
   User=ruta
   WorkingDirectory=/opt/ruta
   EnvironmentFile=/etc/ruta.env
   ExecStart=/usr/bin/python3 app_legacy.py
   Restart=on-failure
   NoNewPrivileges=true
   ProtectSystem=full
   ReadWritePaths=/var/lib/ruta
   [Install]
   WantedBy=multi-user.target
   ```
   `sudo systemctl enable --now ruta`. Si escuchas en la IP de Tailscale, el servicio debe arrancar después de que exista esa interfaz (`After=tailscaled.service`).
7. En el iPhone abre `http://100.x.x.x:8765` (o el nombre MagicDNS; añádelo a `LEARNSCIENCE_ORIGINS` si lo usas).
8. Instalación en la pantalla de inicio: Safari → Compartir → Añadir a pantalla de inicio. No hay modo sin conexión.

Límite: Tailscale cifra el tráfico entre dispositivos, pero la página va por `http://`, así que la cookie de sesión no lleva `Secure`. Es aceptable dentro de tu red Tailscale; para exponerla fuera usa la opción 3.

## Opción 3: VPS o contenedor público con HTTPS

Solo con `LEARNSCIENCE_AUTH=required`. Riesgos reales: cualquiera en internet puede intentar contraseñas (hay límite de intentos, en memoria y por IP, pero una contraseña débil sigue siendo débil: usa una larga y única); tu clave del modelo gasta cuota si alguien entra; los datos de aprendizaje viven en un servidor ajeno. No hay cuentas múltiples: es **un solo dueño**.

1. Construye y ejecuta la imagen (`Dockerfile` en la raíz: usuario no root, volumen `/data`, sin secretos). No se ha construido en esta rama; pruébala antes de depender de ella.
   ```
   docker build -t ruta .
   docker volume create ruta-data
   docker run --rm -it -v ruta-data:/data ruta python app_legacy.py --set-password
   docker run -d --name ruta --restart unless-stopped -v ruta-data:/data \
     -e GEMINI_API_KEY="$GEMINI_API_KEY" -e LEARNSCIENCE_ORIGINS=https://tutor.ejemplo.com \
     -e LEARNSCIENCE_TRUST_PROXY=1 --network web ruta
   ```
   **No uses `-p 8765:8765`**: publicaría el puerto en todas las interfaces del servidor y la app dependería solo de la contraseña (y las comprobaciones de IP/Host quedarían engañadas por NAT). Solo el proxy debe alcanzarla, por la red de Docker. `LEARNSCIENCE_TRUST_PROXY` viene apagado en la imagen: actívalo explícitamente, y si tu proxy no está en una red privada define `LEARNSCIENCE_TRUSTED_PROXIES`.
2. Proxy inverso con HTTPS automático (Caddy). `Caddyfile`:
   ```
   tutor.ejemplo.com {
       encode gzip
       header {
           Strict-Transport-Security "max-age=31536000"
           -Server
       }
       reverse_proxy ruta:8765
   }
   ```
   Caddy añade `X-Forwarded-For`/`X-Forwarded-Proto` y conserva la cabecera `Host` (necesaria: la app solo acepta el host de `LEARNSCIENCE_ORIGINS`). No actives `LEARNSCIENCE_TRUST_PROXY` si algo que no controlas puede alcanzar el contenedor directamente.
3. Abre solo 80/443 en el firewall, activa actualizaciones automáticas de seguridad y programa copias de seguridad (abajo).
4. En `https://tutor.ejemplo.com` iniciarás sesión; el calendario se suscribe con `webcal://`/`https://` normal, y la cookie ya va `Secure`.

## Copia de seguridad y restauración

Hay dos mecanismos y no son equivalentes:

- **Copia de toda la base (recomendada para respaldar y para mudar de servidor).** Con la app en marcha usa la copia en caliente de SQLite, no `cp`:
  ```
  python3 -c "import sqlite3,sys,datetime; sqlite3.connect(sys.argv[1]).execute('VACUUM INTO ?', (sys.argv[2] + '/ruta-' + datetime.date.today().isoformat() + '.sqlite3',))" /var/lib/ruta/ruta-memory.sqlite3 /ruta/respaldo
  ```
  (es la copia en caliente de SQLite con Python, que ya tienes; no hace falta instalar la CLI `sqlite3`. La carpeta de destino debe existir y el archivo de destino no.)
  Restaurar: detén el servicio, reemplaza el archivo (y borra `*.sqlite3-wal`/`-shm` si existen), arranca. Conserva **todo**: perfiles, historial, casos prácticos con su rúbrica privada y el secreto de verificación de mentores (`metadata.mentor_code_secret`), llamadas de uso, **y también el hash de la contraseña, las sesiones abiertas y los enlaces de calendario**. Si restauras una copia antigua, ejecuta `--set-password` (cierra todas las sesiones, incluidas las que venían en la copia) y regenera los enlaces del calendario si no los reconoces. Trata el archivo como secreto: contiene tus datos de aprendizaje.
- **Exportar/restaurar un perfil desde la app (JSON).** Sirve para mover un perfil entre instalaciones distintas, pero según `docs/authentic_performance_v1.md` **al restaurar en otra instalación se pierde la verificación local**: el restaurar borra los casos prácticos y sus rúbricas privadas; la evidencia de un caso que no existe en esa instalación se conserva pero un acierto deja de contar como independiente (`case_unverified`), y las atestaciones de mentor firmadas con el secreto de la instalación anterior ya no se verifican. No se inventa evidencia al restaurar. Los ajustes de recordatorios no viajan en este JSON.

Prueba una restauración antes de necesitarla.

## Riesgos y límites (resumen)

- Sin HTTPS propio: la opción 1 y 2 usan HTTP dentro de Tailscale; la 3 delega en el proxy.
- Límite de intentos en memoria: un reinicio lo borra; con una contraseña corta no protege lo suficiente.
- El enlace del calendario es una credencial de solo lectura (títulos de meta y conteos): trátalo como una contraseña, regenéralo si se filtra.
- No se probó con un iPhone real, el Calendario de iOS real, HTTPS real ni la imagen de Docker (ver «Sin validar» en `docs/validation.md`).
- Ningún alojamiento cambia las reglas de evidencia: la política es la misma en cualquier servidor.
