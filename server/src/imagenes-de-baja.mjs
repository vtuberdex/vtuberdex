// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Las imágenes de una ficha de BAJA (grado 1, `ficha-deteriorada.mjs`) no pueden delatar su nombre.
 *
 * EL FALLO (auditoría 2026-11-19): el listado ocultaba nombre, slug y logo, pero la carta conservaba
 * `images.character = /images/character/<slug-real>.webp`: el slug ES el nombre. Y `/images/*` seguía
 * sirviendo sus imágenes (limpias) por el slug real a quien lo conociera o lo adivinara.
 *
 * LA REGLA:
 *   · La carta rota del listado pide su personaje por una ruta NEUTRA, `images/character/deteriorada-<dex>`,
 *     que aquí se traduce a la imagen real solo mientras la ficha siga de baja (la carta 3D la estropea).
 *   · Cualquier imagen pedida por el slug real (o por un alias antiguo) de una ficha de baja, 404.
 *
 * Una ficha que vuelve a un grado normal recupera sus rutas de siempre y la neutra deja de existir.
 */
import { PREFIJO_NEUTRO } from "./ficha-deteriorada.mjs";
import { tienePremium } from "./search.mjs";

const memoria = new WeakMap();
/**
 * Cuánto vale lo leído (ms). En producción cada cambio del diario abre una base nueva y la memoria se
 * renueva sola; con una base que se edita en sitio, un cambio de grado se nota en este plazo.
 */
const VIGENCIA_MS = 5000;

/** Slugs (vigentes y alias) y dex → slug de las fichas de grado 1 (una consulta cada `VIGENCIA_MS`). */
function bajasDe(db, ahora = Date.now()) {
  const hit = memoria.get(db);
  if (hit && ahora - hit.leido < VIGENCIA_MS) {
    return hit;
  }
  const porSlug = new Set();
  const porDex = new Map();
  if (tienePremium(db)) {
    const filas = db
      .prepare(
        `SELECT v.id, v.slug, v.dex_number AS dex FROM vtuber v
           JOIN premium p ON p.vtuber_id = v.id WHERE p.grade = '1'`,
      )
      .all();
    for (const f of filas) {
      porSlug.add(f.slug);
      porDex.set(Number(f.dex), f.slug);
    }
    try {
      for (const a of db
        .prepare(
          `SELECT a.slug FROM slug_alias a JOIN premium p ON p.vtuber_id = a.vtuber_id WHERE p.grade = '1'`,
        )
        .all()) {
        porSlug.add(a.slug);
      }
    } catch {
      /* una base anterior sin `slug_alias`: solo los slugs vigentes */
    }
  }
  const bajas = { porSlug, porDex, leido: ahora };
  memoria.set(db, bajas);
  return bajas;
}

/**
 * Qué servir para `key` (`images/<carpeta>/<slug>.<ext>`): `{ key }` (la misma u otra, si era la ruta
 * neutra) o `{ bloqueada: true }` (404).
 */
export function claveSegunBajas(db, key) {
  const m = /^images\/([^/]+)\/([^/]+?)\.([a-z0-9]+)$/i.exec(key);
  if (!m) {
    return { key };
  }
  const [, carpeta, slug, ext] = m;
  const { porSlug, porDex } = bajasDe(db);
  if (slug.startsWith(PREFIJO_NEUTRO)) {
    const real =
      carpeta === "character"
        ? porDex.get(Number(slug.slice(PREFIJO_NEUTRO.length)))
        : undefined;
    return real
      ? { key: `images/character/${real}.${ext}` }
      : { bloqueada: true };
  }
  return porSlug.has(slug) ? { bloqueada: true } : { key };
}
