/**
 * Tests del contrato de las rutas del mantenedor en producción (Turso).
 *
 * POR QUÉ ESTOS TESTS EXISTEN
 * ---------------------------
 * El fallo que llegó a producción —"no puedo subir imágenes"— no lo veía ningún test: las
 * rutas de escritura devolvían `{ok, slug, kind, size}` mientras el cliente esperaba
 * `{ok, kind, asset, vtuber}`, y **la UI reaccionaba a ese desajuste sin dar un error**. La
 * suite cubría el cliente (con la API mockeada) y el compositor, nunca el contrato entre los
 * dos, que es justo por donde se escapó.
 *
 * Aquí se comprueba el CONTRATO por sus dos mitades, sin red:
 *   · el compositor puro (`aplicarImagenesDelMantenedor`), que es lo que rellena `images[kind]`
 *     y `assets[]` — el campo que decide lo que se dibuja;
 *   · la lista compartida de carpetas, que es la que decide si una imagen nueva se puede servir
 *     (el manifiesto no la conoce: solo se regenera con `npm run build:data`).
 */
import { describe, expect, test } from 'vitest';

import {
  aplicarImagenesDelMantenedor,
  aplicarEdiciones,
} from '@/lib/ediciones.mjs';
import { CARPETAS_PUBLICADAS, KINDS_GESTIONABLES, EXTENSION_DE_CARPETA } from '@/lib/carpetas.mjs';

/** Detalle mínimo con la forma que devuelve la API. */
function detalle(extra: Record<string, unknown> = {}) {
  return {
    id: 2,
    slug: 'yeicokp-harv',
    name: 'YEICOKP HARV',
    images: { character: '/images/character/yeicokp-harv.webp', background: null, logo: null, card: null, thumb: null, radar: null },
    assets: [
      { kind: 'character', path: 'images/character/yeicokp-harv.webp', sourceUrl: null, width: 720, height: 1008, bytes: 60860 },
    ],
    ...extra,
  };
}

/** Tipo de una fila de asset en el detalle que devuelve la API. */
type FilaAsset = { kind: string; path: string; width: number | null; height: number | null; bytes: number | null };

describe('aplicarImagenesDelMantenedor', () => {
  test('un fondo subido rellena images.background, que es lo que dibuja la carta', () => {
    // El caso que rompía: el fondo NO está en el catálogo (784 de 785 fichas no lo tienen) y
    // `holo-card.tsx` solo pinta esa capa si `images.background` es truthy. Con `null` el archivo
    // se servía por HTTP y la carta no lo dibujaba.
    const out = aplicarImagenesDelMantenedor(detalle(), {
      background: { path: 'images/background/yeicokp-harv.webp', width: 720, height: 1008, bytes: 529054 },
    });
    expect(out.images.background).toBe('/images/background/yeicokp-harv.webp');
  });

  test('añade la fila de assets y con ella las dimensiones del gestor', () => {
    const out = aplicarImagenesDelMantenedor(detalle(), {
      background: { path: 'images/background/yeicokp-harv.webp', width: 720, height: 1008, bytes: 529054 },
    });
    const fila = out.assets.find((a: FilaAsset) => a.kind === 'background');
    expect(fila).toBeTruthy();
    expect(fila.width).toBe(720);
    expect(fila.bytes).toBe(529054);
  });

  test('reemplaza el personaje del catálogo sin duplicar la fila', () => {
    const out = aplicarImagenesDelMantenedor(detalle(), {
      character: { path: 'images/character/yeicokp-harv.webp', width: 720, height: 1008, bytes: 90000 },
    });
    expect(out.assets.filter((a: FilaAsset) => a.kind === 'character')).toHaveLength(1);
    expect(out.assets.find((a: FilaAsset) => a.kind === 'character').bytes).toBe(90000);
    expect(out.images.character).toBe('/images/character/yeicokp-harv.webp');
  });

  test('no muta el detalle original (la respuesta de una ruta no puede contaminar otra)', () => {
    const original = detalle();
    const copia = JSON.parse(JSON.stringify(original));
    aplicarImagenesDelMantenedor(original, {
      background: { path: 'images/background/yeicokp-harv.webp', width: 1, height: 2, bytes: 3 },
    });
    expect(original).toEqual(copia);
  });

  test('sin reemplazos devuelve el MISMO objeto, sin trabajo extra', () => {
    const original = detalle();
    expect(aplicarImagenesDelMantenedor(original, {})).toBe(original);
    expect(aplicarImagenesDelMantenedor(original, undefined)).toBe(original);
  });

  test('las ediciones de texto se siguen aplicando (precedencia del mantenedor)', () => {
    const out = aplicarEdiciones(detalle(), { 'yeicokp-harv': { name: '"CORREGIDO"' } });
    expect(out.name).toBe('CORREGIDO');
  });
});

/**
 * LA INVALIDACIÓN DE CACHÉ DE LA IMAGEN REEMPLAZADA.
 *
 * POR QUÉ ESTE BLOQUE EXISTE
 * --------------------------
 * Subir una imagen desde el mantenedor guardaba los bytes y actualizaba el catálogo, y el
 * sitio seguía mostrando la ANTERIOR. La causa no era el guardado: la ruta es canónica
 * (`/images/<kind>/<slug>.webp`), no cambia al reemplazar, y el navegador y el CDN ya la
 * tenían cacheada, así que nadie volvía a pedirla. El gestor de imágenes lo tapaba con un
 * `?v=<timestamp>` en su PROPIA vista previa (`image-manager.tsx`), y por eso el fallo
 * parecía resuelto mientras la carta 3D, la grilla y la ficha seguían mostrando la vieja.
 *
 * Ningún gate lo veía: la API devolvía la ruta correcta y el archivo correcto estaba en la
 * base. Lo que faltaba era que la URL CAMBIARA. Aquí se fija eso — que la versión viaja en
 * la URL y que cambia cuando cambia la subida.
 */
describe('la URL de una imagen reemplazada se versiona (invalida la caché)', () => {
  test('la URL lleva la versión de la subida, no solo la ruta canónica', () => {
    const out = aplicarImagenesDelMantenedor(detalle(), {
      character: {
        path: 'images/character/yeicokp-harv.webp',
        width: 720,
        height: 1008,
        bytes: 90000,
        actualizado: '2026-09-23T15:23:32.277Z',
      },
    });
    // La ruta sigue siendo canónica (regla del repo) PERO con la versión: es lo que hace
    // que el navegador no reutilice el búfer anterior.
    expect(out.images.character).toBe('/images/character/yeicokp-harv.webp?v=20260923152332277');
    expect(out.images.character).toContain('?v=');
  });

  test('dos subidas distintas dan dos URLs distintas (la segunda se ve)', () => {
    const base = { path: 'images/character/yeicokp-harv.webp', width: 720, height: 1008, bytes: 1 };
    const primera = aplicarImagenesDelMantenedor(detalle(), {
      character: { ...base, actualizado: '2026-09-23T15:23:32.277Z' },
    });
    const segunda = aplicarImagenesDelMantenedor(detalle(), {
      character: { ...base, actualizado: '2026-09-23T15:23:33.001Z' },
    });
    // Este es el caso que rompía en silencio: mismo path, misma ficha, segundo reemplazo.
    expect(segunda.images.character).not.toBe(primera.images.character);
  });

  test('una fila antigua sin marca sigue dando la ruta canónica, sin query inventado', () => {
    // `actualizado` es `null` en las filas antiguas: no se puede versionar lo que no tiene
    // marca, y un `?v=undefined` sería una versión falsa que además se cachearía.
    const out = aplicarImagenesDelMantenedor(detalle(), {
      logo: { path: 'images/logo/yeicokp-harv.webp', width: 10, height: 10, bytes: 1, actualizado: null },
    });
    expect(out.images.logo).toBe('/images/logo/yeicokp-harv.webp');
    expect(out.images.logo).not.toContain('v=');
  });

  test('la URL sigue siendo absoluta al versionarla (no se rompe en /v/:slug)', () => {
    // La regla del repo es que las rutas de assets empiezan por `/`: una relativa pediría
    // `/v/images/...` en la ficha. El `?v=` no puede cambiar eso.
    const out = aplicarImagenesDelMantenedor(detalle(), {
      background: {
        path: 'images/background/yeicokp-harv.webp',
        width: 720,
        height: 1008,
        bytes: 1,
        actualizado: '2026-09-23T15:23:32.277Z',
      },
    });
    expect(out.images.background?.startsWith('/images/')).toBe(true);
  });
});

describe('carpetas compartidas', () => {
  test('las carpetas gestionables son un subconjunto de las publicadas', () => {
    // Si divergieran, el mantenedor ofrecería un tipo que el manifiesto no publica (o al revés)
    // y la imagen se guardaría sin poder servirse.
    for (const kind of KINDS_GESTIONABLES) {
      expect(CARPETAS_PUBLICADAS).toContain(kind);
    }
  });

  test('background está publicado y es gestionable', () => {
    expect(CARPETAS_PUBLICADAS).toContain('background');
    expect(KINDS_GESTIONABLES).toContain('background');
  });

  test('las carpetas RETIRADAS no se publican ni se gestionan', () => {
    // Su retirada es deliberada (ver AGENTS.md): sus rutas responden 404. Si alguna volviera a
    // esta lista, `npm run verify` fallaría en las cuatro comprobaciones de carpeta retirada.
    for (const retirada of ['thumb', 'avatar', 'ficha', 'radar', 'card']) {
      expect(CARPETAS_PUBLICADAS, `${retirada} debe seguir retirada`).not.toContain(retirada);
    }
  });

  test('la extensión de facción es PNG y la de las otras tres WebP', () => {
    // Los 23 emblemas son PNG: asumir `.webp` los dejaba sin servir y el fallo era invisible.
    expect(EXTENSION_DE_CARPETA.faction).toBe('png');
    for (const kind of KINDS_GESTIONABLES) {
      expect(EXTENSION_DE_CARPETA[kind as keyof typeof EXTENSION_DE_CARPETA]).toBe('webp');
    }
  });
});
