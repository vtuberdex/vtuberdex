/**
 * Ediciones y assets del mantenedor, guardados en Turso (base de datos externa).
 *
 * POR QUÉ EXISTE
 * --------------
 * Vercel Blob quedó BLOQUEADO: sus 2.000 "Advanced Operations" de Hobby se agotaron
 * subiendo 1.625 imágenes (cada `put` es una operación), y el bloqueo dura 30 días.
 * Sin almacén de objetos, el catálogo de producción no podía servir sus imágenes ni
 * aceptar ediciones desde el mantenedor.
 *
 * Turso resuelve las dos cosas con UN solo servicio y sin tarjeta de crédito:
 *
 *   · Las EDICIONES son filas de la tabla `edicion` (una fila = un campo de una ficha).
 *   · Las IMÁGENES son filas de `asset_remoto`, con los bytes en un BLOB. Verificado
 *     byte a byte idéntico al original, y 73 MB son el 1,5% de los 5 GB gratuitos.
 *
 * QUÉ NO HACE
 * -----------
 * No migra el catálogo. La base SQLite sigue siendo el catálogo —completo, con FTS5,
 * sus facetas y sus 52 tests intactos— y sigue abriéndose en modo SÍNCRONO con
 * `node:sqlite`. Este archivo es la ÚNICA parte asíncrona, y solo se usa desde el
 * mantenedor: los caminos de lectura del catálogo no pagan ni un `await` nuevo para
 * funcionar sin Turso configurado.
 *
 * POR QUÉ NO SE TOCÓ `search.mjs`
 * -------------------------------
 * `searchVtubers` y `getVtuberBySlug` son síncronas y las llaman las rutas de Next sin
 * `await`. Volverlas asíncronas obligaba a reescribir ~236 llamadas en 10 archivos más
 * los 52 tests. En vez de eso, la ruta lee el catálogo de SQLite como siempre y APLICA
 * las ediciones encima (`aplicarEdiciones`). El resultado es el mismo y el riesgo es
 * mucho menor.
 *
 * SIN TURSO CONFIGURADO NO PASA NADA
 * ----------------------------------
 * Sin `TURSO_DATABASE_URL` todas las funciones devuelven vacío y la app se comporta
 * exactamente como antes. Eso es lo que mantiene verdes los 52 tests y lo que hace que
 * el desarrollo local (`npm run dev`, `dev-docker.sh`) no necesite cuenta ni red.
 */
import { createClient } from '@libsql/client/node';

import { EXTENSION_DE_CARPETA, KINDS_GESTIONABLES } from './carpetas.mjs';

/**
 * ¿Hay Turso configurado?
 *
 * Se comprueba la variable de entorno y no la conexión: la app tiene que poder
 * responder el catálogo aunque Turso esté caído. Una base externa inalcanzable no puede
 * tumbar la lectura de un catálogo que vive dentro del bundle.
 */
export function tursoConfigurado() {
  return Boolean(process.env.TURSO_DATABASE_URL);
}

/**
 * Origen de un asset.
 *
 * `catalogo` = lo sube `scripts/publish-images.mjs` desde el manifiesto (el scraper es la
 * fuente de la verdad). `mantenedor` = lo sube una persona desde el mantenedor. Son filas
 * distintas de la misma tabla para que la segunda nunca pueda destruir la primera.
 */
export const ORIGEN_MANTENEDOR = 'mantenedor';

/** Campos de la ficha que se pueden editar. Espejo de `vtuberUpdateSchema`. */
const CAMPOS_EDITABLES = [
  'name',
  'phrase',
  'themeColor',
  'birthday',
  'height',
  'hashtag',
  'favoriteColor',
  'status',
  'profile',
];

/**
 * Cliente perezoso y cacheado.
 *
 * Se crea en la primera llamada y no al importar el módulo: importar este archivo sin
 * Turso configurado (los tests, el build) no debe intentar ninguna conexión.
 */
let cliente = null;
export function turso() {
  if (!cliente) {
    cliente = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return cliente;
}

/**
 * Crea las tablas del mantenedor si no existen. Idempotente.
 *
 * No usa `schema.sql` a propósito: ese archivo describe el CATÁLOGO (y lo aplica el
 * scraper con `node:sqlite`). Mezclar ahí tablas que solo existen en Turso haría que el
 * esquema del catálogo dependiera de un servicio externo.
 *
 * POR QUÉ `asset_remoto` TIENE COLUMNA `origen`
 * --------------------------------------------
 * La primera versión guardaba en la MISMA fila `(slug, kind)` tanto la imagen publicada
 * del catálogo como el reemplazo subido desde el mantenedor. Eso hacía que subir una
 * imagen **destruyera la única copia del original** y que borrarla dejara el hueco sin
 * vuelta atrás: no era un fallo de caché, era que la imagen del catálogo ya no existía
 * en ningún sitio. Se descubrió probando el ciclo completo en producción (la imagen del
 * catálogo no volvió tras el DELETE).
 *
 * Ahora una imagen publicada y su reemplazo son FILAS DISTINTAS, y borrar el reemplazo
 * simplemente deja de tapar la del catálogo, que nunca se tocó.
 */
let tablasListas = null;

/**
 * Asegura el esquema del mantenedor. **Una vez por instancia.**
 *
 * POR QUÉ SE MEMOIZA (medido)
 * ---------------------------
 * Era idempotente, pero idempotente no es gratis: son 3 sentencias DDL enviadas por
 * red. Y se llamaba en CADA lectura —`leerEdiciones`, `leerAssetRemoto`,
 * `leerAssetDelMantenedor`—, así que una sola página de catálogo pagaba el DDL
 * 4 + 12·N veces (una vez por carta y por tipo de imagen). Medido en producción con
 * `perPage`: 1 → 0,417 s · 24 → 0,824 s · 100 → 1,854 s. Lineal, ~14 ms por carta:
 * es el patrón de un viaje de red por carta, no el de un catálogo local (que cuesta
 * 2,2 ms para las 24 fichas, medido con `scripts/probe-timings.mjs`).
 *
 * El esquema no puede cambiar mientras la instancia vive —lo crea este mismo
 * proceso al arrancar—, así que no necesita invalidación en las escrituras: un
 * INSERT no altera si una tabla existe.
 *
 * El memo guarda la PROMESA, no el resultado: dos peticiones concurrentes en una
 * instancia fría comparten el mismo trabajo en vez de lanzar el DDL dos veces.
 * Y si falla, se suelta: cachear el rechazo dejaría todas las lecturas siguientes
 * rotas hasta reciclar la instancia, que es peor que el fallo original.
 */
export async function asegurarTablas() {
  if (!tursoConfigurado()) return;
  if (!tablasListas) {
    tablasListas = crearTablas().catch((error) => {
      tablasListas = null;
      throw error;
    });
  }
  return tablasListas;
}

/** El DDL del esquema del mantenedor. Solo lo llama `asegurarTablas`. */
async function crearTablas() {
  await turso().executeMultiple(`
    CREATE TABLE IF NOT EXISTS edicion (
      slug        TEXT NOT NULL,
      campo       TEXT NOT NULL,
      valor       TEXT,
      actualizado TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (slug, campo)
    );
    CREATE INDEX IF NOT EXISTS idx_edicion_slug ON edicion (slug);
  `);

  // Migración: la tabla vieja no tenía `origen`. Se reconstruye etiquetando lo que ya
  // había como `catalogo`, que es lo que era (lo subió `publish-images.mjs`). Sin esto,
  // una base ya desplegada se quedaría con el esquema antiguo y el borrado seguiría
  // destruyendo la imagen publicada.
  const columnas = await turso().execute('PRAGMA table_info(asset_remoto)');
  const existe = columnas.rows.length > 0;
  const tieneOrigen = columnas.rows.some((c) => c.name === 'origen');
  if (existe && !tieneOrigen) {
    await turso().executeMultiple(`
      ALTER TABLE asset_remoto RENAME TO asset_remoto_viejo;
      CREATE TABLE asset_remoto (
        slug        TEXT NOT NULL,
        kind        TEXT NOT NULL,
        origen      TEXT NOT NULL DEFAULT 'catalogo',
        mime        TEXT NOT NULL,
        bytes       BLOB NOT NULL,
        width       INTEGER,
        height      INTEGER,
        size        INTEGER NOT NULL,
        actualizado TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (slug, kind, origen)
      );
      INSERT INTO asset_remoto (slug, kind, origen, mime, bytes, width, height, size, actualizado)
        SELECT slug, kind, 'catalogo', mime, bytes, width, height, size, actualizado FROM asset_remoto_viejo;
      DROP TABLE asset_remoto_viejo;
    `);
  }

  await turso().executeMultiple(`
    CREATE TABLE IF NOT EXISTS asset_remoto (
      slug        TEXT NOT NULL,
      kind        TEXT NOT NULL,
      origen      TEXT NOT NULL DEFAULT 'catalogo',
      mime        TEXT NOT NULL,
      bytes       BLOB NOT NULL,
      width       INTEGER,
      height      INTEGER,
      size        INTEGER NOT NULL,
      actualizado TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (slug, kind, origen)
    );
    CREATE INDEX IF NOT EXISTS idx_asset_slug_kind ON asset_remoto (slug, kind);
  `);
}

/** Todas las ediciones, indexadas por slug. `{}` si no hay Turso. */
export async function leerEdiciones() {
  if (!tursoConfigurado()) return {};
  await asegurarTablas();
  const { rows } = await turso().execute('SELECT slug, campo, valor FROM edicion');
  const porSlug = {};
  for (const fila of rows) {
    // node:sqlite devuelve objetos sin prototipo; el cliente de Turso también puede
    // devolver filas "raras", así que se copia a un objeto normal antes de exponerlo.
    porSlug[fila.slug] = { ...(porSlug[fila.slug] ?? {}), [fila.campo]: fila.valor };
  }
  return porSlug;
}

/**
 * Extensiones que puede tener una clave de asset.
 *
 * NO se asume `.webp`: los emblemas de facción son **PNG** (`data/images/faction/*.png`)
 * y las otras dos carpetas WebP. Suponer una sola extensión dejaba los 23 emblemas sin
 * poder servirse — la firma se descarta y devuelve `null`, así que la imagen caería al
 * 301 de Blob (que está bloqueado) sin ningún error visible. Se listan las que existen
 * de verdad, no un comodín, para que una ruta inventada no consulte la base por gusto.
 */
const EXTENSIONES = ['webp', 'png', 'jpg', 'jpeg', 'gif', 'svg'];

/**
 * Descompone `images/<carpeta>/<slug>.<ext>` en sus partes, o `null` si no encaja.
 *
 * El `slug` puede llevar puntos (hay fichas con nombres así), por eso se separa por la
 * ÚLTIMA extensión conocida y no por el primer punto.
 */
function partesDeClave(key) {
  const corte = String(key).match(/^images\/([^/]+)\/(.+)\.([a-z0-9]+)$/i);
  if (!corte) return null;
  const [, kind, slug, ext] = corte;
  if (!EXTENSIONES.includes(ext.toLowerCase())) return null;
  return { kind, slug, ext: ext.toLowerCase() };
}

/**
 * (No hay `leerAssetsRemotos`: se retiró con `GET /api/admin/vtubers`, su único consumidor.
 * La lista del mantenedor usa la ruta pública y no marca qué imágenes se reemplazaron a
 * mano, así que este mapa no tenía a quién servir. Los bytes se siguen leyendo con
 * `leerAssetRemoto`, que es lo que sirve las imágenes.)
 */

/**
 * Los bytes de un asset, o `null` si no está.
 *
 * PRECEDENCIA: la imagen del mantenedor tapa a la del catálogo. Es la misma regla que las
 * ediciones de texto (`aplicarEdiciones`): lo que alguien subió a mano gana, porque si
 * perdiera, el siguiente `publish-images.mjs` revertiría el cambio sin avisar. Y como son
 * filas distintas, la del catálogo sigue INTACTA debajo: borrar el reemplazo la deja
 * volver a la vista sin haberla tocado nunca.
 */
export async function leerAssetRemoto(key) {
  if (!tursoConfigurado()) return null;
  const partes = partesDeClave(key);
  if (!partes) return null;
  await asegurarTablas();
  const { rows } = await turso().execute({
    sql: `SELECT bytes, mime, origen FROM asset_remoto
          WHERE slug = ? AND kind = ?
          ORDER BY CASE origen WHEN ? THEN 0 ELSE 1 END
          LIMIT 1`,
    args: [partes.slug, partes.kind, ORIGEN_MANTENEDOR],
  });
  if (rows.length === 0) return null;
  const fila = rows[0];
  // El `mime` guardado es la fuente de la verdad del tipo: la extensión de la ruta solo
  // sirvió para encontrar la fila.
  return { bytes: Buffer.from(fila.bytes), mime: fila.mime, origen: fila.origen };
}

/** Guarda los bytes de una imagen subida a mano (origen `mantenedor`). */
export async function guardarAssetDelMantenedor(slug, kind, bytes, mime, medidas = {}) {
  if (!tursoConfigurado()) return false;
  await asegurarTablas();
  /**
   * `width`/`height` llegan ya resueltos y NO se pueden deducir aquí.
   *
   * Quien llama los conoce: la ruta de producción los lee de la cabecera WebP con
   * `readWebpSize` (`server/src/seed.mjs`, JS puro) porque no lleva `sharp` —es un binario
   * nativo que no viaja a la función—, y el Express los mide con `sharp`. Sin ellos, el gestor
   * del mantenedor los lee como `null` y su cabecera pinta "sin imagen" **aunque la imagen esté
   * guardada y se vea en la vista previa**: el mismo síntoma engañoso que el resto del arreglo.
   * Aquí solo se normaliza a entero positivo (una cabecera ilegible da `null`, no `NaN`).
   */
  const aEnteroPositivo = (valor) => {
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  await turso().execute({
    sql: `INSERT INTO asset_remoto (slug, kind, origen, mime, bytes, width, height, size, actualizado)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT (slug, kind, origen) DO UPDATE
            SET mime = excluded.mime, bytes = excluded.bytes, width = excluded.width,
                height = excluded.height, size = excluded.size, actualizado = excluded.actualizado`,
    args: [
      slug,
      kind,
      ORIGEN_MANTENEDOR,
      mime,
      bytes,
      aEnteroPositivo(medidas.width),
      aEnteroPositivo(medidas.height),
      bytes.length,
    ],
  });
  return true;
}

/**
 * Borra SOLO el reemplazo del mantenedor, nunca el asset del catálogo.
 *
 * El `AND origen = ?` es la línea que evita el fallo que apareció en producción: sin él,
 * restaurar una imagen borraba también la copia publicada y la imagen desaparecía del
 * sitio en vez de volver a la del catálogo.
 */
export async function borrarAssetDelMantenedor(slug, kind) {
  if (!tursoConfigurado()) return false;
  await asegurarTablas();
  const { rowsAffected } = await turso().execute({
    sql: 'DELETE FROM asset_remoto WHERE slug = ? AND kind = ? AND origen = ?',
    args: [slug, kind, ORIGEN_MANTENEDOR],
  });
  return rowsAffected > 0;
}

/**
 * Guarda una edición. `patch` ya viene validado por `vtuberUpdateSchema`: aquí no se
 * valida otra vez para no tener dos reglas que puedan divergir.
 *
 * Los campos vacíos (`null`) se guardan como tales en vez de borrar la fila: un campo
 * borrado a mano en el mantenedor es una edición, no la ausencia de una.
 */
export async function guardarEdicion(slug, patch) {
  if (!tursoConfigurado()) return false;
  await asegurarTablas();
  const sentencias = [];
  for (const campo of CAMPOS_EDITABLES) {
    if (patch[campo] === undefined) continue;
    const valor = patch[campo] === null ? null : JSON.stringify(patch[campo]);
    sentencias.push(sentenciaDeEdicion(slug, campo, valor));
  }
  if (sentencias.length === 0) return false;
  await turso().batch(sentencias, 'write');
  return true;
}

/** La sentencia de upsert de una edición. Una sola definición para los dos caminos. */
function sentenciaDeEdicion(slug, campo, valor) {
  return {
    sql: `INSERT INTO edicion (slug, campo, valor, actualizado)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT (slug, campo) DO UPDATE
            SET valor = excluded.valor, actualizado = excluded.actualizado`,
    args: [slug, campo, valor],
  };
}

/**
 * Guarda el MISMO cambio de un campo en muchas fichas (el estado masivo del mantenedor).
 *
 * Se hace en UNA transacción y no en N llamadas: si fueran sueltas y fallara la mitad, el
 * mantenedor diría "0 actualizados" con la base ya a medias. Devuelve cuántas fichas
 * tocó.
 */
export async function guardarEdicionMasiva(slugs, campo, valor) {
  if (!tursoConfigurado() || slugs.length === 0) return 0;
  if (!CAMPOS_EDITABLES.includes(campo)) return 0;
  await asegurarTablas();
  const json = valor === null ? null : JSON.stringify(valor);
  await turso().batch(
    slugs.map((slug) => sentenciaDeEdicion(slug, campo, json)),
    'write',
  );
  return slugs.length;
}

/**
 * Aplica las ediciones de Turso SOBRE el resultado del catálogo.
 *
 * Regla de precedencia (el punto que hay que tener claro): **gana la edición del
 * mantenedor**. El catálogo lo reescribe el scraper en cada pasada, así que si el
 * catálogo ganara, una corrección a mano desaparecería en el siguiente scrape sin
 * avisar. Las ediciones solo se pierden si alguien las borra de Turso a propósito.
 *
 * Los valores se guardan como JSON para no perder el tipo (un `profile` es un array,
 * un `themeColor` una cadena), y se leen con tolerancia: una fila con JSON inválido se
 * ignora en vez de tumbar la respuesta entera.
 */
export function aplicarEdiciones(carta, ediciones) {
  if (!carta || !ediciones) return carta;
  const propias = ediciones[carta.slug];
  if (!propias) return carta;

  const salida = { ...carta };
  for (const campo of CAMPOS_EDITABLES) {
    if (!(campo in propias)) continue;
    const bruto = propias[campo];
    if (bruto === null) {
      salida[campo] = null;
      continue;
    }
    try {
      salida[campo] = JSON.parse(bruto);
    } catch {
      // Valor escrito antes de que existiera el JSON (o corrupto): se usa tal cual.
      salida[campo] = bruto;
    }
  }
  return salida;
}

/**
 * Igual que `aplicarEdiciones` pero sobre una lista, sin recorrerla dos veces.
 */
export function aplicarEdicionesLista(cartas, ediciones) {
  if (!ediciones || Object.keys(ediciones).length === 0) return cartas;
  return cartas.map((carta) => aplicarEdiciones(carta, ediciones));
}

/**
 * La fila de un asset subido A MANO, con sus medidas y su peso; `null` si no hay.
 *
 * A diferencia de `leerAssetRemoto` —que devuelve el reemplazo SI existe y si no el del
 * catálogo, porque sirve para SERVIR una imagen— aquí solo interesa el reemplazo: quien
 * llama quiere saber si lo que se ve es lo que subió una persona.
 */
export async function leerAssetDelMantenedor(slug, kind) {
  if (!tursoConfigurado()) return null;
  await asegurarTablas();
  const { rows } = await turso().execute({
    sql: `SELECT mime, width, height, size, actualizado FROM asset_remoto
          WHERE slug = ? AND kind = ? AND origen = ? LIMIT 1`,
    args: [slug, kind, ORIGEN_MANTENEDOR],
  });
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Sustituye en un detalle las imágenes que tienen reemplazo del mantenedor.
 *
 * POR QUÉ NO BASTA CON RELEER EL CATÁLOGO
 * ---------------------------------------
 * Las rutas de escritura del mantenedor (`PATCH`, `POST/DELETE …/image/:kind`) devuelven el
 * detalle actualizado porque el cliente hace `setSelected(result)` y **la página se vuelve a
 * dibujar desde ese objeto**. Si la respuesta no trae el reemplazo, la ficha queda con la
 * imagen del catálogo —o con `null` si el tipo no existía— justo después de subirla: la UI
 * pinta "sin imagen" con la imagen ya guardada. Medido en producción, ese era el síntoma de
 * "no puedo subir imágenes".
 *
 * La precedencia es la MISMA que en la lectura (Turso gana al catálogo) y se aplica en dos
 * sitios a la vez porque los leen dos consumidores distintos:
 *   · `images[kind]` → lo leen la carta 3D, la ficha y el gestor de imágenes.
 *   · `assets[]`     → lo lee el gestor, que muestra dimensiones y peso.
 *
 * `reemplazos` es `{ <kind>: { path, width, height, bytes } }`, ya resuelto por quien habla
 * con Turso; esta función solo compone, así que es pura y se puede probar sin red.
 */
export function aplicarImagenesDelMantenedor(detail, reemplazos) {
  const kinds = Object.keys(reemplazos ?? {});
  if (!detail || kinds.length === 0) return detail;

  const salida = { ...detail, images: { ...detail.images }, assets: [...(detail.assets ?? [])] };
  for (const kind of kinds) {
    const reemplazo = reemplazos[kind];
    const i = salida.assets.findIndex((a) => a.kind === kind);
    if (i >= 0) salida.assets[i] = { ...salida.assets[i], ...reemplazo };
    else salida.assets.push({ kind, sourceUrl: null, ...reemplazo });
    salida.images[kind] = `/${reemplazo.path}`;
  }
  return salida;
}

/**
 * Los reemplazos del mantenedor de UNA ficha, listos para `aplicarImagenesDelMantenedor`.
 *
 * POR QUÉ NO BASTA CON LOS `assets` DEL CATÁLOGO
 * ----------------------------------------------
 * El campo que decide lo que se VE es `images[kind]`, y para `background` viene `null` en 784
 * de las 785 fichas (el scraper no produce fondos: solo existe si alguien lo sube). Con
 * `images.background` en `null`, `holo-card.tsx` **no dibuja la capa de fondo**, así que el
 * fondo subido se servía por HTTP (200) y no aparecía en la carta. Los `assets` sí traían la
 * ruta correcta, y por eso el fallo pasaba desapercibido al mirar la API.
 *
 * Una ficha es el caso particular de N=1: delega en `reemplazosDePagina`, que resuelve la
 * consulta con `IN (...)`. Así hay **una sola** definición de la consulta y del mapeo de
 * filas (antes este `for` + `await` hacía 3 viajes por ficha, y el detalle pagaba 3 consultas
 * donde basta 1). El nombre se conserva porque lo llama el mantenedor y expresa la intención.
 */
export async function reemplazosDelMantenedor(slug, kinds = KINDS_GESTIONABLES) {
  if (!tursoConfigurado()) return {};
  const porSlug = await reemplazosDePagina([slug], kinds);
  return porSlug[slug] ?? {};
}

/**
 * Un reemplazo de imagen del mantenedor, ya compuesto con su ruta canónica.
 *
 * @typedef {object} ReemplazoDeImagen
 * @property {string} path        Ruta canónica publicada (`images/<kind>/<slug>.<ext>`).
 * @property {number|null} width  Medida guardada, o `null` si la cabecera no se pudo leer.
 * @property {number|null} height
 * @property {number|null} bytes
 */

/**
 * Los reemplazos del mantenedor de MUCHAS fichas, en UNA consulta.
 *
 * POR QUÉ EXISTE (medido)
 * -----------------------
 * La versión por ficha (`reemplazosDelMantenedor`) consulta tipo por tipo con un
 * `for` + `await`: 3 viajes por carta (uno por `KINDS_GESTIONABLES`). Aplicada a la
 * lista, `Promise.all` los lanzaba todos a la vez pero **no los convertía en una
 * consulta**: con `perPage=24` eran 4 + 24×3×(3 DDL + 1 SELECT) ≈ 292 viajes a Turso
 * para pintar una página, y con `perPage=100`, 1.204. De ahí el escalado lineal de
 * ~14 ms por carta.
 *
 * Esta función resuelve la página entera con DOS viajes (el DDL ya memoizado cuenta
 * una vez por instancia): uno para las ediciones y uno para los assets.
 *
 * Se sigue devolviendo SOLO `origen = 'mantenedor'`: un asset del catálogo no es un
 * reemplazo y no debe pisar nada. El filtro va en el SQL y no en JS porque es la
 * tabla entera la que no interesa traer — cada fila lleva los BYTES de una imagen.
 *
 * `slug IN (...)` con placeholders, no interpolación: un slug llega de la URL y
 * concatenarlo sería inyección (los slugs son ASCII sin comillas, pero la consulta
 * no tiene por qué saberlo).
 *
 * @param {string[]} slugs
 * @param {readonly string[]} [kinds]
 * @returns {Promise<Record<string, Record<string, ReemplazoDeImagen>>>} por slug, por tipo.
 */
export async function reemplazosDePagina(slugs, kinds = KINDS_GESTIONABLES) {
  const lista = [...new Set((slugs ?? []).filter(Boolean))];
  if (!tursoConfigurado() || lista.length === 0 || kinds.length === 0) return {};
  await asegurarTablas();
  const marcadoresSlug = lista.map(() => '?').join(', ');
  const marcadoresKind = kinds.map(() => '?').join(', ');
  const { rows } = await turso().execute({
    sql: `SELECT slug, kind, width, height, size FROM asset_remoto
          WHERE origen = ? AND slug IN (${marcadoresSlug}) AND kind IN (${marcadoresKind})`,
    args: [ORIGEN_MANTENEDOR, ...lista, ...kinds],
  });
  const porSlug = {};
  for (const fila of rows) {
    const ext = EXTENSION_DE_CARPETA[fila.kind] ?? 'webp';
    const reemplazos = porSlug[fila.slug] ?? {};
    reemplazos[fila.kind] = {
      path: `images/${fila.kind}/${fila.slug}.${ext}`,
      width: fila.width ?? null,
      height: fila.height ?? null,
      bytes: fila.size ?? null,
    };
    porSlug[fila.slug] = reemplazos;
  }
  return porSlug;
}

/**
 * Aplica a una LISTA los reemplazos de imagen del mantenedor.
 *
 * La grilla del catálogo pinta el personaje (`images.character`) de cada carta, así que sin
 * esto la imagen recién subida se vería en la ficha y NO en el listado. Antes se preguntaba
 * carta por carta (y tipo por tipo) a Turso; ahora la página entera se resuelve con una sola
 * consulta (ver `reemplazosDePagina`).
 */
export async function aplicarReemplazosALista(cartas, kinds = KINDS_GESTIONABLES) {
  if (!tursoConfigurado() || !Array.isArray(cartas) || cartas.length === 0) return cartas;
  const porSlug = await reemplazosDePagina(cartas.map((carta) => carta.slug), kinds);
  if (Object.keys(porSlug).length === 0) return cartas;
  return cartas.map((carta) =>
    porSlug[carta.slug] ? aplicarImagenesDelMantenedor(carta, porSlug[carta.slug]) : carta,
  );
}
