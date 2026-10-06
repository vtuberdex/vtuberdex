# Sistema de diseño de VTuberDex

Una sola identidad para la web y para el correo saliente: oscura, con un acento turquesa y un
resplandor violeta de fondo. La fuente de verdad de los colores es `app/globals.css` (`@theme`);
las superficies que no leen ese CSS (el correo) usan la copia de `lib/diseno.mjs`, y
`lib/diseno.test.ts` falla si se desfasan.

## Colores

| Token | Valor | Uso |
|---|---|---|
| `void` | `#05060a` | Fondo de página; fondo de la cabecera del correo y de las cajas de código |
| `panel` | `#0d1017` | Tarjetas y paneles |
| `panelSoft` | `#141924` | Cajas internas, pie del correo |
| `line` | `#232a38` | Bordes y divisores |
| `ink` | `#e8ecf5` | Texto principal |
| `muted` | `#8b96ad` | Texto secundario, notas, etiquetas |
| `accent` | `#5eead4` | Acento de marca: enlaces, botón principal, códigos |
| `violeta` | `#a855f7` | Segundo tono de marca (resplandor del fondo, degradado de la franja) |
| `peligro` | `#f87171` | Solo estados: acciones irreversibles (baja) |
| `aviso` | `#fbbf24` | Solo estados: acceso del mantenedor |
| `exito` | `#34d399` | Solo estados: bienvenida y confirmaciones |

Los tres últimos son **semánticos**: indican qué tipo de mensaje es, no se usan como decoración.
Texto sobre un color de acento siempre es `void` (contraste alto con los cinco).

## Tipografía

- **Títulos: Knewave** (peso 400; una negrita sería sintética). Wordmark «VTuberDex» y `h1`.
- **Todo lo demás: Asul** (400/700), incluidos los números.
- Respaldo `Georgia, serif`. En el correo las fuentes se piden por la hoja de Google Fonts
  (`DISENO.fuentesUrl`); los clientes que no la cargan (Gmail, Outlook) usan el respaldo.
- Excepción: el código de verificación va en monoespaciada, porque se copia y pega y debe
  distinguir `0/O` y `l/1`.

## Forma

Radios: tarjeta 16 px, botón 12 px, cajas internas 10 px. Borde de 1 px en `line`.
La franja bajo la cabecera del correo es el degradado `accent → violeta`.

## Correo saliente (`lib/correo.mjs`)

Una sola plantilla (`plantilla()`) para los seis correos: código de inscripción, código de
actualización, confirmación de baja, acceso del mantenedor, «Mi ficha» y bienvenida. Cada uno elige
un tono con `acento`: `accent` (inscripción), `violeta` (actualización y Mi ficha), `peligro` (baja),
`aviso` (mantenedor), `exito` (bienvenida, que además tiene maqueta propia: hero con resplandores, tarjeta de la ficha y lista de lo que se puede hacer). Reglas de la maqueta:

- Tablas y estilos en línea; `bgcolor` además de `background` (Outlook ignora el segundo).
- `color-scheme: dark` declarado y todo color explícito, para que ningún cliente lo reinterprete.
- Todo texto que escribió una persona se escapa; el texto plano lleva el mismo contenido.
- Un color nuevo se añade primero a `lib/diseno.mjs` (y a `globals.css` si es de la web): el test
  rechaza cualquier hexadecimal del correo que no sea un token.

## Web

Clases de Tailwind: `bg-dex-void`, `bg-dex-panel`, `bg-dex-panel-soft`, `border-dex-line`,
`text-dex-ink`, `text-dex-muted`, `text-dex-accent`. Los valores del efecto de la carta 3D viven
aparte, en `components/card3d-config.ts`.
