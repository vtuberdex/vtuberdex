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
  En Vercel corre Node 24, donde `node:sqlite` ya es estable.
- **La app es un solo paquete Next.js** en la raíz: **Next 16 (App Router)** +
  React 19 + Tailwind 4 + three.js/react-three-fiber. `scraper/` y `server/`
  siguen siendo paquetes npm independientes con su `node_modules`.
  `server/src/*.mjs` **no es un servidor Express separado en producción**: es la
  capa de datos que importan las rutas de Next (`search.mjs`, `validation.mjs`,
  `db/index.mjs`). Express solo queda para el mantenedor en local.
- Los datos crudos (`data/`, `scraper/out/`, `scraper/cache/`) están en
  `.gitignore`: son **reproducibles**, no se versionan. `deploy/data/` sí se
  versiona (ver «Despliegue en Vercel»).

```
scraper/ ──▶ scraper/out/dataset.json + data/images/ ──▶ server/seed.mjs ──▶ data/vtuberdex.db
                                                                                    │
                                                        scripts/build-db.mjs ──▶ deploy/data/ (al repo)
                                                                                    │
                                          app/ (rutas Next) ──▶ SQLite empaquetada + Vercel Blob
```

## Comandos

```bash
# Tests (desde la raíz)
npm test                   # 100 tests (vitest): utilidades, componentes, páginas
cd scraper && npm test     # 25 tests (node --test): parsers y normalización
cd server  && npm test     # 59 tests: búsqueda, facetas, API HTTP, mantenedor, migraciones

# Linter (raíz; cubre también server/ y scraper/)
npm run lint               # eslint . — falla con cualquier error
npm run lint:fix           # corrige lo corregible

# Gate real antes de dar algo por terminado
npm run lint && npm run typecheck && npm run build

# Puesta en marcha
cd scraper && npm install && npm run scrape      # reanudable: cachea el HTML
cd ../server && npm install && npm run seed && npm run admin -- admin <pass>
cd .. && npm install && npm run dev               # http://localhost:3000

# Atajos (desde la raíz)
./scripts/dev-up.sh          # Next dev + servidor del mantenedor (Express, local)
./scripts/dev-docker.sh      # publica ambos a la LAN (0.0.0.0) para revisar desde otro PC
./scripts/refresh.sh         # re-scrape completo (6 pasos) + re-seed + build

# Despliegue
npm run build:data           # regenera deploy/ (base saneada + manifiesto)
npm run publish:images       # sube las imágenes a Vercel Blob (reanudable)
npm run verify               # 32 comprobaciones sobre un escenario de producción
```

`docs/README.md` cita 15/32/57 tests: son cifras **viejas**. Las reales son
**25/59/100** (medidas; el CI corre las tres). Si añades tests, actualiza aquí.

## Arquitectura: las reglas que no se negocian

1. **El PERSONAJE es la única imagen fuente del VTuber.**
   `asset.kind = 'character'` → `data/images/character/<slug>.webp`, normalizado
   al lienzo de carta **720x1008 (proporción 1.4)**. Es lo que consumen la carta
   3D, el listado y la ficha. Nunca se deforma al encajarlo porque ya viene en la
   proporción correcta.
2. **Se publican SOLO tres carpetas de imagen: `character`, `logo`, `faction`.**
   Todo lo demás se retiró (ver «Imágenes: qué se publica y qué no»). No añadas
   carpetas al manifiesto sin comprobar antes que alguna vista las pide.
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
   (`lib/query.ts`); un resultado filtrado se comparte por enlace.
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
  negra. En `components/shaders.ts` se usa `halfSize`.
- **El límite de samplers del driver no lo ve NINGÚN gate.** El fragment shader
  llegó a 18 samplers contra un límite de 16 y el material no compilaba
  (`Implementation limit of 16 active fragment shader samplers exceeded`) mientras
  `typecheck`, `test` y `build` pasaban en verde: tsc lee el shader como una
  cadena, los tests corren sin WebGL a propósito (`test/setup.ts` anula
  `getContext`) y next build no compila GLSL. El único síntoma es la carta NEGRA y
  un error que sale solo en la consola del navegador. Al añadir un `sampler2D`
  nuevo hay que contar los declarados y quedarse por debajo de 16 — el refactor de
  7 capas dejó el presupuesto en 14. Un sampler declarado pero no leído lo elimina
  el compilador, así que la cifra que importa es la de samplers ACTIVOS del
  programa enlazado, no las líneas del fuente.
- **Ojo con `//` y backticks dentro de los comentarios GLSL**: el shader es un
  template literal de TypeScript, así que un backtick suelto cierra la cadena y
  `tsc` reporta el error en la línea SIGUIENTE (confuso). Y un bloque `/** ... */`
  al que le falte la apertura deja el texto suelto y rompe el GLSL con un error de
  sintaxis que solo aparece al compilar el shader de verdad, no en `tsc`.
- **El alfa de la CAPA es la silueta: el shader no puede ver la transparencia del
  arte combinado.** Las capas del refactor se dibujan aisladas y transparentes, así
  que `uLayer1.a` es exactamente 1 donde hay personaje y 0 donde no — de ahí sale la
  cobertura del fondo, sin textura de máscara aparte (antes viajaba
  `characterAlphaMask` como sampler propio y eso, sumado a los 7 de las capas,
  reventaba el límite de 16). Lo que NO se puede hacer es leer el alfa de una imagen
  ya compuesta: el degradado del color de tema se pintaba a sangre sobre todo el
  lienzo ANTES del arte, así que ahí la silueta no existe. El patrón del repo para
  las otras máscaras es calcularlas en CPU y pasarlas como su propia textura
  (`logoMask`, `inkAndSkinMask`). Medido sobre las 785 fichas: 9 son recortes
  reales, 155 abarcan todo el ancho, el resto tiene bandas laterales transparentes
  donde el fondo SÍ se ve.
- **Los shaders no tienen los valores, tienen la fórmula.** Todo lo ajustable
  (intensidades, pesos, geometría, luces) vive en `components/card3d-config.ts`,
  que es el archivo que se abre para tocar el efecto; el GLSL se genera desde ahí
  y `components/factions.test.ts` comprueba que las posiciones de facción salen de
  la config y no de literales sueltos. `npm run check:shaders` (encadenar al
  build) detecta uniforms sin declarar, uniforms declarados que nadie lee y
  uniforms creados en CPU que ningún shader consume — ninguno de los tres lo ve
  `tsc`. **Nada de backticks en los comentarios GLSL**: cierran el template
  literal y dejan el archivo con un error que `tsc` reporta en la línea SIGUIENTE.
- **Vite 7 rechaza un `Host` que no sea IP** (DNS rebinding): abrir la app por
  nombre de máquina da "Blocked request". Se resuelve con `allowedHosts` +
  `VTUBERDEX_ALLOWED_HOSTS` (`web/vite.config.ts`).
- **Combinar headers en el cliente de API, no reemplazarlos.**
  `fetch(headers: { authorization })` borraba el `content-type: application/json`
  y el PATCH fallaba con "expected object, received undefined".
- **`express.json` global está en 1 MB**: las subidas de imagen usan
  `express.raw` con su propio límite (12 MB) solo en esas rutas, y validan el
  tipo **por contenido** con `sharp`, nunca por extensión ni `Content-Type`.
- **`node scripts/x.mjs` es relativo al `cwd`.** Parado dentro de `scripts/`, anteponer
  `scripts/` otra vez busca `scripts/scripts/x.mjs` y Node lo reporta como
  `MODULE_NOT_FOUND` con una ruta que parece un archivo perdido (el archivo existe).
  Lánzalos con `npm run <tarea>` —npm sube solo hasta el `package.json`, así que da
  igual en qué subcarpeta estés— o desde la raíz del repo. `npm run admin:hash`
  (`scripts/admin-hash.mjs`) es el que produce `VTUBERDEX_ADMIN_PASSWORD_HASH` para
  Vercel: sin TTY lee la clave de una línea de stdin en vez de colgarse en un `await`
  que nunca resuelve (que Node reportaba como "unsettled top-level await").
- **Cambiar la contraseña del mantenedor son DOS pasos, no uno.** Vercel **hornea las
  variables por despliegue** ("changes to environment variables are not applied to previous
  deployments"): `vercel env add ... VTUBERDEX_ADMIN_PASSWORD_HASH production` guarda el hash
  pero el despliegue que ya estaba sirviendo sigue comparando contra el ANTERIOR, y el login
  responde el mismo `401 credenciales_invalidas` de una contraseña equivocada. Hay que
  **redeployar** (`vercel redeploy --target production`, o un `vercel deploy` nuevo) para que
  la función reciba el valor actualizado. `npm run admin:verificar` comprueba el resultado
  (login real + sesión en Turso) y, si hay 401, distingue "hash mal pegado" de "contraseña
  equivocada" leyendo el diagnóstico de FORMA que ahora devuelve el 401.
- **No marques `VTUBERDEX_ADMIN_PASSWORD_HASH` como *sensitive*.** El panel y
  `npx vercel env add` ofrecen *Sensitive*/**Secret** por defecto, y Vercel guarda esos valores
  en un **formato ilegible para siempre**: ni el CLI, ni `vercel env pull`, ni la API con
  `decrypt=true` dejan volver a leerlos (devuelven un placeholder o un sobre cifrado;
  comprobado). Un hash `scrypt` no es un secreto reutilizable —es irreversible y salado—, así
  que guárdalo como *encrypted*/**Config** (`--no-sensitive`): se puede releer para comparar y
  el fallo deja de ser indepurable. `formatoDeHash` (`lib/admin-auth.mjs`) solo puede
  describir la FORMA, nunca recuperar el valor.
- **`scripts/` no es `web/scripts/`**: `scripts/*.sh` es infraestructura del
  repo; `web/scripts/*.mjs` son sondas de desarrollo (medir tinte, volcar
  texturas, capturas). Las sondas y `screenshots.mjs` esperan un Chrome en
  `CHROME_PATH` (`/opt/data/cache/chrome/...`), que **en este contenedor no
  existe**: `npm run shots` falla aquí hasta que se baje el binario.
- **`npm run lint` YA FUNCIONA** (dejó de estar roto): ESLint 9 con config
  plana en `eslint.config.mjs`, porque Next 16 **eliminó `next lint`** y la
  config tiene que ser nuestra (ver
  `node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md`).
  Un solo `npx eslint .` cubre los CUATRO árboles del repo (front TS/TSX,
  `scripts/`, `server/` y `scraper/`), así que no hay un lint por paquete.
  Tres reglas de `react-hooks` v7 están **apagadas a propósito** — con el motivo
  escrito en la config — porque marcan como error cómo funciona three.js
  (`immutability` sobre los uniforms en `useFrame`), el patrón "latest callback
  ref" del debounce de `SearchBar` (`refs`) y la carga de datos por `useEffect`
  de todo el front (`set-state-in-effect`). `@next/next/no-img-element` también
  va apagada: `next.config.mjs` tiene `images: { unoptimized: true }` porque las
  imágenes salen de `/images/*` (Turso o disco), no de un dominio optimizable.
  Si algún día se apaga el modo `unoptimized`, esa regla debería volver.
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
  se probó y por qué se descartó (ver `holo-card.tsx`, `shaders.ts`,
  `uploads.mjs`). Respeta ese estilo; un cambio de comportamiento sin esa nota
  se lee como una regresión. **Los valores del efecto van en
  `components/card3d-config.ts`, no en los shaders ni en el componente**: si
  añades una perilla, va ahí con el comentario de por qué ese número.
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

La app es **Next.js con App Router** (Vercel la detecta como framework nativo). El
catálogo corre como funciones con SQLite empaquetada y las imágenes en Vercel
Blob. El mantenedor **no** existe en producción.

```
GitHub vtuberdex/vtuberdex ─▶ vercel build ─▶ app/ (Next)
                                               ├─ app/api/*              → SQLite (readOnly, del bundle)
                                               ├─ app/images/[...path]   → 301 a Vercel Blob
                                               ├─ app/api/admin/[...path]→ 404 en prod (solo local)
                                               └─ app/(dex)/*            → catálogo + detalle
```

```bash
npm install                      # deps del proyecto (root)
npm run build                    # next build (usa deploy/ ya construido)
npm run build:data               # regenera deploy/ desde data/ (local, tras scrape o edición)
npm run publish:images           # sube las imágenes a Blob (reanudable)
npm run verify                   # 32 comprobaciones sobre un escenario de producción
npx vercel deploy --prod         # publica
```

### Las reglas del deploy

1. **El FS de Vercel es de SOLO LECTURA** y `/tmp` no se comparte entre
   instancias. Nada de lo que la app necesita puede escribirse en runtime: por eso
   la base se abre con `readonly: true`. Verificado que SQLite consulta —FTS5
   incluido— sobre un filesystem inmutable.
2. **La base de datos viaja EMPAQUETADA en la función**, declarada en
   `outputFileTracingIncludes` (`next.config.mjs`). El trazador de Next no puede
   deducir una ruta que se lee con `fs`, así que sin esa declaración la función
   arranca sin catálogo. Comprobado: aparece en el `.nft.json` de 5 funciones.
3. **Las rutas de archivos se resuelven de forma ESTÁTICA.** Escribir
   `path.resolve(process.cwd(), x)` dentro de un bucle hace que Turbopack lo
   detecte como acceso dinámico y **trace el proyecto entero** dentro de cada
   función (aviso explícito del build). Las rutas se escriben literales.
4. **`deploy/data/` SÍ se versiona** (a diferencia del resto de datos generados):
   en Vercel no existe `data/`, así que la base saneada y el manifiesto tienen que
   estar en el repo. `next build` los reutiliza con `--if-missing`.
5. **La base que se despliega va SANEADA**: `admin_user` y `audit_log` se vacían,
   y después se hace **`VACUUM`**. Esto último no es opcional: `DELETE` deja los
   bytes en las páginas liberadas y el hash `scrypt` de la contraseña seguía
   siendo recuperable con `strings` del archivo que se publica. El build **falla**
   si detecta un hash, y hay una comprobación en `npm run verify`.
6. **La base NO puede quedar en `public/`** — sería descargable por HTTP. El
   verificador lo comprueba mirando el **contenido** de la respuesta, no el status:
   un `status === 404` da falso positivo porque el fallback responde el index.
7. **La URL de Blob se resuelve en runtime** (`VTUBERDEX_BLOB_BASE`); el
   manifiesto guarda rutas canónicas, no URLs, para que cambiar de store no obligue
   a recompilar.
8. **El mantenedor devuelve 404 en producción** (`app/api/admin/[...path]`). No es
   una degradación silenciosa: en Vercel el catálogo es de solo lectura, así que
   arrastrar `sharp` y subidas de 12 MB a una función que no puede escribir no
   aportaría nada. En local se reenvía al Express con `VTUBERDEX_ADMIN_URL`.
9. **El deploy NO puede ser por integración Git**: el team es **Hobby** y Vercel no
   conecta repos de organizaciones en ese plan (limitación de plataforma). Se
   despliega con `vercel deploy`, o con un GitHub Action con token.

### CI en GitHub Actions

El repositorio es **privado y de una organización en plan Hobby**, así que Vercel
no lo conecta por integración Git. Eso NO impide tener CI: `deploy.yml` ya
publicaba con un token, y **`ci.yml` valida sin necesitar ningún secreto**.

Dos workflows con trabajos distintos, a propósito:

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `ci.yml` | todo push (cualquier rama) y cada PR | lint, typecheck, check:shaders, las 3 suites, build y `verify` |
| `deploy.yml` | solo `master` | los mismos gates + `vercel deploy --prod` con el secret `VERCEL_TOKEN` |

```bash
npm run lint      # eslint . — cubre front, scripts, server y scraper
npm run verify    # 32 comprobaciones sobre next start real
```

Tres cosas del CI que no son obvias:

1. **Los tres paquetes se instalan** (`npm ci` en la raíz, en `server/` y en
   `scraper/`): los tests de server y scraper no corren sin su `node_modules`.
   El `lint` de la raíz sí los cubre a los tres en una sola pasada.
2. **`verify` funciona sin `data/`**, que no se versiona. `build-db.mjs` recibe
   `--if-missing` cuando no hay base de desarrollo y reutiliza el artefacto de
   `deploy/` —exactamente lo que hace el build de Vercel—, así que las 32
   comprobaciones se corren igual sobre la base que se despliega. Antes moría en
   el primer paso con "falta la base de origen".
3. **`next build` en CI y `next dev` en local no comparten `.next/`** (ver la
   trampa equivalente en «Desarrollo local»): en el runner son máquinas
   distintas, así que no hay conflicto, pero **aquí no lances `npm run build`
   con el dev server vivo** o la app se ve negra sin ningún error en los logs.

### Verificación del deploy

`npm run verify` monta un escenario **sin los datos crudos de desarrollo**, arranca
un `next start` real y pide rutas por HTTP. Son **32 comprobaciones**: catálogo (785
fichas, FTS5, facetas, detalle, validación 400), imágenes (301 a Blob, 404 en lo no
publicado, **carpetas retiradas**), seguridad (base saneada, no descargable,
mantenedor en 404) y front.

Trampas que ese script ya encontró y conviene no reintroducir:
`res.sendFile` **falla en un FS de solo lectura** (daba 500 en rutas profundas del
SPA), y el "leak" de la base hay que comprobarlo por contenido, no por status.

## Imágenes: qué se publica y qué no

Publican **cuatro carpetas**: las tres primeras las produce el scraper y viajan
siempre; `background` es nueva y viaja **vacía** por defecto. La decisión es por
uso real verificado en el front, no por lo que exista en disco:

| Carpeta | Estado | Por qué |
|---|---|---|
| `character` | ✅ publicado | La imagen fuente del VTuber |
| `logo` | ✅ publicado | Capa superior de la carta |
| `faction` | ✅ publicado | Emblema que la carta superpone como holograma |
| `background` | ✅ publicado (vacía) | Capa POR DETRÁS del personaje, con holograma y paralaje propios. **El scraper NO la produce**: solo se llena si alguien sube una desde el mantenedor |
| `thumb` | ❌ eliminado | Ninguna vista la pedía (18 MB) |
| `avatar` | ❌ eliminado | Duplicado legacy de `character` (13 MB) |
| `ficha` | ❌ eliminado | Respaldo de `character`; hoy los 785 lo tienen (33 MB) |
| `radar` | ❌ eliminado | Gráfico de atributos **dibujado desde los datos** por `StatBars` en la misma página (8 MB) |
| `card` | ❌ eliminada | Vacía desde siempre |

`data/images/` pasó de **143 MB a 73 MB**; el manifiesto publica **1593** objetos
(785 + 785 + 23) mientras nadie suba un fondo. Las rutas de las carpetas retiradas
responden **404 explícito**, comprobado en `npm run verify`.

**Ojo:** los tipos `card`/`thumb`/`radar` siguen en el contrato de la API y en el
esquema de la base (el `seed` los sigue escribiendo); lo que se retiró es su
publicación. Si vuelves a necesitarlos, hay que reponer la carpeta en disco,
añadirla a `USED_FOLDERS` de `scripts/build-db.mjs` y republicar.

## Verificación antes de decir "listo"

1. `npm run lint && npm run typecheck && npm run build` (el build es el gate real).
2. `npm test` en el paquete que tocaste; si cambiaste el esquema o la búsqueda,
   corre también `server` y, si aplica, `scraper`.
3. Si tocaste la carta 3D o el shader, **no basta con que compile**: mira la
   carta renderizada (o al menos confirma que el fallback 2D responde) — los
   fallos de WebGL no aparecen en los tests, que corren sin WebGL a propósito
   (`test/setup.ts` anula `getContext`).
4. Si cambiaste el seed o el scraper, re-ejecuta `verifySeed()` y confirma
   `vtubers == expected == fts`: el proceso sale con código 2 si no cuadra.
5. Si tocaste el manifiesto de imágenes, `npm run verify` comprueba que las
   carpetas retiradas dan 404 y que el conteo declarado coincide con lo subido.

## Desarrollo local (lo que ya costó tiempo)

`./scripts/dev-up.sh` levanta **dos** procesos y los dos hacen falta:

| Puerto | Qué | Por qué |
|---|---|---|
| 3000 | la app Next | catálogo, API de lectura, imágenes |
| 4000 | `server/src/index.mjs` (Express) | el mantenedor: es el ÚNICO que escribe |

Next reenvía `/api/admin/*` al Express con `VTUBERDEX_ADMIN_URL`. Si esa variable
no está, la página `/admin` carga pero cada llamada da **404** — el mismo
comportamiento que en producción, y lo que comprueba `npm run verify`.

Cuatro trampas concretas de trabajar en local:

1. **`VTUBERDEX_DB` es obligatoria y las dos bases NO pueden separarse.**
   `lib/db.mjs` cae por defecto en `deploy/data/vtuberdex.db` (la base EMPAQUETADA,
   correcta para la función serverless) mientras el Express escribe en
   `data/vtuberdex.db`. Si se levanta Next a mano sin esa variable, **los dos
   procesos leen bases distintas**: lo que se sube o edita en el mantenedor no
   aparece en la app —imágenes recién subidas que dan 404 y `background: null`—
   porque Next consulta otra base. `dev-up.sh` la fija para los dos; al arrancar
   a mano, hay que exportarla en AMBOS lados.
   **No "arreglar" esto apuntando el mantenedor a `deploy/`**: esa base está
   saneada (`admin_user` y `audit_log` VACÍOS a propósito, para no publicar el
   hash) y está versionada, así que el login sería imposible y cada subida
   ensuciaría el repo con un binario de ~60 MB.
2. **Sin `VTUBERDEX_BLOB_BASE`, las imágenes se sirven de `data/images/`**
   (rama local de `app/images/[...path]/route.js`). Antes esa ruta devolvía
   `null` y la app entera salía sin una sola imagen, difícil de diagnosticar.
   En local el **disco es la fuente de verdad** (sin exigir que el archivo esté
   en el manifiesto, que solo se regenera con `npm run build:data`): sin eso, una
   imagen recién subida daba 404 con el archivo ya en disco. El manifiesto manda
   en PRODUCCIÓN, que es la rama que cubre `npm run verify`.
3. **Nada de `window`/`localStorage` durante el render.** Un componente
   `'use client'` se renderiza igualmente en el servidor: acceder ahí daba
   `ReferenceError: window is not defined` y la página respondía **500**. El
   token del mantenedor se lee en un `useEffect`.
4. **`next build` y `next dev` NO pueden compartir `.next/`.** El build deja su
   `BUILD_ID` dentro de `.next/`, y un dev server arrancado encima escribe en el mismo
   directorio: quedan las dos salidas mezcladas (`BUILD_ID` **y** `dev/`). El síntoma es
   que la app **se ve negra / las fichas no cargan** aunque los puertos respondan 200 y
   el log del servidor no marque ni un error — parece un fallo del shader y no lo es.
   Ya pasó **tres veces**; dos de ellas el culpable fue correr los gates mientras el dev
   server del usuario estaba vivo.
   - **Antes de `npm run build` o `npm run verify`, para el dev server.**
   - Para diagnosticarlo: `ls .next/BUILD_ID` (si existe con un dev server corriendo,
     está mezclado) y `ls -d .next/dev`.
   - El arreglo es `rm -rf .next` y arrancar en frío. No hay que tocar el shader.
   - Es un síntoma que **no** distingue el navegador del usuario: él ve el canvas negro
     y no hay nada en los logs. Antes de buscar la causa en el GLSL, descarta esto.
5. **Next 16 mantiene un bloque gestionado en `AGENTS.md`** (entre
   `<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->`, al
   final). Es inofensivo: se **añade** y todo lo escrito fuera de los marcadores
   se **preserva**. No lo borres de un diff sin querer — `next dev` lo vuelve a
   crear; commitearlo con el resto deja el árbol limpio.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
