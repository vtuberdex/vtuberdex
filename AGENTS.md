# VTuberDex — notas para agentes

Reconstrucción de `vtuberdex.com` (una "pokédex" plana de 785 fichas en un solo
HTML, sin backend) como aplicación propia: scrape único → SQLite → API → React
con carta holográfica 3D. Sin dependencias nativas, sin servicios externos.

El README humano es `docs/README.md` (arquitectura, cifras del scrape, API y
capturas). **Este archivo es el contrato operativo**: cómo correr, qué no romper
y los errores que ya costaron tiempo.

## Stack y requisitos

- **Node 22+ obligatorio.** `server/src/db/index.mjs` usa `node:sqlite`
  (`DatabaseSync`), que no existe antes de Node 22. Verificado con v22.23.2.
- Tres paquetes npm **independientes**, cada uno con su `node_modules` y sus
  scripts: `scraper/`, `server/`, `web/`. No hay workspaces ni lockfile raíz.
- `scraper`: cheerio + sharp + tesseract.js · `server`: Express 5 + zod ·
  `web`: React 19 + Tailwind 4 + three.js/react-three-fiber + Vite 7.
- Los datos (`data/`, `scraper/out/`, `scraper/cache/`, `web/dist/`) están en
  `.gitignore`: son **reproducibles**, no se versionan.

```
scraper/  ──▶ scraper/out/dataset.json + data/images/  ──▶ server (seed) ──▶ data/vtuberdex.db ──▶ web (API)
```

## Comandos

```bash
# Tests — cada paquete por separado (no hay test raíz)
cd scraper && npm test     # 25 tests (node --test): parsers y normalización
cd server  && npm test     # 52 tests: búsqueda, facetas, API HTTP, mantenedor
cd web     && npm test     # 76 tests (vitest): utilidades, componentes, páginas

# Verificación del front antes de dar algo por terminado
cd web && npm run typecheck && npm run build

# Puesta en marcha
cd scraper && npm install && npm run scrape      # reanudable: cachea el HTML
cd ../server && npm install && npm run seed && npm run admin -- admin <pass>
cd ../web && npm install && npm run build        # el server sirve web/dist
cd ../server && npm start                        # http://localhost:4000

# Atajos (desde la raíz)
./scripts/dev-up.sh          # API + Vite en local
./scripts/dev-docker.sh      # publica ambos a la LAN (0.0.0.0) para revisar desde otro PC
./scripts/refresh.sh         # re-scrape completo (6 pasos) + re-seed + build
```

`docs/README.md` cita 15/32/57 tests: son cifras **viejas**. Las de arriba son
las reales (medidas). Si añades tests, actualiza aquí.

## Arquitectura: las reglas que no se negocian

1. **El PERSONAJE es la única imagen fuente del VTuber.**
   `asset.kind = 'character'` → `data/images/character/<slug>.webp`, normalizado
   al lienzo de carta **720x1008 (proporción 1.4)**. Es lo que consumen la carta
   3D, el listado y la ficha. Nunca se deforma al encajarlo porque ya viene en la
   proporción correcta.
2. **La CARTA no se guarda: la compone el visor 3D** en el navegador
   (personaje + logo + marco). `asset.kind = 'card'` apunta a
   `data/images/ficha/<slug>.webp`, que es la **ficha apaisada del sitio
   (legacy)**: solo el respaldo cuando no hay personaje.
   `data/images/card/` está **vacío y no se usa** — no escribas ahí.
3. **Los nombres de archivo son canónicos por slug**
   (`<carpeta>/<slug>.webp`). Subir desde el mantenedor y regenerar con el
   scraper escriben el MISMO archivo; nunca hay dos copias que se contradicen.
4. **Las rutas de assets se sirven desde la raíz** (`/images/...`), con barra
   inicial. Una ruta relativa se rompería en rutas anidadas del SPA
   (`/v/:slug/images/...`).
5. **`dex_number` es el identificador estable** de la carta y `slug` la clave
   pública (`/v/:slug`). El seed hace upsert por `dex_number`, así que re-scrapear
   no duplica fichas.
6. **La URL es el estado de la búsqueda.** Todo filtro vive en el querystring
   (`web/src/lib/query.ts`); un resultado filtrado se comparte por enlace.
7. **Una sola carta WebGL por pantalla.** La grilla usa CSS 3D (24 contextos
   WebGL matarían el rendimiento en móvil); el canvas con shaders vive en el
   detalle.
8. **El color del dato manda.** `THEME` de cada ficha alimenta la paleta
   (acento, secundario, fondo, tinta) de cartas, chips y bordes.

## Base de datos y migraciones

- Esquema completo en `server/src/db/schema.sql` (`CREATE TABLE IF NOT EXISTS`).
- **Una columna nueva NO se añade sola** a una base existente: agrega una
  entrada al array `MIGRATIONS` de `server/src/db/index.mjs`, que se aplica una
  vez y registra en `meta` (`migration:<id>`). Idempotente.
- Las vistas (`v_vtuber_card`) se recrean en CADA apertura y **después** de las
  migraciones: SQLite no deja alterar un `CHECK`, así que una migración que
  reconstruya una tabla tiene que poder soltar la vista primero.
- La búsqueda es **FTS5** (`vtuber_fts`, `unicode61 remove_diacritics 2`) +
  `LIKE` como respaldo sobre `search_name` y `card_text`. Las facetas y los
  contadores (`vtuber_count`) se calculan en SQLite, nunca recorriendo filas en JS.

## El scraper: particularidades del origen

- **El sitio devuelve el index con status 200 para cualquier URL inexistente**
  ("soft 404"). Por eso nada se acepta sin validar la marca de la plantilla de
  detalle (`class="terminal-bar"`). Ver `scraper/src/http.mjs` (`isSoft404`).
- `data-pais` mezcla variantes (`Mexico`/`México`/`Argetina`/`Perú´`): todo se
  normaliza a slugs ASCII en `scraper/src/normalize.mjs`, en un solo lugar.
- Los **emblemas de facción** viven en `facciones/<Nombre>.png` con nombres de
  archivo irregulares (erratas incluidas): se resuelven por slug y por prefijo
  común más largo (`factionIcon()` en `server/src/seed.mjs`).
- El scrape es **reanudable**: si el HTML ya está en `scraper/cache/`, no se
  vuelve a pedir. `--from-cache` fuerza a no tocar la red.
- Pasos que van FUERA de `scrape.mjs` y son imprescindibles (los corre
  `scripts/refresh.sh` en orden): `get-faction-logos` → `extract-logo2` →
  `extract-character`. Sin ellos, 574 VTubers se quedan sin logo ni personaje:
  el sitio solo sirve esos assets en sus 211 páginas de detalle.

## Trampas conocidas (ya nos costaron tiempo)

- **R3F en producción**: la geometría del canto se crea con `useMemo` como
  instancia, NO como elemento JSX. Instanciar la clase desde JSX acaba en
  `Class constructor cannot be invoked without 'new'` en el bundle minificado y
  la carta sale negra.
- **`half` es palabra reservada en GLSL ES 3.0.** Usarla como variable en un
  shader hace que NO compile ("Illegal use of reserved word") y la carta sale
  negra. En `web/src/features/card3d/shaders.ts` se usa `halfSize`.
- **Vite 7 rechaza un `Host` que no sea IP** (DNS rebinding): abrir la app por
  nombre de máquina da "Blocked request". Se resuelve con `allowedHosts` +
  `VTUBERDEX_ALLOWED_HOSTS` (`web/vite.config.ts`).
- **Combinar headers en el cliente de API, no reemplazarlos.**
  `fetch(headers: { authorization })` borraba el `content-type: application/json`
  y el PATCH fallaba con "expected object, received undefined".
- **`express.json` global está en 1 MB**: las subidas de imagen usan
  `express.raw` con su propio límite (12 MB) solo en esas rutas, y validan el
  tipo **por contenido** con `sharp`, nunca por extensión ni `Content-Type`.
- **`scripts/` no es `web/scripts/`**: `scripts/*.sh` es infraestructura del
  repo; `web/scripts/*.mjs` son sondas de desarrollo (medir tinte, volcar
  texturas, capturas). Las sondas y `screenshots.mjs` esperan un Chrome en
  `CHROME_PATH` (`/opt/data/cache/chrome/...`), que **en este contenedor no
  existe**: `npm run shots` falla aquí hasta que se baje el binario.
- **`npm run lint` está roto**: ESLint 9 exige `eslint.config.js` y no hay
  ninguno en el repo. Los gates reales del front son `typecheck` + `build` +
  `test`. Si arreglas el lint, quita esta nota.
- **`npm run palette` (scraper) apunta a `src/palette.mjs`, que no existe.**
- **`server/src/seed.mjs` documenta un `--keep-edits` que no está
  implementado.** Los flags reales son `--reset`, `--dataset`, `--db`; por
  defecto manda el dataset (los cambios a mano del mantenedor se pisan).
- **Los borradores/ocultos no aparecen en la lista del mantenedor.** `AdminPage`
  se llena con `/api/vtubers`, que filtra `status = 'published'`. La UI pinta la
  etiqueta de estado, pero nunca le llega una ficha no publicada.
  `searchVtubers()` sí soporta `includeHidden`, pero la ruta pública no lo
  expone. El detalle (`getVtuberBySlug`) sí acepta `includeHidden`.

## Convenciones de código

- **Comentarios y JSDoc que expliquen el POR QUÉ, no el qué.** Es el rasgo más
  fuerte del repo: los bloques documentan el problema medido, la alternativa que
  se probó y por qué se descartó (ver `HoloCard.tsx`, `shaders.ts`,
  `uploads.mjs`). Respeta ese estilo; un cambio de comportamiento sin esa nota
  se lee como una regresión.
- **Idioma: español** (es-CL) en comentarios, docs, UI y mensajes de error de la
  API (`no_encontrado`, `payload_invalido`, `slug_duplicado`). Slugs y claves en
  ASCII sin acentos.
- **Estilo**: 2 espacios, comillas simples, punto y coma, ESM puro (`import`).
  Nada de CommonJS en `src/`.
- **Duplicación deliberada y verificada**: `normalizeText`/`slugify` existen en
  `server/src/text.mjs` y en `scraper/src/normalize.mjs` porque el servidor no
  puede depender del scraper. Un test cruzado
  (`scraper/test/helpers.mjs` re-exporta el del servidor) comprueba que ambas
  implementaciones coinciden: **si tocas una, toca la otra y corre los tests**.
- **Tests con el runner nativo** (`node:test` + `node:assert/strict`) en
  scraper y server; **vitest + Testing Library** en web. Los del server corren
  contra una base SQLite temporal sembrada con un dataset de ejemplo: no tocan
  la base real ni la red.
- **No inventes cifras.** `docs/README.md` trae las métricas del scrape
  (785 cartas, 211 fichas, 31 países, 1055 habilidades); se obtienen ejecutando
  `verifySeed()` o consultando la base, no estimando.

## Despliegue en Vercel

El catálogo corre en producción como **una función** con SQLite empaquetada y las
imágenes en Vercel Blob. El mantenedor **no** existe en producción.

```
GitHub vtuberdex/vtuberdex ─▶ vercel deploy ─▶ server.mjs (Node server)
                                                ├─ /api/*    → SQLite (readOnly, del bundle)
                                                ├─ /images/* → 301 a Vercel Blob
                                                └─ resto     → public/ (index) + CDN
```

```bash
npm install                      # deps de la RAÍZ: express + zod (las de la función)
npm run build                    # typecheck + build del front → public/, y los artefactos
npm run publish:images           # sube las imágenes a Blob (reanudable)
npm run verify                   # 25 comprobaciones sobre un árbol de solo lectura
npm run deploy                   # build + vercel deploy --prod
```

### Las reglas del deploy

1. **El FS de Vercel es de SOLO LECTURA** y `/tmp` no se comparte entre
   instancias. Nada de lo que la app necesita puede escribirse en runtime: por eso
   la base viaja como asset (`includeFiles` en `vercel.json`) y se abre con
   `readonly: true`.
2. **`express.static()` se IGNORA en Vercel.** El front lo reparte el CDN desde
   `public/**` (lo copia `scripts/vercel-build.mjs`). `app.mjs` conserva el
   middleware solo como respaldo local; en producción quien sirve el HTML es el CDN.
3. **La base NO puede quedar en `public/`** — sería descargable por HTTP. Vive en
   `deploy/data/` y solo entra al bundle de la función. El build falla si la
   detecta en `public/`.
4. **La base que se despliega va SANEADA**: `admin_user` y `audit_log` se vacían
   al construirla (`scripts/build-db.mjs`). En producción no hay sesiones, así que
   no se pierde ninguna función. Nunca edites `deploy/data/vtuberdex.db` a mano:
   se regenera.
5. **`server.mjs` (raíz) es el entrypoint**, no la carpeta `api/`: se usa el
   patrón de "Node server" con `app.listen()`. La razón es que **las reglas de
   rewrite de Vercel cambian la URL interna** y el router tendría que
   reconstruirla; así Express recibe la URL tal como la pidió el navegador.
6. **La URL de Blob se resuelve en runtime** (`VTUBERDEX_BLOB_BASE`); el
   manifiesto guarda rutas canónicas, no URLs, para que cambiar de store no
   obligue a recompilar.
7. **El deploy NO puede ser por integración Git**: el team es **Hobby** y Vercel
   no conecta repos de organizaciones en ese plan (limitación de plataforma). Se
   despliega con `vercel deploy`, o con un GitHub Action con token.
8. **`sharp` no está en las dependencias de la raíz a propósito**: solo lo usa la
   ruta de subida del mantenedor (`await import('sharp')`), que en producción no
   se ejerce. Añadirlo engordaría la función sin dar nada.

### Verificación del deploy

`npm run verify` monta un escenario con el árbol en **solo lectura** y sin
`data/images/`, arranca el MISMO `server.mjs` que despliega y pide rutas por HTTP.
Comprueba 25 cosas: catálogo (785 fichas, FTS5, facetas, detalle), imágenes
(redirect a Blob, 404 explícito en lo no publicado), seguridad (base saneada y no
descargable, rutas de admin en 401) y front (index, rutas profundas del SPA).

Dos trampas que ese script ya encontró y que conviene no reintroducir:
`res.sendFile` **falla en un FS de solo lectura** (daba 500 en `/v/:slug`, solo
en rutas profundas; se usa `readFileSync` + `res.send`), y comprobar el "leak" de
la base con un `status === 404` es un **falso positivo**, porque el fallback del
SPA responde 200 con el index a cualquier ruta; hay que mirar el contenido.

## Verificación antes de decir "listo"

1. `cd web && npm run typecheck && npm run build` (el build es el gate real).
2. `npm test` en el paquete que tocaste; si cambiaste el esquema o la búsqueda,
   corre también `server` y, si aplica, `scraper`.
3. Si tocaste la carta 3D o el shader, **no basta con que compile**: mira la
   carta renderizada (o al menos confirma que el fallback 2D responde) — los
   fallos de WebGL no aparecen en los tests, que corren sin WebGL a propósito
   (`web/src/test/setup.ts` anula `getContext`).
4. Si cambiaste el seed o el scraper, re-ejecuta `verifySeed()` y confirma
   `vtubers == expected == fts`: el proceso sale con código 2 si no cuadra.
