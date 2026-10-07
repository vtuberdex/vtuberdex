/**
 * Acceso al mantenedor con ENLACE MÁGICO: se pide con un correo de la lista de admins y llega un
 * enlace de un solo uso (15 min) que abre una sesión. No hay contraseña que robar ni que olvidar:
 * entrar exige controlar el buzón.
 *
 * QUIÉN PUEDE ENTRAR: `VTUBERDEX_ADMIN_EMAILS` (separados por comas). Sin la variable, los dos
 * correos de los mantenedores actuales. La lista NO se puede deducir desde fuera: pedir un enlace
 * responde SIEMPRE lo mismo, sea o no admin el correo, y el envío se hace en segundo plano para que
 * ni el tiempo de respuesta delate cuáles están en la lista.
 *
 * CONTRA EL ABUSO: sin IP fiable detrás de cada correo, se limita por correo (`envioPermitido`, más
 * holgado que el de las solicitudes para no dejar fuera a un admin que lo pide varias veces) y por red
 * (ventana en memoria: basta para frenar a un script, no hace falta persistirla).
 *
 * LA SESIÓN es la de siempre (`emitirSesion`, tabla `sesion_admin`, 8 h): el resto del mantenedor no
 * se entera de cómo se entró. El nombre de usuario de la sesión es el correo, así que el diario de
 * cambios dice quién editó qué.
 */
import { consumirToken, crearToken, envioPermitido } from '../server/src/verificacion.mjs';
import { emitirSesion } from './admin-auth.mjs';
import { correoDeAcceso, enviarCorreo } from './correo.mjs';
import { hashearRed } from '../server/src/solicitudes.mjs';
import { ejecutorDeSolicitudes } from './solicitudes.mjs';

const ADMINS_POR_DEFECTO = ['madkoding@gmail.com', 'ritcher.recomienda@gmail.com'];

export function correosDeAdmin(env = process.env) {
  const lista = (env.VTUBERDEX_ADMIN_EMAILS ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  return lista.length ? lista : ADMINS_POR_DEFECTO;
}

const VENTANA_MS = 10 * 60 * 1000;
const MAX_POR_RED = 10;
const porRed = (globalThis.__vtuberdexEnlaceRed ??= new Map());

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
export function __reiniciarLimiteDeRed() {
  porRed.clear();
}

/**
 * Pide el enlace. Devuelve `{ status, cuerpo }`; el cuerpo es el mismo para cualquier correo bien formado.
 * `esperar` solo lo usan los tests (en producción el envío corre en segundo plano).
 */
export async function pedirEnlaceDeAcceso({ email, ip }, { ejecutor, esperar = false, env = process.env } = {}) {
  const correo = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) || correo.length > 200) {
    return { status: 400, cuerpo: { error: 'correo_invalido', detail: 'escribe un correo válido' } };
  }
  if (redAgotada(ip)) {
    return { status: 429, cuerpo: { error: 'demasiados_intentos', detail: 'Demasiados intentos desde esta red. Espera unos minutos.' } };
  }
  const acuse = { status: 200, cuerpo: { ok: true } };
  if (!correosDeAdmin(env).includes(correo)) return acuse;

  const trabajo = (async () => {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    const permiso = await envioPermitido(e, { email: correo, proposito: 'admin', maximo: 20, espera: 30 * 1000 });
    if (!permiso.ok) return;
    const token = await crearToken(e, { proposito: 'admin', email: correo });
    const { asunto, texto, html } = correoDeAcceso({ token }, env);
    await enviarCorreo({ para: correo, asunto, texto, html }, env);
  })().catch((error) => console.error(`[admin] no se pudo enviar el enlace de acceso: ${error.message}`));
  if (esperar) await trabajo;
  return acuse;
}

/** Gasta el enlace y abre la sesión. Devuelve `{ status, cuerpo }`. */
export async function entrarConEnlace(token, { ejecutor } = {}) {
  const e = ejecutor ?? (await ejecutorDeSolicitudes());
  const gastado = await consumirToken(e, token, 'admin');
  // Aunque el token sea auténtico, el correo debe seguir en la lista (se pudo quitar a un admin entre medias).
  if (!gastado || !correosDeAdmin().includes(gastado.email)) {
    return { status: 410, cuerpo: { error: 'enlace_invalido', detail: 'Este enlace no es válido: caducó o ya se usó. Pide uno nuevo.' } };
  }
  const user = { id: 0, username: gastado.email, role: 'admin' };
  const sesion = await emitirSesion(user);
  if (!sesion) return { status: 404, cuerpo: { error: 'no_encontrado', detail: 'no se pudo emitir la sesión (¿base del mantenedor configurada?)' } };
  return { status: 200, cuerpo: { token: sesion, user: { username: user.username, role: user.role } } };
}
