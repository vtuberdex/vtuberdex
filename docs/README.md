# VTuberDex

Reconstrucción del directorio **vtuberdex.com** como aplicación propia: el
catálogo original funciona como una "pokédex" plana (785 fichas en un HTML con
atributos sueltos), su buscador solo hace `scrollIntoView` sobre el primer
`div` que coincide y las 194 páginas de detalle enlazadas son plantillas
copiadas a mano. Este proyecto extrae esos datos una sola vez a **SQLite** y
sirve una app React que busca de verdad y muestra cada VTuber como una **carta
holográfica 3D**.

## Qué hay aquí

```
scraper/   Extrae el catálogo y las fichas a out/dataset.json + data/images/
server/    API Express + SQLite (búsqueda, facetas, mantenedor) y el seed
web/       React 19 + Tailwind 4 + react-three-fiber (catálogo, detalle, admin)
docs/      Capturas de pantalla y este documento
scripts/   dev-up.sh (levanta API y web) y refresh.sh (re-scrape completo)
```

## Arquitectura

```
vtuberdex.com  ──scraper──▶  dataset.json ──seed──▶  SQLite  ──API──▶  React (3D)
   (HTML plano)              (normalizado)          (1 archivo)      (Next.js App Router)
```

- **Scraper** (Node + cheerio): descarga el index y las fichas de detalle,
  normaliza países/idiomas/etiquetas, convierte las imágenes a WebP y guarda el
  HTML en caché para poder re-parsear sin volver a la red (`--from-cache`).
- **SQLite** (`node:sqlite`, sin dependencias nativas): 15 tablas normalizadas
  con tablas puente para los atributos multivaluados y un índice **FTS5** para
  búsqueda por nombre, frase, etiquetas y facciones.
- **API** (Express 5 + zod): listado paginado con facetas calculadas en la base,
  detalle completo, y mantenedor con login `scrypt`, edición y auditoría.
- **Web** (React 19 + Tailwind 4 + three.js): búsqueda con estado en la URL,
  grilla de cartas 2D y carta holográfica 3D con shaders propios.

## Datos extraídos (evidencia real del scrape)

| Métrica | Valor |
| --- | --- |
| Cartas del index | **785** |
| Fichas de detalle encontradas | **211** |
| Cartas solo con datos de index | 574 (no tienen ficha en el origen) |
| Imágenes de carta + miniatura | 785 + 785 |
| Logos / avatares / radares | 154 / 155 / 153 |
| Países distintos | 31 |
| Habilidades | 1055 |
| Filas de assets | 2203 |

Notas del origen que el scraper resuelve:

- El sitio devuelve **el index con status 200** para cualquier URL inexistente
  ("soft 404"), por eso los enlaces rotos pasan desapercibidos. El scraper
  valida la respuesta buscando la marca de la plantilla de detalle.
- `data-pais` mezcla variantes (`Mexico`, `México`, `Argetina`, `Perú´`,
  `España, Canarias`): todo se normaliza a slugs ASCII en un único módulo.
- 58 fichas traen el avatar **embebido en base64** dentro del HTML: el scraper lo
  decodifica, lo convierte a WebP y descarta el base64 del dataset
  (de 72 MB a 25 MB).

## Puesta en marcha

```bash
# 1. Datos (una vez; tarda unos minutos y cachea el HTML)
cd scraper && npm install && npm run scrape

# 2. Base de datos
cd ../server && npm install && npm run seed && npm run admin -- admin <tu-password>

# 3. App (Next.js, en la raíz)
cd .. && npm install && npm run dev            # http://localhost:3000
npm run build && npm start                     # build de producción, misma URL
```

Atajos: `scripts/dev-up.sh` levanta Next + el servidor del mantenedor en local;
`scripts/refresh.sh` re-hace el scrape y re-importa; `scripts/dev-docker.sh`
publica ambos a la LAN para revisar desde otra máquina (ver abajo).

El mantenedor (`/admin`) corre **solo en local**: necesita escribir en disco y el
sistema de archivos de Vercel es de solo lectura. En producción esa ruta devuelve
404 a propósito.

## Despliegue

Todo el catálogo corre en Vercel: las rutas de `app/api/*` consultan una copia
**saneada** de SQLite empaquetada en la función, y `/images/*` sirve las imágenes
desde **Turso** (los bytes viven en un BLOB de la tabla `asset_remoto`), con el disco
local como respaldo en desarrollo. Las ediciones del mantenedor también viven allí.

```bash
npm run build:data               # regenera deploy/ desde data/ (tras scrape o edición)
npm run publish:images           # sube las imágenes a Turso (reanudable)
npm run verify                   # 32 comprobaciones sobre un escenario de producción
npx vercel deploy --prod         # publica
```

`AGENTS.md` documenta las reglas del deploy y las trampas ya pagadas (FS de solo
lectura, base empaquetada vía `outputFileTracingIncludes`, saneado con `VACUUM`).

## Revisar desde otra máquina (modo dev)

Este entorno corre dentro de un contenedor Docker cuyos puertos **no están
publicados** al host, así que `localhost:3000` no es alcanzable desde otro PC.
Como `/home/madkoding/proyectos` es un bind-mount del host, el daemon de Docker
resuelve esa ruta y sí puede publicar puertos de verdad:

```bash
./scripts/dev-docker.sh          # levanta Next (3000) + mantenedor, publicados a 0.0.0.0
./scripts/dev-docker.sh --logs   # sigue los logs
./scripts/dev-docker.sh --down   # los detiene
```

El navegador de la otra máquina habla **solo con Next** (`:3000`); sus rutas
`/api` y `/images` las sirve la propia app, así que funciona desde cualquier IP
sin tocar CORS.

| Acceso | URL |
| --- | --- |
| Front | `http://192.168.100.90:3000/` |
| Mantenedor | `http://192.168.100.90:3000/admin` |

Si la IP del host cambia, el script la detecta solo (contenedor en `--network host`).

## API

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/health` | Estado y conteos publicados |
| GET | `/api/vtubers` | Búsqueda paginada (`q`, `countries`, `languages`, `groups`, `artists`, `factions`, `sort`, `page`, `perPage`, `facet`) |
| GET | `/api/vtubers/:slug` | Detalle + vecinos de dex |
| POST | `/api/admin/login` | Sesión del mantenedor |
| PATCH | `/api/admin/vtubers/:id` | Edición (nombre, color, visibilidad, relaciones) |
| POST | `/api/admin/vtubers/bulk-status` | Visibilidad en lote |
| GET | `/api/admin/stats`, `/api/admin/audit` | Métricas y auditoría |

## Tests y lint

```bash
npm test                   # 127 tests (vitest): utilidades, componentes, páginas y carta 3D
npm run lint               # eslint . — cubre también server/ y scraper/
npm run typecheck          # tsc --noEmit
npm run check:shaders      # guard de uniforms de GLSL (ni tsc ni los tests lo ven)
cd scraper && npm test     # 25 tests: parsers y normalización
cd server  && npm test     # 59 tests: búsqueda, facetas, API HTTP y mantenedor
```

Para medir en vez de suponer (ninguno modifica nada):

```bash
npm run probe:timings      # piso de SQLite local, sin red
npm run bench:ediciones    # A/B del camino de Turso contra el de HEAD (stub, sin credenciales)
npm run sweep:dead-code    # exports sin consumidores
```

Los tests del servidor corren contra una base SQLite temporal sembrada con un
dataset de ejemplo: no tocan la base real ni la red.

Todo esto —más `npm run build` y las 32 comprobaciones de `npm run verify`— lo
corre GitHub Actions en cada push y cada PR (`.github/workflows/ci.yml`), sin
necesitar ningún secreto. El deploy a producción es otro workflow (`deploy.yml`,
solo `master`).

## Decisiones de diseño

- **La URL es el estado de la búsqueda.** Un resultado filtrado se puede
  compartir por enlace; en el origen todo el filtrado era cliente y se perdía.
- **Una sola carta WebGL por pantalla.** La grilla usa CSS 3D (24 contextos WebGL
  matarían el rendimiento en móvil); la carta con shaders vive en el detalle.
- **Degradación explícita.** Sin WebGL, la carta 3D cae a una vista 2D con el
  mismo arte en lugar de dejar un hueco negro.
- **El color del dato manda.** El `THEME` de cada ficha alimenta la paleta
  (acento, secundario, tinte de fondo y tinta legible) de la carta, los chips y
  los bordes.
