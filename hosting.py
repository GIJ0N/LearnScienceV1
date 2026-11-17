"""hosting_ready_v1: inicio de sesión opcional, calendario suscribible e iconos. Python 3, sin dependencias externas.

Funciones puras (sin red ni base de datos) para poder probarlas aparte; app_legacy.py las conecta al servidor.
"""
import base64
import collections
import datetime
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
import struct
import threading
import time
import zlib

AUTH_MODES = ('off', 'required')
PBKDF2_ITERATIONS = 600_000
PASSWORD_MIN_LENGTH = 12
SESSION_TTL_SECONDS = 30 * 24 * 3600
SESSION_ABSOLUTE_SECONDS = 90 * 24 * 3600     # tope desde el inicio de sesión aunque se use a diario
SESSION_COOKIE = 'ruta_session'
HOST_SESSION_COOKIE = '__Host-ruta_session'   # con HTTPS declarado: el prefijo obliga a Secure, Path=/ y sin Domain
DEVICE_COOKIE = 'ruta_device'
DEVICE_TTL_SECONDS = 365 * 24 * 3600

# ---------------------------------------------------------------- red: ¿dónde se puede escuchar sin inicio de sesión?
_SAFE_NETWORKS = tuple(ipaddress.ip_network(n) for n in (
    '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', 'fc00::/7', '::1/128'))
# Sin login solo se permite sin más loopback y 100.64/10 (Tailscale; ojo: también es el rango CGNAT de algunos operadores).
_NO_AUTH_NETWORKS = tuple(ipaddress.ip_network(n) for n in ('127.0.0.0/8', '100.64.0.0/10', '::1/128'))
DEFAULT_TRUSTED_PROXIES = '127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7'


def parse_auth_mode(value):
    mode = (value or 'off').strip().lower() or 'off'
    if mode not in AUTH_MODES:
        raise ValueError('LEARNSCIENCE_AUTH debe ser «off» o «required».')
    return mode


def _addr(host):
    try:
        addr = ipaddress.ip_address(str(host).strip())
    except ValueError:
        return None
    if addr.version == 6 and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    return addr


def _in(addr, nets):
    return addr is not None and any(addr in net for net in nets if net.version == addr.version)


def host_is_private(host):
    """True solo para loopback y redes privadas/Tailscale. 0.0.0.0, :: y cualquier dirección pública o ilegible son False."""
    addr = _addr(host)
    return addr is not None and not addr.is_unspecified and _in(addr, _SAFE_NETWORKS)


def host_ok_without_auth(host):
    """Loopback y 100.64/10 (Tailscale). Otras redes privadas (192.168.x…) pueden ser alcanzables desde fuera (NAT de nube, Docker -p)."""
    addr = _addr(host)
    return addr is not None and not addr.is_unspecified and _in(addr, _NO_AUTH_NETWORKS)


def startup_problem(host, auth_mode, has_password, allow_lan=False):
    """Mensaje en español si el servidor NO debe arrancar con esta combinación; cadena vacía si puede."""
    if auth_mode == 'required':
        if not has_password:
            return ('LEARNSCIENCE_AUTH=required pero no hay contraseña fijada. Ejecuta «python app_legacy.py --set-password» '
                    'y vuelve a iniciar el servidor.')
        return ''
    if host_ok_without_auth(host):
        return ''
    if host_is_private(host) and allow_lan:
        return ''
    if host_is_private(host):
        return (f'El servidor se niega a arrancar sin contraseña en {host}: es una red privada (192.168.x, 10.x, 172.16-31.x…) pero no es loopback ni Tailscale. '
                'Una dirección privada puede ser alcanzable desde fuera (NAT de una nube, Docker con -p, reenvío de puertos del router) y cualquiera podría usar la app '
                'y gastar tu cuota del modelo. Opciones: usa la IP de Tailscale (100.x.y.z) o 127.0.0.1; o activa el inicio de sesión (LEARNSCIENCE_AUTH=required y '
                '«python app_legacy.py --set-password»); o, si estás seguro de que esa red es solo tuya, define LEARNSCIENCE_ALLOW_LAN_WITHOUT_AUTH=1.')
    return (f'El servidor se niega a arrancar en {host}: no es una dirección local ni de red privada (o escucha en todas las interfaces) '
            'y el inicio de sesión no está activado. Fija LEARNSCIENCE_AUTH=required y una contraseña con '
            '«python app_legacy.py --set-password», o usa 127.0.0.1 / la IP de Tailscale.')


def cleartext_warning(host, auth_mode, https_declared, proxy_trusted):
    """Aviso (no bloqueo) si hay login pero la dirección puede ser pública y nada declara HTTPS: la contraseña viajaría en claro."""
    if auth_mode != 'required' or host_is_private(host) or https_declared or proxy_trusted:
        return ''
    return ('AVISO: el inicio de sesión está activo en una dirección que puede ser pública y no declaraste HTTPS (ni un origen https:// en LEARNSCIENCE_ORIGINS, '
            'ni LEARNSCIENCE_COOKIE_SECURE=1, ni un proxy de confianza con LEARNSCIENCE_TRUST_PROXY=1). La contraseña y la cookie de sesión viajarían en claro. '
            'Pon un proxy con HTTPS delante (ver docs/hosting_v1.md).')


def parse_trusted_proxies(value):
    """Lista de CIDR separados por comas; vacío = loopback y redes privadas. ValueError en español."""
    nets = []
    for raw in (value or DEFAULT_TRUSTED_PROXIES).split(','):
        raw = raw.strip()
        if not raw:
            continue
        try:
            nets.append(ipaddress.ip_network(raw, strict=False))
        except ValueError:
            raise ValueError('LEARNSCIENCE_TRUSTED_PROXIES debe ser una lista de redes CIDR separadas por comas (por ejemplo 172.18.0.0/16).')
    return tuple(nets)


def ip_in_nets(ip, nets):
    return _in(_addr(ip), nets)


def forwarded_client_ip(peer, forwarded_for, nets):
    """IP real tras un proxy de confianza: de derecha a izquierda se saltan los proxies de confianza; el primer valor ajeno es el cliente.
    Solo se llama si el par que se conectó ya es un proxy de confianza."""
    for part in reversed([p.strip() for p in str(forwarded_for or '').split(',')]):
        addr = _addr(part)
        if addr is None:
            continue
        if not _in(addr, nets):
            return str(addr)
    return peer


def allowed_hostnames(bound_host, origins):
    """Nombres de host aceptados en la cabecera Host (el puerto no se mira: la defensa contra DNS rebinding es el nombre)."""
    names = {'127.0.0.1', 'localhost', '::1'}
    addr = _addr(bound_host)
    if addr is not None and not addr.is_unspecified:
        names.add(str(addr))
    elif addr is None and bound_host:
        names.add(str(bound_host).lower())
    for origin in origins:
        name = hostname_of(re.sub(r'^https?://', '', origin))
        if name:
            names.add(name)
    return names


def hostname_of(host_header):
    """Nombre sin puerto de un valor Host (admite [v6]:puerto). Cadena vacía si es ilegible."""
    value = str(host_header or '').strip().lower()
    if value.startswith('['):
        end = value.find(']')
        return value[1:end] if end > 0 else ''
    return value.rsplit(':', 1)[0] if value.count(':') == 1 else value


# ---------------------------------------------------------------- contraseña
def validate_new_password(password):
    if not isinstance(password, str) or len(password) < PASSWORD_MIN_LENGTH:
        raise ValueError(f'La contraseña debe tener al menos {PASSWORD_MIN_LENGTH} caracteres.')
    if len(password) > 1024:
        raise ValueError('La contraseña es demasiado larga.')
    return password


def hash_password(password, iterations=PBKDF2_ITERATIONS, salt=None):
    validate_new_password(password)
    salt = salt if salt is not None else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return 'pbkdf2_sha256$%d$%s$%s' % (iterations, base64.b64encode(salt).decode(), base64.b64encode(digest).decode())


def verify_password(password, encoded):
    """Comparación en tiempo constante. Cualquier formato roto o contraseña no textual devuelve False."""
    try:
        scheme, iterations, salt_b64, digest_b64 = str(encoded).split('$')
        iterations = int(iterations)
        if scheme != 'pbkdf2_sha256' or not 100_000 <= iterations <= 10_000_000 or not isinstance(password, str) or len(password) > 1024:
            return False
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, UnicodeError):
        return False


def token_hash(token):
    return hashlib.sha256(str(token).encode('utf-8')).hexdigest()


def new_token(nbytes=32):
    return secrets.token_urlsafe(nbytes)


# ---------------------------------------------------------------- límite de intentos (en memoria)
class LoginLimiter:
    """Bloqueo duro SOLO por IP (o por dispositivo conocido); el volumen global solo ralentiza, nunca bloquea una contraseña correcta.

    El intento se reserva dentro del lock ANTES de verificar (`begin`) y `success` lo deshace: así peticiones concurrentes no pueden
    colarse todas antes de que el primer fallo se anote. Reiniciar el servidor lo reinicia."""
    IP_FREE = 5            # intentos por IP antes de la primera espera
    DEVICE_FREE = 10       # un dispositivo conocido (cookie ruta_device) tiene su propio contador, más holgado
    GLOBAL_FREE = 20       # fallos globales antes de empezar a ralentizar
    GLOBAL_STEP = 0.25     # segundos de retraso por fallo global de más
    GLOBAL_MAX_DELAY = 2.0
    IDLE_RESET = 3600
    MAX_ENTRIES = 10_000

    def __init__(self, clock=time.time):
        self.clock = clock
        self._lock = threading.Lock()
        self._entries = collections.OrderedDict()   # clave -> [intentos reservados, instante del último]
        self._global = [0, 0.0]

    @staticmethod
    def _wait(count, free):
        return 0 if count < free else min(3600, 30 * 2 ** min(count - free, 20))

    def begin(self, ip, device_id=None):
        """(permitido, segundos_de_espera). Si se permite, el intento ya queda contado."""
        key, free = (('d', device_id), self.DEVICE_FREE) if device_id else (('i', ip), self.IP_FREE)
        now = self.clock()
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and now - entry[1] >= self.IDLE_RESET:
                entry = None
            if entry is None:
                entry = [0, now]
            wait = entry[1] + self._wait(entry[0], free) - now
            if entry[0] >= free and wait > 0:
                self._entries[key] = entry
                self._entries.move_to_end(key)
                return False, int(wait) + 1
            entry[0] += 1
            entry[1] = now
            self._entries[key] = entry
            self._entries.move_to_end(key)
            while len(self._entries) > self.MAX_ENTRIES:
                self._entries.popitem(last=False)
            return True, 0

    def release(self, ip, device_id=None):
        """Deshace la reserva de un intento que no llegó a verificarse (servidor ocupado)."""
        key = ('d', device_id) if device_id else ('i', ip)
        with self._lock:
            entry = self._entries.get(key)
            if entry and entry[0] > 0:
                entry[0] -= 1

    def fail(self, device_id=None):
        """Contribuye al ralentizador global (solo intentos sin dispositivo conocido)."""
        if device_id:
            return
        now = self.clock()
        with self._lock:
            if now - self._global[1] >= self.IDLE_RESET:
                self._global[0] = 0
            self._global[0] += 1
            self._global[1] = now

    def success(self, ip, device_id=None):
        with self._lock:
            self._entries.pop(('d', device_id) if device_id else ('i', ip), None)
            self._global[0] = 0

    def global_delay(self):
        """Retraso corto (nunca un bloqueo) antes de verificar cuando hay muchos fallos globales."""
        now = self.clock()
        with self._lock:
            count = self._global[0] if now - self._global[1] < self.IDLE_RESET else 0
        return min(self.GLOBAL_MAX_DELAY, self.GLOBAL_STEP * (count - self.GLOBAL_FREE + 1)) if count >= self.GLOBAL_FREE else 0.0

    def __len__(self):
        return len(self._entries)


def new_device_id():
    return secrets.token_hex(16)


def device_cookie_value(secret_hex, device_id):
    mac = hmac.new(bytes.fromhex(secret_hex), device_id.encode(), hashlib.sha256).hexdigest()[:32]
    return f'{device_id}.{mac}'


def parse_device_cookie(secret_hex, value):
    """Id del dispositivo si la cookie trae un HMAC válido con el secreto local; si no, None."""
    try:
        device_id, mac = str(value).split('.')
        if not re.fullmatch(r'[0-9a-f]{32}', device_id):
            return None
        expected = hmac.new(bytes.fromhex(secret_hex), device_id.encode(), hashlib.sha256).hexdigest()[:32]
        return device_id if hmac.compare_digest(mac, expected) else None
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------- cookies y direcciones
def session_cookie_name(secure_configured):
    return HOST_SESSION_COOKIE if secure_configured else SESSION_COOKIE


def make_cookie(name, value, secure, max_age=SESSION_TTL_SECONDS):
    # SameSite=Lax y no Strict: con Strict un enlace desde otra app (correo, mensaje) llegaría sin cookie y pediría login otra vez.
    # La protección de los POST es la comprobación de Origin, que sigue siendo obligatoria con auth activo.
    parts = [f'{name}={value}', 'Path=/', f'Max-Age={int(max_age)}', 'HttpOnly', 'SameSite=Lax']
    if secure:
        parts.append('Secure')
    return '; '.join(parts)


def session_cookie(token, secure, max_age=SESSION_TTL_SECONDS, name=SESSION_COOKIE):
    return make_cookie(name, token, secure, max_age)


def clear_cookie(secure, name=SESSION_COOKIE):
    return make_cookie(name, '', secure, 0)


def cookie_value(header, name=SESSION_COOKIE):
    for part in str(header or '').split(';'):
        key, _, value = part.strip().partition('=')
        if key == name and value:
            return value
    return None


# ---------------------------------------------------------------- iCalendar (RFC 5545)
DAY_CODES = ('MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU')
_TOKEN_PATH = re.compile(r'^/calendar/([A-Za-z0-9_-]{20,64})\.ics$')


def calendar_token_from_path(path):
    match = _TOKEN_PATH.match(str(path or '').split('?', 1)[0])
    return match.group(1) if match else None


def ics_escape(text):
    text = re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', ' ', str(text))
    return text.replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\r\n', '\\n').replace('\n', '\\n').replace('\r', '\\n')


def ics_fold(line):
    """Pliega a 75 octetos por línea sin partir un carácter UTF-8; las continuaciones empiezan con un espacio."""
    raw = line.encode('utf-8')
    if len(raw) <= 75:
        return line
    out, current, size, limit = [], '', 0, 75
    for ch in line:
        n = len(ch.encode('utf-8'))
        if size + n > limit:
            out.append(current)
            current, size, limit = '', 0, 74
        current += ch
        size += n
    out.append(current)
    return '\r\n '.join(out)


def _local_date(ms, tz_name, offset_minutes):
    stamp = ms / 1000.0
    if tz_name:
        try:
            from zoneinfo import ZoneInfo
            return datetime.datetime.fromtimestamp(stamp, ZoneInfo(tz_name)).date()
        except Exception:
            pass
    tz = datetime.timezone(datetime.timedelta(minutes=int(offset_minutes or 0)))
    return datetime.datetime.fromtimestamp(stamp, tz).date()


def _uid(*parts):
    return hashlib.sha256('|'.join(parts).encode('utf-8')).hexdigest()[:32] + '@ruta.local'


def due_review_groups(store, now_ms, tz_name=None, offset_minutes=0, horizon_days=30):
    """[(fecha, goal_id, nombre, n)] a partir de `goal.reviews[].due` ya guardado. Los vencidos van al día de hoy.
    Solo cuenta repasos cuyo tema sigue en la meta (igual que el cliente); no mira respuestas ni evidencia."""
    today = _local_date(now_ms, tz_name, offset_minutes)
    limit = today + datetime.timedelta(days=horizon_days)
    groups = {}
    for goal in (store or {}).get('goals', []) if isinstance(store, dict) else []:
        if not isinstance(goal, dict) or not isinstance(goal.get('id'), str):
            continue
        node_ids = {n.get('id') for n in goal.get('nodes', []) if isinstance(n, dict)}
        for review in goal.get('reviews', []) or []:
            if not isinstance(review, dict) or review.get('id') not in node_ids:
                continue
            due = review.get('due')
            if isinstance(due, bool) or not isinstance(due, (int, float)) or due != due or due < 0 or due > 4e12:
                continue
            day = max(today, _local_date(due, tz_name, offset_minutes))
            if day > limit:
                continue
            groups.setdefault((day, goal['id']), [str(goal.get('goal') or '')[:80], 0])[1] += 1
    return [(day, gid, name, n) for (day, gid), (name, n) in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1]))]


def build_calendar(profile_id, store, settings, now_ms=None):
    """Texto iCalendar. Solo nombres de meta (si no se ocultan), conteos y la hora elegida: nunca respuestas, evidencia ni texto del aprendiz."""
    now_ms = int(time.time() * 1000) if now_ms is None else int(now_ms)
    hide = bool(settings.get('hide_goal_name'))
    tz_name, offset = settings.get('timezone') or '', settings.get('utc_offset_minutes') or 0
    stamp = datetime.datetime.fromtimestamp(now_ms / 1000.0, datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    pid = str(profile_id)
    goals = [g for g in (store or {}).get('goals', []) if isinstance(g, dict)]
    active = next((g for g in goals if g.get('id') == (store or {}).get('active')), None)
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ruta//hosting_ready_v1//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
             'X-WR-CALNAME:Ruta', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H']
    hour, minute = int(settings.get('hour', 20)), int(settings.get('minute', 0))
    days = sorted({d for d in settings.get('days', range(7)) if isinstance(d, int) and 0 <= d <= 6}) or list(range(7))
    anchor = settings.get('anchor_date') or _local_date(now_ms, tz_name, offset).isoformat()
    start = datetime.date.fromisoformat(anchor)
    # Zona horaria: hora local «flotante» (sin TZID ni Z). El evento sale a la hora del reloj del teléfono, así un cambio de horario
    # de verano no lo mueve. Solo las fechas de los repasos usan la zona (o el desfase) que envió el cliente.
    rule = 'FREQ=DAILY' if len(days) == 7 else 'FREQ=WEEKLY;BYDAY=' + ','.join(DAY_CODES[d] for d in days)
    title = 'Estudiar' if hide or not active else 'Estudiar: ' + str(active.get('goal') or '')[:80]
    lines += ['BEGIN:VEVENT', 'UID:' + _uid('daily', pid), 'DTSTAMP:' + stamp, 'SEQUENCE:0',
              'DTSTART:%s' % start.strftime('%Y%m%d') + 'T%02d%02d00' % (hour, minute), 'DURATION:PT15M', 'RRULE:' + rule,
              'SUMMARY:' + ics_escape(title), 'DESCRIPTION:' + ics_escape('Abre Ruta y estudia unos minutos.'), 'TRANSP:TRANSPARENT',
              'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + ics_escape(title), 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT']
    for day, goal_id, name, count in due_review_groups(store, now_ms, tz_name, offset):
        noun = 'repaso' if count == 1 else 'repasos'
        summary = f'{count} {noun}' if hide or not name else f'{count} {noun} de {name}'
        lines += ['BEGIN:VEVENT', 'UID:' + _uid('review', pid, goal_id, day.isoformat()), 'DTSTAMP:' + stamp, 'SEQUENCE:0',
                  'DTSTART;VALUE=DATE:' + day.strftime('%Y%m%d'), 'DTEND;VALUE=DATE:' + (day + datetime.timedelta(days=1)).strftime('%Y%m%d'),
                  'SUMMARY:' + ics_escape(summary), 'DESCRIPTION:' + ics_escape('Abre Ruta para repasar.'), 'TRANSP:TRANSPARENT', 'END:VEVENT']
    lines.append('END:VCALENDAR')
    return '\r\n'.join(ics_fold(line) for line in lines) + '\r\n'


# ---------------------------------------------------------------- ajustes de recordatorios
_TZ_RE = re.compile(r'^[A-Za-z0-9_+\-/]{1,64}$')


def clean_reminder_settings(data, now_ms=None):
    """Valida lo que envía el cliente. Lanza ValueError en español."""
    if not isinstance(data, dict):
        raise ValueError('Ajustes de recordatorio inválidos.')
    match = re.match(r'^([01]?\d|2[0-3]):([0-5]\d)$', str(data.get('time') or ''))
    if not match:
        raise ValueError('Elige una hora válida (HH:MM).')
    days = data.get('days')
    if not isinstance(days, list) or not days or any(isinstance(d, bool) or not isinstance(d, int) or not 0 <= d <= 6 for d in days):
        raise ValueError('Elige al menos un día de la semana.')
    tz = str(data.get('timezone') or '')
    tz = tz if _TZ_RE.match(tz) else ''
    offset = data.get('utc_offset_minutes')
    offset = offset if isinstance(offset, int) and not isinstance(offset, bool) and -840 <= offset <= 840 else 0
    # La fecha ancla es la fecha LOCAL del cliente (su zona o su desfase), no la del servidor: de noche en Monterrey el servidor en UTC ya va un día adelante.
    anchor = _local_date(int(time.time() * 1000) if now_ms is None else now_ms, tz, offset).isoformat()
    return {'version': 'hosting_ready_v1', 'enabled': True, 'hour': int(match.group(1)), 'minute': int(match.group(2)), 'days': sorted(set(days)),
            'hide_goal_name': data.get('hide_goal_name') is True, 'timezone': tz, 'utc_offset_minutes': offset, 'anchor_date': anchor}


# ---------------------------------------------------------------- iconos y manifiesto (sin librerías)
ICON_BG, ICON_FG = '#1F7A5C', '#FFFFFF'
ICON_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="%s"/>'
            '<circle cx="256" cy="256" r="150" fill="none" stroke="%s" stroke-width="44"/><circle cx="256" cy="256" r="52" fill="%s"/></svg>') % (ICON_BG, ICON_FG, ICON_FG)
_PNG_CACHE = {}


def icon_png(size):
    """PNG RGB opaco (anillo blanco sobre verde) generado con zlib; sin canal alfa para que iOS no pinte fondo negro."""
    if size in _PNG_CACHE:
        return _PNG_CACHE[size]
    bg, fg = (0x1F, 0x7A, 0x5C), (0xFF, 0xFF, 0xFF)
    c = (size - 1) / 2.0
    r_out, r_in, r_dot = size * 150 / 512 + size * 22 / 512, size * 150 / 512 - size * 22 / 512, size * 52 / 512
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            d = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
            row += bytes(fg if (r_in <= d <= r_out or d <= r_dot) else bg)
        rows.append(bytes(row))

    def chunk(tag, body):
        return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')
    _PNG_CACHE[size] = png
    return png


MANIFEST = {'name': 'Ruta · Tutor adaptativo', 'short_name': 'Ruta', 'lang': 'es', 'start_url': '/', 'scope': '/', 'display': 'standalone',
            'background_color': '#F3F6F1', 'theme_color': '#1F7A5C',
            'icons': [{'src': '/icon-192.png', 'sizes': '192x192', 'type': 'image/png'}, {'src': '/icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
                      {'src': '/icon.svg', 'sizes': 'any', 'type': 'image/svg+xml'}]}
MANIFEST_JSON = json.dumps(MANIFEST, ensure_ascii=False)
HEAD_EXTRA = ('<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg" type="image/svg+xml">'
              '<link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes">'
              '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Ruta">'
              '<meta name="apple-mobile-web-app-status-bar-style" content="default">'
              '<meta name="theme-color" content="#F3F6F1" media="(prefers-color-scheme: light)">'
              '<meta name="theme-color" content="#0E1512" media="(prefers-color-scheme: dark)">')

# ---------------------------------------------------------------- pantalla de inicio de sesión (sin el JS de la app)
LOGIN_JS = r"""'use strict';
const form=document.getElementById('login-form'),pw=document.getElementById('login-password'),msg=document.getElementById('login-message'),go=document.getElementById('login-go');
try{const t=localStorage.getItem('ruta-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}
form.addEventListener('submit',async ev=>{
  ev.preventDefault();msg.textContent='';go.disabled=true;
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw.value})});
    let d={};try{d=await r.json()}catch(e){}
    if(r.ok){pw.value='';location.reload();return}
    msg.textContent=d.error||'No se pudo iniciar sesión.';
  }catch(e){msg.textContent='No se pudo contactar al servidor.'}
  finally{go.disabled=false}
});
"""
LOGIN_CSS = (':root{color-scheme:light dark;--bg:#F3F6F1;--surface:#FFFFFF;--ink:#16211C;--muted:#55655D;--line:#D9E0D6;--go:#1F7A5C;--on-go:#FFFFFF;--bad:#B93A26}'
             '@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0E1512;--surface:#17211C;--ink:#EEF4EF;--muted:#A7B6AD;--line:#2C3A33;--go:#57C79E;--on-go:#08110D;--bad:#FF9C8A}}'
             ':root[data-theme="dark"]{--bg:#0E1512;--surface:#17211C;--ink:#EEF4EF;--muted:#A7B6AD;--line:#2C3A33;--go:#57C79E;--on-go:#08110D;--bad:#FF9C8A}'
             '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,"Segoe UI",sans-serif}'
             'main{width:100%;max-width:420px;padding:20px}form{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:24px}'
             'h1{margin:0 0 4px;font-size:1.6rem}p{color:var(--muted);margin:.2rem 0 1rem}label{display:block;font-weight:600;margin-bottom:6px}'
             'input{width:100%;font:inherit;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}'
             'button{width:100%;min-height:48px;margin-top:14px;font:inherit;font-weight:600;border:0;border-radius:10px;background:var(--go);color:var(--on-go);cursor:pointer}'
             'button:disabled{opacity:.55}button:focus-visible,input:focus-visible{outline:3px solid var(--go);outline-offset:2px}#login-message{min-height:1.5em;margin:10px 0 0;color:var(--bad)}')
LOGIN_HTML = ('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ruta · Iniciar sesión</title>'
              + HEAD_EXTRA + '<style>' + LOGIN_CSS + '</style></head><body><main><form id="login-form" autocomplete="on"><h1>Ruta</h1><p>Inicia sesión para continuar.</p>'
              '<label for="login-password">Contraseña</label><input id="login-password" name="password" type="password" autocomplete="current-password" required>'
              '<button id="login-go" type="submit">Entrar</button><p id="login-message" role="alert"></p></form></main><script>' + LOGIN_JS + '</script></body></html>')
