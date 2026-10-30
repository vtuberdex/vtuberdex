# VTuberDex — notas para agentes

Reconstrucción de `vtuberdex.com` (una "pokédex" plana de 785 fichas en un solo
HTML, sin backend) como aplicación propia: scrape único → SQLite → API → React
con carta holográfica 3D. **Sin dependencias nativas** (nada que compilar:
`node:sqlite` viene con Node) y con **un servicio externo: Turso**, donde viven
las ediciones del mantenedor y las imágenes publicadas (ver «Lecturas externas»).
El catálogo no depende de él: si Turso no está, la app sirve el bundle igual.

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
                                          app/ (rutas Next) ──▶ SQLite empaquetada
                                                             └─▶ Turso (ediciones + imágenes)
```

## Comandos

```bash
# Node/npm NO están en el PATH por defecto: antes de cualquier comando npm
#   export PATH=/home/madkoding/.nvm/versions/node/v22.23.3/bin:$PATH

# Tests (desde la raíz)
npm test                   # 997 tests (vitest): utilidades, componentes, páginas, carta 3D, libro
cd scraper && npm test     # 25 tests (node --test): parsers y normalización
cd server  && npm test     # 154 tests: búsqueda, facetas, API HTTP, mantenedor, migraciones, habilidades

# Linter (raíz; cubre también server/ y scraper/)
npm run lint               # eslint . — falla con cualquier error
npm run lint:fix           # corrige lo corregible

# Gate real antes de dar algo por terminado
npm run lint && npm run typecheck && npm run check:shaders && npm run build

# Medición (informan; no tocan nada)
npm run probe:timings      # piso de SQLite local, sin red — el "cuánto debería costar"
npm run bench:ediciones    # A/B del camino de Turso contra el de HEAD (stub, sin credenciales)
npm run sweep:dead-code    # exports sin consumidores (informa, no borra)
npm run informe:habilidades  # reglas del kit de habilidades rotas, por ficha (--slug, --codigo, --json)

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
npm run publish:images       # sube las imágenes a Turso (reanudable)
npm run download:images      # BAJA lo que solo está en Turso a data/mantenedor/ (respaldo + local)
npm run verify               # 32 comprobaciones sobre un escenario de producción
```

`docs/README.md` es el documento humano y cita cifras **viejas** (100 tests, Blob):
las reales son **25/94/451** (medidas; el CI corre las tres) y las imágenes viven en
Turso. Si añades tests, actualiza **los dos** archivos.

## Etiquetas, autodeploy y carga del token (información de la sesión)

- **Etiqueta de release actual: `v1.0.0`** en los repositorios de VtuberDex. Para listar las etiquetas de origin: `git ls-remote --tags origin 'refs/tags/v*'`, que requiere cargar el token (ver abajo).
- **Autodeploy**: `vtuberdex-autodeploy` (`/usr/local/sbin/vtuberdex-autodeploy`) vive FUERA del repositorio y no se versiona aquí. Sigue la etiqueta más alta de origin ordenando con `sort -V`. Modo seco: `VTD_AUTO_DRY=1` con `VTD_ESTADO` apuntando a un directorio temporal.
- **Carga del token** (`GITHUB_TOKEN`) antes de `git` contra GitHub o `gh`: `eval "$(grep -m1 '^export GITHUB_TOKEN=' /home/madkoding/.profile)"`. Nunca imprimir su valor.
- **Remotos (específico de esta sesión)**: en este entorno `vtuberdex` usa HTTPS y funciona. Los remotos `vtuberdex-*` deben usar HTTPS con `GITHUB_TOKEN`; SSH falla con publickey aquí.
- **Rama principal: `main`** en vtuberdex y en los demás repositorios. `master` no existe en origin.
- **Pushes**: el push directo falla y los cambios entran solo por PR.
- **Tiempos medidos**: `npm test` tarda unos 50 a 70 s (91 ficheros, 1045 tests); `npm run lint` es rápido. En `vtuberdex-minecraft`, `./gradlew build --rerun-tasks` tarda unos 10 a 14 s y ejecuta 45 tests en 12 XML bajo `build/test-results/test`; con las tareas UP-TO-DATE tarda unos 1 a 2 s.

## Publicación de cambios (regla operativa)

Este proyecto está clonado en la **misma máquina donde se ejecuta**, así que lo que
hay en disco es lo que corre. Por eso **cada cambio hecho debe publicarse** al
terminar: commit (mensaje semántico `tipo(ámbito): descripción`) y `git push` al
remoto de la rama en la que se trabaja. En Vercel el push dispara el despliegue.

- Se publica **solo tras pasar el gate**: `npm run lint && npm run typecheck && npm test`.
  Si algo falla, se arregla antes de publicar; nunca se publica en rojo.
- El commit contiene únicamente los archivos del cambio; no se tocan scripts ni
  `package.json` para publicar.
- Tras el push se verifica con `git status` y `git log -1` que quedó publicado.

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
7. **Un solo canvas WebGL por pantalla.** El catálogo es un LIBRO
   (`components/card-binder.tsx`): las 8 cartas de la página son mallas de UNA escena
   (dos hojas de 4 fundas, la hoja gira al pasar de página); el detalle tiene su
   propia carta. Nunca un canvas por carta: 8 contextos con su renderer, PMREM y
   framebuffers cada uno fue lo que disparó la memoria, y el navegador destruye
   contextos al pasar de 16. Lo que pinta una carta (texturas, uniforms, materiales)
   está UNA vez en `card-material.ts` (`useCardMaterials`) y lo consumen las dos
   escenas; `check:shaders` lee ese archivo para cruzar los uniforms con el GLSL.
8. **El color del dato manda.** `THEME` de cada ficha alimenta la paleta
   (acento, secundario, fondo, tinta) de cartas, chips y bordes.

## Lecturas externas: Turso (ediciones e imágenes)

`lib/ediciones.mjs` es la ÚNICA parte asíncrona del camino de lectura: el catálogo
sigue saliendo de SQLite síncrono (`search.mjs`, sin `await`) y las ediciones del
mantenedor se aplican ENCIMA. Sin `TURSO_DATABASE_URL` todo devuelve vacío y la app
se comporta como antes (es lo que hace que local y CI no necesiten cuenta ni red).

- **Nada de `await` dentro de un bucle POR ELEMENTO.** Medido: preguntar tipo por
  tipo para cada carta (3 viajes) más el DDL en cada lectura daba **292 peticiones**
  a Turso para pintar una página de 24 cartas, y 1.204 con 100. El síntoma que lo
  delata es que la latencia escalaba LINEAL (~14 ms por carta) mientras el catálogo
  local resuelve esas 24 fichas en **2,2 ms** (`npm run probe:timings`). Si una
  consulta local es de milisegundos y la ruta tarda cientos, el coste viaja por la red.
- **Una consulta para toda la página**, no una por carta:
  `WHERE origen = ? AND slug IN (?,...) AND kind IN (...)` (placeholders: un slug
  llega de la URL) y **sin la columna `bytes`** — cada fila de asset lleva una
  imagen entera y aquí solo se quieren metadatos. El camino de UNA ficha es el caso
  N=1 de la misma función, así que la consulta y el mapeo de filas tienen una sola
  definición (`reemplazosDePagina` / `aplicarReemplazosALista`).
- **El DDL se memoiza como PROMESA a nivel de módulo** (`asegurarTablas`), no como
  resultado: dos peticiones concurrentes en una instancia fría comparten el trabajo.
  Y **si falla se suelta el memo** — cachear el rechazo dejaría todas las lecturas
  siguientes rotas hasta reciclar la instancia.
- **Este coste no lo ve ningún gate.** `lint`, `typecheck`, `build` y las 127
  pruebas pasaban con las 292 consultas: el comportamiento era CORRECTO, solo
  multiplicado por 146. `lib/lecturas-turso.test.ts` fija el **NÚMERO de consultas**
  con un cliente falso (la suite corre en CI sin credenciales), no la forma de la
  respuesta.
- **Las credenciales de producción NO se pueden releer para medir.** Marcadas
  _sensitive_ en Vercel devuelven vacío incluso con `decrypt=true` (comprobado con la
  API; las de _development_ sí salen, pero su valor puede ser un JWT y no la URL del
  servicio). Plan B que sí mide, y es el que usa `npm run bench:ediciones`: un **stub
  del protocolo** —`@libsql/client` habla Hrana v2 en `/v2/pipeline` con JSON—
  respaldado por SQLite, comparando el módulo actual contra `git show HEAD:lib/ediciones.mjs`
  en un temporal con el mismo cliente. Con `--delay N` por petición se reproduce la
  latencia de red: el modelo cuadró con producción (292 × 2,8 ms ≈ 817 ms frente a
  los 824 ms medidos).

Resultado del arreglo, medido en producción tras desplegar: `perPage=1/24/48/100` →
**0,33 s planos** (antes 0,417 / 0,824 / 1,138 / 1,854 s). El detalle completo, con
la tabla de antes y después, está en `docs/optimizacion-turso.md`.

## El mantenedor edita TODO: diario de cambios (Turso) y reglas compartidas

- **Una sola definición de las reglas**: `server/src/mutations.mjs` (editar, crear, facciones,
  número de dex, slug). El Express local y la producción llaman a las mismas funciones; no
  dupliques reglas en las rutas.
- **Producción no escribe SQLite**: cada cambio es una OPERACIÓN en la tabla `cambio` de Turso
  (`lib/diario.mjs`). Para leer, la instancia copia la base empaquetada a `/tmp`, reproduce el
  diario (primero la tabla `edicion` antigua, luego `cambio`) y abre esa copia: así el SQL
  (FTS, facetas, orden, paginación) ve el número de dex, las facciones y las cartas nuevas. Cuesta
  UNA consulta a Turso por petición (la «clave» del diario), no una por carta. Las cartas y
  facciones creadas llevan id explícito en la operación (`ID_BASE_*`) para que cada instancia las
  cree igual. Las rutas públicas y de admin usan `await dbConDiario()`, no `getDb()`.
- **Facciones: catálogo cerrado de 22, máximo 2 por VTuber.** `buscarFaccion` NO crea: se dan de
  alta/renombran/fusionan desde el mantenedor. `FACCION_ALIAS` funde las variantes con errata del
  scrape (`Netherbane2`, `Mythical Lecagy`…); lo aplican el seed y la migración
  `2026-10-facciones-canonicas`. Las fichas con 3-4 facciones quedaron recortadas a las 2 primeras.
- **El nombre ya NO cambia la URL**: el `slug` es un campo propio; el anterior queda en
  `slug_alias` y sigue resolviendo (el detalle redirige). Las imágenes subidas desde el mantenedor
  se mudan con el slug (`renombrarAssetsDelMantenedor`).
- **Número de dex**: debe estar LIBRE (409 `dex_ocupado`); `'end'` = el siguiente al último. No
  se intercambia: se mueve primero a quien lo tiene.
- **Emblemas**: `POST /api/admin/factions/:id/image` (PNG). El cliente convierte a PNG ≤512 px
  (`lib/imagen-cliente.ts`; en producción no hay sharp) y la facción apunta a
  `images/faction/<slug>.png?v=<ms>` (la ruta es canónica: sin `?v` el navegador sigue con el viejo).
- **Mantenedor guiado**: un solo asistente de 6 pasos (`components/admin/card-wizard.tsx`) sirve para
  crear y editar fichas; las facciones tienen su propio asistente y pestaña «Emblemas y facciones».
- **Cartas nuevas nacen en borrador**; el listado del mantenedor (`/api/admin/vtubers`) incluye
  borradores y ocultos (la ruta pública no).
- **Carta 3D**: los emblemas de facción van en la cabecera, a la derecha del nombre, sobre un
  engarce oscuro que pinta `capa-titulo.ts` (geometría única en `card-texture/dimensiones.ts`,
  de donde sale `FACTION.slots`). El «fondo rojo/oscuro que no se veía» eran DOS fallos: el color
  secundario escrito como NOMBRE (`Rojo`, `Naranja`; 211 fichas) caía al cian de respaldo y teñía
  el degradado (`colorDesdeNombre` en `lib/color.ts`), y el arcoíris sumado como luz cambiaba el
  matiz de superficies saturadas u oscuras (`HUE_PROTECT` + `protegerMatiz` en el shader).
  Además el foil del fondo se tiñe del **color predominante** de la superficie
  (`card-texture/predominante.ts`, perilla `DOMINANT.mix` = 70 %): se calcula en CPU por matiz (no
  promedio: rojo+azul no dan morado), ignora grises y su `amount` baja a 0 en fondos grises o
  multicolor, donde queda el arcoíris completo. **El emblema va FIJO y centrado en su
  engarce**: el shader lo muestrea con el MISMO paralaje que la capa del título
  (`parallax * uParallaxFactors[3]`), porque con un paralaje propio se despegaba del cuadrado
  al mover el puntero; lo encaja «contain» con la proporción real del PNG (`uFactionAspect`,
  que `card-material.ts` saca de la imagen) en vez de estirarlo; y no late: la intensidad es
  constante (`FACTION.maskBase`) con un leve realce por inclinación y glare. `factions.test.ts`
  fija las tres cosas sobre el GLSL generado. **El emblema se COMPONE (mix) con su color sobre el
  engarce, no se suma como luz**: la suma con umbral de brillo ancho lo dejaba en un trazo binario
  sobreexpuesto con ruido iridiscente y sin los grises del interior; hoy solo se descarta el negro
  casi puro (`strokeLow/High`), el tinte del arcoíris es leve (`tintSpectrumMix`) y el UV se acota
  (sin `continue` antes de muestrear: derivadas indefinidas = ruido en el borde). El engarce mide
  100 px del lienzo (`FACTION_SOCKET`) para que el detalle se alcance a ver.

## Inscripción, baja y términos: formularios públicos con cola de revisión

Cuatro páginas públicas (`/inscripcion`, `/modificacion`, `/baja`, `/terminos`, con enlaces en el menú lateral, `components/side-menu.tsx`) y una
pestaña «Solicitudes» en el mantenedor. **Nada se publica solo**: cada envío es una fila `pendiente` de la tabla
`solicitud` hasta que el mantenedor la resuelve.

- **Las reglas viven UNA vez** en `server/src/solicitudes.mjs` (JS puro; recibe un EJECUTOR `{ execute, exec }` con la
  forma del cliente de Turso). `lib/solicitudes.mjs` elige el ejecutor del entorno igual que los likes: Turso en
  producción, `data/solicitudes.db` sin él; el Express local abre el MISMO archivo junto a la base. No van al diario de
  cambios: son una cola de entrada, no ediciones del catálogo.
- **Términos obligatorios, comprobados en el servidor** (`aceptaTerminos: z.literal(true)`), no solo con `required` de
  HTML. Cada solicitud guarda `terminos_version` y la fecha de aceptación. Si cambias el texto de `lib/terminos.ts`,
  **sube `TERMINOS_VERSION`** (`server/src/terminos-version.mjs`, sin imports para que el cliente no arrastre
  `node:crypto`): los formularios abiertos con la versión vieja se rechazan con `terminos_desactualizados`.
- **Confidencialidad por estructura**: el correo y el nombre civil van en la columna `contacto`; la ficha que nace de una
  inscripción aprobada (`fichaDesdeInscripcion`) solo lee `datos`, así que no puede copiarlos. El contacto se borra al
  rechazar o procesar; se conserva en una inscripción aprobada. De la red solo se guarda un hash.
- **Aprobar crea la ficha en BORRADOR** por el camino de siempre (`vtuber.crear` del diario en producción, `crearFicha` en
  el Express). Si la ficha no se puede crear (URL repetida, país desconocido) la solicitud sigue pendiente.
- **«Procesar» una baja NO degrada la ficha**: solo cierra la solicitud. La degradación de la cláusula de salida es un
  paso manual aparte (no está automatizada) y el mantenedor lo avisa.
- **La inscripción valida PASO A PASO con lista de faltantes** (`validar-inscripcion.ts`, función pura `faltasDelPaso`; el formulario va
  `noValidate`): la burbuja nativa señalaba un solo campo y no cubría idiomas, redes ni términos, que solo fallaban con un 400 al final.
  Al pulsar «Siguiente» (o «Enviar») con algo sin completar NO se avanza: sale la lista completa del paso (cada ítem lleva el foco a su
  campo), los campos quedan en rojo (`aria-invalid`) y la lista se recalcula al corregir. El botón de enviar ya NO se deshabilita sin
  términos (un botón apagado sin explicación era justo el problema). Mantén `validar-inscripcion.ts` igual a `inscripcionSchema`.
- **Botón «Inscribir mi ficha» en la cabecera** (`app-header.tsx`, relleno y siempre visible) y página **`/minecraft`** (guía para entrar al
  servidor, `components/minecraft/`, textos en `lib/i18n/textos/minecraft.ts`, enlazada en cabecera `md+`, pie y sitemap). Si cambia el flujo
  del plugin (`/vtd email`, `/vtd codigo`, puertos), actualiza ese texto.
- **La inscripción es un formulario de 5 pasos** (`inscripcion-form.tsx`; el estado vive en el padre, así que «Volver» no pierde nada y la
  validación nativa `required` de cada paso corre antes de avanzar): 1) nombre artístico y correo, 2) código del correo, 3) tu ficha
  (color, idiomas, frase, redes), 4) tu personaje (avatar y logo SUBIDOS, modelo, hashtag, estatura, cumpleaños, país, signo, lore), 5) gustos + términos. Obligatorios todos salvo país y signo. Los textos cortos
  salen de `CAMPOS_PERFIL` (cliente) y `perfilObligatorio` (`solicitudes.mjs`): al añadir uno, tócalos a la vez (y `sanearBorrador` los toma de
  `PERFIL_CAMPOS`, así que el borrador los sigue solo). `fichaDesdeInscripcion`
  mapea estatura/cumpleaños/hashtag/color a sus columnas, el modelador a `artists` y el resto a filas de `profile`.
- **Modificación de una ficha ya registrada** (4 pasos: correo → código → qué cambiar → gustos y envío; la ficha sale del correo, ver más abajo; `/modificacion`, `components/solicitudes/modificacion-form.tsx`, tipo `modificacion`
  en la MISMA cola y tabla): misma forma que la inscripción pero solo identifica el correo (verificado antes de rellenar; la ficha sale de él: la de la inscripción
  aprobada con ese correo, se elige si hay varias y se escribe solo si no hay ninguna, como en las del scrape; ya no hay «cómo comprobamos») y todo lo demás es opcional (en blanco = no cambia; el servidor exige al menos un cambio). Las preguntas
  salen de `campos-ficha.ts`, compartido con la inscripción. **Aprobar APLICA** el parche a la ficha existente
  (`server/src/modificacion.mjs`, `prepararModificacion`: lo comparten Express y Next; local escribe con `aplicarParche`, producción
  con `vtuber.editar` del diario, leyendo la ficha del diario ya reproducido): las redes se SUMAN o actualizan por plataforma, los
  gustos actualizan su fila de `profile` sin tocar las demás, el modelador pasa al frente de `artists` sin quitar a nadie. El nombre
  no se cambia por aquí. **Avatar y logo (subidos) se aplican al aprobar** y REEMPLAZAN a los actuales (ver «Imágenes subidas desde los formularios»). Si la
  ficha no se resuelve (nombre ambiguo o inexistente) la solicitud sigue pendiente con `ficha_no_encontrada`.
- **La cola del mantenedor** (`admin/solicitudes-manager.tsx`) es lista + detalle, no una tarjeta por solicitud con 30 campos en
  un muro de texto. La lista es una línea por solicitud (tipo, nombre, «hace 5 min»), la más antigua primero (la cola se atiende en
  orden); el detalle agrupa por secciones. **Antes de aprobar se sabe qué pasará**: `GET /api/admin/solicitudes/:id/vista-previa`
  (`server/src/solicitud-vista.mjs`) calcula, SIN escribir, si se puede, qué ficha afecta y, en una modificación, **qué cambia
  (antes → después)**. La simulación ejecuta las mismas `crearFicha`/`aplicarParche` que aprobar dentro de un `BEGIN … ROLLBACK`
  (node:sqlite es síncrono: nada más usa la conexión en medio), así que «la regla lo rechaza» sale idéntico en ambos sitios. Si la ficha
  de una modificación no se resuelve, el mantenedor la ELIGE (candidatas o búsqueda) y el resolver acepta `fichaSlug`. «Aprobar» queda
  deshabilitado mientras se comprueba o si la regla lo rechaza; rechazar pide confirmación (borra el contacto). La vista previa solo
  existe en la ruta de Next: el Express local no la tiene y la pantalla degrada (botón habilitado, datos crudos).
- **La ficha de una modificación se escribe a mano** (campo libre) y la gente copia `#486 NOMBRE` del catálogo: `fichaDeLaSolicitud`
  acepta ese formato (el número desempata, nunca manda sobre un nombre que coincide con otra ficha). Antes quedaba atascada con
  `ficha_no_encontrada`.
- **Antispam**: campo trampa `website`, un solo pendiente por correo y tipo, tope de 5 envíos por red y día.
- **Imágenes subidas desde los formularios** (`server/src/imagenes-solicitud.mjs`, `components/solicitudes/subida-imagen.tsx`,
  `POST/GET /api/{inscripciones,modificaciones}/imagen`). Antes el avatar y el logo eran ENLACES porque un formulario público que recibe
  archivos es una puerta a subir basura; se cambió a subida con estas defensas, TODAS en el servidor:
  · **Solo WebP y solo bytes que el servidor pueda verificar**: en producción no hay `sharp`, así que el navegador decodifica y reexporta la
    imagen a un lienzo (`normalizarImagenDeSolicitud` en `lib/imagen-cliente.ts`: personaje 720x1008 `cover` anclado arriba, logo ≤ 900 px con
    alfa) y el servidor recorre el contenedor RIFF (`validarWebp`): tamaño declarado = real (nada pegado al final), solo trozos
    `VP8 `/`VP8L`/`VP8X`/`ALPH`/`ICCP`, una sola imagen, sin animación, EXIF ni XMP. Medidas EXACTAS (personaje) o 64-900 px (logo), ≤ 900 KB
    (nginx corta en 1 MB). Validado también contra un WebP real de `sharp` (`server/test/api.test.mjs`).
  · **Se exige la credencial del formulario** (`x-credencial`: la `sesion` o el `permiso`, MIRADA sin gastarla): sin correo verificado no se
    sube. El correo sale de la credencial y en la tabla solo queda una huella (`huellaDeCorreo`). Una imagen por tipo y correo (subir otra
    reemplaza), 12 subidas por correo y 30 por red al día. La vista previa solo la ve quien la subió (404 igual si es de otra persona).
  · **El formulario lleva IDs** (`imageId`/`logoId`), no bytes; `crearSolicitud` comprueba que son de ese correo, del tipo y sin usar.
    Inscripción: obligatorias; modificación: opcionales. El borrador guarda solo el id (`sanearBorrador`); si la imagen caducó, el
    componente lo detecta y pide subirla de nuevo.
  · **Nada se queda si no se aprueba** (`LIMITES`, `purgarCaducadas`, sin trabajo programado: se llama al subir y al listar la cola): 24 h
    sin enviar, 30 días en una solicitud pendiente, 7 días en una ya resuelta, y se borran de inmediato al RECHAZAR.
  · **Aprobar las aplica**: `aplicarImagenesDeSolicitud` las copia a la ficha (producción: `guardarAssetDelMantenedor`, origen
    `mantenedor`; Express local: `saveUploadedImage` con `sharp` + `registrarAsset`) y borra las copiadas. Si una falla NO se rompe la
    aprobación: `imagenes.fallidas` en la respuesta, el mantenedor la sube a mano desde «Imágenes». En una MODIFICACIÓN reemplazan a las
    actuales (la vista previa lo avisa). El mantenedor las ve antes (`ImagenesSubidas`, `GET /api/admin/solicitudes/:id/imagenes[|imagen/:tipo]`).
  · Las solicitudes antiguas con enlaces (`imageUrl`/`logoUrl`) siguen mostrándose en la cola; el esquema nuevo ya no los acepta.
  · Términos 4.12, 19.4 y 20.5 (`TERMINOS_VERSION` 2026-10-20b).
- `/api/admin/solicitudes*` sale 404 sin Turso ni proxy local, como el resto del mantenedor.
- **Registro de rechazos** (`server/src/rechazos.mjs`, tabla `rechazo` en el MISMO ejecutor que `solicitud`): una validación que
  falla responde 400/409/410 y antes no dejaba rastro (solo los 503 se imprimían), así que nadie sabía dónde se atascaba la gente.
  `lib/solicitudes.mjs` (`responderRegistrando`) apunta todo 4xx/503 de los formularios públicos: **formulario, código, status y ruta del
  campo** (`socials.0.url`). **Nunca** correo, contenido, red ni mensaje (puede citar lo escrito); se poda a los 30 días y no lanza jamás.
  Se ve en el mantenedor, «Envíos rechazados (últimos 7 días)» (`GET /api/admin/solicitudes/rechazos?dias=`, Next y Express). Si añades
  un formulario público, estrénalo con `responderRegistrando`.

## Correo saliente, verificación de solicitudes y acceso por enlace mágico

**Diseño de los correos**: una sola plantilla (`plantilla()` en `lib/correo.mjs`) con el sistema de diseño de la web
(`docs/sistema-de-diseno.md`, tokens en `lib/diseno.mjs`). Un color nuevo va primero en `diseno.mjs`; `lib/diseno.test.ts` lo cruza con
`globals.css` y rechaza cualquier hexadecimal del correo que no sea un token.

La VPS envía correo con su propio **Exim4**, configurado como servidor SOLO DE SALIDA: escucha únicamente en
`127.0.0.1:25` (no es accesible desde internet, no recibe correo), `disable_ipv6 = true` (el SPF declara solo la IPv4) y firma
con DKIM (`/etc/exim4/dkim/vtuberdex.com.key`, selector `mail`; macros en `conf.d/main/00_local_macros`). La app le habla por
SMTP local con nodemailer (`lib/correo.mjs`). Sin `VTUBERDEX_MAIL=smtp` el correo NO sale: el enlace se imprime en la consola del
servidor (así local y CI funcionan sin servidor de correo). Variables: `VTUBERDEX_MAIL`, `VTUBERDEX_MAIL_FROM`,
`VTUBERDEX_MAIL_REPLY_TO`, `VTUBERDEX_ADMIN_EMAILS` (por defecto los dos mantenedores). DNS necesario (Cloudflare): SPF, DKIM
(`mail._domainkey`) y DMARC; sin ellos Gmail marca el correo como spam o lo rechaza.

- **Tokens** (`server/src/verificacion.mjs`, tabla `token_correo` en el MISMO ejecutor que `solicitud`): un solo uso (`UPDATE …
WHERE usado = 0 AND expira > ahora` es el cerrojo), 24 h para solicitudes y 15 min para acceso, **solo se guarda el sha256**. El
  enlace lleva el token en el **fragmento** (`/verificar#t=…`, `/admin#entrar=…`): no llega a nginx ni a los logs. Y se gasta con un
  **botón (POST)**, no al abrir el enlace: antivirus y clientes de correo abren los enlaces y lo quemarían. La URL sale de
  `SITE_URL`, nunca de la cabecera `Host`.
- **Dos formas de demostrar el correo**:
  · **Inscripción y actualización: el correo se demuestra ANTES de rellenar** (`pedirCodigo` / `verificarCodigo` en `lib/solicitudes.mjs`,
  rutas `/api/inscripciones|modificaciones/codigo|verificar`). Se manda un CÓDIGO (1 h, un uso; el enlace del correo abre el formulario en el
  paso 2 con el código puesto, `/inscripcion#t=…`) y se canjea por una credencial que vive solo en memoria del navegador: la **`sesion`**
  de la inscripción (24 h, se puede usar muchas veces, se gasta al enviar) y el **`permiso`** de la actualización (2 h, un solo envío).
  El envío final lleva la credencial y **el servidor toma el correo de ella, no del cuerpo** (`crearSolicitud(..., { permiso, propositoPermiso })`):
  la solicitud nace `pendiente` sin segundo correo. La credencial se MIRA (`correoDelToken`) y se gasta (`consumirToken`) al final, con todo lo
  demás validado: un error de validación no quema un formulario largo. Sin credencial, `recibirSolicitud` responde 400 `falta_verificacion`.
  Tope de 1 código/min y 4/día por correo (`envioPermitido`); un código no sirve para otro formulario (propósitos distintos).
  · **Baja: se envía primero y se confirma después** (la solicitud entra `sin_verificar` y el mantenedor NO la ve; su cola lista `pendiente`).
  Pasa a `pendiente` al confirmar (`POST /api/verificar`). Reenviar reemplaza la anterior sin confirmar del mismo correo. Tope por correo
  comprobado **antes** de guardar: crear reemplaza, y un doble clic no puede borrar la solicitud cuyo correo ya va en camino. Si el correo no se
  puede enviar, la solicitud se descarta (503): nadie podría confirmarla.
- **BORRADOR de la inscripción** (`server/src/borradores.mjs`, tabla `borrador (email, tipo)`, `PUT /api/inscripciones/borrador`): desde que se
  valida el código, lo escrito se guarda solo (un instante después de dejar de teclear) atado al correo de la `sesion`. Para retomar: volver a
  `/inscripcion`, escribir el MISMO correo y un código nuevo; `verificarCodigo` devuelve el borrador y el formulario carga todo y sigue en su paso
  (3 a 5). **Solo se guarda por lista blanca** (`sanearBorrador`: nunca el correo dentro de `datos`, los términos ni el campo trampa); un
  borrador por correo; se borra al enviar y a los 60 días sin cambios (se purga al guardar otro). **Antes de verificar el correo no se guarda
  nada** en el servidor: nombre y correo del paso 1 viven en memoria; si hay un borrador, manda sobre lo recién escrito. El borrador está en la
  cláusula 4.10 de los términos. Si la sesión caduca, el envío devuelve 410 y el formulario vuelve al paso 1 (el borrador sigue guardado).
- **La baja es de DOS pasos y no pide ficha ni «cómo comprobamos»** (`baja-form.tsx`): 1) correo + motivo (+ términos) → se envía
  el token; 2) la persona **pega el código** en la misma página (o pulsa el botón del correo, que va a `/verificar`) y se confirma
  por `POST /api/verificar`. La ficha SALE DEL CORREO: `fichasDelTitular` busca las inscripciones APROBADAS con ese correo
  (compara por id de ficha vigente, el slug pudo cambiar). Sin ficha escrita se dan de baja TODAS las de ese correo
  (`premium: { grade: '1' }` por el diario, actor `baja-verificada`), la solicitud queda `procesada`, se borran los contactos y la
  respuesta lista los nombres (`fichas`). Con ficha escrita solo se baja esa y solo si es de ese correo. **Las ~785 fichas del
  scrape no tienen correo guardado**: sin ficha asociada ni escrita la baja queda `pendiente` y la respuesta es `sin_ficha` (el
  mantenedor tiene el correo y el motivo para escribirle); con ficha escrita que no es del correo, `en_revision`. El campo «Ficha»
  existe pero escondido y opcional. Cualquier fallo al aplicar también la deja pendiente. Los términos (3.2, 8.1 y 8.9) lo dicen:
  quien controle ese buzón puede dar de baja las fichas inscritas con él, de forma irreversible. **La modificación tampoco pide
  prueba de titularidad**: el enlace del correo es la comprobación y el mantenedor revisa igual.
- **Acceso del mantenedor** (`lib/admin-enlace.mjs`, `POST /api/admin/enlace` y `/enlace/entrar`): pedir el enlace responde SIEMPRE
  lo mismo y el envío va en segundo plano (ni la respuesta ni el tiempo delatan quién es admin). La sesión es la de siempre
  (`emitirSesion`) con el correo como usuario, así que el diario dice quién editó. **La UI de `/admin` ya no tiene login por
  contraseña** (solo correo). El endpoint `POST /api/admin/login` sigue en la ruta de Next y funciona mientras exista
  `VTUBERDEX_ADMIN_PASSWORD_HASH`: **en producción se cierra quitando esa variable de `/etc/vtuberdex.env`**. El Express local
  conserva su login por contraseña, pero ya no hay pantalla que lo use.
- **No desplegar sin DNS**: sin SPF/DKIM/DMARC publicados el correo sale pero Gmail lo descarta o lo manda a spam, y las
  inscripciones parecerían enviadas sin que nadie pueda confirmarlas.

## Cartas premium: grado, placa de acrílico y mantenedor

Un VTuber que dona recibe su carta **gradeada** (como las de CGC): entra en el 8 y sube 0,5 por
cada mes que sigue donando, hasta el 10 y luego la **Black Label**. Escala: `8 → 8.5 → 9 → 9.5 → 10 → BL`.

- **La escala vive UNA vez**, en `server/src/premium.mjs` (JS puro, sin Node ni DOM). Validación
  (`validation.mjs`), regla (`mutations.mjs`), búsqueda (`search.mjs`) y cliente (`lib/premium.ts`
  la reexporta) la importan; no la copies. El grado es **texto** (`'BL'` no es un número).
- **Datos**: tabla `premium (vtuber_id PK, grade, since, graded_at)`, sin CHECK de la escala (SQLite
  no deja alterarlo). Sin fila = carta normal. El certificado y el código de donación (`VTD-016` para la carta `#016`) se **derivan del número de dex**, no se guardan (antes del id interno, que no coincidía con lo visible; los códigos viejos de 6 dígitos se rechazan a propósito).
  Se edita por el mismo PATCH de siempre: `{ premium: { grade } }` o `{ premium: null }` (`aplicarParche`),
  así que **local (Express) y producción (diario de Turso) comparten la regla** sin código nuevo en las rutas.
- **El diario sella el DÍA, no las fechas.** `aplicarYAnotar` llama a `sellarPremium`, que guarda
  `premium.ahora`; qué fecha le toca a `since`/`gradedAt` la decide `aplicarPremium` con la fila que ya
  existe. La primera versión sellaba `since` y **cada ascenso movía la fecha de alta a «hoy»** (lo cazó
  `lib/diario.test.ts`). Reproducir el diario otro día no cambia nada.
- **Una base empaquetada anterior no tiene la tabla** y se abre en SOLO LECTURA (no aplica el esquema):
  `search.mjs` detecta `premium` (`tienePremium`, solo recuerda el SÍ) y devuelve `premium: null` en vez de
  fallar con `no such table`. No hace falta regenerar `deploy/data/` para que el sitio siga sirviendo.
- **Placa 3D** (`premium-slab.tsx`): envoltorio de `CardMeshes` cuando `card.premium` existe. De fuera a
  dentro: cuerpo de acrílico (shader propio, transparente, `renderOrder` alto, sin `transmission` — un segundo
  pase de toda la escena lo pagarían las 8 cartas del libro), la carta escalada en la ventana, y la hoja
  interior con la etiqueta (lienzo 2D, `premium-label.ts`). **El alto de la placa es el de la funda**
  (carta + 2 × `BINDER.pocketPad`): cabe en su casilla del libro sin tocar `card-binder-layout`. En el detalle
  la cámara se aleja en esa proporción (`cameraZFor`). Todas las perillas están en `PREMIUM`
  (`card3d-config.ts`). El resplandor de la carta se omite dentro de la placa (se pintaría sobre la etiqueta).
- **Trampa del bisel** (ya documentada en la skill de three): `ExtrudeGeometry` con bisel EXPANDE el contorno;
  `crearCuerpo` insetea la forma y `premium.test.tsx` mide la caja (`layout.width` exacto).
- **Sección pública**: `?premium=1` es un filtro más (URL = estado): botón «★ Premium» en el catálogo y acceso
  en la cabecera. **Mantenedor**: pestaña «Premium» (`admin/premium-manager.tsx`). Es una LISTA de una línea por carta, no
  tarjetas: la versión anterior apilaba una tarjeta alta con 5 controles por carta y con decenas era una sábana (además
  cortaba en 100 sin avisar; ahora trae todas las páginas). Qué hay: filtros por tramo CON contadores (`6–7,5`, `8–9,5`,
  `10`, `Black Label`, `Deterioradas`) y **«Por subir este mes»** (el trabajo mensual: premium que pueden subir y aún no
  cambiaron de grado este mes; la donación la sabe una persona, nada sube solo), búsqueda en la lista (sin tildes; por
  nombre, `#NNN` o `VTD-…`), orden y paginación de 20. El botón relleno «Subir a …» solo lo lleva quien está por revisar;
  quien ya subió se ve en contorno y el grado máximo en gris. Lo raro (corregir grado, degradar, quitar) va en «Más», bajo la
  fila, de una a la vez. El alta es un panel que abre «+ Nueva premium» (abierto solo si no hay ninguna). El deterioro
  arranca en el grado MÁS LEVE y el 1 (baja: ficha sin página pública) pide confirmación. La lógica pura está en
  `admin/premium-lista.ts` (probada); `PremiumBadge` tiene `compacto` para listas. Avisa si el grado ya cambió este mes pero deja subir: la donación es
  un dato que sabe una persona, el mantenedor no la calcula.
- **Un re-seed con `--reset` borra las premium** (cascada desde `vtuber`), igual que el resto de ediciones.
- `madKoding` (dex 16) es premium **grado 10 en la base LOCAL** (`data/vtuberdex.db`, ignorada por git). En
  producción hay que asignarla desde el mantenedor (pestaña Premium), que escribe en el diario de Turso.

## Escala premium 6…BL, donación y desgaste leve

La escala premium es `6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, BL` (`GRADOS` en `server/src/premium.mjs`; el grado inicial es el 6).
`DONACION_POR_GRADO` (misma archivo) es la tabla de referencia en USD ACUMULADOS (1 USD = 1 mes de racha): 6=1, 6.5=2, 7=3,
7.5=4, 8=5, 8.5=7, 9=10, 9.5=20, 10=50; la BL no se vende. La muestra la pestaña «Tarifas» del mantenedor (`premium-rates.tsx`),
solo lectura: el grado lo sigue fijando el mantenedor a mano (no hay aún «cubierto hasta» ni ascenso automático).

- **Racha** (`rachaDe`): meses seguidos, derivada de `since`/`gradedAt`; `aplicarPremium` adelanta `since` si pasó más de un mes sin
  ascenso (el grado no baja). Se ve en la etiqueta de la placa y en `PremiumBadge`.
- **Desgaste leve** (`DESGASTE_LEVE`, `planDeDesgasteLeve`): la carta SIN premium se pinta con uso mínimo (canto, grano, rayitas) y las
  premium 6…7,5 con menos; del 8 hacia arriba, limpia. Nunca toca texto ni foco. Calibrado mirando la carta renderizada.
- Las degradadas pasaron a `5…1` (antes `7…1`): cualquier fila local con grado `6` o `7` se lee ahora como premium de entrada.

## Cartas degradadas (grados 5…1): las bajas se rompen, no se borran

La contraparte de la premium. Una ficha dada de baja no se elimina (cláusula de salida de `/terminos`): se muestra
**gradeada en su placa de acrílico, pero rota**. Escala `7` (apenas desgastada) → `1` (ilegible; es el de las bajas).
Los asigna a mano el mantenedor (pestaña «Premium»: «Degradar», «Fijar grado», «Llevar al grado 1 (baja)»); **nada los
calcula ni «procesar» una baja los aplica solo**.

- **Misma tabla, misma regla**: `premium.grade` acepta también `'7'…'1'` (`TODOS_LOS_GRADOS` en `server/src/premium.mjs`, que
  también define `GRADOS_DEGRADADOS`, `esGradoDegradado` y `severidadDeGrado`: 1/7 en el 7, 1 en el 1). `GRADOS` sigue siendo la
  escala PREMIUM y `gradoSiguiente` no sube una degradada: las donaciones no arreglan una carta rota.
- **El filtro público `?premium=1` NO lista las degradadas** (`search.mjs`: `premium: true` filtra por `GRADOS`); el mantenedor
  pide `premium: 'todas'` (rutas `/api/admin/vtubers` de Express y de Next) para verlas.
- **El daño se pinta en las capas 2D ANTES de subirlas a la GPU** (`card-texture/deterioro.ts`), así que el shader no cambió: ni
  uniformes ni samplers nuevos. Qué se rompe lo decide `lib/degradado.ts` (puro, probado, DETERMINISTA por id+grado: la carta no
  «baila» al volver de otra página) y las perillas están en `DETERIORO` (`card3d-config.ts`).
- **Reparto por capa, a propósito**: los mordiscos de los bordes, el canto blanqueado y los rayones van SOLO en la capa de arriba
  (wordmark). Las capas se desplazan distinto con el puntero (`PARALLAX_LAYERS`), y el mismo mordisco en todas salía doble y
  desfasado. Superficie y personaje reciben apagado de color, grano y pérdida de foco/pixelado; la cabecera, nombre corrompido
  (`corromperTexto`) y **la placa del número de dex queda siempre intacta** (en el grado 1 es lo único que se entiende).
- **Los huecos se pintan del color de la ventana de la placa** (`DETERIORO.window`), no transparentes: el shader rellena una capa 0
  sin alfa con el degradado de marca, así que un hueco transparente no se vería como hueco.
- **El grado va en la clave de la caché de texturas** (`claveDe` en `fabrica.ts`); sin eso el mantenedor seguiría viendo la textura
  vieja al cambiar el grado. `generarRapida` estropea las capas y `completar` las reutiliza; `drawCardLayers` solo estropea las que
  dibuja él (no se daña dos veces).
- La etiqueta de la placa (`premium-label.ts`) corrompe nombre y país con la misma semilla y dice «DETERIORADA»; el foil se apaga
  (`premium-boost.ts`, nunca por debajo de 0,35 para que siga reaccionando al puntero).
- **Grado 1 = SIN FICHA** (`server/src/ficha-deteriorada.mjs` + `search.mjs`). Una ficha de baja no tiene página pública: `getVtuberBySlug`
  sin `includeHidden` devuelve `null` (404 en `/v/:slug`, en la API, por alias antiguo y en el metadata), `getNeighbors` y
  `fichasPublicadas` (sitemap y JSON-LD) la saltan, el libro no la enlaza ni responde al toque y buscar su nombre no la encuentra. En el
  LISTADO sigue saliendo como carta rota, con el nombre ilegible, `slug: deteriorada-<dex>` (la URL real delataría el nombre), sin textos,
  país, facciones, redes ni **logo** (`images.logo` nulo; la carta 3D tampoco lo pinta, ni en la vista del mantenedor). **El mantenedor
  (`includeHidden`) la ve entera** y puede devolverla a un grado normal; nada se borra de la base. Solo el grado 1: del 7 al 2 la ficha
  y su página son normales. Antes se probó una página «Ficha Deteriorada» con los datos vaciados; se descartó porque cualquier ruta que
  llegue a la ficha (URL, vecino, buscador) es una fuga del nombre.
- Para ver el resultado sin WebGL ni base de datos: bundlear `drawCardFront` con `esbuild --alias:@=.` y dibujar los grados en
  Chromium (`/opt/pw-browsers`); es lo que se hizo para calibrar `DETERIORO`.

## Directo en Twitch / YouTube / Kick y XP por transmitir

- **Ficha**: `components/directo-en-vivo.tsx` pide `GET /api/vtubers/:slug/directo` (mismas defensas que el detalle) y muestra «EN DIRECTO» con
  título y espectadores, estadísticas públicas y últimos vídeos de YouTube. **El navegador nunca habla con las plataformas**: `lib/directos.mjs`
  consulta desde el servidor con credenciales de APLICACIÓN (`VTUBERDEX_TWITCH_ID_CLIENT/VTUBERDEX_TWITCH_SECRET`, `VTUBERDEX_KICK_ID_CLIENT/VTUBERDEX_KICK_SECRET`, `VTUBERDEX_YOUTUBE_API_KEY`), con caché en
  memoria (60 s Twitch/Kick, 5 min YouTube, 30 s los fallos) y peticiones en vuelo compartidas. **Sin credenciales la plataforma no se pinta**
  (local y CI no necesitan nada). El canal sale del DOMINIO del enlace de la red, no del nombre escrito.
- **Límites reales**: Twitch sin token del streamer no da seguidores; Kick no publica seguidores; YouTube detecta el directo entre las últimas 10
  subidas (3 unidades de cuota por canal; `search.list` cuesta 100 y no se usa) y no resuelve URLs `/c/Nombre`. **Probado solo con respuestas
  simuladas**: falta una pasada con credenciales reales por plataforma.
- **XP por transmitir**: `scripts/premiar-directos.mjs` (`npm run premiar:directos`, `--vigilar` para servicio, `--seco` para ver quién está en
  directo sin pagar). Cada 10 min revisa Twitch y Kick de todas las fichas y `premiarDirecto` (`server/src/minecraft.mjs`) paga 5 XP por tramo
  de 30 min, tope 50 al día, **idempotente por `directo:<ficha>:<tramo>`** y con el tope aplicado en la misma sentencia. Tabla `xp_directo`, aparte de
  `xp_juego`: **no gasta el tope de Minecraft**; la suma `xpDeJuego`/`xpDeJuegoVarias` incluye las dos, así que nivel y puntos salen solos.
  Una ficha con varios canales cobra una vez por tramo. **YouTube NO paga**: revisar ~800 fichas gastaría las 10.000 unidades diarias en horas.
  Falta instalar el servicio en la VPS (como `vtuberdex-voces`) y definir las credenciales en `/etc/vtuberdex.env`. Perillas: `XP_DIRECTO_*` en
  `server/src/experiencia.mjs`.

## Rangos y misiones de Minecraft (XP y grado de carta)

- **Rangos por nivel** (`server/src/rangos.mjs`, UNA tabla: Novato 1 · Aprendiz 5 · Veterano 10 · Élite 20 · Maestro 35 · Leyenda 50;
  `lib/rangos.ts` la reexporta). Se calculan del nivel en el cliente (insignia en `StatBars`; títulos en `rango.<id>`, es/en/ja) y salen en
  `GET /api/minecraft/reglas` (`rangos`) para el plugin. Los umbrales salen de la curva real (`umbralDeNivel`); ajustarlos = tocar `RANGOS`.
- **Misiones** (`server/src/misiones.mjs`, catálogo `MISIONES`): el plugin solo REPORTA contadores (`mobs`, `jefes`, `mineria`, `pesca`,
  `cosecha`, `cria`, `entregas`, `distancia`) y la web decide qué se completó. Una misión pide uno o varios contadores y se completa al llegar
  todos a su meta; las diarias cuentan por día de Chile. **Idempotente**: el lote (`idLote`, UUID) es clave primaria, completar es un
  `INSERT … ON CONFLICT DO NOTHING` (solo el que gana paga) y la XP es otra fila (`xp_mision`, clave `ficha:mision:periodo`) que se suma en
  `xpDeJuego`/`xpDeJuegoVarias` junto a `xp_juego` y `xp_directo`: **no gasta el tope diario de Minecraft** (las diarias suman 70 XP/día como mucho).
  Rutas del plugin (con `X-Minecraft-Token`): `POST /api/minecraft/misiones` `{ uuid, idLote, avances }` y `GET /api/minecraft/misiones/:uuid`.
- **Grado por misiones (opcional)**: las 5 misiones de grado (`grado-6` … `grado-8`) son DIFÍCILES (miles de mobs, jefes, 250 entregas…) y no dan
  XP: dan el derecho a reclamar el grado desde «Mi ficha» (`POST /api/mi-ficha/misiones`, con confirmación). **Tope 8** (`GRADO_MAXIMO_POR_MISIONES`):
  del 8,5 a la Black Label queda solo para donación. Reclamar nunca baja un grado, no toca una carta deteriorada y se aplica por el diario
  (`vtuber.editar`, actor `mision`); la marca de «reclamada» va primero (UPDATE condicional) y se suelta si el diario falla. Los textos de las
  misiones (nombre/descripcion) están en español en el catálogo: fuera del i18n de momento.
- **Semanales**: `repetible: 'semanal'` cuenta de lunes a domingo (`periodo = semana:<lunes>`, `lunesDe`); hay 2 («Cazador de la semana» 80 XP, «Repartidor
  de la semana» 120 XP). Se pagan una vez por semana y arrancan de cero el lunes.
- **Panel del juego y avisos**: `progreso.rango` (nombre en español) sale en `GET /api/minecraft/jugador/:uuid` y el panel lo muestra junto al nivel; al entrar,
  `MisionesService.avisarGradoListo` recuerda (una vez por conexión) los grados de misión completados y sin reclamar.
- **Twitch en lotes**: `precalentarTwitch` (`lib/directos.mjs`) pregunta a Helix de a 100 logins y llena la caché; `premiarDirectos` lo llama antes de revisar
  (~8 llamadas en vez de ~800 por pasada). Si el lote falla, los canales quedan en error un rato corto en lugar de caer a llamadas sueltas.
- **Traducción**: nombre y descripción de cada misión y la etiqueta de cada contador están en `lib/i18n/textos/mificha.ts` (`mision.<id>.nombre|descripcion`,
  `contador.<c>`, es/en/ja); `lib/misiones-textos.test.ts` falla si se añade una misión o contador al catálogo sin sus textos. Si el servidor trae una
  misión que el cliente no conoce, sale el texto en español del catálogo.
- **Mantenedor**: pestaña «Premium» → «Grados reclamados con misiones» (`components/admin/reclamos-misiones.tsx`, `GET /api/admin/misiones/reclamos`,
  `POST …/reclamos/:ficha/:mision/revocar`). Cada reclamo guarda el grado ANTERIOR (`mision_reclamo`); revocar devuelve la carta a él, pero solo si la carta
  todavía lleva el grado reclamado (si una donación la subió, no se toca) y la misión sigue marcada como reclamada, así que no se puede repetir. Solo en la
  ruta de Next (el Express local no la tiene).
- **Ajustar la dificultad con datos**: `npm run informe:misiones` (`resumenDeMisiones`) muestra cuántas fichas completaron cada misión y el avance medio/máximo
  de quienes van en camino. Las metas del catálogo son una propuesta sin jugar: ajustarlas con ese informe tras unas semanas.
- **Rango en la carta 3D**: el chip de nivel de la carta dice «NIV 12 · VETERANO» (`card-texture/chip-nivel.ts`, compartido por `capa-textos.ts` y
  `componer.ts`). Solo sale donde la carta trae nivel (la ficha; el listado y el libro no aplican likes ni XP y no pintan chip). **Sin mirar renderizada**:
  cabe de sobra por cuenta (≈ 726 de 916 px útiles), pero falta verlo en un navegador con GPU.
- **Plugin** (repo `vtuberdex/vtuberdex-minecraft`): `MisionesService` acumula los contadores y los manda cada ~30 s; `/vtd misiones` las lista.
  Ver el README del plugin para qué evento cuenta para cada contador.

## Experiencia, niveles y puntos de habilidad («Mi ficha»)

- **La experiencia es función de los likes** (`server/src/experiencia.mjs`, `experienciaConLikes`): la barra (`current/max`) se
  vacía al subir de nivel y cada nivel pide más que el anterior (`BASE_NIVEL + PASO_NIVEL × (n-1)`, nunca menos). **El contador
  TOTAL no se reinicia** (`total`: lo que valían los niveles que la ficha ya traía + su barra + los likes; como en Ragnarok): sale
  en `experience.total` y se ve como «EXP total» en `StatBars`.
- **Puntos de habilidad**: cada nivel GANADO con likes (`nivelesGanados`, desde el nivel que traía la ficha, no el del scrape) da
  `PUNTOS_POR_NIVEL` = 3. Cada punto sube un rango (`RANGO_MAXIMO` = 5) de una habilidad con nombre. Los disponibles NO se guardan:
  `ganados − repartidos` (`server/src/mi-ficha.mjs`, tabla `punto_habilidad` por **nombre** de habilidad, no por id: el mantenedor
  reescribe las filas). Gastar es UNA sentencia condicional (dos clics a la vez no gastan un punto inexistente). El rango sale
  público en la ficha (`skills[].rank`, insignia en `SkillList`).
- **Aviso de subida de nivel** (`lib/mi-ficha.mjs`, `avisarSubidaDeNivel`, llamado en segundo plano desde el POST del like):
  `reclamarAvisoDeNivel` (tabla `aviso_nivel`) es un UPSERT condicional, así que solo UN like gana el derecho a mandar el correo; si
  el envío falla se suelta y el siguiente like lo reintenta. Va al correo de la inscripción APROBADA (`correoDeLaFicha`); las fichas
  del scrape no tienen correo: suben de nivel sin aviso.
- **Enlace mágico** (propósito `ficha` en `token_correo`): vale 7 días y **NO se gasta** (se MIRA con `correoDelToken`), a
  diferencia del resto: los puntos se reparten en varias visitas. Lleva el token en el fragmento (`/mi-ficha#t=…`) y la página lo deja
  en la barra para que recargar funcione. Sin enlace, `/mi-ficha` pide el correo y responde siempre igual (`pedirEnlaceDeMiFicha`).
  Rutas: `POST /api/mi-ficha`, `/enlace`, `/puntos`. Textos en `lib/i18n/textos/mificha.ts` (es/en/ja); el correo va en español.

- **Página explicativa `/niveles`** (enlazada en el pie, trilingüe en `lib/i18n/textos/niveles.ts`, `components/niveles/niveles-contenido.tsx`): las cifras
  y la tabla de niveles salen de `server/src/experiencia.mjs` (`umbralDeNivel`, `XP_POR_LIKE`…), no de números escritos en el texto: si cambias la
  regla, la página se corrige sola (y `niveles-contenido.test.tsx` lo comprueba). Sus «capturas» NO son PNG: `components/niveles/graficos.tsx` dibuja
  los gráficos en SVG desde `experienciaConLikes`/`umbralDeNivel` y las maquetas son los componentes REALES (`StatBars`, `SkillList`, `MiFichaVista`
  — la pantalla de «Mi ficha» sin lógica) con datos de ejemplo, `inert` y marcadas «Ejemplo»: no se desfasan al cambiar el diseño y se traducen solas.

## Minecraft: servidor para VTubers con ficha (`minecraft/`, `server/src/minecraft.mjs`)

Versión de Minecraft del servidor: NO VERIFICADA (pendiente de leer de /srv/minecraft; el directorio es de `minecraft` con permisos drwx--x--- y el usuario de trabajo no puede leerlo). Es el único sitio donde se anota; no escribir una cifra sin comprobarla.

Un plugin de Paper (`paperApiVersion` de `vtuberdex-minecraft/build.gradle.kts`, pendiente de verificar; Java 25, `minecraft/`; `./gradlew build` → `build/libs/vtuberdex-mc-*.jar`, el wrapper es Gradle
9.8.1 porque Gradle 8 no corre en Java 25; compila contra `paper-api:$paperApiVersion` (`paperApiVersion` en `vtuberdex-minecraft/build.gradle.kts`, la fuente única de la versión) con el `api-version` de `vtuberdex-minecraft/src/main/resources/plugin.yml` (debe coincidir con `paperApiVersion`): Paper NO carga un
plugin con `api-version` más nueva que el servidor) hace del servidor uno **solo para VTubers con ficha**: se juega con los stats de la ficha
PROPIA y lo ganado suma experiencia en la web. **La web es la fuente de la verdad**: el plugin no calcula niveles, topes ni dueños.

- **Casa-lobby para quien no está vinculado** (`Lobby.java` + `SalaDeEspera.java`): un MUNDO APARTE vacío (`vtuberdex_lobby`, generador
  sin terreno, pacífico, mediodía fijo, sin mobs) con una casa de 13x13 construida por código en cada arranque (idempotente; paredes,
  techo y barreras arriba y abajo) y carteles ENCERADOS con los pasos (los textos están en `CARTELES`: ~15 caracteres por línea, más se
  corta; texto BLANCO con borde oscuro: brillante con tinte GRIS, porque el tinte negro pone borde claro y no se leía). Estados: COMPROBANDO (recién entra: quieto donde aparece mientras la web responde; reintenta cada 20 s; falla CERRADO),
  ENCERRADO (sin vínculo: a la casa en modo aventura, camina dentro, solo `/vtd`; si sale de los límites vuelve al centro; se guarda en
  el PDC dónde estaba en el mundo y su modo de juego) y LIBRE (vinculado: si estaba en la casa sale a donde estaba o al spawn del
  mundo). Los NUEVOS aparecen ya en la casa (`AsyncPlayerSpawnLocationEvent`): nunca ven el mundo. Expulsión a los `minutos-de-espera`
  (15). `vtuberdex.admin` (op) no queda retenido y puede visitar la casa con `/vtd lobby`, **pero solo con identidad verificada**
  (`adminVerificado`: UUID que no sea versión 3): en modo offline un op dado POR NOMBRE lo heredaría cualquiera con ese nombre. Sin verificar a la vista: falta mirarla
  con un cliente. `/vtd email <correo>` → `POST /api/minecraft/email` manda al correo un código por cada ficha de ese correo
  (`fichasDelCorreo`: inscripción aprobada o `ficha_correo`), **atado al UUID que lo pidió**; `/vtd codigo <código>` lo canjea. El
  código se ESCRIBE en el juego, nunca se canjea con un clic en el correo: quien pide con el correo de otra persona no ve el código, y
  un clic de la víctima vincularía la cuenta del intruso. Responde igual tenga o no fichas el correo; topes (`ENVIOS`): 1/min y 5/día
  por correo (solo su hash), 10/día por cuenta. «Mi ficha» también da códigos (sin cuenta atada). Ya NO existe elegir una ficha a mano.
- **Modo híbrido: Java NO premium también entra** (`online-mode=false`, `enforce-secure-profile=false`). En offline el UUID de Java
  sale del NOMBRE (versión 3), así que para esas cuentas (`requiereSesion`) el vínculo guardado no basta: hace falta una SESIÓN
  (`sesion_minecraft`) para la RED desde la que entra, que nace al canjear un código del correo y dura `SESION_DIAS` (7). Misma red y
  plazo → entra directo; otra red o vencida → `/vtd email` + `/vtd codigo` otra vez (`jugador` responde `necesitaSesion` SIN decir de
  quién es la ficha). La red viaja en `X-Jugador-Red` desde el plugin y la web solo guarda su hash (`hashearRed`). La XP de una cuenta v3
  sin sesión no suma. Bedrock (Floodgate) y premium verificadas (UUID v4) siguen con vínculo permanente. `/vtd email` añade un tope
  por RED (`ENVIOS.porRedDia` = 20): sin cuentas de pago cambiar de nombre es gratis. **FastLogin** (que haría entrar directo a los
  premium) NO se instaló: en Paper exige ProtocolLib, que no tiene versión para 26.x (última 5.4.0, 2025-08); la alternativa sería un
  proxy Velocity. Por eso hoy los premium Java también confirman el correo cada 7 días o al cambiar de red. Las skins las pone
  **SkinsRestorer** 15.12.6 (declara hasta 26.1.1; carga en 26.2 sin errores) con `offlineModeWarning.enabled: false` (por defecto
  muestra a cada jugador offline un aviso enorme sobre launchers «cracked»: la identidad la da el código del correo, no el launcher).
  **FreedomChat** 1.7.9 reescribe el chat como mensajes del servidor (sin la marca de «no verificado» en cada mensaje).
  `claim-secure-chat-enforced` sigue en `false` A PROPÓSITO: escondería el aviso «Chat messages can't be verified» de Java mintiéndole
  al cliente, y su propia config advierte que puede violar las reglas de uso de Minecraft (riesgo de bloqueo del dominio por Mojang).
  Decidido así con el usuario (2026-10-08); el aviso es del juego y Bedrock no lo muestra. Riesgo aceptado: misma red (casa, cibercafé) + mismo
  nombre comparte la sesión de 7 días.
- **Una ficha, UNA conexión a la vez**: (1) una ficha tiene una cuenta (vincular otra reemplaza; la anterior, si está conectada, va
  al lobby en el acto, `VtdCommand`) y una cuenta tiene UNA red de sesión (`abrirSesion` borra las demás: confirmar desde otra red
  olvida la anterior); (2) `alIntentarEntrar` (`AsyncPlayerPreLoginEvent`) RECHAZA una conexión nueva de una cuenta o nombre que ya
  juega desde OTRA IP. Por defecto Minecraft hace lo contrario (expulsa al que ya estaba), y en offline cualquiera echaría a una VTuber
  escribiendo su nombre. Desde la MISMA IP sí entra (reconexión tras un corte). Sin probar con dos clientes reales.
- **La XP del juego es un dato más de la curva**: `experienciaConLikes(base, likes, xpJuego)` la suma como la de los likes; niveles,
  puntos y aviso de subida salen solos. `xpJuego` = `SUM(cantidad)` de `xp_juego` (incluida la de entregas) (ejecutor de `lib/solicitudes.mjs`), la leen la ficha
  pública, el like y «Mi ficha» (`xpJuegoDe` vale 0 si el almacén falla). El LISTADO no la aplica (tampoco los likes).
- **Lotes idempotentes con tope en UNA sentencia**: lotes de ≤ `XP_POR_LOTE_MAX` (100) con `idLote` UUID fijado al crearlo (un
  reintento no suma dos veces); el INSERT recorta a lo que cabe en `XP_JUEGO_MAX_DIA` (300, día de Chile). Motivos: `MOTIVOS_XP`.
- **Rutas**: `GET /api/minecraft/reglas` pública; `email`, `vincular`, `jugador/:uuid` (GET/DELETE), `xp` y `puntos` exigen `X-Minecraft-Token` =
  `VTUBERDEX_MINECRAFT_TOKEN` (≥16; sin él, 404). `POST /api/minecraft/puntos` `{ uuid, stat, cantidad? }` (1..50) gasta puntos de stats con `subirStat` (las mismas reglas que «Mi ficha»; lo usa la ventana `/vtd stats` del plugin) y responde `{ ok, aplicados, puntosStats }`; si se acaban a mitad, vale lo aplicado. «Mi ficha»: `POST /api/mi-ficha/minecraft`. No usan `responderRegistrando`.
- **En el juego**: stats como `AttributeModifier` `vtuberdex:stat_<slug>` escalados/topados en `config.yml` (se quitan al salir: se
  guardan con el jugador); nivel/EXP en una BossBar, NO en la barra vanilla (es la de encantar). Fase 2 pendiente: habilidades jugables.
- **Panel lateral con el progreso** (`Panel.java`, sidebar por jugador; `/vtd panel` lo oculta, se recuerda en el PDC): nombre, nivel,
  barra de EXP, EXP total, XP de juego de HOY con su tope, likes, stats de dos en dos, puntos por repartir (→ `/mi-ficha`) y la hora
  de la última sincronización. **Todo sale de la web**: la ficha pública (nivel, EXP, stats con puntos y bonos aplicados) y
  `progreso` de `GET /api/minecraft/jugador/:uuid` (`progresoDe`: likes, XP de juego total y de hoy, puntos de habilidad y de stats
  con `estadoDePuntos`/`estadoDeStats`; si falla, el jugador entra igual sin esa parte). Se refresca al entrar, tras cada lote de XP
  y **cada minuto** (así llegan los likes y los puntos repartidos sin jugar). `FichaService` compara con el refresco anterior: subir
  de nivel → título, sonido y aviso a todo el servidor; más EXP → barra de acción «+N EXP · ✔ vtuberdex.com»; stats distintos →
  chat «Tus stats se actualizaron desde la web: ATQ 215 → 220». Llegar al tope diario se avisa una vez al día. `/vtd ficha` lista
  todos los stats en el chat.
- **Java y Bedrock en el mismo servidor**: Paper (la versión del encabezado de este bloque, estable) + **ViaVersion** (deja entrar a clientes Java 26.3, protocolo
  777; el servidor es 776) + **Geyser** (traduce Bedrock: Android, iOS, Windows de la tienda; UDP **19132**) + **Floodgate** (Bedrock
  entra con su cuenta Xbox sin comprar Java; `auth-type: floodgate` en `plugins/Geyser-Spigot/config.yml`, que nace en `online` y
  hay que cambiarlo). Se bajó de 26.3 a 26.2 porque Geyser solo soportaba Java 26.2; el mundo 26.3 (sin jugar) quedó en
  `/srv/minecraft-respaldo-26.3-*` (borrado el 2026-10-08). Cuando Geyser soporte la versión nueva, subir Paper y quitar ViaVersion si ya no hace falta.
  Floodgate da a Bedrock un UUID `00000000-0000-0000-0009-…` (válido para el vínculo) y el nombre con «.» delante (`JUGADOR` lo admite).
  Las consolas (Xbox/PS/Switch) no dejan añadir servidores propios. `api.mcsrvstat.us/bedrock` daba «offline» con Bedrock
  funcionando: para comprobarlo, `tcpdump -ni eth0 udp port 19132` o un ping RakNet, no ese servicio.
- **Trampa: las copias del diario llenaban /tmp (que es RAM).** `lib/diario.mjs` copia la base a `/tmp/vtuberdex-<pid>-<ms>.db`;
  `retirar` borraba las reemplazadas, pero la VIGENTE de cada proceso que terminaba (reinicio, script, test) quedaba para siempre:
  2.916 copias (9.201 archivos con -wal/-shm, 1,9 GB) en 4 días, /tmp al 100 %, 2,9 GB de swap y las voces con ENOSPC. Hoy cada
  proceso borra la suya al salir y la primera construcción barre las de PIDs muertos (`barrerCopiasHuerfanas`, probado). Lo mismo
  hacían los tests del server (`migrations`, `uploads`): ahora limpian en `after`.
- **Trampa: el cliente HTTP de Java pide `Upgrade: h2c`** en conexiones sin TLS y el servidor Node de la app cierra la conexión sin
  responder («HTTP/1.1 header parser received no bytes»; `curl --http2` reproduce: exit 52). `ApiClient` fuerza HTTP/1.1. Ningún
  gate lo vio: salió en la primera entrada real (Bedrock) y dejaba a todos en la sala de espera.
- **Producción (VPS)**: servicio `vtuberdex-minecraft` (usuario `minecraft`, `/srv/minecraft`, Java 25 de apt, `-Xmx1536M`
  `-XX:ActiveProcessorCount=2`, `ProtectSystem=strict`), puertos **25565/tcp** (Java) y **19132/udp** (Bedrock) públicos, `online-mode=false` (híbrido, ver arriba). **RCON activado el 2026-10-12** a petición del mantenedor (puerto 25575, contraseña en `server.properties` y en `~/.local/share/vtuberdex-auto/rcon-pass`; cliente `~/.local/bin/mc-rcon "<comando>"`): no hay cortafuegos, así que el drop-in `rcon-local.conf` del servicio añade una regla iptables que descarta 25575 salvo desde `lo`. Si cambias de máquina o quitas el drop-in, RCON queda abierto a internet. **No hagas
  op por nombre a cuentas Java**: el permiso lo hereda quien use ese nombre (el plugin no lo deja saltarse el lobby, pero el op sigue
  siendo op en el resto del servidor). Se entra con `vtuberdex.com`
  (el registro A no pasa por el proxy de Cloudflare). El plugin habla con la app LOCAL (`api-url: http://127.0.0.1:3100`; `sitio-url`
  es lo que se enseña en el chat); el token está en `/etc/vtuberdex.env` y en `plugins/VTuberDex/config.yml` (600). Actualizar el
  plugin = copiar el jar a `/srv/minecraft/plugins/` (dueño `minecraft`) y `sudo systemctl restart vtuberdex-minecraft`. Compilar:
  JDK 25 y Gradle viven en `~/.local/share/vtuberdex-build/` (NO en /tmp, que es RAM): `GRADLE_USER_HOME=…/gradle-home
JAVA_HOME=…/jdk25 ./gradlew build`.
- **Reparto de recursos de la VPS** (drop-ins `recursos.conf` en `/etc/systemd/system/<servicio>.service.d/`): Minecraft
  `CPUQuota=200%` (2 de 4 núcleos), `CPUWeight=40`, `Nice=5`, `MemoryHigh=2300M`/`MemoryMax=2700M`, `OOMScoreAdjust=300` (el núcleo
  lo mata antes que a la web); `view-distance=6`, `simulation-distance=4`, Paper `worker-threads: 2`/`io-threads: 1` (generar chunks es
  lo que más CPU come). Voces (Piper usa todos los núcleos al generar) `CPUQuota=150%`, `CPUWeight=20`, `MemoryMax=1200M`. La web y
  nginx `CPUWeight=200`, `OOMScoreAdjust=-300`. Medido tras aplicarlo: 4,8 GB disponibles y 101 MB de swap (antes ~2 GB y 2,9 GB).
- **Más ahorro (2026-10-08)**: `pause-when-empty-seconds=60` (el servidor deja de simular sin jugadores; mientras Chunky
  pregenera NO se pausa: lo comprobé, sigue a ~13 chunks/s con el servidor vacío), heap `-Xms512M` + `G1PeriodicGCInterval` (sin
  `AlwaysPreTouch`: devuelve memoria al sistema en reposo), `sync-chunk-writes=false` (sin tirones al guardar; se pueden perder
  segundos si la VPS se corta de golpe), menos mobs (`bukkit.yml` monsters 50, ambient 8, water-ambient 12; `spigot.yml`
  activation-range 24 y `mob-spawn-range` 4). **Borde del mundo** (`Mundo.java`, `borde-radio` 5000 en `config.yml`): 10.000×10.000
  en el mundo, /8 en el Nether, igual en el End; **Chunky** 1.5.3 lo pregenera una vez (el plugin le da la orden por la consola y deja
  la marca `plugins/VTuberDex/pregeneracion-encargada`; Chunky sigue tras reiniciar). Primera pasada: ~8 h a 2 núcleos, la web siguió
  respondiendo en 30-55 ms. Respaldos de cada archivo tocado: `*.bak-<fecha>` junto a cada uno.
- **Respaldo del MUNDO** (antes no había: el de las 03:30 es solo la base de la web): `/usr/local/sbin/vtuberdex-mc-respaldo`
  vía `/etc/cron.d/vtuberdex-mc-respaldo` (04:00-05:30 cada 30 min, espera a que el servidor esté VACÍO —pausado, no escribe— y a las
  05:30 copia igual), `tar.gz` de `/srv/minecraft/world` (en 26.x incluye todas las dimensiones y el lobby) en
  `/srv/minecraft-respaldos/`, 7 copias. Log en `/var/log/vtuberdex-mc-respaldo.log`.
- **Textos cortos en el juego**: el tamaño de letra lo decide el cliente (escala de interfaz), así que se achica CUÁNTO se muestra:
  prefijo `✦`, sin títulos grandes (solo subtítulo), panel de 7 líneas, BossBar «Nv N · x/y», recordatorio del lobby en chat UNA vez.
- **Probado a medias con un cliente real**: un Bedrock (Android) entró por Geyser/Floodgate el 2026-10-08 y destapó la trampa h2c;
  tras el arreglo falta jugar el flujo completo (sala de espera → `/vtd email` → `/vtd codigo` → stats y BossBar).

## Entregas estilo Death Stranding (plugin `vtuberdex-entregas`, XP `entrega`)

Un TERCER plugin, aparte del principal y de las mochilas (`~/.motita/workspace/vtuberdex-entregas`, paquete `com.vtuberdex.entregas`), que
depende de los dos y solo usa su API pública. Se compila DESPUÉS de ellos (`build.gradle.kts` lee sus jars de `build/libs/`):
mochilas y principal → entregas. Todo es del mundo principal; los de la sala de espera no llegan.
- **API que se añadió a los otros dos**: `MochilasPlugin` (`llevaMochila`, `capacidadLibre`, `fraccionDeCarga`, `guardar`, `contar`,
  `sacar`; cierran la ventana de la mochila antes de escribir, porque al cerrarse reescribe la página y pisaría el cambio) y
  `VtuberDexPlugin` (`darXp(jugador, motivo, cantidad)`, `tieneFicha`).
- **El paquete SOLO viaja en la mochila**: entra directo en la mochila puesta (no en el inventario), su cantidad son sus unidades de
  peso (cuentan para el tope de 100, el peso y el equilibrio) y `ReglasDeCarga` cierra las salidas (no se tira, no se coloca, no entra en
  ventanas ajenas, el del suelo es invulnerable y solo lo recoge su dueño con la mochila puesta; si aparece en el inventario, cada
  segundo vuelve). Entregar exige la mochila puesta. Una caída de la mochila lo esparce, y eso es el obstáculo del trayecto.
- **Puestos** (`Puestos`): 6, del anillo de `config.yml` (ángulo y distancia al spawn), cada uno en el sitio más plano y seco de sus
  alrededores; se guardan en `puestos.yml` y NO se mueven. Plataforma 11×11 con atril (terminal), piedra imán (cargador de moto) y
  mástil. Protegidos. El mapa (1:16) cubre ±1.024 bloques: no pongas puestos más allá de ~950.
- **Encargos sin estado** (`Contratos`): salen de (puesto, ranura de 20 min, número), así que todos ven los mismos y no hay nada que
  guardar. Un jugador tiene UN encargo (`misiones.yml`). Paga `Recompensa.xp` (distancia, peso, zonas en la ruta recta) × lo que
  llega × factor de tiempo (1,2 / 1 / 0,5); menos de un cuarto entregado = fallido.
- **XP**: motivo `entrega`, con tope diario propio en la web (`XP_ENTREGA_MAX_DIA` = 600) **además** de los 300 de siempre. Un lote de
  entrega no se mezcla con otros motivos (`entrega_aparte`); `XpCollector.enviar` los empaqueta aparte. `hoy`/`topeDia` de la respuesta
  siguen siendo solo los de siempre (el panel del juego muestra «hoy x/300»); lo de entregas va en `entregaHoy`/`topeEntrega`.
- **Zonas varadas** (`Zonas`, `Varados`): 9, sobre las rutas entre puestos y nunca a < 90 de un puesto ni < 220 del spawn (donde están
  el lobby, el coliseo, la caseta y la casa). Los varados son zombis a los que se les quitó su IA de ataque: el objetivo automático de
  vanilla se cancela y solo `Sigilo` decide cuándo atacan (alcance base 20 × lo que hagas: moto 2,2, correr 1,6, caminar 1, lento 0,7,
  agachado 0,4, quieto 0,25; cono de 140° y línea de visión; a < 2,5 bloques te oyen). La alerta SUBE mientras te ven y BAJA si te
  pierden: al llegar a 1 atacan (y los de 12 bloques se unen). Existen solo con jugadores cerca (no persistentes). Dentro de una zona
  llueve solo para quien está en ella.
- **Odradek**: se entrega solo al aceptar el primer encargo (y se re-entrega si se pierde con uno en curso). Activo = lo tiene Y está en
  una zona (o lanzó un pulso). Activo, el varado deja de estar oculto para él (`hideEntity` por jugador), la barra de acción muestra
  flecha, metros y la barra de alerta, y suena un ping más rápido cuanto más cerca. Es un ítem ligado (no se tira ni se guarda en cofres).
- **Moto** (`Moto`): un CABALLO invisible/mudo/invulnerable, a velocidad fijada por el plugin, con un modelo de 20 `BlockDisplay`
  pasajeros (el conductor tiene que ser el PRIMER pasajero: el caballo solo deja controlar al primero; `montar` baja y vuelve a subir
  los displays). Se GANA (3 entregas; libre para las fichas de `moto.libre-para-fichas`, reconocidas por la ficha VINCULADA vía
  `slugDe`, nunca por el nombre de cuenta) y se entrega como **Llave de moto** (ítem ligado). Trampas que ya costaron:
  · **Clicar la moto con la llave en la mano la reemplazaba**: el cliente manda «usar sobre la entidad» Y «usar el ítem»; el segundo
    retiraba la moto recién montada y tiraba al conductor. Hoy la llave MONTA tu moto si está a ≤ 8 bloques y no hace nada montado.
  · **Medidas reales, no estimadas** (servidor de prueba + cliente): un pasajero se ancla a **1,444 × escala** sobre los pies del caballo
    (lineal: 1 → 1,444, 0,8 → 1,155) y 0 en X/Z. Con escala 1 el conductor quedaba ~25 cm alto: el caballo va a **escala 0,82**.
  · Un caballo invisible SIGUE dibujando silla y riendas: la silla lleva un modelo de equipo inexistente (`vtuberdex:vacio`).
  · Los displays nacen con guiñada 0 (si heredan la de quien llama, la moto sale «ladeada» ese ángulo).
  · La caja del caballo es menor que el modelo: hay una `Interaction` de 1,8×1,1 que sigue al caballo (no como pasajera: se anclaría
    a 1,18 de alto) y se encoge a 0 montado (si no, se tragaría los clics del conductor).
  · Aparece en el primer hueco libre con suelo firme por delante (antes, a ciegas, podía quedar dentro de un bloque).
- **Probar con un cliente REAL (lo que de verdad funcionó)**: Paper de prueba (la versión del encabezado) + `portablemc` (cliente 26.2 offline, instalado en
  `~/.local/share/vtuberdex-build/mc-cliente`, NO en /tmp que es RAM) en `Xvfb` con `LIBGL_ALWAYS_SOFTWARE=1`, control por XTest
  (`python-xlib`), capturas con `ffmpeg -f x11grab`, y una web falsa que vincule a todos (con HTTP/1.0: con keep-alive el cliente HTTP
  de Java daba timeouts). Para ver al propio jugador montado hace falta un SEGUNDO cliente observador en espectador (otro Xvfb). No
  hay bot posible: `minecraft-data` llega a 26.1. Al matar procesos, por PID: `pkill -f <patrón>` mata la propia shell si el patrón
  aparece en el comando.
- **Mapa** (`Mapa`): UN mapa compartido (escala 1:16) con una capa contextual que pinta puestos, zonas y el destino del encargo.
- **Qué NO está probado**: en vivo, la IA de los varados, su visibilidad y el mapa (la moto sí, ver arriba). Lo comprobado: compila contra la versión de Paper del encabezado, 22 pruebas de lógica pura (geometría, sigilo,
  recompensa, contratos, zonas), y un Paper de prueba (misma versión del encabezado) carga los tres plugins, construye los 6 puestos y crea las 9 zonas sin errores.
  Falta jugarlo con un cliente real; las perillas para afinarlo están en `config.yml` del plugin.

## Habilidades del RPG: catálogo de estados y validador

Las reglas MECÁNICAS del «prompt maestro» de habilidades viven en `server/src/habilidades.mjs` (JS puro, probado en
`server/test/habilidades.test.mjs`): los 42 estados con su color oficial, polaridad (`positivo` se obtiene, `negativo` se
aplica, `ambos` para Hackeo/Hemofagia/Drenaje Arcano/Usurpación/Soul Trader, que las fichas usan de las dos formas), su
evolución con los efectos OFICIALES y la facción exclusiva (Juramento, Requiem, Soul Trader, Epopeya, Fortificación).
`spanDeEstado`/`bloqueDeEvolucion` pintan el HTML; `validarKit` dice qué regla se rompe (error) o qué conviene revisar (aviso).

- **Solo valida lo que se lee en el HTML**: si sale del lore, si hay narrativa, si la Habilidad Única es única o si está
  balanceado NO se comprueba (eso lo decide una persona). El MP no está en `effect_html`: no se valida.
- **El estado se cuenta si lo ENTREGA un verbo** («obtienes/aplicas X [y Y]»); nombrarlo en una condición no cuenta.
- La evolución lleva el color de su base; Hackeo y System Override, el degradado. Nombres canónicos = lista de colores
  (`Deux ex Machina`, `Mente Agil`, `Glotoneria`); los alias se aceptan con aviso.
- Medido al escribirlo (base empaquetada, 211 kits): 18 limpias, 150 con algún error; 114 Ultimates con estado base.
- **Pasos de la ficha en el mantenedor**: Atributos, Habilidades y Redes sociales son TRES pasos (antes uno solo, una
  sábana). Atributos es una línea por atributo con su barra (`steps/attributes-step.tsx`); Habilidades, una línea por
  habilidad con su estado (punto verde/ámbar/rojo según `validarKit`) que se despliega para ver y editar a mano
  (`steps/skills-step.tsx`).
- **Asistente de kit** (`components/admin/kit-builder.tsx`, sustituye a la lista mientras está abierto; lógica pura y
  probada en `kit-habilidades.ts`): va PIEZA POR PIEZA (Activa 1 … Ultimate, Revisar), cada una con su vista previa y lo
  que dice hoy la ficha al lado. Menús (estado por polaridad,
  exclusivos de otra facción deshabilitados, 3 fórmulas de Ultimate, Habilidad Única opcional) y el texto libre admite `[[Estado]]`
  → `<span>` oficial. Lo escrito a mano se ESCAPA. «Usar este kit» solo reemplaza las habilidades del formulario (las `other` se
  conservan); se publica con el Guardar de siempre. Precarga nombres y pasivas del kit existente; activas y Ultimate se rehacen.
  Ojo: los puntos de «Mi ficha» van por NOMBRE de habilidad: renombrar los deja de contar (la confirmación lo avisa).
- **`effectHtml` viaja en el PATCH y se GUARDA** (`skillSchema`, `aplicarParche`). Antes `mutations` lo ponía a `null` siempre, así
  que tocar UNA habilidad borraba los colores de TODO el kit (el PATCH reenvía la lista entera). Hoy el formulario lo devuelve tal
  cual y solo lo suelta en la habilidad cuyo texto se reescribe a mano. Como la ficha pública lo inyecta como HTML, el servidor
  acepta solo lista blanca (`htmlDeHabilidadSeguro`: `<br>`, `<span style>` sin `url(`, `<b>/<i>`, el `<div>` del scrape y
  comentarios; las 1.055 habilidades del scrape pasan, comprobado: si no, reenviar su kit daría 400).

## Datos personales ocultos en el mantenedor (streaming)

El mantenedor se usa en directo: todo correo y el nombre civil nacen OCULTOS (`components/admin/dato-oculto.tsx`) y se revelan
uno a uno con «Mostrar»; al volver a montar, se ocultan otra vez (no se guarda). Cubre la cabecera («Sesión de …», el usuario es el
correo del admin), el correo de la ficha (paso Identidad: «Mostrar y editar»; si nace vacío, lo que se escribe queda a la vista),
el contacto de una solicitud (correo y nombre civil), «resuelta por» y el actor de «Actividad reciente» (`QuizasCorreo`: solo si
parece un correo). La máscara es de largo FIJO (`MASCARA_CORREO`): copiar el largo o el dominio ya daría pistas. Si añades una vista
que muestre un correo, envuélvelo igual. Ojo: un botón dentro de un `<label>` (`Field`) hereda el texto de la etiqueta como nombre
accesible; por eso los botones llevan `aria-label` explícito.

## Dados de rol 3D (pestaña «Dados» del mantenedor)

El admin tira los dados de la partida (la X de una Ultimate «Lanza 2d6», o cualquier tirada) en `components/admin/dados-panel.tsx`;
la escena es `components/dados/` (un canvas, montado solo con la pestaña abierta).

- **El resultado NO sale de la animación**: `tirar` (`dados-geometria.ts`) usa `crypto.getRandomValues` con rechazo (sin sesgo de
  módulo) y el dado rueda hasta `orientacionFinal`, que deja ESA cara arriba (el d4, ese vértice). No hay motor de física: el tumbo
  es un giro que se deshace y rebotes que decrecen. El panel muestra el número al acabar la duración conocida (`DADOS.duracionMs`),
  no por aviso de la escena, así que se prueba sin WebGL.
- **Forma**: vértices → envolvente convexa → caras (triángulos coplanares fundidos). Opuestas suman N+1; el d10 es un trapezoedro
  pentagonal cuyas cometas solo son planas con el zigzag `H·(1−cos36°)/(1+cos36°)`. Bisel = envolvente de las caras encogidas
  (`DADOS.bisel`). Todo probado en `dados-geometria.test.ts` (planitud, N+1, la cara de arriba es el resultado, UV no espejadas).
- **Cristal**: `MeshPhysicalMaterial` con transmisión, `dispersion` y atenuación; reflejos de un `RoomEnvironment` local (sin HDR
  descargado). Un atlas GRIS por tipo (`atlas.ts`) hace de `roughnessMap` (grabado esmerilado), `bumpMap` con escala NEGATIVA
  (relieve inverso: el número se hunde) y `emissiveMap`. Sin la trama del tapete la refracción no se nota.
- **Humo espectral** (`humo.ts`): cuadro-billboard con fbm, aditivo y SIN prueba de profundidad (el cuerpo con transmisión escribe
  profundidad y lo taparía); la luz puntual de cada dado usa el mismo matiz y tiñe el tapete: es lo que asienta los dados en la mesa.
- Calibrado mirando la escena en Chromium con SwiftShader (página temporal + CDP). Sin medir en GPU real; perillas en `ESCENA` y `HUMO`.

## Idiomas (es / en / ja) y traducción de la historia

La interfaz pública es trilingüe, **español por defecto**. Código en `lib/i18n/` (JS/TS puro, probado).

- **Sin prefijo en la URL** (la URL es el estado de la búsqueda, regla 6) y **sin leer `Accept-Language` en el
  servidor** (haría dinámica la home estática y su JSON-LD). El HTML del servidor es siempre español, que es lo que
  indexan los buscadores; `I18nProvider` (en `app/layout.tsx`) arranca en `es` y, ya hidratado, aplica
  `elegirLocale(localStorage 'vtuberdex:idioma', navigator.languages)`. Selector en la cabecera (`language-switcher.tsx`).
  Sin proveedor `useI18n` devuelve español: los componentes se prueban sin envolver nada.
- **Textos**: `lib/i18n/es.ts` es la fuente de claves; `en.ts`/`ja.ts` se tipan contra ella (falta o sobra una → `tsc`
  falla) y `i18n.test.ts` exige mismas claves y mismos marcadores `{x}`. Plurales `x_one`/`x_other` con
  `t('x', { n })`. **Al añadir texto a la UI pública, añade la clave en los tres.**
- **Datos de la base** (`lib/i18n/nombres.ts`): países vía `Intl.DisplayNames` con el ISO sacado del emoji de bandera,
  idiomas por su código, etiquetas de la ficha (con las erratas del scrape: `Pais`, `Hashtag arte`…), stats y tipos
  de habilidad por tablas cerradas. El texto libre (frases, valores de la ficha, nombres de habilidades) no se traduce.
- **Fuera de alcance, sigue en español**: formularios `/inscripcion`, `/modificacion`, `/baja`, `/terminos` (texto
  legal versionado: `TERMINOS_VERSION`), el mantenedor, los textos pintados en el canvas de la carta 3D (etiqueta de la
  placa premium) y los metadatos SEO del servidor.
- **Traducción al vuelo de la historia/frase** (`components/texto-traducible.tsx`, `lib/traductor/`): si
  `idiomaDelTexto` ve el texto en otro idioma que el de la interfaz, ofrece «Traducir a …». Corre EN EL DISPOSITIVO,
  solo al pulsar: 1) API nativa `Translator` del navegador (Chrome 138+ escritorio); 2) respaldo Transformers.js con
  `Xenova/opus-mt-{es-en,en-es,ja-en,en-jap}` (~100 MB cada uno, en caché del navegador), importado por URL desde jsDelivr
  con `webpackIgnore` para que no entre en ningún bundle. No hay modelo directo es↔ja: pasa por inglés. La calidad
  es↔ja por pivote es modesta. Sin medir en un navegador real (jsdom no tiene ninguno de los dos motores): las pruebas
  cubren la lógica pura y la API nativa simulada, no la descarga del modelo.

## SEO: qué dice el servidor sin JavaScript

El catálogo y la ficha se pintan en el cliente, así que el SEO vive en el `<head>` y en datos
estructurados que genera el servidor (`lib/seo.ts` puro y probado; `lib/seo-datos.mjs` lee la base).

- **`/v/:slug`**: `generateMetadata` (título = `<nombre> · VTuberDex`, igual que el `document.title` del
  cliente; descripción ≤160, canonical al slug VIGENTE, OG/Twitter con el personaje) + JSON-LD
  (`ProfilePage`/`Person`/migas). Un slug inexistente o en borrador es un **404 real** (`notFound()`).
- **`(dex)/layout.tsx` NO puede envolver `children` en `Suspense`**: con él Next manda el status 200 junto al
  esqueleto y el `notFound()` ya no cambia el código (soft 404; medido: 200 con él, 404 sin él). Cada página
  que usa `useSearchParams` lleva su propio `Suspense`.
- **`/`**: canonical siempre `/` (filtros y páginas son querystring: no se indexan como páginas aparte) + JSON-LD
  `WebSite`/`ItemList` (las primeras 24 fichas; la home es estática, se congela en el build).
- **`/sitemap.xml`** (dinámico, todas las fichas publicadas) y **`/robots.txt`** (bloquea `/api/` y `/admin`).
- **Dominio**: `SITE_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → localhost. Defínela en Vercel si hay dominio propio;
  no hay dominio fijado en el código a propósito (un canonical ajeno saca la página del índice).
- Al probar con `next start` por puerto, mata el proceso VIEJO por PID: un `EADDRINUSE` deja sirviendo el build anterior.

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

- **El canvas de la carta NO puede medir su propio contenedor (responsive roto al
  redimensionar en vivo).** three.js escribe el tamaño medido en el estilo INLINE del
  canvas (`width: 414px`), y un canvas en el flujo aporta ese ancho a la cadena de
  `min-content` de sus ancestros: el contenedor queda con un SUELO igual al tamaño que
  ya tenía, no puede encoger y el `ResizeObserver` que debería re-medirlo no ve ningún
  cambio. Es un lazo cerrado —la medida vieja impide la nueva— y solo aparece cuando el
  viewport cambia SIN recargar (rotar el móvil, girar la tablet, abrir el inspector).
  Medido en la ficha al pasar 1440x900 → 390x844: el canvas se quedaba en **414 px CSS
  (745 px de búfer)** dentro de una columna de 332 px, y con el viewport en 320 seguía
  en **694 px desbordando la página**. La carga en frío del mismo tamaño da 332/597
  exactos, así que el encuadre y la cámara NO tenían nada malo.
  El arreglo es que el canvas no participe en el layout: raíz `relative` + caja
  `absolute inset-0` en `holo-card.tsx` (la grilla no lo sufría porque su caja de
  aspecto ya lleva `overflow: hidden`, que exime al contenedor del `min-content` del
  hijo). Verificado al volver a medir: 390 → 332/597 y 320 → 262/471, idénticos a la
  carga en frío en las dos vistas.
  **Ningún gate lo ve**: jsdom no calcula layout, `tsc` y el build no leen CSS, y
  `check:shaders` mira uniforms. Lo fija `components/holo-card-layout.test.ts`, que
  comprueba por texto que la caja posicionada siga ahí (el resto de la clase está en la
  skill `threejs-r3f-webgl-rendering`).

- **El libro de cartas (`card-binder.tsx`) tiene reglas de geometría que ningún gate ve
  salvo `card-binder-layout.test.ts`.** La hoja gira alrededor del lomo (x = 0) con un
  ángulo de signo NEGATIVO al avanzar: con el signo contrario `z' = -x·sin θ` manda la hoja
  hacia DENTRO de la tapa y el giro se ve «por detrás». Las cartas del dorso van en su
  funda de DESTINO giradas media vuelta (`sheetCardLocalMatrix(..., 'back')`): al empezar
  quedan reflejadas detrás de la hoja de origen y, al completar PI, caen exactamente en
  la funda donde luego viven fijas, así que la MISMA `key` (el `id` de la carta) pasa de
  «dorso» a «fija» sin remontarse ni regenerar texturas. La cara de cada carta flota ~0.16 sobre la
  hoja (ya no hay cuerpo extruido: se retiró por coste, ~2.000 triángulos y un draw call por carta),
  por eso las fijas que una hoja tapa se esconden hasta
  que gira `BINDER.revealAngle` (0.2 rad), y las que va a tapar se esconden ese mismo
  ángulo antes de aterrizar: sin eso las caras atraviesan la hoja cerca del lomo. Si la página
  siguiente no llegó de la API, el giro se queda en pie en `holdProgress` (90°) y sigue
  al llegar (`advanceFlip` integra por `delta`, no por marca de inicio, así no salta).
  Las texturas de las 8 cartas se generan EN COLA (`encolarTrabajo`, una por vuelta del
  event loop): las ocho a la vez bloqueaban el hilo en un tramo largo. El entorno
  metálico y su PMREM se cargan una vez por escena (`useSharedCardEnv`) y se reparten
  por contexto; la carta suelta del detalle sigue cargando el suyo.
  **En celular (viewport < `BINDER.singleMaxWidth`, 640 px) cada PÁGINA son 4 cartas en
  UNA hoja**: con el libro entero encajado en 390 px cada carta medía ~70 px. Lo decide el
  CATÁLOGO (`useSingleSheet`, por `matchMedia` en un efecto: el servidor no tiene viewport)
  porque cambia lo que se pide a la API: `useVtuberSearch({ perPage: 4 })`, y la clave de
  la caché de páginas lleva ese `perPage`. En el libro (`single`), las 4 cartas van en la
  hoja DERECHA (`planPlacements(..., { singleSheet: true })`), la cámara encuadra solo esa
  hoja y la izquierda queda vacía; avanzar gira la hoja derecha con las salientes y destapa
  las entrantes, retroceder trae la hoja izquierda con las entrantes en el dorso. El número
  de página de la URL cuenta hojas de 4 en celular y de 8 en escritorio: un enlace compartido
  entre ambos cae en cartas distintas, y se aceptó a cambio de no mezclar dos paginados.
- **Pasar de página no debe esperar a la red: las páginas vecinas se PRECARGAN.** Medido
  por el usuario como «demasiado delay» al avanzar/retroceder: el libro dejaba la hoja en
  pie hasta que la API respondía y después cada carta esperaba sus imágenes. Hoy
  `lib/cache-paginas.ts` guarda cada respuesta en un LRU por clave de consulta (filtros +
  orden + página, `perPage` normalizado a 8) y, `RETRASO_PRECARGA_MS` después de mostrar
  una página, pide la anterior y la siguiente en segundo plano y calienta sus imágenes.
  `loadImage` (`card-texture/imagen.ts`) memoiza la PROMESA por URL (LRU de 96), así que
  dos cartas con el mismo emblema comparten petición y una carta precargada genera su
  textura sin red. Un fallo no se memoiza (se reintenta) y las URLs versionadas (`?v=`)
  del mantenedor invalidan solas. La caché es de módulo y sobrevive a ir a una ficha y
  volver; los tests que montan el catálogo deben vaciarla (`__limpiarCachePaginas`) en
  `afterEach`, o leerán la página de otro test.
- **Generar las texturas de las cartas es lo que cuesta, no traer los datos.** Medido al
  cargar una página de 8: la API tarda 11-45 ms y el hilo principal quedó bloqueado 6,5 s
  (4 lienzos por carta más dos máscaras píxel a píxel). `card-texture/fabrica.ts` es la
  única puerta de generación y aplica tres medidas, con sus perillas en `TEXTURAS`:
  (1) PROGRESIVA: `generarRapida` (superficie, personaje, título) muestra la carta y
  `completar` añade marca y máscaras REUTILIZANDO esas capas (`reutilizar` en
  `drawCardLayers`), nada se dibuja dos veces; (2) CACHÉ LRU por carta y ancho con presupuesto en PÍXELES
  (`cacheMaxPixels`), con las cartas montadas ancladas (`anclar`) para que no se
  desalojen debajo de quien las usa, los canvases se cachean y las `CanvasTexture` se crean
  por montaje porque pertenecen a un renderer; (3) PREGENERACIÓN: `pregenerar` encola con
  prioridad BAJA y en `requestIdleCallback` las cartas de las páginas vecinas que trajo
  `cache-paginas`, y un trabajo bajo que ya tenía turno lo CEDE si llega uno alto. Las
  máscaras corren en un Web Worker (`mascaras.worker.ts`, matemática pura en
  `mascaras-puras.ts` compartida con el camino síncrono de respaldo): el hilo principal
  solo dibuja, lee y escribe píxeles. Dos trampas: la cola ejecuta de UNO en uno con un
  `setTimeout 0` entre trabajos (ocho a la vez bloqueaban en un tramo), y `buscarEnCache`
  REJUVENECE la entrada (LRU), así que una consulta la aleja del desalojo. `precalentarMascaras()`
  arranca el worker mientras se descargan las imágenes. **NO hay calidad adaptativa**: hubo una que medía la
  generación y bajaba el ancho 512 -> 384 -> 256 (y otra, `card-quality.ts`, que elegía nivel por
  `hardwareConcurrency`/`deviceMemory`/táctil/`saveData`/`prefers-reduced-motion`); se retiraron. El ancho es FIJO
  (`TEXTURAS.ancho` = 512 en el libro, `CARD_TEXTURE_FULL_WIDTH` en el detalle) y el canvas usa `dpr={[1, RENDER.dprMax]}` (2; el único mando de resolución). Medido con
  canvas por CPU (`--disable-accelerated-2d-canvas`; con SwiftShader el canvas 2D también
  va por software y las cifras no valen): ~14 ms la etapa rápida y ~13 ms de CPU la
  completa por carta a 512, máximo 40 ms de pared, y 24 aciertos de caché al volver a una
  página. Las etapas emiten `performance.measure` (`textura-rapida:*`,
  `textura-completa:*`, `textura-completa-cpu:*`, `textura-cache`) para leerlas en la
  pestaña Performance sin tocar el código.
- **NO hay vista 2D de respaldo: el producto asume que quien lo ve tiene GPU.** Se retiraron
  `BinderFallback`/`FallbackPage`, `CardTile`, `CardFallback`, `supportsWebGL` y la prop `active` de
  `HoloCard`: eran DOM y un probe de contexto cargados para un caso que no existe. El libro y la ficha
  montan SIEMPRE un `<Canvas>` (tras hidratar: antes es solo la caja con la proporción del libro). Si el
  contexto se pierde, `webgl-recovery.ts` remonta; si agota los intentos, el libro muestra
  `BinderUnavailable` («No se pudo mostrar el libro 3D», botón Recargar). La lista `sr-only` de enlaces
  (`data-testid="binder-link"`) queda SIEMPRE en el DOM: es la accesibilidad y lo que ve un rastreador.
  `prefers-reduced-motion` ya no cambia nada de la carta (no hay niveles de calidad). jsdom no tiene WebGL, así que `test/setup.ts` sustituye el `<Canvas>` de R3F por una caja
  inerte (`data-testid="r3f-canvas"`); lo que se prueba es el contrato de DOM, no la escena.
- **El canvas NO corre a 60 fps continuos, y un `contextlost` ya no es permanente.** Antes el
  `<Canvas>` iba en `frameloop="always"` y el primer `webglcontextlost` dejaba un 2D hasta
  recargar (`setLost(true)` sin vuelta). Hoy (`components/render-governor.tsx`, lógica pura en
  `render-pacing.ts`, perillas en `RENDER` de `card3d-config.ts`): `frameloop="demand"` y un
  gobernador que (1) PAUSA del todo fuera de pantalla (IntersectionObserver) o con la pestaña
  oculta, (2) baja a `idleFps` en reposo y con interacción topa a `RENDER.activeFps` = **60** (se probó 24: en 60 Hz alterna 33/50 ms y se ve menos suave; agenda FIJA `nextSchedule`, porque comparar con el último frame real rinde menos fps que los pedidos), y NO hay DPR adaptativo (hubo uno que medía la cadencia y realocaba el framebuffer; se retiró: la resolución es fija).
  `advanceFlip` recorta el delta a `RENDER.maxDeltaMs` (70: debe superar el paso de 50 ms del reposo): el primer frame del giro llega tras uno de
  reposo (50 ms) y adelantaba la hoja de golpe. `webgl-recovery.ts` desmonta el canvas,
  espera `cooldownMs` y REMONTA un canvas nuevo (`key`); no sigue en sitio tras
  `webglcontextrestored` porque el PMREM no sobrevive y el metal saldría negro.
  Trampas: (a) desmontar un Canvas dispara `webglcontextlost` en el canvas viejo
  (`forceContextLoss`): el hook solo acepta el evento del canvas VIGENTE; (b) el reloj de three
  sigue corriendo en pausa, así que al reanudar se descarta con `clock.getDelta()` o `advanceFlip`
  (integra por delta) saltaría el giro; (c) `PerformanceMonitor` de drei NO sirve: contaría el reposo (20 fps a propósito) como lento.
  Medido en chrome-headless con SwiftShader: fuera de pantalla = 0 frames/s y tras `loseContext()`
  el canvas vuelve a los ~2,5 s; los topes de fps no se pueden medir ahí (el rasterizador por
  software satura antes), los cubre `render-pacing.test.ts`. Sin medir aún: GPU real.
- **El tirón al pasar de página era `getImageData` sobre canvases ACELERADOS.** Las 7 capas de cada carta
  (`createLayer`, `card-texture/lienzo.ts`) nacían como canvas 2D acelerados por GPU y `completar` las
  copia a `flat` y lee píxeles para las máscaras: cada lectura es una espera sincrónica GPU -> CPU en el
  hilo principal, justo mientras las 4 cartas entrantes generan texturas. Perfil de CPU de CDP del giro
  (mismo flujo): `getImageData` **2.596 ms** acelerado frente a **205 ms** con canvas en CPU; con
  `willReadFrequently` en `createLayer`, 221 ms, y las tareas largas del primer giro pasaron de 7 (hasta
  972 ms) a 6 (máx. 141 ms) y el segundo giro quedó sin ninguna. Ojo: `flat` YA lo tenía y no bastaba, porque
  el coste estaba en LEER las capas de origen. Ningún gate lo ve; para repetirlo, `Profiler.start` por
  CDP durante el clic en «Página siguiente» y ordenar por tiempo propio. Lo fija `lienzo.test.ts`.
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
- **Para entrar a `next dev` por nombre/IP desde otro equipo: `allowedDevOrigins`.**
  El antiguo `web/vite.config.ts` (y su `VTUBERDEX_ALLOWED_HOSTS`) desapareció con la
  migración a Next: hoy `next.config.mjs` lista las IPs/hostnames permitidos
  (`192.168.100.90`, `fuchikoma`, `*.local`, IP de Tailscale). Sin la entrada, Next 16
  bloquea HMR y chunks al navegar desde fuera y los módulos `ssr:false` no hidratan.
  Al cambiar de red, añade la IP ahí.
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
  igual en qué subcarpeta estés— o desde la raíz del repo. `node scripts/admin-hash.mjs`
  (`scripts/admin-hash.mjs`) es el que produce `VTUBERDEX_ADMIN_PASSWORD_HASH` para
  Vercel: sin TTY lee la clave de una línea de stdin en vez de colgarse en un `await`
  que nunca resuelve (que Node reportaba como "unsettled top-level await").
- **Cambiar la contraseña del mantenedor son DOS pasos, no uno.** Vercel **hornea las
  variables por despliegue** ("changes to environment variables are not applied to previous
  deployments"): `vercel env add ... VTUBERDEX_ADMIN_PASSWORD_HASH production` guarda el hash
  pero el despliegue que ya estaba sirviendo sigue comparando contra el ANTERIOR, y el login
  responde el mismo `401 credenciales_invalidas` de una contraseña equivocada. Hay que
  **redeployar** (`vercel redeploy --target production`, o un `vercel deploy` nuevo) para que
  la función reciba el valor actualizado. `node scripts/verificar-admin-prod.mjs` comprueba el resultado
  (login real + sesión en Turso) y, si hay 401, distingue "hash mal pegado" de "contraseña
  equivocada" leyendo el diagnóstico de FORMA que ahora devuelve el 401.
- **El mantenedor escribe en TURSO, y por eso hay contenido que SOLO existe ahí.** Las
  ediciones de texto y los reemplazos de imagen del mantenedor son filas de Turso: no pasan
  por `data/images/` ni por la base local, y **no vuelven solas**. `data/images/` es un
  artefacto del scrape, así que sin bajar nada el disco se queda con la versión del día del
  scrape y probar en local (`dev-up.sh`, que corre SIN Turso) pinta las imágenes VIEJAS
  mientras producción pinta las nuevas. Medido cuando se escribió `download:images`: de 84-90
  filas `origen = 'mantenedor'`, **cero** coincidían con el disco y 30 de los 31 fondos no
  existían allí. `npm run download:images` (ver «Publicar y bajar imágenes») es el camino de
  vuelta; los bytes de Turso **son** el respaldo del mantenedor, no hay otro.
  - **Los reemplazos se bajan a `data/mantenedor/`, nunca a `data/images/`.** Antes
    `download:images` escribía sobre el MISMO archivo canónico
    (`data/images/<carpeta>/<slug>.webp`), así que con `--origen todos` el orden de la
    consulta decidía qué quedaba en disco: medido, el `catalogo` **pisó 58 reemplazos** del
    mantenedor y el script no lo dijo. Un solo camino de escritura por imagen es la regla del
    repo, y aquí el camino bueno es la carpeta aparte. Los reemplazos van a `data/mantenedor/`
    (ignorada por git), la app local los sirve ENCIMA del catálogo —misma precedencia que
    `leerAssetRemoto`— y `publish:images` **se niega a subir** si encuentra reemplazos dentro
    de `data/images/`, porque subirlos los guardaría como `origen = catalogo` y perdería la
    imagen pública original (que es la única copia que existe).
  - **La fila local `asset.path` lleva el prefijo `images/`, el archivo está en
    `data/images/`.** La fila no guarda la ruta del archivo: guarda la clave pública que
    `mapCard` convierte en `/images/...`, que es la única URL que atiende
    `app/images/[...path]`. Escribir ahí la ruta de disco (lo natural, y el primer error de
    `download:images`) devuelve `/background/<slug>.webp` en vez de
    `/images/background/<slug>.webp`: la imagen queda escrita en disco, la API responde 404 y
    **no hay ningún error en los logs** — el mismo síntoma mudo que el resto de esta sección.
    `download:images` normaliza la fila de todo lo que esté bien en disco, así que correrlo
    otra vez repara una base escrita por la versión con el fallo.
- **El mantenedor escribe en TURSO, no en Blob, y Blob ya no se usa.** La primera
  versión subía las imágenes a Vercel Blob y el store quedó **bloqueado** (los 2.000
  "Advanced Operations" del plan Hobby se agotaron con 1.625 `put`; el bloqueo dura
  30 días). Turso resuelve las dos cosas con un servicio: las EDICIONES son filas de
  `edicion` y las IMÁGENES filas de `asset_remoto` con los bytes en un BLOB (73 MB =
  1,5% de los 5 GB gratuitos). `app/images/[...path]/route.js` **consulta Turso
  PRIMERO**; el 301 a Blob sigue en el código pero es la rama muerta (por eso
  `npm run verify` aún comprueba "301 a Blob": prueba esa rama con `VTUBERDEX_BLOB_BASE`
  definida). El fallo que causó: `usesLocalImages()` decide "modo local" mirando esa
  variable, y **en Vercel NO está definida**, así que la ruta se creía en local,
  buscaba en `data/images/` (que no viaja al deploy) y devolvía 404 a las 1.593
  imágenes que sí estaban subidas — con el catálogo funcionando y las imágenes no.
- **`asset_remoto` distingue `origen` (`catalogo` vs `mantenedor`), y borrar un
  reemplazo NO puede tocar el original.** La primera versión guardaba las dos cosas
  en la MISMA fila `(slug, kind)`, así que subir una imagen **destruía la única copia
  del original** y borrarla dejaba el hueco sin vuelta atrás (no era caché: la imagen
  ya no existía en ningún sitio). Si tocas esa tabla, mantén la clave de tres columnas.
- **La URL de una imagen reemplazada lleva la VERSIÓN (`?v=`); sin eso el navegador
  sigue mostrando la vieja.** La ruta es canónica por diseño (`/images/<kind>/<slug>.webp`:
  el scraper y el mantenedor escriben el MISMO archivo), así que reemplazar no cambia la
  URL y nadie vuelve a pedirla: el navegador y el CDN sirven su copia. El `?v` sale de
  `actualizado` (`lib/ediciones.mjs`, `marcaDeVersion`) y viaja en `images[kind]`
  (`aplicarImagenesDelMantenedor`), así que **todas** las vistas se invalidan solas: la
  carta 3D, el listado y la ficha. Antes el gestor de imágenes tenía su propio `?v` local
  y por eso el fallo parecía resuelto mientras el resto seguía mostrando la anterior.
  - **`actualizado` se escribe con MILISEGUNDOS desde JS** (`ahoraConMilisegundos`), no con
    `datetime('now')`: esa función tiene resolución de un segundo y dos reemplazos seguidos
    daban la MISMA versión, así que el segundo salía invisible. Las filas antiguas conservan
    el formato viejo: la marca se reduce a dígitos, así que los dos se toleran.
  - **Bajar el `max-age` NO arregla esto** (la copia vieja vive hasta que expire, y el
    usuario mira justo en ese hueco) y quitarlo castiga a las 1.593 imágenes del catálogo,
    que no cambian nunca. La versión en el query invalida al instante sin tocar las demás.
  - **En local (`data/images/`) la rama de disco revalida con `ETag`** (mtime + tamaño) y
    sirve `no-cache`: ahí el mantenedor reescribe el archivo y con `max-age=3600` el búfer
    viejo duraba una hora. El 304 responde sin cuerpo.
  - **Republicar NO reescribe las filas del catálogo**: `publish-images.mjs` solo sube lo
    que cambió de tamaño, así que las URLs versionadas del catálogo no rotan en cada pasada.
- **`VTUBERDEX_ADMIN_PASSWORD_HASH` no va marcado _sensitive_.** El panel y
  `npx vercel env add` lo ofrecen por defecto, y Vercel guarda esos valores en un
  **formato ilegible para siempre**: ni el CLI, ni `vercel env pull`, ni la API con
  `decrypt=true` dejan volver a leerlos (devuelven un placeholder o un sobre cifrado;
  comprobado). Un hash `scrypt` no es un secreto reutilizable —es irreversible y
  salado—, así que se guarda como _encrypted_/**Config** (`--no-sensitive`) y se puede
  releer para comparar. `formatoDeHash` (`lib/admin-auth.mjs`) solo describe la FORMA.
  **Lo mismo vale para `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`**: hoy están como
  _sensitive_ en producción y por eso `npm run bench:ediciones` mide con un stub en vez
  de contra el servicio real.
- **`scripts/` no tiene subcarpeta de sondas.** `scripts/*.sh` es infraestructura del
  repo (`dev-up.sh`, `dev-docker.sh`, `refresh.sh`) y `scripts/*.mjs` son utilidades
  (`build-db`, `verify-vercel-bundle`, `check-shaders`, `probe-timings`,
  `bench-ediciones`, `sweep-dead-code`, `admin-*`). Las sondas de desarrollo que
  vivían en `web/scripts/*.mjs` (medir tinte, volcar texturas, capturas) **se fueron
  con el árbol `web/`**: hoy no hay script `shots`. Para una captura suelta, el
  `chrome-headless-shell` de `~/.hermes/cache/chrome/chrome-headless-shell-linux64/`
  funciona (`--headless --screenshot=... --virtual-time-budget=9000` sobre la URL).
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

## Despliegue en Vercel (HISTÓRICO)

> **Ya no se despliega en Vercel.** Producción es la VPS (ver «Despliegue en VPS») y el workflow
> `deploy.yml` se eliminó: el CI solo valida. Esta sección y el código de compatibilidad que conserva
> (build `standalone` opt-in, rama de Blob en `/images`, `outputFileTracingIncludes`) describen cómo era.
> Si el proyecto sigue enlazado en Vercel, su integración Git seguirá construyendo cada push a `master`:
> se corta desconectando el repositorio en el panel de Vercel (no es algo que viva en este repo).

La app es **Next.js con App Router** (Vercel la detecta como framework nativo). El
catálogo corre como funciones con SQLite empaquetada; las imágenes y las ediciones del
mantenedor viven en **Turso** (Blob quedó atrás, ver «Trampas conocidas»). El
mantenedor **sí responde en producción** (`/api/admin/*`, login real contra Turso).

```
GitHub vtuberdex/vtuberdex ─▶ vercel build ─▶ app/ (Next)
                                               ├─ app/api/*              → SQLite (readOnly, del bundle)
                                               ├─ app/images/[...path]   → Turso (BLOB) o disco local
                                               ├─ app/api/admin/[...path]→ Turso (401 sin sesión) o Express local
                                               └─ app/(dex)/*            → catálogo + detalle
```

```bash
npm install                      # deps del proyecto (root)
npm run build                    # next build (usa deploy/ ya construido)
npm run build:data               # regenera deploy/ desde data/ (local, tras scrape o edición)
npm run verify                   # 32 comprobaciones sobre un escenario de producción
npx vercel deploy --prod         # (HISTÓRICO) ya no se despliega en Vercel: ver «Despliegue en VPS»
```

`npm run publish:images` sube las imágenes a **Turso** (`asset_remoto`), no a Blob; es
idempotente y reanudable. **`npm run download:images` es el sentido contrario** y existe
porque la mitad del contenido del mantenedor NO está en el disco de nadie más que en Turso
(ver «El mantenedor escribe en Turso»). Para el mantenedor en producción están
`node scripts/publicar-admin-prod.mjs` (alta del usuario admin) y `node scripts/verificar-admin-prod.mjs` (login real de punta a punta).

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
7. **Las imágenes se resuelven en runtime por dos ramas, y Turso es la primera.**
   `app/images/[...path]/route.js` consulta `asset_remoto` en Turso y, si `origen` es
   `mantenedor`, sirve ese BLOB; si no hay Turso, cae al disco en DOS raíces y por este
   orden: `data/mantenedor/` (los reemplazos bajados con `download:images`) primero y
   `data/images/` (el catálogo) después. La
   rama del 301 a Blob sigue en el código pero **no se alcanza en producción** (no hay
   `VTUBERDEX_BLOB_BASE`): `npm run verify` la prueba a propósito poniendo esa variable.
   El manifiesto guarda rutas canónicas, no URLs. Cachea `public, max-age=60` +
   `s-maxage=300`; el borde respeta 300 s (medido: `x-vercel-cache: MISS` a los 305 s).
8. **El deploy NO publica ni pisa las imágenes de producción.** `vercel deploy` sube la
   app y `deploy/data/` (base saneada + manifiesto) y nada más: los bytes de las imágenes
   viven en `asset_remoto` de Turso y **el repo no los toca**. Con Turso configurado la
   ruta sirve el BLOB remoto e ignora el manifiesto, así que desplegar no reescribe lo
   que ya está publicado. Por eso `deploy/` se revierte a HEAD antes de desplegar si un
   `build:data` de prueba lo movió (un `generatedAt` distinto basta para ensuciar el diff)
   y por eso `publish:images` es el ÚNICO camino de subida y **se niega a subir** si
   encuentra un reemplazo del mantenedor dentro de `data/images/` (ver «Publicar y bajar
   imágenes»). Para subir contenido nuevo de forma deliberada está `npm run publish:images`,
   nunca el deploy.
9. **El mantenedor SÍ existe en producción** (`app/api/admin/[...path]`), con Turso
   configurado: login real (401 sin sesión, verificado en producción) y escritura de
   ediciones e imágenes contra Turso. Solo devuelve 404 cuando **no** hay ni Turso ni
   proxy local — el 404 explícito que comprueba `npm run verify`. En local se reenvía
   al Express con `VTUBERDEX_ADMIN_URL`.
10. **El deploy NO puede ser por integración Git**: el team es **Hobby** y Vercel no
    conecta repos de organizaciones en ese plan (limitación de plataforma). Se
    despliega con `vercel deploy`, o con un GitHub Action con token.

### CI en GitHub Actions

Hay **un solo workflow, `ci.yml`**, que valida sin necesitar ningún secreto. No publica nada: el
despliegue es `scripts/release.sh` en la VPS (antes existía `deploy.yml` con `vercel deploy --prod`; se eliminó).
Corre con **Node 22**, el mismo que la VPS.

| Workflow | Cuándo                               | Qué hace                                                       |
| -------- | ------------------------------------ | -------------------------------------------------------------- |
| `ci.yml` | todo push (cualquier rama) y cada PR | lint, typecheck, check:shaders, las 3 suites, build y `verify` |

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
fichas, FTS5, facetas, detalle, validación 400), imágenes (rama de Blob con la variable
puesta, 404 en lo no publicado, **carpetas retiradas**), seguridad (base saneada, no
descargable, mantenedor en 404 **cuando no hay Turso**) y front.

Trampas que ese script ya encontró y conviene no reintroducir:
`res.sendFile` **falla en un FS de solo lectura** (daba 500 en rutas profundas del
SPA), y el "leak" de la base hay que comprobarlo por contenido, no por status.

## Imágenes: qué se publica y qué no

Publican **cuatro carpetas**: las tres primeras las produce el scraper y viajan
siempre; `background` es nueva y viaja **vacía** por defecto. La decisión es por
uso real verificado en el front, no por lo que exista en disco:

| Carpeta      | Estado                  | Por qué                                                                                                                                                          |
| ------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `character`  | ✅ publicado            | La imagen fuente del VTuber                                                                                                                                      |
| `logo`       | ✅ publicado            | Capa superior de la carta                                                                                                                                        |
| `faction`    | ✅ publicado            | Emblema que la carta superpone como holograma                                                                                                                    |
| `background` | ✅ publicado (1 objeto) | Capa POR DETRÁS del personaje, con holograma y paralaje propios. **El scraper NO la produce**: solo se llena si alguien sube una desde el mantenedor (hoy hay 1) |
| `thumb`      | ❌ eliminado            | Ninguna vista la pedía (18 MB)                                                                                                                                   |
| `avatar`     | ❌ eliminado            | Duplicado legacy de `character` (13 MB)                                                                                                                          |
| `ficha`      | ❌ eliminado            | Respaldo de `character`; hoy los 785 lo tienen (33 MB)                                                                                                           |
| `radar`      | ❌ eliminado            | Gráfico de atributos **dibujado desde los datos** por `StatBars` en la misma página (8 MB)                                                                       |
| `card`       | ❌ eliminada            | Vacía desde siempre                                                                                                                                              |

`data/images/` pasó de **143 MB a ~74 MB**; el manifiesto publica **1594** objetos
(785 `character` + 785 `logo` + 23 `faction` + 1 `background`), y `count` del
manifiesto cuadra con la suma. Las rutas de las carpetas retiradas responden
**404 explícito**, comprobado en `npm run verify`.

**Ojo:** los tipos `card`/`thumb`/`radar` siguen en el contrato de la API y en el
esquema de la base (el `seed` los sigue escribiendo); lo que se retiró es su
publicación. Si vuelves a necesitarlos, hay que reponer la carpeta en disco,
añadirla a `USED_FOLDERS` de `scripts/build-db.mjs` y republicar.

## Publicar y bajar imágenes: los dos sentidos de Turso

`asset_remoto` es el único sitio donde vive la mitad del contenido del mantenedor, así que
hay un script por sentido y **tienen reglas que no pueden divergir**:

| Script                    | Sentido                             | Qué compara | Fuente de la verdad                       |
| ------------------------- | ----------------------------------- | ----------- | ----------------------------------------- |
| `npm run publish:images`  | disco → Turso (`origen = catalogo`) | tamaño      | el MANIFIESTO (`deploy/data/images.json`) |
| `npm run download:images` | Turso → `data/mantenedor/`          | tamaño      | Turso                                     |

- **Los dos comparan TAMAÑO, no presencia**, y por la misma razón: el nombre canónico
  (`<carpeta>/<slug>.<ext>`) no cambia aunque cambie el contenido, así que sin mirar el peso
  una imagen regenerada se queda con la versión vieja para siempre en el lado que no se
  revisó. Un archivo que falla no se da por hecho, así que volver a correr reintenta solo lo
  que falta: los dos son reanudables.
- **`download:images` baja a `data/mantenedor/`, NO a `data/images/`.** Es `data/mantenedor/`
  el que está en `.gitignore`, así que los reemplazos que solo viven en Turso (backup) quedan
  en disco **sin ensuciar el repo**. `data/images/` se queda prístino: sigue siendo el
  artefacto del scrape, y el manifiesto sigue declarando 1594 objetos. Sirve para las dos
  cosas que pide tener Turso a mano: **respaldo** (los bytes de ahí no están en ningún otro
  sitio) y **probar en local** (`dev-up.sh` corre sin Turso, así que la rama de disco es la
  única que se usa y sin bajar nada se ven las imágenes del scrape, no las del mantenedor).
- **La app local sirve `data/mantenedor/` ENCIMA de `data/images/`.** Es la misma precedencia
  que sirve la API con Turso (`leerAssetRemoto`): el reemplazo del mantenedor gana al catálogo
  en modo local. Por eso `app/images/[...path]/route.js` prueba primero la raíz de reemplazos
  (`data/mantenedor/`) y solo después la del catálogo (`data/images/`).
- **`publish:images` se NIEGA a subir si `data/images/` está contaminado.** Antes de subir
  compara los archivos de `data/images/` contra los tamaños de las filas
  `origen = 'mantenedor'` de Turso: si alguno coincide, sale con código 1 y no sube nada.
  Por qué existe esa guarda: subirlos los guardaría como `origen = 'catalogo'` y **destruiría
  la imagen pública original**, que es el único sitio donde vive. Es el blindaje de la regla
  «no pisar lo que ya está en producción»: el camino bueno es `download:images` (a
  `data/mantenedor/`) y nunca copiar reemplazos a mano dentro de `data/images/`.
- **También vuelca las EDICIONES de texto** a `data/mantenedor-ediciones.json` — se pierden
  igual de fácil que las imágenes y no hay otro sitio donde estén.
- **Con los dos orígenes a la vez (`--origen todos`) gana `mantenedor`**, porque las dos filas
  escriben el mismo archivo y el orden de la consulta no puede decidir el resultado. Es la
  misma precedencia que sirve la API. Sin la poda, el catálogo pisó 58 reemplazos (ver
  «Trampas conocidas»).
- **Credenciales:** acepta `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` del entorno, o `--turso-url`
  / `--turso-token`, o las lee de un `.env` (`--env-file`, por defecto `.env.dev.local`, lo que
  deja `npx vercel env pull --environment=development`). Las de **producción** están marcadas
  _sensitive_ en Vercel y no se pueden releer; las de _development_ apuntan a la MISMA base, así
  que sirven igual.

## Despliegue en VPS (nginx + base local, sin Turso)

`vtuberdex.com` y `www.vtuberdex.com` corren en una VPS, no en Vercel. `TURSO_DATABASE_URL` admite una URL `file:`
(`@libsql/client` abre un SQLite local con el MISMO código), así que no hay rama aparte. (Hubo un `test.vtuberdex.com`;
se retiró: ya no hay nada con ese nombre en nginx, systemd ni `/var/www`.)

- **Release**: `./scripts/release.sh` compila con `VTUBERDEX_STANDALONE=1` (`output: 'standalone'`, opt-in para no afectar
  a Vercel) y `SITE_URL=https://vtuberdex.com` **definida en el build** (la home es estática: sin ella el canonical se
  congela como `http://localhost:3000`). Deja `/srv/vtuberdex/releases/<fecha>/` con `index.html`, `.well-known/` (legibles)
  y `app/` (la app, **modo 750, grupo `vtuberdex`**: nginx/`www-data` no la lee), apunta `/var/www/vtuberdex.com` a él
  (`ln -sfn`) y reinicia el servicio `vtuberdex` (`node server.js` en 127.0.0.1:3100,
  `WorkingDirectory=/var/www/vtuberdex.com/app`). Volver atrás = repuntar el enlace.
- **Usuario del servicio (desde 2026-10-10)**: `vtuberdex` corre como el usuario de sistema `vtuberdex` (sin shell, no ve
  `/home`), con Node del sistema en `/opt/node-v22.23.3` (copia del de nvm; al subir de versión hay que recopiarlo y editar
  `ExecStart`) y aislado por systemd (`ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `NoNewPrivileges`; solo escribe en
  `/var/lib/vtuberdex`). `madkoding` está en el grupo `vtuberdex` para desplegar (`release.sh` hace `chgrp vtuberdex`; si el
  shell es anterior al alta en el grupo, `sg vtuberdex -c ./scripts/release.sh`). `vtuberdex-voces` sigue como `madkoding`
  (necesita Piper). Si la web falla con `EACCES` tras un deploy, casi seguro es el grupo/permisos de `app/`. Copias previas al
  cambio: `/etc/systemd/system/vtuberdex.service.bak-20261010-135103` y `/etc/vtuberdex.env.bak-20261010-135103`.
- **Por qué `app/` cerrada y el release en `/srv`**: el script `ssl-dominios` de la VPS genera, al emitir un certificado, un
  bloque 443 que sirve `/var/www/<dominio>` COMO ESTÁTICO; con la app en la raíz quedaban descargables `deploy/data/*.db` y
  el código compilado. Y `www-data` no atraviesa `/home/madkoding`: el desafío ACME daba 404 (el primer intento de
  certificado falló por eso). Comprobado: `app/` y la base responden 404 por HTTP y HTTPS.
- **nginx**: `/etc/nginx/conf.d/00-a-vtuberdex.com.conf` (HTTP; `server_name` exacto gana al regex del multidominio) +
  `snippets/vtuberdex-{locations,proxy}.conf`. Cachea `/images/` (clave con `?v=`) y `/_next/static/`. **No** servir el
  release con `alias`/`root` salvo `/.well-known/acme-challenge/`. `www` comparte carpeta (mapa `$dominio_web`).
- **HTTPS**: lo emite `ssl-dominios` (Let's Encrypt, cada 5 min, cuando el DNS apunta aquí); su 443 es estático y no sirve,
  así que `/usr/local/sbin/vtuberdex-https` (drop-in `ExecStartPost` de `ssl-dominios.service`) escribe el 443 PROPIO
  `conf.d/00-b-vtuberdex.com-https.conf` (carga antes y gana) y **amplía el certificado a `www`** si este resuelve a la VPS
  pero el certificado no lo lleva (ssl-dominios exige un A directo; con CNAME dejaría www sin cubrir). Renueva `certbot.timer`
  y `renewal-hooks/deploy/nginx-reload` recarga nginx. Vigente hasta 2027-01-03, `certbot renew --dry-run` pasa.
  Sin HTTPS `navigator.clipboard` no existe (solo en contexto seguro): por eso el botón de copiar tiene respaldo `execCommand`.
- **DNS**: `vtuberdex.com` y `www` con registros **A** a la IP de la VPS (169.58.75.176). Vercel sigue teniendo el dominio
  asociado a su proyecto, pero ya no recibe tráfico.
- **Entorno** en `/etc/vtuberdex.env` (600): URL `file:` de la base, usuario y hash del mantenedor, sal de likes,
  `SITE_URL`, `VTUBERDEX_VOCES_DIR`.
- **Base**: `/var/lib/vtuberdex/data/turso-local.db` (WAL; propiedad de `vtuberdex`, grupo con escritura; `~/data/vtuberdex`
  es un enlace simbólico a ese directorio, así que respaldo y scripts siguen funcionando; el original quedó en
  `~/data/vtuberdex.old-20261010-135103`, borrar cuando se dé por bueno). `node scripts/copiar-turso.mjs` la rellena desde Turso (una vez; lotes
  de 5 filas en `asset_remoto`, porque Turso cortaba la conexión con lotes grandes de BLOB). `lib/ediciones.mjs`
  aplica pragmas (WAL, `busy_timeout`, `mmap`) solo para URLs `file:`. **Es la única copia de las ediciones** desde que se
  dejó Turso: producción en Vercel ya no recibe visitas, pero sus cambios previos al corte solo están en la copia de ese día.
- **Respaldo**: `scripts/respaldo-db.mjs` (`VACUUM INTO`, consistente con WAL) vía `/etc/cron.d/vtuberdex-respaldo`,
  03:30, 7 copias en `~/backups/vtuberdex/`. No copies solo el `.db`: pierdes lo que está en el `-wal`.
- **Trampa de imports de imagen**: en Next, `import x from './a.webp'` da un OBJETO `{ src }`, no una cadena.
  El mapa del metal se pedía como `/[object Object]` (404) y NUNCA cargaba, sin error visible; vitest sí da
  cadena, por eso ningún test lo vio (`card-material.ts`, `metalEnvUrl`).
- **Código de donación y certificado**: `VTD-` + **número de dex** (`#016` ⇒ `VTD-016`), no el id interno (que no coincide con
  lo visible: madKoding es dex 16, id 17; las fichas nuevas tienen ids desde 100001). Los códigos viejos de 6 dígitos se
  rechazan a propósito (`dexDeCodigo`): leídos como dex apuntarían a OTRA ficha. Si el mantenedor mueve el dex, el código cambia.
  PayPal: el enlace `ncp/payment/<id>` solo admite `locale.x`/`country.x` (no lleva referencia); el botón copia el código al
  pulsarlo. Con `PAYPAL_MERCHANT_ID` (lib/donar.ts) el enlace pasa a `paypal.com/donate?business=…&item_number=VTD-016`, que sí lo
  transporta. Está vacío: hace falta el ID de comerciante de la cuenta.
- **«← Catálogo» de la ficha** vuelve a la página/filtros donde se estaba: `use-vtuber-search` guarda el querystring en
  `sessionStorage` (`lib/volver-al-catalogo.ts`).
- **Medición del libro (VPS, CPU, Chromium + SwiftShader)**: texturas ~46 ms rápida / ~110 ms completa por carta;
  el pico de 1,3-1,5 s al primer giro es compilación/enlazado de shaders y `texSubImage2D`, no las texturas. Se calientan
  los shaders (`shader-warmup.tsx`: compilar Y dibujar una vez, que es lo que obliga al primer dibujo). Se probó
  `debug.checkShaderErrors = false` en producción: solo movió la espera, y se revirtió. Medir en GPU real antes de tocar más.

## Voz de la ficha (Piper + filtro, cola de regeneración)

Cada ficha con historia tiene un clip `<slug>.mp3`: una voz femenina española «de aparato» que dice
«Nombre. País. Historia.» al entrar a la ficha. Hay un parlantito con mute sobre la carta
(`components/voice-button.tsx`). **La voz sintética es propia: nunca se clona la de la Pokédex** (personaje comercial).

- **Dónde viven**: `VTUBERDEX_VOCES_DIR` (VPS: `/var/lib/vtuberdex/data/voces/`), junto a un `<slug>.txt` con el guion con que
  se generó. La ruta `app/voces/[slug]/route.js` los sirve (con `Range`: Safari no reproduce `<audio>` sin 206).
- **Qué se dice** (`lib/voz-guion.mjs`, pura y probada): se saltan las fichas sin historia (3), las de baja grado 1
  (`deteriorada-*`: su nombre es secreto) y las cuyo TEXTO no está en español; la historia se corta en una frase completa a
  700 caracteres (111 fichas pasan de eso); NFKC convierte las «letras matemáticas» de algunos nombres.
  OJO: el facet `languages` de una ficha es el idioma del STREAMER, no el del texto (8 fichas no-`es` tienen historia en español).
- **Generar**: `npm run voces -- --todas` (lote, ~1,5 h en 4 núcleos; reanudable: salta lo que no cambió comparando el `.txt`),
  `--slug=x`, `--forzar`, `--seco`, `--limpiar`. Piper: `~/voces/venv`, modelo `es_ES-sharvard-medium` hablante 1 (F),
  `--noise-scale 0.15` (entonación plana). El filtro es `scripts/voz/pokedex-voz.sh` (altura +30 %, anillo 110 Hz, bitcrush, eco,
  pitidos). **`sine` de ffmpeg sale a −18 dBFS**: con `volume=0.25` los pitidos quedaban a −30 dB (inaudibles).
- **Al crear/editar una ficha**: `aplicarYAnotar` (`lib/diario.mjs`) llama a `encolarVocesAfectadas` → `lib/voces-cola.mjs`
  escribe `<VOCES>/.cola/<id>.json` (un trabajo por ficha). El servicio `vtuberdex-voces` (`scripts/voces-generar.mjs --vigilar`,
  cada 5 s) lo procesa: regenera si el guion cambió, **retira el clip si la ficha ya no tiene guion** o quedó oculta/en borrador.
  Piper tarda segundos de CPU y necesita Python: por eso NO corre dentro de la petición del mantenedor. Sin `VTUBERDEX_VOCES_DIR`
  (Vercel, CI) la cola no hace nada y no falla.
- **Trampas**: (1) el `id` de una ficha NO es su número de dex (madKoding: dex 16, **id 17**). Una prueba con `PATCH /vtubers/16`
  sobrescribió la historia de otra ficha; se restauró desde el cambio nº 177 del diario, pero el diario conserva ambos cambios.
  Resuelve siempre el id por slug y comprueba el nombre ANTES de editar. (2) Durante el lote, una ficha editada puede
  procesarse con el texto viejo de su instantánea: corre `--todas` una vez más al terminar (idempotente). (3) Un slug
  renombrado deja su clip viejo huérfano hasta el siguiente `--limpiar`. (4) El autoplay con sonido lo bloquea el navegador
  sin gesto previo (enlace directo): el botón queda en «Escuchar». Entrando desde el catálogo hay un clic y suena sola.
- **El servicio** corre desde clones propios del autodeploy (`~/.local/share/vtuberdex-auto/web`, no desde el checkout de trabajo ni desde el release): necesita `lib/` y `server/src` en
  claro, y el `.env` es `/etc/vtuberdex.env` (el mismo del sitio).

## Estadísticas de visitantes (panel de la IP)

El panel de estado del servidor (lo que se ve al entrar por la IP, `/srv/estado`, fuera de este repo; copias de lo que se
modificó en `~/backups/estado-*`) tiene una sección «Visitantes // vtuberdex.com» alimentada por la propia app. Todo es
**anónimo y agregado**: no se guarda IP, cookies ni User-Agent. El servidor lee el `User-Agent` de la petición y lo
reduce a una familia cerrada de navegador y de sistema (`lib/user-agent.mjs`; los robots no cuentan); lo que el cuerpo
del latido diga de sí mismo (`navegador`, `so`, `fichaId`) se ignora. **Qué ficha se ve**: el cliente manda el slug SOLO
en `/v/:slug`; el servidor lo valida (`lib/ficha-id.mjs`: publicada, no baja, alias resuelven), lo convierte en id y
descarta el slug. Se cuentan vistas por id de ficha (ranking mensual) sin cruzarlas con navegador, sistema ni
dispositivo. El panel pone los nombres al servir y una ficha retirada sale como «Ficha retirada». Un guardia limita a
600 sesiones nuevas por minuto (no hay IP con la que limitar). Panel: donas, gráfica de 30 días y ranking, no tablas.

- **Cliente** (`components/cliente-stats.tsx` + `lib/telemetria-cliente.ts`, montado en `app/layout.tsx`): un latido cada 20 s
  (carga, LCP, fluidez, tareas largas, si la GPU es por software…) y un **aviso mínimo de navegación** inmediato al cargar y en cada
  cambio de página (`usePathname`), con dispositivo y conexión. Respeta «No rastrear» y Global Privacy Control. El latido de 20 s se
  perdería las navegaciones rápidas catálogo → ficha: por eso el aviso aparte.
- **En vivo** (`lib/clientes-stats.mjs`, en memoria, estado en `globalThis` porque Next compila cada ruta como entrada distinta):
  conectados, medianas de rendimiento y repartos. Valida y acota todo campo; claves de listas cerradas. Topes: 5.000 sesiones, un
  latido cada 5 s y un aviso de navegación cada 2 s por sesión (sin IP no hay otro límite).
- **Histórico mensual** (`lib/clientes-historial.mjs`, tabla `estadistica_mes(mes, clave, n)` en la base local, así entra en el
  respaldo): por mes UTC cuenta `visitas` (cargas de página), `dispositivo:*`, `conexion:*` (por visita), `pagina:*` (vistas, contando
  cada cambio de página), `cruce:dispositivo:pagina` y `pico` de conectados. Se acumula en memoria y se vuelca cada 15 s con un UPSERT
  que SUMA (el pico usa MAX): al reiniciar el servicio se pierde, como mucho, lo de los últimos 15 s. Si la base falla, lo acumulado
  se conserva para el siguiente intento. Sin base configurada solo hay histórico en memoria. Empezó a acumular el 2026-10-06.
- **Entrega al panel**: `GET /api/stats/resumen` (`app/api/stats/resumen/route.js`) exige `X-Estado-Token` (= `VTUBERDEX_STATS_TOKEN`,
  sin él o con otro responde 404 como si no existiera); lo consulta el nginx del panel (`location = /clientes.json` en
  `00-multidominio.conf`, token en `snippets/estado-token.conf`, 600 root). Devuelve lo de ahora + `historial` (12 meses).
- **Panel** (`/srv/estado/{index.html,estado.js,estado.css}`): tarjetas Dispositivo/Página/Conexión de ahora y el histórico mensual
  (barras apiladas por mes + tabla resumen). Solo muestra los meses con datos y el actual. Su CSP es estricta (`connect-src 'self'`):
  por eso consulta `clientes.json` del mismo origen y todo texto entra por `textContent`.

## Anti-scraping (nginx + fail2ban, desde 2026-10-20)

Es una **barrera de coste, no una garantía**: el catálogo es público y un scraper con navegador real lo saca igual.
Copias versionadas en `infra/` (la fuente viva está en `/etc/nginx` y `/etc/fail2ban`; copia de vuelta si las tocas).

- `conf.d/00-seguridad.conf`: 403 a UAs vacíos, librerías de scraping (curl, python-requests, Scrapy, headless…) y bots de
  SEO/IA (Ahrefs, Semrush, GPTBot, ClaudeBot…). Buscadores y previsualizadores de enlaces (Googlebot, Bing, Facebook, Discord…) pasan.
  `/api/vtubers` e `/images/` exigen `Sec-Fetch-Site` o `Referer` (un navegador siempre manda uno). Techo de 10 r/s por IP en imágenes.
  Loopback y VPN están exentos (`$vtd_limitar`; en fail2ban, `ignoreip` incluye la IP pública de la propia VPS: probar la trampa desde aquí contra la IP pública SIN esa excepción baneó al servidor): **probar desde 127.0.0.1 no ejercita nada**; usa `curl --resolve vtuberdex.com:443:<IP pública>`.
- fail2ban `vtuberdex-scraping`: 40 respuestas 403/429 sobre esas rutas en 10 min → ban 1 h (creciente). El filtro NO lleva fecha
  ni `\[`: fail2ban la recorta antes de aplicar la regex.
- **Presupuesto de fichas distintas por red** (`lib/anti-scraping.mjs`, llamado desde `/api/vtubers` y `/api/vtubers/[slug]`): 300 fichas
  distintas por hora y 600 por día (el catálogo son 785: una red sola no lo completa en 24 h) → 429 `demasiadas_fichas` con `Retry-After`.
  Repetir una ficha no gasta cupo. La red sale de `X-Real-IP` (nginx lo sobrescribe; el primer valor de `X-Forwarded-For` lo escribe el
  cliente). `perPage` público topado a 24. Memoria de la instancia: un reinicio lo borra. Si subes el tamaño de página del libro, súbelo.
- **Sesión de visitante con prueba de trabajo** (`lib/sesion-visitante.mjs`, `app/api/sesion`, cliente en `lib/sesion-cliente.ts`):
  `/api/vtubers*` responde 401 `sesion_requerida` sin la cookie `vtd_s`. Se obtiene resolviendo un reto (sha256 con 16 bits de ceros,
  ~1 s en el navegador), dura 5 min y el navegador la RENUEVA sola cada 3 min mientras la pestaña está visible (`POST /api/sesion/renovar`, sin repetir la prueba; tope de 2 h desde el reto) y va atada al hash de la red y del User-Agent (copiarla a otra máquina no sirve). Tope de 30 sesiones
  nuevas por red y hora. `ClienteStats` la abre al cargar y `request()` de `lib/api.ts` la abre y repite UNA vez ante la primera 401.
  Secreto por proceso (un reinicio invalida las sesiones; el cliente re-resuelve). Loopback/VPN y desarrollo sin `X-Real-IP` no la exigen.
  Un navegador real la pasa: lo que frena a ese es el presupuesto de fichas. Probado con `next start` + `X-Real-IP` simulada.
- **Términos**: la cláusula 18 (`/terminos#seguridad`) prohíbe el scraping, los usos derivados (incluido entrenar IA), la elusión de
  estas medidas y lo declara con consecuencias; `TERMINOS_VERSION` pasó a `2026-10-20` (los formularios abiertos se rechazan).
- **Menú lateral en lugar de enlaces en el pie**: hamburguesa arriba a la izquierda de la cabecera (`components/side-menu.tsx`, diálogo modal con
  foco atrapado, Escape, bloqueo de scroll y cierre al navegar). TODOS los enlaces del sitio viven en la lista `GRUPOS` de ese archivo (Explorar, Mi ficha, Juego y comunidad, Legal): al añadir
  una página pública, añádela ahí, en su grupo (y la clave `menu.grupo.*` en es/en/ja si creas uno). El pie quedó solo con el aviso de derechos (1 línea en escritorio, 2 en celular) y la trampa. **Alturas**: el botón
  cabe en la fila de 3,5 rem de la cabecera y el pie ocupa lo mismo que el pie de enlaces de antes, así que `--binder-chrome` (globals.css) volvió
  a 17,6 / 26,4 rem. Sin navegador en la VPS esto está calculado, no medido: si cambias el alto de cabecera o pie, mide 1440x900 y 390x844.
- **Aviso de derechos visible y reserva legible por máquina**: línea en el pie (`pie.derechos`, es/en/ja; corta A PROPÓSITO, ver arriba) que enlaza a la cláusula 18;
  `<meta name="tdm-reservation" content="1">` y `robots: noai, noimageai` (`app/layout.tsx`); `/.well-known/tdmrep.json`
  (protocolo TDM del W3C). Son declaraciones, no barreras: las respetan los rastreadores formales y sirven de prueba de que se reservó el derecho.
- **Licencia: todos los derechos reservados** (`LICENSE`, `NOTICE.md`, `"license": "UNLICENSED"`). Creative Commons no encaja: todas sus
  licencias permiten copiar y redistribuir algo y son irrevocables. El repo es público; `NOTICE.md` separa código (© VTuberDex) de los
  datos e imágenes de cada VTuber (de sus titulares). nginx añade `X-Robots-Tag: noai, noimageai`, `tdm-reservation` y `tdm-policy`.
- **Trampa**: enlace invisible en el pie (`/v/archivo-completo`, `<a>` y no `<Link>` para que no se precargue); nginx 403 y el jail
  `vtuberdex-trampa` banea 24 h al primer toque. robots.txt la prohíbe, así que los buscadores no caen.
- `robots.txt` pide a los bots de IA/SEO que no pasen (cortesía; la barrera es nginx).
- **Host FIJO en nginx** (`proxy_set_header Host vtuberdex.com` en los tres `proxy_pass` de `vtuberdex-locations.conf`): Semgrep marca como vulnerabilidad (`request-host-used`) reenviar la cabecera Host que manda quien llama, y esas 3 alertas hacían fallar el quality gate de Sonar (`security_rating` de código nuevo en C; se exige A). Sonar importa los SARIF de Semgrep y CodeQL, así que **todo `.conf` que se copie a `infra/` también se analiza**. Para ver qué rompe el gate: `GET /api/qualitygates/project_status?projectKey=vtuberdex` y `/api/issues/search?...&inNewCodePeriod=true` en `http://127.0.0.1:9000` (token en `~/.sonar-token`).
- Un cliente legítimo nuevo que no sea navegador (monitor, integración) recibirá 403: añade su UA a `$vtd_ua_bueno` o usa loopback.

## Verificación antes de decir "listo"

1. `npm run lint && npm run typecheck && npm run check:shaders && npm run build` (el build es el gate real).
2. `npm test` en el paquete que tocaste; si cambiaste el esquema o la búsqueda,
   corre también `server` y, si aplica, `scraper`.
3. Si tocaste la carta 3D o el shader, **no basta con que compile**: mira la
   carta renderizada (no existe vista 2D de respaldo: se ve el canvas o no se ve nada) — los
   fallos de WebGL no aparecen en los tests, que corren sin WebGL a propósito
   (`test/setup.ts` anula `getContext`).
4. Si cambiaste el seed o el scraper, re-ejecuta `verifySeed()` y confirma
   `vtubers == expected == fts`: el proceso sale con código 2 si no cuadra.
5. Si tocaste el manifiesto de imágenes, `npm run verify` comprueba que las
   carpetas retiradas dan 404 y que el conteo declarado coincide con lo subido.

## Desarrollo local (lo que ya costó tiempo)

`./scripts/dev-up.sh` levanta **dos** procesos y los dos hacen falta:

| Puerto | Qué                              | Por qué                                |
| ------ | -------------------------------- | -------------------------------------- |
| 3000   | la app Next                      | catálogo, API de lectura, imágenes     |
| 4000   | `server/src/index.mjs` (Express) | el mantenedor: es el ÚNICO que escribe |

Next reenvía `/api/admin/*` al Express con `VTUBERDEX_ADMIN_URL`. Si esa variable
no está y tampoco hay Turso, la página `/admin` carga pero cada llamada da **404**
(el 404 explícito que comprueba `npm run verify`). En producción no pasa: allí el
mantenedor atiende con Turso.

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
2. **Sin Turso y sin `VTUBERDEX_BLOB_BASE`, las imágenes se sirven de disco, en DOS
   raíces y por este orden: `data/mantenedor/` primero y `data/images/` después**
   (rama local de `app/images/[...path]/route.js`; si hay Turso, Turso va PRIMERO y el
   disco es solo el respaldo). La primera raíz son los reemplazos que el mantenedor
   guardó en Turso y que `npm run download:images` bajó a `data/mantenedor/` (ignorada
   por git); la segunda es el catálogo del scrape. Ese orden es la precedencia de la
   API (`leerAssetRemoto`): el reemplazo gana. Antes esa ruta devolvía
   `null` y la app entera salía sin una sola imagen, difícil de diagnosticar.
   En local el **disco es la fuente de verdad** (sin exigir que el archivo esté
   en el manifiesto, que solo se regenera con `npm run build:data`): sin eso, una
   imagen recién subida daba 404 con el archivo ya en disco. El manifiesto manda
   en PRODUCCIÓN, que es la rama que cubre `npm run verify`.
   **Y el disco solo tiene lo que alguien haya bajado**: lo que sube el mantenedor
   vive en Turso y no vuelve solo, así que antes de fiarse de lo que se ve en local
   hay que correr `npm run download:images` (ver «Publicar y bajar imágenes»), que deja
   los reemplazos en `data/mantenedor/` sin tocar `data/images/`.
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
