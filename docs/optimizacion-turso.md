# Lecturas a Turso: por qué la API tardaba y cuánto se ganó

Medición del 2026-09-23 sobre `vtuberdex-sepia.vercel.app`. Este documento guarda los
números del problema y del arreglo, porque el fallo **no lo veía ningún gate** y el síntoma
("la db es lenta") no apuntaba a su causa.

## El síntoma

| Ruta | Mediana en producción | Qué consulta |
|---|---|---|
| `/api/meta` | **313 ms** | solo SQLite empaquetada |
| `/api/vtubers?perPage=1` | 417 ms | SQLite + Turso |
| `/api/vtubers?perPage=24` | **824 ms** | SQLite + Turso |
| `/api/vtubers?perPage=100` | 1.854 ms | SQLite + Turso |

`/api/meta` no toca Turso y aun así tardaba 313 ms; el piso local del catálogo, medido con
`scripts/probe-timings.mjs`, es de **2,2 ms para las 24 fichas**. Es decir: de los 824 ms,
unos 2 ms eran trabajo de catálogo.

El escalado era LINEAL (~14 ms por carta), que es la firma de un viaje de red por carta y no
de un catálogo. Una página del catálogo —la que se pinta al abrir el sitio— hacía
**292 peticiones** a Turso, y con `perPage=100`, 1.204.

## La causa

`lib/ediciones.mjs` llamaba `asegurarTablas()` en CADA lectura, y esa función hace 3 sentencias
DDL más un `PRAGMA`. Y `aplicarReemplazosALista` preguntaba **tipo por tipo para cada carta**
(3 viajes por ficha, uno por `KINDS_GESTIONABLES`). Cada consulta espera a la anterior, así que
el cliente de libsql no podía agruparlas.

Ningún gate lo veía: `lint`, `typecheck`, `build` y las 118 pruebas pasaban en verde. El
resultado era correcto; solo estaba multiplicado por 146. Por eso el test que se añadió
(`lib/lecturas-turso.test.ts`) fija el **número de consultas**, no la forma de la respuesta.

## El arreglo

1. `asegurarTablas()` memoiza su promesa a nivel de módulo: el DDL se paga una vez por
   instancia, no una vez por lectura. Si falla, el memo se suelta (cachear el rechazo dejaría
   todas las lecturas siguientes rotas hasta reciclar la instancia).
2. `reemplazosDePagina(slugs)` resuelve la página entera con **una** consulta
   (`WHERE origen = ? AND slug IN (...) AND kind IN (...)`), en vez de 3·N.
   `reemplazosDelMantenedor` pasa a ser el caso N=1, así que hay una sola definición de la
   consulta y del mapeo de filas.

## El resultado medido

Con `scripts/bench-ediciones.mjs`, que sirve el protocolo de Turso sobre SQLite real y compara
el `lib/ediciones.mjs` de `HEAD` contra el actual, con el mismo cliente `@libsql/client`:

| `perPage` | Antes | Después | Peticiones |
|---|---|---|---|
| 24 | 292 POST | **2 POST** | −99,3 % |
| 48 | 580 POST | **2 POST** | −99,7 % |
| 100 | 1.204 POST | **2 POST** | −99,8 % |

Equivalencia: **24/24 fichas idénticas** en `images` y `assets` entre los dos caminos.

El modelo cuadra con producción: 292 viajes × ~2,8 ms ≈ 817 ms, contra los 824 ms medidos, y
`scripts/bench-ediciones.mjs --delay 2` reproduce el escalado lineal (298 / 463 / 685 ms) que
tenía el sitio.

En el detalle, `leerAssetRemoto` pasó de **4 peticiones por imagen** (3 de DDL + 1 consulta) a
**1**, con una única de DDL por instancia.

## Cómo reproducirlo

```bash
npm run probe:timings      # piso local de SQLite (sin red)
npm run bench:ediciones    # A/B contra el protocolo de Turso, con stub SQLite
```

Las credenciales de Turso **no** se pueden releer para medir contra el servicio real: las de
`production` están marcadas `sensitive` en Vercel y devuelven vacío incluso con
`decrypt=true` (la misma trampa que documenta AGENTS.md para el hash del mantenedor). Los dos
scripts miden sin red, que es lo que hace falta para contar viajes.

## Código muerto retirado en la misma pasada

Barrido con `npm run sweep:dead-code` (informa; no borra). Se retiraron **10 exports sin
ningún consumidor** —cada uno aparecía solo en su propia línea de definición— más el endpoint
muerto:

| Qué | Dónde | Nota |
|---|---|---|
| `GET /api/meta` + `api.meta()` + `ApiMetaResponse` | `app/api/meta/`, `lib/api.ts`, `lib/types.ts` | 313 ms por un dato que nadie pedía; las facetas viajan en `/api/vtubers?facet=all` |
| `canvasToTextureSource` | `components/card-texture.ts` | identidad pura |
| `backlightGlow` | `components/card-texture.ts` | el halo lo pinta la escena 3D, no un canvas |
| `__resetCardVisibility` | `components/card-visibility.ts` | su gemelo `__resetCardQuality` **sí** se usa; este no |
| `LAYER_COUNT`, `LAYER_SCALES`, `LAYER_LABELS` | `components/card3d-config.ts` | nadie los leía |
| `API_BASE` | `lib/api.ts` | alias de un `BASE` que solo usa el propio módulo |
| `glowShadow` | `lib/color.ts` | nadie lo llamaba |
| `encodePath` | `scraper/src/http.mjs` | nadie lo llamaba |
| `requireSession` | `server/src/auth.mjs` | **duplicado**: la protección real de las rutas del mantenedor es `requireAdmin` (`server/src/routes.mjs:207`), que inlinea el mismo código |

La comprobación de `verify` que consultaba `/api/meta` **se movió** a las facetas de la lista
en vez de borrarse: "31 países" es un dato que conviene vigilar, y si la consulta de facetas
se rompiera el panel de filtros saldría vacío sin que `/api/vtubers` dejara de responder 200.
Verificado por HTTP contra un `next start` local: `/api/meta` da 404 (con el fallback HTML,
la firma de ruta inexistente en este repo), `/api/health` 200 y `facet=all` devuelve 31 países.

**Queda uno huérfano a propósito:** `LayerName` (`components/card3d-config.ts`) se quedó sin
consumidores al retirar `LAYER_LABELS`, pero es un **tipo** derivado de `PARALLAX_LAYERS` —no
genera código y documenta la forma de la config—, así que se deja. Igualmente,
`PARALLAX_LAYERS[].scale` se quedó sin lectores al borrar `LAYER_SCALES`: es un campo de una
tabla de configuración, no código muerto. Se reportan en vez de tocarlos.

El primer intento del barrido incluía un chequeo de `export default` sin consumidor por
defecto que marcaba **23 archivos vivos** (los componentes se exportan por nombre y el default
es requisito de Next en `app/`). Se quitó: un guard que siempre miente es peor que no tenerlo.

## Lo que queda (no aplicado)

- **Caché de borde en las respuestas de la API.** Hoy `/api/vtubers` y `/api/health` llevan
  `public, max-age=0, must-revalidate`: no hay caché de borde, así que **cada carga de la
  página vuelve a la función** (dos veces: la del HTML y la del cliente). Con
  `CDN-Cache-Control` de unos segundos, las visitas repetidas se servirían del borde. El
  precio es que una edición del mantenedor tarda esos segundos en verse, y hay que pensar la
  clave por querystring (la URL ya es el estado de la búsqueda, así que es viable).
  No aplicarlo sin medir el ahorro real contra el número de escrituras del mantenedor.
- **Dos consultas de paginación secuenciales.** El conteo (`vtuber_count`) y la página podrían
  resolverse secuencialmente sin pérdida porque son SQLite local (2,2 ms los dos): no merece
  la pena tocarlo; queda anotado para que nadie lo "optimice" creyendo que cuesta.
- **`asegurarTablas` se llama en cada ruta de lectura.** Con el memo es gratis, pero ahora
  `leerAssetRemoto` (la ruta MÁS caliente del sitio: una por imagen) mantiene vivo el memo de
  esquema de una tabla que no usa. En el detalle se midió: 1 petición por imagen, correcto.
  Si algún día se separan los módulos, el memo debería quedarse con las tablas.
