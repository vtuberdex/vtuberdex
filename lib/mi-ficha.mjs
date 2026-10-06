/**
 * «Mi ficha»: el pegamento HTTP del reparto de puntos de habilidad y del aviso de subida de nivel.
 * Las reglas viven en `server/src/mi-ficha.mjs` y `server/src/experiencia.mjs`; aquí solo se decide
 * quién es la persona, qué ficha mira y cuándo se manda el correo.
 *
 * LA LLAVE ES EL CORREO, NO UNA CONTRASEÑA
 * ----------------------------------------
 * El enlace mágico lleva un token (propósito `ficha`, 7 días, NO se gasta) atado al correo con que se
 * inscribió la ficha. Con él se listan las fichas de ese correo (`fichasDelTitular`) y solo sobre ellas
 * se puede repartir. El token viaja en el fragmento de la URL (no llega a nginx ni a los logs) y en el
 * cuerpo de un POST. Las fichas del scrape original no tienen correo guardado: no tienen «Mi ficha»
 * (el mantenedor puede editarlas igual).
 *
 * EL AVISO NO RETRASA EL LIKE: sale en segundo plano y nunca rompe la respuesta; si el correo falla se
 * suelta el aviso para que el siguiente like lo reintente (`soltarAvisoDeNivel`).
 */
import { experienciaConLikes } from '../server/src/experiencia.mjs';
import {
  PuntosError,
  estadoDePuntos,
  reclamarAvisoDeNivel,
  reiniciarRangos,
  soltarAvisoDeNivel,
  subirHabilidad,
} from '../server/src/mi-ficha.mjs';
import { correoDeLaFicha, fichasDelTitular, hashearRed } from '../server/src/solicitudes.mjs';
import { getVtuberBySlug } from '../server/src/search.mjs';
import { correoDeMiFicha, enviarCorreo } from './correo.mjs';
import { dbConDiario } from './diario.mjs';
import { conExperiencia, contarLikes, ipDelCliente, origenPermitido } from './likes.mjs';
import { ejecutorDeSolicitudes } from './solicitudes.mjs';
import { correoDelToken, crearToken, envioPermitido } from '../server/src/verificacion.mjs';

/** @typedef {{ ejecutor?: any, db?: any, esperar?: boolean, env?: Record<string, string | undefined> }} Opciones */

const CABECERAS = { 'cache-control': 'no-store' };
const responder = (cuerpo, status = 200) => Response.json(cuerpo, { status, headers: CABECERAS });
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Una ficha dada de baja (grado 1) no tiene página ni puntos: es secreta. */
const activa = (ficha) => ficha && ficha.premium?.grade !== '1';

/** Por id: lo que `ficha_correo` guarda. El id no cambia aunque la ficha cambie de slug. */
const resolverPorId = (db) => (id) => {
  const fila = db.prepare('SELECT slug FROM vtuber WHERE id = ?').get(id);
  return fila ? resolver(db)(fila.slug) : null;
};

const resolver = (db) => (slug) => {
  const ficha = getVtuberBySlug(db, slug, { includeHidden: true });
  return activa(ficha) ? ficha : null;
};

/** Ficha con experiencia calculada con sus likes. */
async function conNivel(ficha) {
  return conExperiencia(ficha, await contarLikes(ficha.id));
}

/* ------------------------------------------------------------- aviso de nivel */

/**
 * Llamar tras un like registrado. Si la ficha acaba de subir de nivel y se conoce su correo, le manda el
 * enlace mágico con los puntos que tiene para repartir. Seguro de llamar siempre: nunca lanza.
 * @param {{ card: object, likes: number, env?: object, ejecutor?: any, db?: any }} datos
 *   `card` es la ficha ANTES de aplicar likes (con su nivel base); `likes` el total ya con el nuevo.
 */
export async function avisarSubidaDeNivel({ card, likes, env = process.env, ejecutor, db }) {
  let reclamado = null;
  const e = ejecutor ?? (await ejecutorDeSolicitudes().catch(() => null));
  if (!e) return false;
  try {
    const exp = experienciaConLikes({ level: card.level, current: card.experience?.current, max: card.experience?.max }, likes);
    if (exp.nivelesGanados < 1) return false;
    if (!(await reclamarAvisoDeNivel(e, { vtuberId: card.id, nivel: exp.level, nivelBase: exp.level - exp.nivelesGanados }))) return false;
    reclamado = exp.level;
    const base = db ?? (await dbConDiario());
    const completa = getVtuberBySlug(base, card.slug, { includeHidden: true });
    if (!activa(completa)) return false;
    const email = await correoDeLaFicha(e, { fichaId: card.id, resolverFicha: resolver(base) });
    if (!email) return false; // ficha del scrape: nadie a quien avisar (el nivel queda anotado igual)
    const puntos = (await estadoDePuntos(e, { vtuberId: card.id, skills: completa.skills, nivelesGanados: exp.nivelesGanados })).disponibles;
    const permiso = await envioPermitido(e, { email, proposito: 'ficha', maximo: 8, espera: 0 });
    if (!permiso.ok) return false;
    const token = await crearToken(e, { proposito: 'ficha', email });
    const { asunto, texto, html } = correoDeMiFicha({ token, nombre: card.name, nivel: exp.level, puntos, motivo: 'nivel' }, env);
    await enviarCorreo({ para: email, asunto, texto, html }, env);
    return true;
  } catch (error) {
    console.error(`[mi-ficha] no se pudo avisar del nivel de ${card?.slug}: ${error.message}`);
    if (reclamado !== null) await soltarAvisoDeNivel(e, { vtuberId: card.id, nivel: reclamado }).catch(() => {});
    return false;
  }
}

/* --------------------------------------------------------------- pedir enlace */

const VENTANA_MS = 10 * 60 * 1000;
const MAX_POR_RED = 10;
const porRed = (globalThis.__vtuberdexMiFichaRed ??= new Map());
function redAgotada(ip, ahora = Date.now()) {
  const clave = hashearRed(ip);
  const marcas = (porRed.get(clave) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (marcas.length >= MAX_POR_RED) {
    porRed.set(clave, marcas);
    return true;
  }
  marcas.push(ahora);
  porRed.set(clave, marcas);
  if (porRed.size > 5000) porRed.clear();
  return false;
}

/** Solo para los tests. */
export function __reiniciarLimiteMiFicha() {
  porRed.clear();
}

/**
 * `POST /api/mi-ficha/enlace` `{ email }`: manda el enlace mágico a ese correo SI tiene fichas. Responde
 * siempre lo mismo para cualquier correo bien formado: no se puede preguntar «¿esta persona está inscrita?».
 */
export async function pedirEnlaceDeMiFicha(request, { ejecutor, db, esperar = false, env = process.env } = /** @type {Opciones} */ ({})) {
  if (!origenPermitido(request.headers)) return responder({ error: 'origen_no_permitido' }, 403);
  const cuerpo = await request.json().catch(() => null);
  const email = typeof cuerpo?.email === 'string' ? cuerpo.email.trim().toLowerCase() : '';
  if (!CORREO.test(email) || email.length > 200) return responder({ error: 'payload_invalido', detail: 'Escribe un correo válido.' }, 400);
  if (redAgotada(ipDelCliente(request.headers))) {
    return responder({ error: 'demasiados_intentos', detail: 'Demasiados intentos desde esta red. Espera unos minutos.' }, 429);
  }
  const trabajo = (async () => {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    const base = db ?? (await dbConDiario());
    const fichas = await fichasDelTitular(e, { email, resolverFicha: resolver(base), resolverPorId: resolverPorId(base) });
    if (!fichas.length) return;
    const permiso = await envioPermitido(e, { email, proposito: 'ficha' });
    if (!permiso.ok) return;
    const token = await crearToken(e, { proposito: 'ficha', email });
    const { asunto, texto, html } = correoDeMiFicha({ token, nombre: fichas.length === 1 ? fichas[0].ficha.name : '', motivo: 'enlace' }, env);
    await enviarCorreo({ para: email, asunto, texto, html }, env);
  })().catch((error) => console.error(`[mi-ficha] no se pudo enviar el enlace: ${error.message}`));
  if (esperar) await trabajo;
  return responder({ ok: true });
}

/* --------------------------------------------------------------------- estado */

/** Todo lo que la pantalla necesita de una ficha: nivel, barra, total y reparto de puntos. */
async function vistaDeFicha(e, ficha) {
  const card = await conNivel(ficha);
  const puntos = await estadoDePuntos(e, { vtuberId: ficha.id, skills: ficha.skills, nivelesGanados: card.levelsGained });
  return {
    slug: ficha.slug,
    name: ficha.name,
    level: card.level,
    levelsGained: card.levelsGained,
    likes: card.likes,
    experience: card.experience,
    puntos,
  };
}

/** Resuelve token → correo → fichas. `null` si el enlace no sirve. */
async function sesionDeMiFicha(e, db, token) {
  const dueno = await correoDelToken(e, typeof token === 'string' ? token : '', 'ficha');
  if (!dueno) return null;
  const fichas = (await fichasDelTitular(e, { email: dueno.email, resolverFicha: resolver(db), resolverPorId: resolverPorId(db) })).map((f) => f.ficha);
  return { email: dueno.email, fichas };
}

const ENLACE_INVALIDO = {
  error: 'enlace_invalido',
  detail: 'Este enlace caducó o no es válido. Pide uno nuevo con tu correo y te lo mandamos al momento.',
};

/**
 * `POST /api/mi-ficha` `{ token, slug? }`: el estado de la ficha elegida (la primera si no se elige) y las
 * demás fichas de ese correo.
 */
export async function estadoDeMiFicha(request, { ejecutor, db } = /** @type {Opciones} */ ({})) {
  if (!origenPermitido(request.headers)) return responder({ error: 'origen_no_permitido' }, 403);
  const cuerpo = await request.json().catch(() => null);
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    const base = db ?? (await dbConDiario());
    const sesion = await sesionDeMiFicha(e, base, cuerpo?.token);
    if (!sesion) return responder(ENLACE_INVALIDO, 410);
    if (!sesion.fichas.length) return responder({ error: 'sin_fichas', detail: 'No encontramos fichas con este correo.' }, 404);
    const elegida = sesion.fichas.find((f) => f.slug === cuerpo?.slug) ?? sesion.fichas[0];
    return responder({ ok: true, fichas: sesion.fichas.map((f) => ({ slug: f.slug, name: f.name })), ficha: await vistaDeFicha(e, elegida) });
  } catch (error) {
    console.error(`[mi-ficha] estado: ${error.message}`);
    return responder({ error: 'no_disponible', detail: 'No se pudo cargar tu ficha. Inténtalo de nuevo en unos minutos.' }, 503);
  }
}

/**
 * `POST /api/mi-ficha/puntos` `{ token, slug, accion: 'subir' | 'reiniciar', clave? }`: gasta un punto en una
 * habilidad o devuelve todos los puntos repartidos. Responde con el estado nuevo de la ficha.
 */
export async function repartirPuntos(request, { ejecutor, db } = /** @type {Opciones} */ ({})) {
  if (!origenPermitido(request.headers)) return responder({ error: 'origen_no_permitido' }, 403);
  const cuerpo = await request.json().catch(() => null);
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    const base = db ?? (await dbConDiario());
    const sesion = await sesionDeMiFicha(e, base, cuerpo?.token);
    if (!sesion) return responder(ENLACE_INVALIDO, 410);
    const ficha = sesion.fichas.find((f) => f.slug === cuerpo?.slug);
    if (!ficha) return responder({ error: 'no_encontrado', detail: 'Esa ficha no es tuya o ya no existe.' }, 404);
    const card = await conNivel(ficha);
    const entrada = { vtuberId: ficha.id, skills: ficha.skills, nivelesGanados: card.levelsGained };
    if (cuerpo?.accion === 'reiniciar') await reiniciarRangos(e, entrada);
    else if (cuerpo?.accion === 'subir' && typeof cuerpo.clave === 'string') await subirHabilidad(e, { ...entrada, clave: cuerpo.clave });
    else return responder({ error: 'payload_invalido', detail: 'Acción no válida.' }, 400);
    return responder({ ok: true, ficha: await vistaDeFicha(e, ficha) });
  } catch (error) {
    if (error instanceof PuntosError) return responder({ error: error.code, detail: error.detail }, error.status);
    console.error(`[mi-ficha] puntos: ${error.message}`);
    return responder({ error: 'no_disponible', detail: 'No se pudo guardar. Inténtalo de nuevo en unos minutos.' }, 503);
  }
}
