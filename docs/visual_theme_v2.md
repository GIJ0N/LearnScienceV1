# Sistema visual v2 (`visual_theme_v2`)

## Propósito

Pasar de un tema oscuro único y recargado a un sistema claro por defecto, con modo oscuro opcional, basado en
tokens, con contraste verificado y legible en móvil. Es solo presentación: no toca evidencia, eventos,
cobertura ni calendario.

## Qué cambia

- `VISUAL_CSS` (en `app.js`) se reescribe con tokens. Claro en `:root`; oscuro en `:root[data-theme="dark"]`.
- Tokens (claro / oscuro): `--bg #F3F6F1/#0E1512`, `--surface #FFFFFF/#17211C`, `--ink #16211C/#EEF4EF`,
  `--muted #55655D/#A7B6AD`, `--line #D9E0D6/#2C3A33`, `--go #1F7A5C/#57C79E`, `--go-deep #145C44/#2F8F6D`,
  `--on-go #FFFFFF/#08110D`, `--sun #8A5A0C/#F2B33D`, `--info #2F5FD0/#8FB0FF`, `--bad #B93A26/#FF9C8A`,
  `--good-bg #E3F3EA/#16352A`, `--bad-bg #FBE9E5/#3A1C17`, `--unknown-bg #EEF0F4/#222A33`.
- Tipografía solo de sistema: títulos redondeados (peso 700), cuerpo `system-ui` a 17 px, interlineado 1.6,
  texto de lección y pregunta a un máximo de 68 caracteres de ancho.
- Botón primario `--go` con borde inferior de 4 px (2 px al pulsar), radio 14 px, altura táctil mínima de 44 px;
  `.quiet` es el secundario. Tarjetas `.box` sin sombra pesada, radio 18 px.
- A 640 px o menos: margen de 16 px, botones a todo el ancho, `.action-row` en columna.
- `:focus-visible` con contorno de 3 px `--info`; `prefers-reduced-motion: reduce` anula transiciones y animaciones.
- Se conservan todas las clases existentes; las que no tenían estilo (`item-prompt`, `more-practice`,
  `plan-list`, `plan-topic`, `plan-name`) ahora lo tienen. El panel del mapa de red conserva fondo oscuro fijo
  porque los colores de sus nodos se calculan en JS.

## Tema

- `installVisualTheme` usa el id `ruta-visual-v2` y aplica `document.documentElement.dataset.theme`.
- Orden: `localStorage['ruta-theme']` (`light`/`dark`, dentro de `try/catch`) → `prefers-color-scheme` → claro.
- Botón «Tema: claro / oscuro» en la navegación. Cambiar de tema es una preferencia de este navegador:
  no escribe en la meta, no crea eventos y no cambia ningún veredicto.

## Qué cuenta como evidencia

Nada. Es solo presentación. Ningún texto ni botón existente desaparece.

## Compatibilidad y rollback

Sin cambios de datos ni de rutas. Revertir el commit restaura el estilo anterior. El id `ruta-visual-v1` ya no existe.

## Sin validar

Aspecto real en navegador y teléfono; los colores de los nodos del mapa sobre su fondo oscuro fijo.
