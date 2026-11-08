# Acceso desde otro dispositivo en red privada (`private_network_access_v1`)

Para usar la app desde el iPhone sin publicarla en internet. Es opcional: si no se configura nada, el servidor
escucha solo en `127.0.0.1` y solo acepta el origen `http://127.0.0.1:8765`, exactamente como antes.

## Ajustes (variables de entorno al arrancar)

- `LEARNSCIENCE_HOST`: dirección IPv4 en la que escucha el servidor. Recomendado: la IP de Tailscale de la PC
  (`100.x.x.x`). Con ella, el origen `http://100.x.x.x:8765` queda permitido automáticamente.
  `0.0.0.0` escucha en todas las interfaces pero **no** añade ningún origen: hay que listarlos a mano.
- `LEARNSCIENCE_ORIGINS`: orígenes extra permitidos, separados por comas, con la forma `http://nombre:puerto`
  (sin rutas ni comodines). Útil para el nombre MagicDNS de Tailscale.

Un valor inválido detiene el servidor al arrancar con un mensaje claro (código 2); nunca se acepta «cualquier origen».

## Qué no cambia

- La lista de orígenes se calcula en cada petición, como antes, así que un `PORT` o `HOST` cambiado después de
  cargar el módulo (lo hace el arnés de pruebas) sigue aplicando.

- La comprobación de origen sigue siendo una lista exacta (protección contra que otro sitio web use la app).
  `localhost` sigue sin estar permitido, como antes.
- Las peticiones sin `Origin` (clientes que no son navegador) siguen permitidas, como antes.
- La política de evidencia no cambia.

## Uso en la PC con la IP de Tailscale

Si el servidor escucha en la IP de Tailscale, deja de responder en `127.0.0.1`: en la PC también se abre
`http://100.x.x.x:8765`. Los datos viven en el servidor, así que solo hay que volver a elegir el perfil.
No se recomienda `0.0.0.0`: expone el servidor a toda la Wi-Fi.

## Riesgo y recomendación

La app no tiene inicio de sesión. Quien pueda alcanzar la dirección puede usarla y gastar la cuota de Gemini.
Por eso se recomienda Tailscale (solo tus dispositivos) y no la Wi-Fi compartida ni una URL pública.
Al arrancar con una dirección distinta de `127.0.0.1`, el servidor muestra un aviso.

## Pruebas

`tests/private_network_access.test.py`: valores por defecto idénticos, origen de Tailscale añadido, `0.0.0.0` sin
orígenes implícitos, orígenes extra, valores inválidos rechazados (y el servidor no arranca), y con un servidor HTTP
real: sin configurar otro dispositivo recibe 403; configurado, solo el origen exacto (IP y puerto) recibe 200.
