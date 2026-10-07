/**
 * Solicitudes (inscripciones y bajas): el ejecutor del entorno y el pegamento HTTP público.
 *
 * Las reglas viven en `server/src/solicitudes.mjs`; aquí solo se decide DÓNDE se guarda, con la
 * misma convención que los likes (`lib/likes.mjs`): Turso en producción (tabla `solicitud`) y
 * `data/solicitudes.db` sin él (local, CI). Las solicitudes NO van al diario de cambios: no son
 * ediciones del catálogo sino una cola de entrada que el mantenedor vacía a mano.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  SolicitudError,
  borrarContacto,
  confirmarSolicitud,
  correoTieneFicha,
  crearSolicitud,
  descartarSinVerificar,
  ejecutorSqlite,
  fichasDelTitular,
  resolverSolicitud,
} from '../server/src/solicitudes.mjs';
import { fichaDeLaSolicitud } from '../server/src/modificacion.mjs';
import { getVtuberBySlug } from '../server/src/search.mjs';
import { borrarBorrador, guardarBorrador, leerBorrador } from '../server/src/borradores.mjs';
import { consumirToken, correoDelToken, crearToken, envioPermitido } from '../server/src/verificacion.mjs';
import { correoDeSolicitud, enviarCorreo } from './correo.mjs';
import { registrarRechazo } from '../server/src/rechazos.mjs';
import { aplicarYAnotar, dbConDiario } from './diario.mjs';
import { tursoConfigurado, turso } from './ediciones.mjs';
import { ipDelCliente, origenPermitido } from './likes.mjs';

let ejecutorVigente = null;

/** El ejecutor del entorno: Turso si está configurado; si no, `data/solicitudes.db`. */
export async function ejecutorDeSolicitudes() {
  if (ejecutorVigente) return ejecutorVigente;
  if (tursoConfigurado()) {
    const cliente = turso();
    ejecutorVigente = { execute: (sql, args) => cliente.execute({ sql, args }), exec: (sql) => cliente.executeMultiple(sql) };
  } else {
    // La ruta se escribe literal: una dinámica haría que Turbopack trace el proyecto entero.
    const archivo = path.join(process.cwd(), 'data', 'solicitudes.db');
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    ejecutorVigente = ejecutorSqlite(new DatabaseSync(archivo));
  }
  return ejecutorVigente;
}

/** Solo para los tests: olvida el ejecutor del entorno. */
export function reiniciarSolicitudes() {
  ejecutorVigente = null;
}

/**
 * Los rechazos que ve la persona (4xx y 503) se apuntan en `rechazo` para saber dónde se atasca la
 * gente (ver `server/src/rechazos.mjs`: ni correo ni contenido). Va sin esperar: apuntar no puede
 * retrasar ni romper la respuesta. `rechazosPendientes` existe para que los tests esperen el apunte.
 */
const apuntes = new Set();
export const rechazosPendientes = () => Promise.all([...apuntes]);

function responderRegistrando(formulario, ejecutor, cabeceras) {
  return (cuerpo, status) => {
    if (status >= 400) {
      const apunte = (async () => registrarRechazo(ejecutor ?? (await ejecutorDeSolicitudes()), { formulario, codigo: cuerpo?.error, status, issues: cuerpo?.issues }))()
        .catch(() => {})
        .finally(() => apuntes.delete(apunte));
      apuntes.add(apunte);
    }
    return Response.json(cuerpo, { status, headers: cabeceras });
  };
}

/** Respuesta cuando el correo de una modificación o baja no está asociado a ninguna ficha. */
const CORREO_SIN_FICHA = {
  error: 'correo_no_registrado',
  detail: 'No encontramos este correo asociado a ninguna ficha. Comunícate con uno de los administradores para resolver el problema.',
};

/**
 * `POST` público de una solicitud. Devuelve la `Response` ya armada.
 *
 * NO la deja en la cola del mantenedor: la guarda `sin_verificar` y manda un correo con un enlace de
 * un solo uso a la dirección escrita. Solo quien lo abre (y por tanto controla ese buzón) la hace
 * `pendiente`. Nunca se cachea y nunca devuelve el contenido guardado: el visitante solo recibe un acuse.
 */
export async function recibirSolicitud(request, tipo, ejecutor) {
  const cabeceras = { 'cache-control': 'no-store' };
  const responder = responderRegistrando(tipo, ejecutor, cabeceras);
  if (!origenPermitido(request.headers)) return responder({ error: 'origen_no_permitido' }, 403);
  const cuerpo = await request.json().catch(() => null);
  if (!cuerpo || typeof cuerpo !== 'object') return responder({ error: 'payload_invalido', detail: 'el cuerpo debe ser JSON' }, 400);
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    // El tope por correo se mira ANTES de guardar: crear la solicitud reemplaza la anterior sin
    // confirmar del mismo correo, y un doble clic no puede borrar la que ya tiene su correo en camino.
    const correoEscrito = typeof cuerpo.email === 'string' ? cuerpo.email.trim().toLowerCase() : '';
    if (tipo === 'baja' && correoEscrito && !cuerpo.website) {
      if (!(await correoTieneFicha(e, correoEscrito))) return responder(CORREO_SIN_FICHA, 404);
      const permiso = await envioPermitido(e, { email: correoEscrito, proposito: 'solicitud' });
      if (!permiso.ok) {
        const detail =
          permiso.motivo === 'demasiado_pronto'
            ? 'Ya te enviamos un correo hace un momento. Revisa tu bandeja (y el spam) antes de pedir otro.'
            : 'Se alcanzó el máximo de correos de hoy para esta dirección. Inténtalo mañana.';
        return responder({ error: 'demasiados_correos', detail }, 429);
      }
    }
    // La inscripción y los cambios de una ficha exigen el correo verificado ANTES de rellenar el formulario:
    // llegan con la credencial que se canjeó por el código (`sesion` para la inscripción, `permiso` para los
    // cambios). No hay segundo correo: la solicitud entra directa a la cola.
    if (tipo === 'inscripcion' || tipo === 'modificacion') {
      const campo = tipo === 'inscripcion' ? 'sesion' : 'permiso';
      if (typeof cuerpo[campo] !== 'string') {
        return responder({ error: 'falta_verificacion', detail: 'Primero confirma tu correo con el código que te enviamos.' }, 400);
      }
      const hecha = await crearSolicitud(e, cuerpo, { tipo, ip: ipDelCliente(request.headers), permiso: cuerpo[campo], propositoPermiso: campo });
      // Ya es una solicitud: el borrador (solo lo hay en la inscripción) se borra, y con él el correo que guardaba.
      if (tipo === 'inscripcion' && hecha.email) await borrarBorrador(e, { email: hecha.email });
      return responder({ ok: true, estado: hecha.descartada ? 'sin_verificar' : 'pendiente' }, 201);
    }
    const resultado = await crearSolicitud(e, cuerpo, { tipo, ip: ipDelCliente(request.headers) });
    if (resultado.descartada) return responder({ ok: true, estado: 'sin_verificar' }, 201);
    const token = await crearToken(e, { proposito: 'solicitud', email: resultado.email, solicitudId: resultado.id });
    try {
      const { asunto, texto, html } = correoDeSolicitud({ tipo, token, nombre: tipo === 'inscripcion' ? cuerpo.name : cuerpo.ficha });
      await enviarCorreo({ para: resultado.email, asunto, texto, html });
    } catch (error) {
      // Sin correo no hay forma de confirmar: no se deja una solicitud que nadie puede validar.
      console.error(`[solicitudes] no se pudo enviar el correo de confirmación: ${error.message}`);
      await descartarSinVerificar(e, resultado.id);
      return responder({ error: 'correo_no_disponible', detail: 'No pudimos enviar el correo de confirmación. Revisa la dirección e inténtalo de nuevo en unos minutos.' }, 503);
    }
    return responder({ ok: true, estado: 'sin_verificar' }, 201);
  } catch (error) {
    if (error instanceof SolicitudError) {
      return responder({ error: error.code, detail: error.detail, issues: error.issues }, error.status);
    }
    console.error(`[solicitudes] no se pudo guardar la ${tipo}: ${error.message}`);
    return responder({ error: 'solicitudes_no_disponibles', detail: 'No se pudo registrar el envío. Inténtalo de nuevo más tarde.' }, 503);
  }
}

/**
 * Una baja confirmada desde el correo se APLICA sola cuando ese correo es el de una inscripción
 * aprobada: la ficha (o las fichas) que inscribió pasan al grado 1 —la baja—, la solicitud queda
 * `procesada` y se borran los datos de contacto, como prometen los términos.
 *
 *   · Sin ficha escrita: se dan de baja TODAS las fichas inscritas con ese correo (quien controla el
 *     buzón es el titular de todas; la respuesta le dice cuáles fueron).
 *   · Con ficha escrita: solo esa, y solo si es una de las de ese correo. Si es otra, no se toca nada.
 *
 * Si no hay forma de demostrar la titularidad (las fichas del scrape original no tienen correo
 * guardado, o es otro correo) queda `pendiente` para una persona. Cualquier fallo también la deja
 * pendiente: nunca se pierde.
 *
 * Devuelve `{ fichas: string[] }` con los nombres de lo dado de baja, o `null`.
 */
async function intentarBajaAutomatica(ejecutor, solicitud) {
  if (!tursoConfigurado()) return null;
  try {
    const db = await dbConDiario();
    const asociadas = await fichasDelTitular(ejecutor, {
      email: solicitud.contacto?.email,
      resolverFicha: (slug) => getVtuberBySlug(db, slug, { includeHidden: true }),
    });
    let objetivo = asociadas;
    const escrita = String(solicitud.datos.ficha ?? '').trim();
    if (escrita) {
      let pedida = null;
      try {
        pedida = fichaDeLaSolicitud(db, escrita);
      } catch {
        /* una ficha que no existe o es ambigua: no se adivina, queda para una persona */
      }
      objetivo = asociadas.filter((a) => a.ficha.id === pedida?.id);
    }
    if (objetivo.length === 0) return null;
    for (const { ficha } of objetivo) {
      await aplicarYAnotar({ tipo: 'vtuber.editar', id: ficha.id, patch: { premium: { grade: '1' } } }, 'baja-verificada');
    }
    const nombres = objetivo.map((o) => o.ficha.name);
    await resolverSolicitud(ejecutor, solicitud.id, {
      estado: 'procesada',
      actor: 'baja-verificada',
      nota: `Baja confirmada desde el correo del titular: ${nombres.join(', ')} → grado 1.`,
      vtuberSlug: objetivo[0].ficha.slug,
    });
    for (const { inscripcion } of objetivo) await borrarContacto(ejecutor, inscripcion);
    return { fichas: nombres };
  } catch (error) {
    console.error(`[solicitudes] baja automática no aplicada (queda en revisión): ${error.message}`);
    return null;
  }
}

/**
 * `POST /api/verificar`: gasta el token del correo. Devuelve `{ status, cuerpo }`.
 * Un enlace malo, caducado o ya usado responde igual (410): no dice cuál de las tres cosas fue.
 */
export async function confirmarVerificacion(token, ejecutor) {
  const e = ejecutor ?? (await ejecutorDeSolicitudes());
  const gastado = await consumirToken(e, token, 'solicitud');
  const solicitud = gastado?.solicitudId ? await confirmarSolicitud(e, gastado.solicitudId) : null;
  if (!solicitud) {
    return { status: 410, cuerpo: { error: 'enlace_invalido', detail: 'Este enlace no es válido: caducó, ya se usó o la solicitud se reemplazó por un envío más nuevo.' } };
  }
  if (solicitud.tipo === 'baja') {
    const aplicada = await intentarBajaAutomatica(e, solicitud);
    if (aplicada) return { status: 200, cuerpo: { ok: true, tipo: 'baja', resultado: 'baja_aplicada', fichas: aplicada.fichas } };
    // Sin ficha escrita y sin ninguna inscrita con ese correo, la solicitud queda con solo el correo y el motivo.
    if (!String(solicitud.datos.ficha ?? '').trim()) return { status: 200, cuerpo: { ok: true, tipo: 'baja', resultado: 'sin_ficha' } };
  }
  return { status: 200, cuerpo: { ok: true, tipo: solicitud.tipo, resultado: 'en_revision' } };
}

/**
 * Los dos formularios que se rellenan DESPUÉS de demostrar el correo. `proposito` es el del código que se
 * manda, `credencial` el de lo que se canjea: la `sesion` de la inscripción se puede usar muchas veces (guarda
 * el borrador) y solo se gasta al enviar; el `permiso` de los cambios autoriza un solo envío.
 */
const FORMULARIOS_CON_CODIGO = {
  inscripcion: { proposito: 'inscripcion', credencial: 'sesion' },
  modificacion: { proposito: 'modificacion', credencial: 'permiso' },
};

/**
 * Paso 1: `POST /api/<inscripciones|modificaciones>/codigo`. Manda un CÓDIGO al correo escrito (1 h, un uso).
 * No guarda ninguna solicitud. En la modificación exige que el correo ya tenga una ficha (si no, 404
 * `correo_no_registrado`: que hable con un administrador); en la inscripción responde igual para cualquiera.
 * Tope por correo (1/min, 4/día): sin él serviría para inundar el buzón de un tercero.
 */
export async function pedirCodigo(request, tipo, ejecutor) {
  const cabeceras = { 'cache-control': 'no-store' };
  const responder = responderRegistrando(`${tipo}:codigo`, ejecutor, cabeceras);
  if (!origenPermitido(request.headers)) return responder({ error: 'origen_no_permitido' }, 403);
  const { proposito } = FORMULARIOS_CON_CODIGO[tipo];
  const cuerpo = await request.json().catch(() => null);
  const email = typeof cuerpo?.email === 'string' ? cuerpo.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) {
    return responder({ error: 'payload_invalido', detail: 'correo no válido' }, 400);
  }
  // El campo trampa: un bot que lo rellena recibe el mismo acuse y no se le manda nada.
  if (cuerpo.website) return responder({ ok: true }, 200);
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    // Los cambios de una ficha solo tienen sentido para un correo que ya tiene una: se comprueba ANTES de
    // gastar el cupo de envíos y de mandar nada. La inscripción es para fichas nuevas y no lo exige.
    if (tipo === 'modificacion' && !(await correoTieneFicha(e, email))) return responder(CORREO_SIN_FICHA, 404);
    const permiso = await envioPermitido(e, { email, proposito });
    if (!permiso.ok) {
      const detail =
        permiso.motivo === 'demasiado_pronto'
          ? 'Ya te enviamos un código hace un momento. Revisa tu bandeja (y el spam) antes de pedir otro.'
          : 'Se alcanzó el máximo de códigos de hoy para esta dirección. Inténtalo mañana.';
      return responder({ error: 'demasiados_correos', detail }, 429);
    }
    const token = await crearToken(e, { proposito, email });
    try {
      const { asunto, texto, html } = correoDeSolicitud({ tipo, token });
      await enviarCorreo({ para: email, asunto, texto, html });
    } catch (error) {
      console.error(`[solicitudes] no se pudo enviar el código (${tipo}): ${error.message}`);
      return responder({ error: 'correo_no_disponible', detail: 'No pudimos enviar el correo. Revisa la dirección e inténtalo de nuevo en unos minutos.' }, 503);
    }
    return responder({ ok: true }, 200);
  } catch (error) {
    console.error(`[solicitudes] código (${tipo}): ${error.message}`);
    return responder({ error: 'solicitudes_no_disponibles', detail: 'No se pudo procesar. Inténtalo de nuevo más tarde.' }, 503);
  }
}

/**
 * Paso 2: `POST /api/<inscripciones|modificaciones>/verificar`. Canjea el código por la credencial del
 * formulario. Recién aquí, con el correo demostrado, se dice qué tiene asociado: las fichas inscritas con
 * ese correo (cambios) o el borrador que dejó a medias (inscripción).
 */
export async function verificarCodigo(request, tipo, ejecutor) {
  const cabeceras = { 'cache-control': 'no-store' };
  const responder = responderRegistrando(`${tipo}:verificar`, ejecutor, cabeceras);
  if (!origenPermitido(request.headers)) return responder({ error: 'origen_no_permitido' }, 403);
  const { proposito, credencial } = FORMULARIOS_CON_CODIGO[tipo];
  const cuerpo = await request.json().catch(() => null);
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    const gastado = await consumirToken(e, typeof cuerpo?.token === 'string' ? cuerpo.token : '', proposito);
    if (!gastado) {
      return responder({ error: 'enlace_invalido', detail: 'Este código no es válido: caducó, ya se usó o está mal copiado. Pide uno nuevo.' }, 410);
    }
    const emitida = await crearToken(e, { proposito: credencial, email: gastado.email });
    if (tipo === 'inscripcion') {
      const borrador = await leerBorrador(e, { email: gastado.email });
      return responder({ ok: true, sesion: emitida, borrador }, 200);
    }
    let fichas = [];
    if (tursoConfigurado()) {
      const db = await dbConDiario();
      const asociadas = await fichasDelTitular(e, { email: gastado.email, resolverFicha: (slug) => getVtuberBySlug(db, slug, { includeHidden: true }) });
      fichas = asociadas.map((a) => ({ slug: a.ficha.slug, name: a.ficha.name }));
    }
    return responder({ ok: true, permiso: emitida, fichas }, 200);
  } catch (error) {
    console.error(`[solicitudes] verificar código (${tipo}): ${error.message}`);
    return responder({ error: 'solicitudes_no_disponibles', detail: 'No se pudo confirmar. Inténtalo de nuevo en unos minutos.' }, 503);
  }
}

/**
 * `PUT /api/inscripciones/borrador`: guarda lo escrito hasta ahora, atado al correo de la `sesion`. La
 * sesión se MIRA sin gastarla (se llama muchas veces mientras se rellena). Lo guardado pasa por la lista
 * blanca de `sanearBorrador`.
 */
export async function guardarBorradorDeInscripcion(request, ejecutor) {
  const cabeceras = { 'cache-control': 'no-store' };
  const responder = responderRegistrando('inscripcion:borrador', ejecutor, cabeceras);
  if (!origenPermitido(request.headers)) return responder({ error: 'origen_no_permitido' }, 403);
  const cuerpo = await request.json().catch(() => null);
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    const dueno = await correoDelToken(e, typeof cuerpo?.sesion === 'string' ? cuerpo.sesion : '', 'sesion');
    if (!dueno) {
      return responder({ error: 'sesion_invalida', detail: 'Tu sesión caducó. Vuelve al paso 1 y pide un código nuevo: tu borrador sigue guardado.' }, 410);
    }
    const actualizado = await guardarBorrador(e, { email: dueno.email, datos: cuerpo.datos });
    return responder({ ok: true, actualizado }, 200);
  } catch (error) {
    if (error instanceof SolicitudError) return responder({ error: error.code, detail: error.detail }, error.status);
    console.error(`[solicitudes] guardar borrador: ${error.message}`);
    return responder({ error: 'solicitudes_no_disponibles', detail: 'No se pudo guardar el borrador.' }, 503);
  }
}
