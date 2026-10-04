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
# Tests (desde la raíz)
npm test                   # 451 tests (vitest): utilidades, componentes, páginas, carta 3D, libro
cd scraper && npm test     # 25 tests (node --test): parsers y normalización
cd server  && npm test     # 94 tests: búsqueda, facetas, API HTTP, mantenedor, migraciones

# Linter (raíz; cubre también server/ y scraper/)
npm run lint               # eslint . — falla con cualquier error
npm run lint:fix           # corrige lo corregible

# Gate real antes de dar algo por terminado
npm run lint && npm run typecheck && npm run check:shaders && npm run build

# Medición (informan; no tocan nada)
npm run probe:timings      # piso de SQLite local, sin red — el "cuánto debería costar"
npm run bench:ediciones    # A/B del camino de Turso contra el de HEAD (stub, sin credenciales)
npm run sweep:dead-code    # exports sin consumidores (informa, no borra)

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
  *sensitive* en Vercel devuelven vacío incluso con `decrypt=true` (comprobado con la
  API; las de *development* sí salen, pero su valor puede ser un JWT y no la URL del
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

Cuatro páginas públicas (`/inscripcion`, `/modificacion`, `/baja`, `/terminos`, con enlaces en `components/app-footer.tsx`) y una
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
- **La inscripción es un formulario de 3 pasos** (`inscripcion-form.tsx`; el estado vive en el padre, así que «Volver» no pierde nada y la
  validación nativa `required` de cada paso corre antes de avanzar): 1) lo básico y el contacto, 2) tu personaje (avatar y logo como ENLACE,
  modelo, hashtag, estatura, cumpleaños, país, signo, lore), 3) gustos + términos. Obligatorios todos salvo país y signo. Los textos cortos
  salen de `CAMPOS_PERFIL` (cliente) y `perfilObligatorio` (`solicitudes.mjs`): al añadir uno, tócalos a la vez. `fichaDesdeInscripcion`
  mapea estatura/cumpleaños/hashtag/color a sus columnas, el modelador a `artists` y el resto a filas de `profile`.
- **Modificación de una ficha ya registrada** (`/modificacion`, `components/solicitudes/modificacion-form.tsx`, tipo `modificacion`
  en la MISMA cola y tabla): misma forma que la inscripción pero solo identifica la ficha (ficha + correo + cómo se comprueba la
  titularidad, como la baja) y todo lo demás es opcional (en blanco = no cambia; el servidor exige al menos un cambio). Las preguntas
  salen de `campos-ficha.ts`, compartido con la inscripción. **Aprobar APLICA** el parche a la ficha existente
  (`server/src/modificacion.mjs`, `prepararModificacion`: lo comparten Express y Next; local escribe con `aplicarParche`, producción
  con `vtuber.editar` del diario, leyendo la ficha del diario ya reproducido): las redes se SUMAN o actualizan por plataforma, los
  gustos actualizan su fila de `profile` sin tocar las demás, el modelador pasa al frente de `artists` sin quitar a nadie. El nombre
  no se cambia por aquí. **Avatar y logo (enlaces) NO se aplican solos**: el mantenedor los sube por «Imágenes» y la cola lo avisa. Si la
  ficha no se resuelve (nombre ambiguo o inexistente) la solicitud sigue pendiente con `ficha_no_encontrada`.
- **Antispam**: campo trampa `website`, un solo pendiente por correo y tipo, tope de 5 envíos por red y día. El arte del
  personaje se pide como ENLACE: un formulario público que recibe archivos es una puerta a subir basura.
- `/api/admin/solicitudes*` sale 404 sin Turso ni proxy local, como el resto del mantenedor.

## Cartas premium: grado, placa de acrílico y mantenedor

Un VTuber que dona recibe su carta **gradeada** (como las de CGC): entra en el 8 y sube 0,5 por
cada mes que sigue donando, hasta el 10 y luego la **Black Label**. Escala: `8 → 8.5 → 9 → 9.5 → 10 → BL`.

- **La escala vive UNA vez**, en `server/src/premium.mjs` (JS puro, sin Node ni DOM). Validación
  (`validation.mjs`), regla (`mutations.mjs`), búsqueda (`search.mjs`) y cliente (`lib/premium.ts`
  la reexporta) la importan; no la copies. El grado es **texto** (`'BL'` no es un número).
- **Datos**: tabla `premium (vtuber_id PK, grade, since, graded_at)`, sin CHECK de la escala (SQLite
  no deja alterarlo). Sin fila = carta normal. El certificado (`VTD-000017`) se **deriva del id**, no se guarda.
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
  en la cabecera. **Mantenedor**: pestaña «Premium» (`admin/premium-manager.tsx`): alta, «Subir a …» (el gesto
  mensual), fijar grado a mano, quitar. Avisa si el grado ya cambió este mes pero deja subir: la donación es
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
  única puerta de generación y aplica cuatro medidas, con sus perillas en `TEXTURAS`:
  (1) PROGRESIVA: `generarRapida` (superficie, personaje, título) muestra la carta y
  `completar` añade marca y máscaras REUTILIZANDO esas capas (`reutilizar` en
  `drawCardLayers`), nada se dibuja dos veces; (2) ADAPTATIVA: se mide la generación
  completa y si la mediana de `muestras` supera `lentoMs` se baja un escalón de `anchos`
  (512 -> 384 -> 256) para las siguientes, decide la máquina real y no
  `hardwareConcurrency`; (3) CACHÉ LRU por carta y ancho con presupuesto en PÍXELES
  (`cacheMaxPixels`), con las cartas montadas ancladas (`anclar`) para que no se
  desalojen debajo de quien las usa, los canvases se cachean y las `CanvasTexture` se crean
  por montaje porque pertenecen a un renderer; (4) PREGENERACIÓN: `pregenerar` encola con
  prioridad BAJA y en `requestIdleCallback` las cartas de las páginas vecinas que trajo
  `cache-paginas`, y un trabajo bajo que ya tenía turno lo CEDE si llega uno alto. Las
  máscaras corren en un Web Worker (`mascaras.worker.ts`, matemática pura en
  `mascaras-puras.ts` compartida con el camino síncrono de respaldo): el hilo principal
  solo dibuja, lee y escribe píxeles. Dos trampas: la cola ejecuta de UNO en uno con un
  `setTimeout 0` entre trabajos (ocho a la vez bloqueaban en un tramo), y `buscarEnCache`
  REJUVENECE la entrada (LRU), así que una consulta la aleja del desalojo. Y una tercera
  que costó una vuelta: la calidad adaptativa mide SOLO CPU del hilo principal
  (`Completada.msCpu`), nunca la espera del worker, porque su arranque (~0,7 s en una
  máquina lenta) se colaba en la primera carta y bajaba un escalón sin motivo; además
  `precalentarMascaras()` arranca el worker mientras se descargan las imágenes. Medido con
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
  `prefers-reduced-motion` ya no manda al 2D (el tier `static` solo baja textura/DPR y desactiva la
  precarga). jsdom no tiene WebGL, así que `test/setup.ts` sustituye el `<Canvas>` de R3F por una caja
  inerte (`data-testid="r3f-canvas"`); lo que se prueba es el contrato de DOM, no la escena.
- **El canvas NO corre a 60 fps continuos, y un `contextlost` ya no es permanente.** Antes el
  `<Canvas>` iba en `frameloop="always"` y el primer `webglcontextlost` dejaba un 2D hasta
  recargar (`setLost(true)` sin vuelta). Hoy (`components/render-governor.tsx`, lógica pura en
  `render-pacing.ts`, perillas en `RENDER` de `card3d-config.ts`): `frameloop="demand"` y un
  gobernador que (1) PAUSA del todo fuera de pantalla (IntersectionObserver) o con la pestaña
  oculta, (2) baja a `idleFps` en reposo y con interacción topa a `RENDER.activeFps` = **60** (se probó 24: en 60 Hz alterna 33/50 ms y se ve menos suave; agenda FIJA `nextSchedule`, porque comparar con el último frame real rinde menos fps que los pedidos), (3) DPR adaptativo AGRESIVO (`RENDER.dpr`: ventana de 24 frames, escalón 0,3, dos escalones si la mediana pasa de 40 ms, mínimo 0,6, sube con calma tras 5 ventanas; `slowMs` 23 queda por encima de los 20,8 ms de 144 Hz con tope 60) si la cadencia de los frames ACTIVOS no se sostiene (nunca midiendo durante un giro: el hilo
  está saturado por las texturas y realocar el framebuffer a mitad del giro es otro tirón).
  `advanceFlip` recorta el delta a `RENDER.maxDeltaMs` (70: debe superar el paso de 50 ms del reposo): el primer frame del giro llega tras uno de
  reposo (50 ms) y adelantaba la hoja de golpe. `webgl-recovery.ts` desmonta el canvas,
  espera `cooldownMs` y REMONTA un canvas nuevo (`key`); no sigue en sitio tras
  `webglcontextrestored` porque el PMREM no sobrevive y el metal saldría negro.
  Trampas: (a) desmontar un Canvas dispara `webglcontextlost` en el canvas viejo
  (`forceContextLoss`): el hook solo acepta el evento del canvas VIGENTE; (b) el reloj de three
  sigue corriendo en pausa, así que al reanudar se descarta con `clock.getDelta()` o `advanceFlip`
  (integra por delta) saltaría el giro; (c) R3F reimpone la prop `dpr` en cada re-render del
  Canvas, por eso el DPR adaptativo vive en estado de React del dueño y no en un `setDpr` directo;
  (d) `PerformanceMonitor` de drei NO sirve: contaría el reposo (20 fps a propósito) como lento.
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
- **`VTUBERDEX_ADMIN_PASSWORD_HASH` no va marcado *sensitive*.** El panel y
  `npx vercel env add` lo ofrecen por defecto, y Vercel guarda esos valores en un
  **formato ilegible para siempre**: ni el CLI, ni `vercel env pull`, ni la API con
  `decrypt=true` dejan volver a leerlos (devuelven un placeholder o un sobre cifrado;
  comprobado). Un hash `scrypt` no es un secreto reutilizable —es irreversible y
  salado—, así que se guarda como *encrypted*/**Config** (`--no-sensitive`) y se puede
  releer para comparar. `formatoDeHash` (`lib/admin-auth.mjs`) solo describe la FORMA.
  **Lo mismo vale para `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`**: hoy están como
  *sensitive* en producción y por eso `npm run bench:ediciones` mide con un stub en vez
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

## Despliegue en Vercel

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
npx vercel deploy --prod         # publica (o push a master, lo hace deploy.yml)
```

`npm run publish:images` sube las imágenes a **Turso** (`asset_remoto`), no a Blob; es
idempotente y reanudable. **`npm run download:images` es el sentido contrario** y existe
porque la mitad del contenido del mantenedor NO está en el disco de nadie más que en Turso
(ver «El mantenedor escribe en Turso»). Para el mantenedor en producción están
`admin:publicar` (alta del usuario admin) y `admin:verificar` (login real de punta a punta).

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

| Carpeta | Estado | Por qué |
|---|---|---|
| `character` | ✅ publicado | La imagen fuente del VTuber |
| `logo` | ✅ publicado | Capa superior de la carta |
| `faction` | ✅ publicado | Emblema que la carta superpone como holograma |
| `background` | ✅ publicado (1 objeto) | Capa POR DETRÁS del personaje, con holograma y paralaje propios. **El scraper NO la produce**: solo se llena si alguien sube una desde el mantenedor (hoy hay 1) |
| `thumb` | ❌ eliminado | Ninguna vista la pedía (18 MB) |
| `avatar` | ❌ eliminado | Duplicado legacy de `character` (13 MB) |
| `ficha` | ❌ eliminado | Respaldo de `character`; hoy los 785 lo tienen (33 MB) |
| `radar` | ❌ eliminado | Gráfico de atributos **dibujado desde los datos** por `StatBars` en la misma página (8 MB) |
| `card` | ❌ eliminada | Vacía desde siempre |

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

| Script | Sentido | Qué compara | Fuente de la verdad |
|---|---|---|---|
| `npm run publish:images` | disco → Turso (`origen = catalogo`) | tamaño | el MANIFIESTO (`deploy/data/images.json`) |
| `npm run download:images` | Turso → `data/mantenedor/` | tamaño | Turso |

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
  *sensitive* en Vercel y no se pueden releer; las de *development* apuntan a la MISMA base, así
  que sirven igual.

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

| Puerto | Qué | Por qué |
|---|---|---|
| 3000 | la app Next | catálogo, API de lectura, imágenes |
| 4000 | `server/src/index.mjs` (Express) | el mantenedor: es el ÚNICO que escribe |

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
