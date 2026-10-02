/**
 * El DIARIO de cambios del mantenedor en producción, y la base que resulta de reproducirlo.
 *
 * EL PROBLEMA
 * -----------
 * En Vercel el catálogo viaja EMPAQUETADO en la función (SQLite de solo lectura) y no se puede
 * escribir en él. Hasta ahora las ediciones eran filas de Turso que se pintaban ENCIMA de cada
 * respuesta (`aplicarEdiciones`). Eso alcanza para cambiar un texto, pero no para lo que ahora
 * se pide: cambiar el número de dex (reordena el listado y la paginación), crear cartas nuevas,
 * cambiar la URL, reasignar facciones (el filtro y los conteos salen de SQL). Ninguna de esas
 * cosas se puede "pintar encima" sin reescribir el buscador.
 *
 * LA SOLUCIÓN
 * -----------
 * Cada cambio se guarda como una OPERACIÓN en la tabla `cambio` de Turso (un diario, solo se
 * añade). Para leer, la instancia copia la base empaquetada a `/tmp` —que SÍ es escribible—,
 * reproduce el diario con las mismas funciones que usa el Express local
 * (`server/src/mutations.mjs`) y abre esa copia. Así el catálogo, el FTS, las facetas, el orden
 * y la paginación ven los cambios sin que `search.mjs` sepa que existen, y local y producción no
 * pueden tener reglas distintas.
 *
 * COSTE Y FRESCURA
 * ----------------
 * Cada petición hace UNA consulta a Turso (la "clave" del diario: último `seq` + estado del
 * legado). Solo si cambió se reconstruye la copia: la base pesa ~3 MB y el diario son pocas
 * filas, así que es del orden de milisegundos. Es una consulta por PETICIÓN, no por carta: la
 * regla de `AGENTS.md` (nada de `await` por elemento) se respeta.
 *
 * COMPATIBILIDAD CON LO ANTERIOR
 * ------------------------------
 * Las ediciones que ya existían en la tabla `edicion` (nombre, frase, color, estado… por slug) se
 * reproducen PRIMERO como parches, así que no se pierde nada de lo que ya se editó. La tabla ya
 * no se escribe: todo lo nuevo va al diario.
 *
 * SIN TURSO no hay diario: `dbConDiario()` devuelve la base normal y la app va como antes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDatabase } from '../server/src/db/index.mjs';
import {
  ID_BASE_CARTAS_NUEVAS,
  ID_BASE_FACCIONES_NUEVAS,
  MutationError,
  aplicarOperacion,
} from '../server/src/mutations.mjs';
import { asegurarTablas, leerEdiciones, tursoConfigurado, turso } from './ediciones.mjs';
import { DB_PATH, getDb } from './db.mjs';

/** Campos de la tabla `edicion` antigua que se convierten en parche al reproducirla. */
const CAMPOS_LEGADO = ['name', 'phrase', 'themeColor', 'birthday', 'height', 'hashtag', 'favoriteColor', 'status', 'profile'];

/** Cuánto se espera antes de cerrar una copia reemplazada: da tiempo a las peticiones en vuelo. */
const GRACIA_CIERRE_MS = 30_000;

/**
 * La copia materializada vigente. `clave` es la del diario con la que se construyó; `db` el
 * manejador; `archivo` su ruta en /tmp.
 */
let vigente = { clave: null, db: null, archivo: null };
/** Construcción en curso, compartida: dos peticiones en una instancia fría no la duplican. */
let construccion = null;

/**
 * Clave del estado del diario: cambia si y solo si hay que reconstruir.
 *
 * Una sola sentencia a Turso (tres subconsultas): el último `seq` del diario y la huella de la
 * tabla `edicion` antigua (cuántas filas y la última marca).
 */
async function leerClave() {
  const { rows } = await turso().execute(
    `SELECT (SELECT COALESCE(MAX(seq), 0) FROM cambio) AS seq,
            (SELECT COUNT(*) FROM edicion) AS legado,
            (SELECT COALESCE(MAX(actualizado), '') FROM edicion) AS marca`,
  );
  const fila = rows[0] ?? {};
  return `${fila.seq ?? 0}:${fila.legado ?? 0}:${fila.marca ?? ''}`;
}

function jsonTolerante(bruto) {
  if (bruto === null || bruto === undefined) return null;
  try {
    return JSON.parse(bruto);
  } catch {
    return bruto;
  }
}

/**
 * Reproduce, sobre `db`, lo que había en la tabla `edicion` y luego el diario.
 *
 * Una operación que falle (por ejemplo, una URL que ya no es libre porque el catálogo empaquetado
 * cambió desde que se escribió) se OMITE y se registra: tumbar toda la lectura por una sola
 * operación obsoleta dejaría el sitio sin catálogo.
 */
function reproducir(db, legado, cambios) {
  for (const [slug, campos] of Object.entries(legado)) {
    const fila = db.prepare('SELECT id FROM vtuber WHERE slug = ?').get(slug);
    if (!fila) continue;
    const patch = {};
    for (const campo of CAMPOS_LEGADO) {
      if (campo in campos) patch[campo] = jsonTolerante(campos[campo]);
    }
    if (Object.keys(patch).length === 0) continue;
    try {
      aplicarOperacion(db, { tipo: 'vtuber.editar', id: fila.id, patch });
    } catch (error) {
      console.error(`[diario] edición antigua de ${slug} omitida: ${error.message}`);
    }
  }
  for (const { seq, payload } of cambios) {
    try {
      aplicarOperacion(db, JSON.parse(payload));
    } catch (error) {
      console.error(`[diario] operación ${seq} omitida: ${error.message}`);
    }
  }
}

async function construir(clave) {
  const [legado, cambios] = await Promise.all([
    leerEdiciones(),
    turso().execute('SELECT seq, payload FROM cambio ORDER BY seq'),
  ]);
  const archivo = path.join(os.tmpdir(), `vtuberdex-${process.pid}-${Date.now()}.db`);
  fs.copyFileSync(DB_PATH, archivo);
  // Se abre ESCRIBIBLE (a diferencia del catálogo empaquetado): aplica el esquema y las
  // migraciones pendientes, así una base empaquetada anterior a este cambio también sirve.
  const db = openDatabase(archivo);
  try {
    reproducir(db, legado, cambios.rows);
  } catch (error) {
    db.close();
    fs.rmSync(archivo, { force: true });
    throw error;
  }
  return { clave, db, archivo };
}

function retirar(anterior) {
  if (!anterior.db) return;
  const timer = setTimeout(() => {
    try {
      anterior.db.close();
    } catch {
      // ya cerrada
    }
    fs.rmSync(anterior.archivo, { force: true });
    fs.rmSync(`${anterior.archivo}-wal`, { force: true });
    fs.rmSync(`${anterior.archivo}-shm`, { force: true });
  }, GRACIA_CIERRE_MS);
  timer.unref?.();
}

/**
 * La base del catálogo con el diario aplicado.
 *
 * Sin Turso devuelve la base empaquetada tal cual. Si Turso falla, sirve la última copia buena
 * (o el catálogo empaquetado): una base externa caída no puede tumbar la lectura del catálogo.
 */
export async function dbConDiario() {
  if (!tursoConfigurado()) return getDb();
  try {
    await asegurarTablas();
    const clave = await leerClave();
    if (vigente.db && vigente.clave === clave) return vigente.db;
    if (!construccion || construccion.clave !== clave) {
      const propia = construir(clave).then((nueva) => {
        const anterior = vigente;
        vigente = nueva;
        retirar(anterior);
        return nueva;
      });
      construccion = { clave, promesa: propia };
      // Se suelta al terminar, bien o mal: cachear un rechazo dejaría rota cada lectura siguiente.
      const soltar = () => {
        if (construccion?.promesa === propia) construccion = null;
      };
      propia.then(soltar, soltar);
    }
    return (await construccion.promesa).db;
  } catch (error) {
    console.error(`[diario] no se pudo materializar el diario: ${error.message}`);
    return vigente.db ?? getDb();
  }
}

/** Siguiente id libre en una tabla, nunca por debajo de `base`. */
function siguienteId(db, tabla, base) {
  const { n } = db.prepare(`SELECT COALESCE(MAX(id), 0) AS n FROM ${tabla}`).get();
  return Math.max(n, base) + 1;
}

/**
 * Valida una operación contra la base materializada, la guarda en el diario y devuelve su
 * resultado.
 *
 * ORDEN DELIBERADO: primero se APLICA en la copia local (si la regla la rechaza —número ocupado,
 * URL repetida, tercera facción— lanza `MutationError` y NO se escribe nada) y después se anota
 * en Turso. Si anotar falla, se descarta la copia para que la siguiente lectura la reconstruya
 * desde el diario real: la copia nunca puede quedarse adelantada de lo que Turso sabe.
 *
 * @returns {Promise<{ db: import('node:sqlite').DatabaseSync, resultado: object }>}
 */
export async function aplicarYAnotar(operacion, actor = 'admin') {
  if (!tursoConfigurado()) {
    throw new MutationError(404, 'no_encontrado', 'el mantenedor solo existe con Turso configurado');
  }
  const db = await dbConDiario();
  if (db === getDb()) {
    // La base empaquetada es de solo lectura: si estamos aquí es porque Turso falló al construir.
    throw new MutationError(503, 'diario_no_disponible', 'no se pudo preparar el diario de cambios en Turso');
  }
  // Los ids de lo que se CREA se fijan aquí y viajan en la operación: así cada instancia que
  // reproduzca el diario crea la carta con el mismo id y las referencias siguen valiendo.
  const completa = { ...operacion };
  if (completa.tipo === 'vtuber.crear') completa.id = siguienteId(db, 'vtuber', ID_BASE_CARTAS_NUEVAS);
  if (completa.tipo === 'faccion.crear') completa.id = siguienteId(db, 'faction', ID_BASE_FACCIONES_NUEVAS);

  const resultado = aplicarOperacion(db, completa);
  try {
    const { lastInsertRowid } = await turso().execute({
      sql: 'INSERT INTO cambio (tipo, payload, actor, creado) VALUES (?, ?, ?, ?)',
      args: [completa.tipo, JSON.stringify(completa), actor, new Date().toISOString()],
    });
    // Si nadie más escribió entre medias, la copia ya está al día y se evita reconstruirla.
    const [seqPrevio, ...resto] = String(vigente.clave ?? '').split(':');
    if (Number(seqPrevio) + 1 === Number(lastInsertRowid)) {
      vigente.clave = [String(lastInsertRowid), ...resto].join(':');
    } else {
      vigente.clave = null;
    }
  } catch (error) {
    vigente.clave = null;
    throw error;
  }
  return { db, resultado };
}

/** Solo para los tests: olvida la copia vigente. */
export function reiniciarDiario() {
  if (vigente.db) retirar(vigente);
  vigente = { clave: null, db: null, archivo: null };
  construccion = null;
}
