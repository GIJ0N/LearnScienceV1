# Alojamiento: inicio de sesión, recordatorios e instalación (`hosting_ready_v1`)

Rama `feat/hosting-ready`, apilada sobre `feat/authentic-performance`. Este documento es el contrato; la guía práctica está en `docs/hosting_v1.md`.

## Compatibilidad y qué cambia respecto a `main`

**El uso del dueño no cambia:** `LEARNSCIENCE_HOST=<IP Tailscale 100.x.y.z>`, sin auth, abriendo `http://100.x.y.z:8765` desde el iPhone (y `127.0.0.1`/`localhost` en la PC) sigue funcionando sin definir nada nuevo; hay una prueba explícita (`OwnerTailscaleScenario`). Sin `LEARNSCIENCE_AUTH` no hay login ni se exige Origin en los POST (la regla de `private_network_access_v1`).

**Cambios de comportamiento reales (no son «todo igual»):**
1. **Direcciones públicas y `0.0.0.0` sin auth: el servidor ya no arranca.** En `main` arrancaba con un aviso.
2. **Redes privadas que no son Tailscale sin auth (192.168.x, 10.x, 172.16-31.x, fc00::/7): el servidor ya no arranca** salvo `LEARNSCIENCE_ALLOW_LAN_WITHOUT_AUTH=1` (o con auth). En `main` arrancaba con un aviso. Motivo: una dirección privada puede ser alcanzable desde fuera (NAT de una nube, Docker con `-p`, reenvío de puertos del router). Quien usaba la app en 192.168.x sin contraseña debe definir esa variable, activar auth o pasar a Tailscale/`127.0.0.1`. Honestidad: `100.64.0.0/10` (Tailscale) es también el rango CGNAT de algunos operadores; que se permita sin más es una decisión de comodidad, no una garantía de que sea una red solo tuya.
3. **Cabecera `Host` validada** (todos los modos): debe ser el host enlazado, `127.0.0.1`/`localhost`/`::1` o el de un origen de `LEARNSCIENCE_ORIGINS` (el puerto no se mira); otro → 403 «Host no autorizado.». Protege contra DNS rebinding. Quien abra la app por un nombre que no sea ninguno de esos (p. ej. un nombre MagicDNS que no esté en `LEARNSCIENCE_ORIGINS`) recibe 403: añádelo.
4. **Endurecimiento de cabeceras** (todos los modos): `X-Frame-Options: DENY` y `frame-ancestors 'none'` en la CSP (clickjacking). La CSP por lo demás no cambia.
5. En modo `off`, si llega una petición con `X-Forwarded-For` se avisa una vez en la terminal (hay un proxy delante y no hay login).

Sin migración: las tablas nuevas se crean con `CREATE TABLE IF NOT EXISTS`. Lo nuevo visible en modo `off`: panel «Recordatorios» en Preferencias, aviso al abrir y metadatos de instalación.

## Variables de entorno nuevas

| Variable | Efecto |
|---|---|
| `LEARNSCIENCE_AUTH` | `off` (defecto) o `required`. |
| `LEARNSCIENCE_TRUST_PROXY` | `1`: se creen `X-Forwarded-For`/`X-Forwarded-Proto`, **solo** de pares incluidos en `LEARNSCIENCE_TRUSTED_PROXIES`. |
| `LEARNSCIENCE_TRUSTED_PROXIES` | Lista de CIDR de proxies de confianza. Por defecto loopback y redes privadas (`127/8, ::1, 10/8, 172.16/12, 192.168/16, fc00::/7`). |
| `LEARNSCIENCE_COOKIE_SECURE` | `1`: HTTPS declarado (cookie `Secure` y nombre `__Host-ruta_session`). Es automático si algún origen de `LEARNSCIENCE_ORIGINS` empieza por `https://`. |
| `LEARNSCIENCE_ALLOW_LAN_WITHOUT_AUTH` | `1`: permite arrancar sin auth en una red privada que no sea loopback ni Tailscale. |

## A. Inicio de sesión

- **Variable** `LEARNSCIENCE_AUTH`: `off` (por defecto) o `required`. Otro valor impide arrancar.
- **Protección de arranque (se integra con la existente).** Antes solo había un aviso al escuchar fuera de `127.0.0.1` y la validación de `LEARNSCIENCE_HOST`/`LEARNSCIENCE_ORIGINS` (`network_settings`, sin cambios). Ahora, además, el servidor **se niega a arrancar** (código 2, mensaje en español) sin `LEARNSCIENCE_AUTH=required` si la dirección no es loopback ni `100.64/10` (Tailscale) —o es `0.0.0.0`/`::` o pública—; las demás redes privadas (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`) exigen además `LEARNSCIENCE_ALLOW_LAN_WITHOUT_AUTH=1` (`hosting.startup_problem`). Con `required` y sin contraseña fijada tampoco arranca. Con `required` en una dirección que puede ser pública y sin HTTPS declarado ni proxy de confianza, arranca pero avisa de que la contraseña viajaría en claro. El aviso anterior se conserva en modo `off`.
- **Contraseña única del dueño.** `python app_legacy.py --set-password` la pide con `getpass` (nunca por argumento ni variable de entorno), exige ≥ 12 caracteres y guarda **solo el hash** en `metadata.auth_password_hash`: PBKDF2-HMAC-SHA256, 600 000 iteraciones, sal aleatoria de 16 bytes (`pbkdf2_sha256$iteraciones$sal$hash`). Se elige PBKDF2 porque está en la biblioteca estándar de cualquier Python (scrypt depende de la compilación de OpenSSL). Se puede ejecutar con el servidor encendido: las sesiones se leen de la base en cada petición, así que **cambiar la contraseña cierra todas las sesiones** en la misma transacción.
- **Sesión.** `POST /api/login` compara en tiempo constante (`hmac.compare_digest`) y responde siempre lo mismo ante cualquier fallo («No se pudo iniciar sesión.»). Cookie `ruta_session`: token de 32 bytes de `secrets`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 30 días. `Lax` y no `Strict` porque con `Strict` un enlace que llega desde otra app (correo, mensajes) no llevaría la cookie y pediría login de nuevo; la defensa de los POST es la comprobación obligatoria de `Origin` (más abajo), no la cookie. `Secure` si hay HTTPS declarado (`LEARNSCIENCE_COOKIE_SECURE=1` u origen `https://` en `LEARNSCIENCE_ORIGINS`; entonces el nombre es `__Host-ruta_session`, que el navegador solo acepta con `Secure`, `Path=/` y sin `Domain`) o si la petición llegó por HTTPS según un proxy de confianza; por HTTP plano —Tailscale— no puede ir `Secure` o el navegador la descartaría. En SQLite (`auth_sessions`) solo se guarda el SHA-256 del token. La caducidad es deslizante (30 días desde el último uso; se renueva como mucho cada 5 minutos) con un **tope absoluto de 90 días** desde el inicio de sesión. `POST /api/logout` borra la sesión y la cookie; `POST /api/logout/all` («Cerrar todas las sesiones» en la UI) borra todas.
- **Límite de intentos** (en memoria; reiniciar el servidor lo reinicia). Rediseñado tras la auditoría porque un bloqueo global dejaba fuera al dueño ante 20 fallos ajenos:
  - **Bloqueo duro solo por IP**: 5 intentos libres y luego una espera de 30 s que se duplica (tope 1 h), con `429` y `Retry-After` incluso con la contraseña correcta. El diccionario es un LRU acotado a 10 000 entradas y se olvida tras 1 h sin intentos.
  - **Reserva sin carrera**: el intento se cuenta dentro del lock *antes* de verificar (`begin`) y un acierto lo deshace (`success`); así peticiones simultáneas no pasan todas antes de que el primer fallo se anote. Además solo 2 verificaciones PBKDF2 pueden correr a la vez (`BoundedSemaphore(2)`); si no hay hueco en 3 s, `429` y la reserva se libera.
  - **Global solo ralentiza**: pasados 20 fallos globales hay un retraso de 0,25 s por fallo de más (tope 2 s) antes de verificar; **nunca** un bloqueo. Un acierto lo reinicia.
  - **Dispositivo conocido**: tras un login correcto se emite `ruta_device` (id aleatorio + HMAC con un secreto local que se rota al cambiar la contraseña; 1 año; `HttpOnly`, `SameSite=Lax`, `Secure` como la de sesión). Con una cookie válida el intento se cuenta en el contador propio de ese dispositivo (10 libres, mismas esperas) y no le afectan el bloqueo por IP ni el retraso global; una cookie falsificada o caducada se trata como ausente.
  - La IP es la del socket; con `LEARNSCIENCE_TRUST_PROXY=1` **y** si el par es un proxy de `LEARNSCIENCE_TRUSTED_PROXIES`, es el primer valor no confiable de `X-Forwarded-For` leyendo de derecha a izquierda; de un par no confiable esas cabeceras se ignoran.
- **Todas las rutas exigen sesión** salvo una lista corta y revisada (`PUBLIC_GET`, `PUBLIC_POST` en `app_legacy.py`): `GET /` (sin sesión devuelve la pantalla de login, nunca el JS de la app), `GET /api/health` (sin sesión solo `{"ok":true}`), `GET /api/auth/status`, `/manifest.webmanifest` y los iconos (el navegador los pide sin cookies), `POST /api/login`, `POST /api/logout`, y `GET /calendar/<token>.ics` con su propia credencial (ver B). Toda petición (pública o no) debe pasar antes la validación de `Host`. Es **denegar por defecto**: cualquier ruta nueva de `ROUTES` o de `do_GET` queda protegida sin hacer nada. `tests/hosting_ready.test.py` recorre todo `ROUTES` y una lista de GET y falla si alguna no responde 401 sin sesión, y fija las listas públicas exactas.
- **Host.** Ver «Cambios de comportamiento»: nombre de host permitido = enlazado, loopback/localhost u origen declarado (sin mirar el puerto; con `0.0.0.0` no se acepta cualquier host).
- **CSRF.** Con auth activo, todo POST necesita `Origin` presente y en la lista de `allowed_origins()` (la misma que ya existía, ampliable con `LEARNSCIENCE_ORIGINS`, p. ej. `https://tutor.ejemplo.com`); sin Origin o de otro sitio → 403. Se suma `SameSite=Lax`. En modo `off` la regla es la de antes (sin Origin se permite).
- **Un solo dueño.** No hay cuentas ni registro. Los perfiles locales son carpetas de aprendizaje, no usuarios: tras el login se ven todos, como hoy. Quien tenga la contraseña ve todos los perfiles.
- **Cliente.** Pantalla de login sencilla (servida por el servidor, sin el JS de la app; 390 px; tema claro/oscuro por `prefers-color-scheme` o el tema guardado). `app.js` pregunta `/api/auth/status`; solo si es `required` muestra «Cerrar sesión» (en el menú y en la pantalla de perfiles). Un 401 muestra «Tu sesión terminó» y recarga para volver al login.
- **Registros.** No se escriben contraseñas ni cookies; la ruta del calendario, que contiene el token, se enmascara en el registro de peticiones (`/calendar/<oculto>.ics`).

## B. Recordatorios sin notificaciones push

Web Push en iPhone exige HTTPS, instalar la app en la pantalla de inicio y firmar con VAPID (dependencias): **fuera de alcance**. En su lugar:

- **Calendario suscribible** `GET /calendar/<token>.ics` (RFC 5545: CRLF, líneas de ≤ 75 octetos plegadas sin partir caracteres UTF-8, texto escapado, `UID` estables, `DTSTAMP`). Contiene exactamente:
  1. un evento recurrente «Estudiar: <meta activa>» a la hora elegida (cada día, o `BYDAY` con los días elegidos), 15 minutos, con `VALARM` a la hora;
  2. eventos de día completo «N repasos de <meta>» por día y meta, calculados en el servidor con `goal.reviews[].due` **ya guardado** (no se reimplementa el calendario adaptativo): los vencidos se agrupan en hoy, los futuros en su día, hasta 30 días; solo repasos cuyo tema sigue en la meta.
  
  Nada más: ni respuestas, ni evidencia, ni nombres de temas, ni texto del aprendiz, ni identificadores de perfil (los `UID` son hashes). La opción «Ocultar el nombre de la meta» deja «Estudiar» y «N repasos».
- **Token.** 24 bytes de `secrets` (192 bits), uno por perfil, guardado como SHA-256 (`reminders.token_hash`). Es la **única credencial** de esa ruta (las apps de calendario no envían cookies): quien tenga el enlace ve esos títulos. Solo se muestra al crearlo o regenerarlo; después la app dice que hay un enlace activo y ofrece regenerar. Regenerar o desactivar revoca el anterior al instante; borrar el perfil borra el enlace. Se busca primero el token y uno válido se sirve **siempre**; solo los tokens inválidos se limitan, por IP (5 libres y luego `429`), sin bloqueo global. Se ignora la `?query`. Token inválido o revocado → `404 «No existe esta ruta.»`. Funciona también en modo `off`.
- **Zona horaria (decisión).** El evento diario usa hora local **«flotante»** (`DTSTART:20261101T203000`, sin `Z` ni `TZID`; la fecha de inicio es la fecha local del cliente, no la del servidor): sale a esa hora en el reloj del teléfono, así un cambio de horario de verano no lo mueve y no hace falta incluir `VTIMEZONE` (el tzdata no existe en Windows sin instalar). Las fechas de los repasos (día completo) sí necesitan una zona para convertir el instante `due`: el cliente envía su zona IANA y su desfase al guardar; el servidor usa `zoneinfo` si la tiene y, si no, el desfase fijo. Límite: con desfase fijo, un repaso cuyo instante caiga a menos de una hora de la medianoche y cruce un cambio de horario puede aparecer un día antes o después. Si viajas o cambias de zona, vuelve a pulsar «Guardar cambios».
- **UI «Recordatorios»** (Preferencias): hora, días, ocultar nombre, enlace (`webcal://` solo si la página va por HTTP; por HTTPS solo `https://`, para que `webcal://` no degrade a http; copiar, descargar `.ics`), regenerar, desactivar, instrucciones de iPhone (tocar el enlace, o Ajustes → Calendario → Cuentas → Añadir cuenta → Otra → Añadir calendario suscrito) y el aviso honesto: el calendario del teléfono solo se actualiza si alcanza el servidor (PC encendida y Tailscale activo, o servidor alojado). Los iPhone refrescan las suscripciones cada cierto tiempo (`REFRESH-INTERVAL` 6 h es una sugerencia).
- **Aviso al abrir.** En Inicio y en el panel de la meta, si hay repasos vencidos y hoy no hay ninguna respuesta de estudio, una barra no bloqueante («Tienes N repasos vencidos y hoy aún no has estudiado») con «Ver repasos» y «Ahora no» (se descarta hasta recargar). Usa la misma cola de repasos (`reviewQueue`) y `studyAnswers` que la racha; no escribe nada.
- **Qué cuenta como evidencia:** nada. Ni el calendario ni el aviso ni los ajustes crean eventos en ninguna meta, ni tocan cobertura, independencia, racha ni calendario adaptativo. Los ajustes viven en la tabla `reminders`, **fuera del almacén del perfil**: no salen en exportaciones ni respaldos JSON y no se restauran con ellos.

## C. Instalable

`/manifest.webmanifest` (`display: standalone`, iconos 192/512 PNG y SVG), `apple-touch-icon` (PNG 180), `apple-mobile-web-app-*` y `theme-color` claro/oscuro en `<head>`. Los iconos (anillo blanco sobre verde, PNG RGB opaco) se generan con `zlib`/`struct`, sin librerías. **Sin service worker ni caché sin conexión** (riesgo de servir JS viejo): la app necesita el servidor para funcionar. La CSP solo añade `frame-ancestors 'none'` (y `X-Frame-Options: DENY`); manifiesto e iconos propios entran en `default-src 'self'`.

## Fuera de alcance

Web Push/VAPID, service worker, varias cuentas o registro, recuperación de contraseña (se cambia con `--set-password` en la máquina del servidor), 2FA, límite de intentos persistente, HTTPS propio en el servidor (se delega en el proxy), `VTIMEZONE`, estado de «repaso hecho» en el calendario (los eventos se recalculan en cada consulta), recordatorios por correo o mensajería.

## Rollback

Revertir el commit quita el login y los recordatorios; las tablas `auth_sessions` y `reminders` quedan sin usar y son inofensivas. Un respaldo SQLite hecho con auth activo conserva el hash de contraseña y los tokens de calendario.

## Pruebas

`python tests/hosting_ready.test.py` (servidor real en un hilo, SQLite temporal, sin red) y `node tests/hosting_ready.test.js` (login y UI con DOM simulado); `tests/browser_smoke.test.js` comprueba en Chromium que el modo `off` carga igual, es instalable y el panel cabe en 390 px.
