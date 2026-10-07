/**
 * LIKES: cualquier visitante puede darle like a un VTuber, UNO por día y por VTuber. Los likes
 * hacen subir la experiencia de la ficha (`server/src/experiencia.mjs`).
 *
 * SIN CUENTAS, ASÍ QUE «UN VISITANTE» ES UNA COOKIE
 * -------------------------------------------------
 * No hay login de visitantes. La identidad es una cookie aleatoria (`vd_v`, httpOnly, un año) y la
 * restricción vive en la CLAVE PRIMARIA `(dia, visitante, vtuber_id)`: dos likes del mismo día no
 * pueden coexistir ni con peticiones concurrentes, porque la base lo rechaza, no un `if` previo.
 *
 * Una cookie se borra con un clic, así que además hay un TOPE POR RED: como mucho
 * `MAX_POR_RED_Y_DIA` likes al mismo VTuber en un día desde la misma IP. No es 1 porque las
 * redes móviles y las casas comparten IP (NAT) y bloquearía a visitantes legítimos. Lo que se
 * guarda es un HASH de la IP con sal, nunca la IP.
 * Límite honesto: esto frena el abuso casual, no a quien quiera inflar con muchas IP. Para eso
 * haría falta pedir una cuenta, y no es lo que se pidió.
 *
 * EL «DÍA» ES EL DE CHILE (`America/Santiago`)
 * --------------------------------------------
 * Con UTC el día se reiniciaría a las 21:00 en Chile y «vuelve mañana» sería mentira para quien
 * mantiene el sitio. Un solo huso para todos es lo que hace la regla predecible.
 *
 * DÓNDE VIVEN
 * -----------
 * Con Turso (producción) en la tabla `like_dia`; sin él (local, CI) en `data/likes.db`. El SQL
 * es el MISMO para los dos (Turso es SQLite) y solo cambia el ejecutor, así que lo que se prueba
 * en local es lo que corre en producción. Los likes NO van al diario de cambios: son miles de
 * filas pequeñas, no ediciones del mantenedor, y reproducirlas en cada instancia fría sería un
 * disparate. El total se CUENTA (`COUNT(*)`), no se guarda: una sola fuente de verdad.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { experienciaConLikes } from '../server/src/experiencia.mjs';
import { tursoConfigurado, turso } from './ediciones.mjs';

/** Likes al mismo VTuber en un día desde la misma red (ver la cabecera). */
export const MAX_POR_RED_Y_DIA = 5;
export const COOKIE_VISITANTE = 'vd_v';
const UN_ANO_S = 60 * 60 * 24 * 365;

const DDL = `
  CREATE TABLE IF NOT EXISTS like_dia (
    dia        TEXT NOT NULL,
    visitante  TEXT NOT NULL,
    vtuber_id  INTEGER NOT NULL,
    red        TEXT NOT NULL,
    creado     TEXT NOT NULL,
    PRIMARY KEY (dia, visitante, vtuber_id)
  );
  CREATE INDEX IF NOT EXISTS idx_like_vtuber ON like_dia (vtuber_id);
  CREATE INDEX IF NOT EXISTS idx_like_red ON like_dia (dia, red, vtuber_id);
`;

/* ----------------------------------------------------------------- ejecutores */

/**
 * Un EJECUTOR es `{ execute(sql, args) -> { rows, rowsAffected }, exec(sql) }`, la misma forma
 * que el cliente de Turso. El de SQLite local la imita para que `like_dia` tenga un solo SQL.
 */
export function ejecutorSqlite(db) {
  return {
    async execute(sql, args = []) {
      const sentencia = db.prepare(sql);
      if (/^\s*select/i.test(sql)) return { rows: sentencia.all(...args).map((fila) => ({ ...fila })), rowsAffected: 0 };
      const info = sentencia.run(...args);
      return { rows: [], rowsAffected: Number(info.changes) };
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}

let ejecutorVigente = null;
/** El ejecutor del entorno: Turso si está configurado; si no, `data/likes.db`. */
async function ejecutorDelEntorno() {
  if (ejecutorVigente) return ejecutorVigente;
  if (tursoConfigurado()) {
    const cliente = turso();
    ejecutorVigente = { execute: (sql, args) => cliente.execute({ sql, args }), exec: (sql) => cliente.executeMultiple(sql) };
  } else {
    // La ruta se escribe literal: una dinámica haría que Turbopack trace el proyecto entero.
    const archivo = path.join(process.cwd(), 'data', 'likes.db');
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    ejecutorVigente = ejecutorSqlite(new DatabaseSync(archivo));
  }
  return ejecutorVigente;
}

/** DDL memoizado como PROMESA por ejecutor; si falla se suelta para no dejar rotas las lecturas siguientes. */
const tablasListas = new WeakMap();
async function conTablas(ejecutor) {
  if (!tablasListas.has(ejecutor)) {
    const promesa = Promise.resolve(ejecutor.exec(DDL)).catch((error) => {
      tablasListas.delete(ejecutor);
      throw error;
    });
    tablasListas.set(ejecutor, promesa);
  }
  await tablasListas.get(ejecutor);
  return ejecutor;
}

/** Solo para los tests: olvida el ejecutor del entorno. */
export function reiniciarLikes() {
  ejecutorVigente = null;
}

/* ----------------------------------------------------------------------- reglas */

/** El día (`AAAA-MM-DD`) en Chile. Aislado para poder fijarlo en las pruebas. */
export function diaDeChile(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

/** Hash con sal de un dato personal (la IP). La sal es opcional en local; en producción va en el entorno. */
export function hashear(valor, sal = process.env.VTUBERDEX_LIKES_SAL ?? 'vtuberdex') {
  return crypto.createHash('sha256').update(`${sal}:${valor}`).digest('hex').slice(0, 32);
}

export async function contarLikes(vtuberId, ejecutor) {
  const e = await conTablas(ejecutor ?? (await ejecutorDelEntorno()));
  const { rows } = await e.execute('SELECT COUNT(*) AS n FROM like_dia WHERE vtuber_id = ?', [vtuberId]);
  return Number(rows[0]?.n ?? 0);
}

/** ¿Ya le dio like este visitante a este VTuber hoy? */
export async function yaDioLikeHoy({ vtuberId, visitante, ahora = new Date() }, ejecutor) {
  const e = await conTablas(ejecutor ?? (await ejecutorDelEntorno()));
  const { rows } = await e.execute('SELECT 1 AS ya FROM like_dia WHERE dia = ? AND visitante = ? AND vtuber_id = ?', [
    diaDeChile(ahora),
    visitante,
    vtuberId,
  ]);
  return rows.length > 0;
}

/**
 * Registra un like.
 * @returns {Promise<{ ok: true } | { ok: false, motivo: 'ya_dio_like_hoy' | 'demasiados_desde_esta_red' }>}
 */
export async function darLike({ vtuberId, visitante, ip, ahora = new Date() }, ejecutor) {
  const e = await conTablas(ejecutor ?? (await ejecutorDelEntorno()));
  const dia = diaDeChile(ahora);
  const red = hashear(ip || 'desconocida');
  const { rows } = await e.execute('SELECT COUNT(*) AS n FROM like_dia WHERE dia = ? AND red = ? AND vtuber_id = ?', [dia, red, vtuberId]);
  if (Number(rows[0]?.n ?? 0) >= MAX_POR_RED_Y_DIA) return { ok: false, motivo: 'demasiados_desde_esta_red' };
  // La clave primaria decide: si ya existe la fila de hoy no se inserta nada y `rowsAffected` es 0.
  const insertado = await e.execute(
    'INSERT INTO like_dia (dia, visitante, vtuber_id, red, creado) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    [dia, visitante, vtuberId, red, ahora.toISOString()],
  );
  return insertado.rowsAffected > 0 ? { ok: true } : { ok: false, motivo: 'ya_dio_like_hoy' };
}

/**
 * La ficha con la experiencia y el nivel que resultan de sus likes. Una ficha sin experiencia
 * propia parte del nivel 1 con la barra vacía.
 */
export function conExperiencia(card, likes) {
  const exp = experienciaConLikes(
    { level: card.level, current: card.experience?.current, max: card.experience?.max },
    likes,
  );
  return { ...card, likes: exp.likes, level: exp.level, levelsGained: exp.nivelesGanados, experience: { current: exp.current, max: exp.max, total: exp.total } };
}

/** Lo que el cliente necesita tras consultar o dar un like. */
export function resumenDeLikes(card, likes, liked) {
  const exp = experienciaConLikes({ level: card.level, current: card.experience?.current, max: card.experience?.max }, likes);
  return { likes: exp.likes, liked, level: exp.level, experience: { current: exp.current, max: exp.max, total: exp.total }, xpPorLike: exp.xpPorLike };
}

/* ------------------------------------------------------------------------ HTTP */

/** Lee una cookie de la cabecera `cookie`. */
export function leerCookie(cabecera, nombre) {
  for (const parte of String(cabecera ?? '').split(';')) {
    const [clave, ...resto] = parte.trim().split('=');
    if (clave === nombre) return resto.join('=');
  }
  return null;
}

/** Un identificador de visitante válido (UUID) o `null`: una cookie manipulada no entra a la base. */
export function visitanteValido(valor) {
  return typeof valor === 'string' && /^[0-9a-f-]{36}$/i.test(valor) ? valor : null;
}

/** La IP del cliente tras el proxy de Vercel (primer valor de `x-forwarded-for`). */
export function ipDelCliente(cabeceras) {
  const reenviada = cabeceras.get('x-forwarded-for');
  return (reenviada ? reenviada.split(',')[0] : cabeceras.get('x-real-ip') ?? '').trim() || 'desconocida';
}

/**
 * Anti-CSRF barato: un POST con `Origin` de OTRO sitio se rechaza. Sin `Origin` (curl, apps) se
 * deja pasar: el tope por visitante y por red es lo que limita, esto solo evita que una página
 * ajena haga votar a sus visitantes sin que lo sepan.
 */
export function origenPermitido(cabeceras) {
  const origen = cabeceras.get('origin');
  if (!origen) return true;
  const anfitrion = cabeceras.get('x-forwarded-host') ?? cabeceras.get('host');
  try {
    return new URL(origen).host === anfitrion;
  } catch {
    return false;
  }
}

/** Cabecera `Set-Cookie` del visitante. `Secure` solo con HTTPS: en el dev server por HTTP no se guardaría. */
export function cookieDeVisitante(id, seguro) {
  return `${COOKIE_VISITANTE}=${id}; Path=/; Max-Age=${UN_ANO_S}; HttpOnly; SameSite=Lax${seguro ? '; Secure' : ''}`;
}
