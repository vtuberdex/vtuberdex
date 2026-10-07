/**
 * Cola de voces: «esta ficha cambió, hay que regenerar su audio».
 *
 * Quien edita o crea una ficha (`lib/diario.mjs`) solo ESCRIBE un archivo de trabajo; quien
 * genera el audio es el proceso aparte `scripts/voces-generar.mjs --vigilar`. Se separan a
 * propósito: Piper tarda ~4 s de CPU por clip y necesita Python, y nada de eso puede colgar
 * una petición del mantenedor ni vivir dentro de la función de Next.
 *
 * Sin `VTUBERDEX_VOCES_DIR` (Vercel, CI, local sin voces) no hace NADA y no falla: la cola es
 * una comodidad de la VPS, nunca una dependencia del guardado de una ficha.
 */
import fs from 'node:fs';
import path from 'node:path';

export function carpetaDeVoces() {
  return process.env.VTUBERDEX_VOCES_DIR || null;
}

function carpetaDeCola() {
  const base = carpetaDeVoces();
  return base ? path.join(base, '.cola') : null;
}

/** Un trabajo por ficha (por `id`): editar dos veces seguidas no apila dos regeneraciones. */
export function encolarVoz({ id, slug }) {
  const cola = carpetaDeCola();
  if (!cola || !Number.isInteger(id)) return false;
  try {
    fs.mkdirSync(cola, { recursive: true });
    const destino = path.join(cola, `${id}.json`);
    fs.writeFileSync(`${destino}.tmp`, JSON.stringify({ id, slug, encolado: new Date().toISOString() }));
    fs.renameSync(`${destino}.tmp`, destino); // atómico: el generador nunca lee un JSON a medias
    return true;
  } catch (error) {
    console.error(`[voces] no se pudo encolar la ficha ${id}: ${error.message}`);
    return false;
  }
}

/** Trabajos pendientes, los más viejos primero. */
export function leerCola() {
  const cola = carpetaDeCola();
  if (!cola || !fs.existsSync(cola)) return [];
  return fs
    .readdirSync(cola)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => {
      const archivo = path.join(cola, f);
      try {
        return { archivo, ...JSON.parse(fs.readFileSync(archivo, 'utf8')) };
      } catch {
        fs.rmSync(archivo, { force: true }); // JSON ilegible: no puede bloquear la cola
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.encolado).localeCompare(String(b.encolado)));
}

export function quitarDeCola(trabajo) {
  fs.rmSync(trabajo.archivo, { force: true });
}
