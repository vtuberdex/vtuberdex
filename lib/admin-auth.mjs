/**
 * Sesiones y credenciales del mantenedor EN PRODUCCIÓN.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * La primera versión del mantenedor en Turso no tenía login: cualquiera que supiera la URL
 * podía editar el catálogo. Se daba por hecho que "el permiso va implícito en la variable de
 * entorno", y eso es falso: la URL de producción es pública y el mantenedor responde en
 * `/admin`. Además la UI del mantenedor EXIGE login (pide `POST /api/admin/login` y guarda
 * el token en `localStorage`), así que sin esta ruta la página cargaba pero no podía hacer
 * nada — que es exactamente lo que se midió: `/admin` respondía 200 y la consola no hacía ni
 * una llamada a la API.
 *
 * POR QUÉ LAS SESIONES VAN A TURSO Y NO A MEMORIA
 * ----------------------------------------------
 * En Vercel cada petición puede caer en una instancia distinta. Un `Map` en memoria —que es
 * lo que usa el Express local— haría que un login emitido por la instancia A fuera
 * desconocido para la instancia B: el usuario entraría y, en la siguiente petición, se
 * quedaría fuera de forma intermitente y difícil de diagnosticar. Guardando la sesión en
 * Turso, cualquier instancia la lee y el comportamiento es el mismo que en local.
 *
 * DE DÓNDE SALE LA CONTRASEÑA
 * ---------------------------
 * De `VTUBERDEX_ADMIN_PASSWORD_HASH`, un hash `scrypt` (el mismo formato que usa el seed
 * local: `scrypt$<sal>$<derivado>`). Nunca se guarda la contraseña en claro en ningún sitio,
 * ni en el repo ni en la base desplegada: la base saneada va sin `admin_user` a propósito
 * (ver `scripts/build-db.mjs`), así que la credencial de producción vive en una variable de
 * entorno y no en un archivo que se publica.
 *
 * `scripts/admin-hash.mjs` genera el hash para pegarlo en Vercel.
 */
import crypto from 'node:crypto';

import { verifyPassword } from '../server/src/auth.mjs';
import { asegurarTablas, turso, tursoConfigurado } from './ediciones.mjs';

/** 8 horas, igual que las sesiones locales, para que no haya dos comportamientos. */
const TTL_MS = 8 * 60 * 60 * 1000;

/** Usuario del mantenedor en producción. Se puede cambiar por entorno. */
export function usuarioEsperado() {
  return process.env.VTUBERDEX_ADMIN_USER || 'admin';
}

/**
 * ¿Hay credenciales configuradas?
 *
 * Se comprueba el HASH, no la contraseña: si falta, el login responde un error explícito que
 * dice qué variable falta, en vez de un 404 que parecería "esta ruta no existe" y mandaría a
 * buscar el problema al sitio equivocado.
 */
export function credencialesConfiguradas() {
  return Boolean(process.env.VTUBERDEX_ADMIN_PASSWORD_HASH);
}

/**
 * Describe la FORMA del hash configurado, sin revelar ni un carácter de su valor.
 *
 * POR QUÉ EXISTE
 * --------------
 * Vercel guarda esta variable como `sensitive`, y eso la hace **ilegible para siempre**: ni
 * el CLI, ni la API, ni el panel dejan volver a leer el valor una vez creado (comprobado:
 * `vercel env pull` y el endpoint con `decrypt=true` devuelven un placeholder o un sobre
 * cifrado). Si el valor se pega mal, el login responde un 401 idéntico al de una contraseña
 * equivocada y no hay forma de mirar el valor para distinguir las dos cosas.
 *
 * Y no es hipotético: medido, un hash CORRECTO envuelto en las comillas del comando
 * (`VTUBERDEX_ADMIN_PASSWORD_HASH='scrypt$...$...'` — el pie que imprime `admin-hash.mjs`)
 * NO valida, porque `verifyPassword` parte el valor por `$` y compara `'scrypt` contra
 * `scrypt`. Un solo carácter de más deja el mantenedor inaccesible con un error que no dice
 * nada. Lo mismo con los `$` escapados del shell (`\$`) o con un truncado al copiar.
 *
 * Se devuelve la ESTRUCTURA (cuántos segmentos hay, si cada uno es hexadecimal del tamaño
 * esperado) y nunca el valor: por eso puede viajar dentro de la respuesta de un error sin
 * filtrar la credencial. No se incluyen longitudes reales de los segmentos a propósito — el
 * login es una ruta SIN sesión y una longitud revelaría cuánto se escribió.
 */
export function formatoDeHash(stored = process.env.VTUBERDEX_ADMIN_PASSWORD_HASH) {
  const bruto = String(stored ?? '');
  if (!bruto) {
    return { valido: false, problemas: ['falta VTUBERDEX_ADMIN_PASSWORD_HASH (login sin configurar)'] };
  }

  const problemas = [];
  const comilla = bruto[0];
  const entreComillas = (comilla === "'" || comilla === '"') && bruto[bruto.length - 1] === comilla;
  if (entreComillas) {
    problemas.push(
      `el valor empieza y termina con ${comilla === "'" ? 'comilla simple' : 'comilla doble'}: se pegó el comando entero en vez del hash. Pégalo SIN las comillas`,
    );
  }
  if (bruto.includes('\\$')) {
    problemas.push('el valor lleva los $ escapados (\\$): pégalo con $ normales');
  }
  if (/[\r\n\t ]/.test(bruto)) {
    problemas.push('el valor lleva espacios, tabuladores o saltos de línea: pégalo limpio, sin espacios alrededor');
  }

  // Con comillas se analiza el interior, que es como quedaría tras un pegado "arreglado".
  const cuerpo = entreComillas ? bruto.slice(1, -1) : bruto;
  const partes = cuerpo.split('$');
  if (partes.length !== 3) {
    problemas.push(
      `se esperaban 3 segmentos separados por $ con la forma scrypt$<sal-hex>$<derivado-hex> y hay ${partes.length}`,
    );
  } else {
    const [esquema, sal, derivado] = partes;
    if (esquema !== 'scrypt') problemas.push(`el esquema es "${esquema}" y debe ser "scrypt"`);
    if (!/^[0-9a-f]+$/.test(sal)) problemas.push('la sal no es hexadecimal');
    if (!/^[0-9a-f]+$/.test(derivado)) problemas.push('el derivado no es hexadecimal');
    else if (derivado.length !== 128) {
      problemas.push('el derivado no mide 128 caracteres hexadecimales (64 bytes): parece truncado o incompleto');
    }
    if (sal.length !== 32) problemas.push('la sal no mide 32 caracteres hexadecimales (16 bytes): parece truncada o incompleta');
  }

  return { valido: problemas.length === 0, problemas };
}

/**
 * Comprueba usuario y contraseña.
 *
 * Devuelve el usuario si coinciden, o `null`. La comparación de la contraseña es en tiempo
 * constante (`verifyPassword`), y la del nombre de usuario también se hace con
 * `timingSafeEqual` sobre los buffers: comparar el usuario con `===` filtraría por tiempo qué
 * parte de la credencial falló.
 */
export function verificarCredenciales(username, password) {
  const diagnostico = diagnosticarCredenciales(username, password);
  return diagnostico.ok ? { id: 0, username: usuarioEsperado(), role: 'admin' } : null;
}

/**
 * Igual que `verificarCredenciales`, pero SIN tirar la información de cuál de las dos mitades
 * falló.
 *
 * POR QUÉ SE DEVUELVE ESTO
 * ------------------------
 * El login respondía un único `401 credenciales_invalidas` tanto si el usuario estaba mal como
 * si lo estaba la contraseña, y el mantenedor es de UNA sola persona que no puede mirar el
 * valor guardado (Vercel lo cifra). Resultado medido: "actualicé la contraseña y sigue
 * diciendo credenciales inválidas" sin ninguna forma de saber si el problema era el campo de
 * usuario. Distinguirlos no filtra la contraseña —que es el secreto— y el usuario ni lo es ni
 * pretende serlo: `admin` por defecto, escrito en `admin-hash.mjs`, en este archivo y en la
 * documentación. Aun así las dos comprobaciones se ejecutan SIEMPRE (ver abajo), para que el
 * tiempo de respuesta no revele nada extra.
 */
export function diagnosticarCredenciales(username, password) {
  if (!credencialesConfiguradas()) return { ok: false, usuarioOk: false, claveOk: false };
  const esperado = usuarioEsperado();
  const a = Buffer.from(String(username ?? ''));
  const b = Buffer.from(esperado);
  const usuarioOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  const claveOk = verifyPassword(password, process.env.VTUBERDEX_ADMIN_PASSWORD_HASH);
  // Se evalúan las dos SIEMPRE (nada de `&&` con cortocircuito) para que el tiempo de
  // respuesta no revele si el usuario existe.
  return { ok: usuarioOk && claveOk, usuarioOk, claveOk };
}

/** Tabla de sesiones. Aparte de `edicion`/`asset_remoto`: es estado efímero, no contenido. */
async function asegurarSesiones() {
  await asegurarTablas();
  await turso().executeMultiple(`
    CREATE TABLE IF NOT EXISTS sesion_admin (
      token      TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      role       TEXT NOT NULL,
      expira_en  INTEGER NOT NULL,
      creada     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sesion_expira ON sesion_admin (expira_en);
  `);
}

/** Emite una sesión y devuelve el token (lo que el cliente guarda y reenvía). */
export async function emitirSesion(user) {
  if (!tursoConfigurado()) return null;
  await asegurarSesiones();
  const token = crypto.randomBytes(32).toString('base64url');
  await turso().execute({
    sql: 'INSERT INTO sesion_admin (token, username, role, expira_en) VALUES (?, ?, ?, ?)',
    args: [token, user.username, user.role, Date.now() + TTL_MS],
  });
  return token;
}

/**
 * Lee una sesión. Devuelve el usuario o `null` si no existe o caducó.
 *
 * La limpieza de las caducadas se hace aquí y no con un trabajo aparte: en un servidor sin
 * procesos de fondo (funciones de Vercel) no hay dónde programar uno, y una fila muerta de
 * vez en cuando no molesta frente a arrastrar un cron.
 */
export async function leerSesion(token) {
  if (!tursoConfigurado() || !token) return null;
  await asegurarSesiones();
  const { rows } = await turso().execute({
    sql: 'SELECT username, role, expira_en FROM sesion_admin WHERE token = ?',
    args: [token],
  });
  if (rows.length === 0) return null;
  const fila = rows[0];
  if (Number(fila.expira_en) < Date.now()) {
    await turso().execute({ sql: 'DELETE FROM sesion_admin WHERE token = ?', args: [token] });
    return null;
  }
  return { username: fila.username, role: fila.role };
}

/** Cierra la sesión (el botón de salir del mantenedor). */
export async function cerrarSesion(token) {
  if (!tursoConfigurado() || !token) return false;
  await asegurarSesiones();
  const { rowsAffected } = await turso().execute({
    sql: 'DELETE FROM sesion_admin WHERE token = ?',
    args: [token],
  });
  return rowsAffected > 0;
}

/** El token de la cabecera `Authorization: Bearer ...`, o `null`. */
export function tokenDeCabecera(request) {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}
