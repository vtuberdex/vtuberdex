/**
 * Tests de la GUARDA de `scripts/publish-images.mjs`.
 *
 * QUÉ SE FIJA AQUÍ Y POR QUÉ
 * --------------------------
 * `publish-images.mjs` es el único camino por el que se escribe en el almacén compartido que
 * sirve producción (`asset_remoto` de Turso), y la clave primaria es `(slug, kind, origen)`:
 * subir un archivo con `origen = 'catalogo'` **encima** de una imagen ya publicada no deja copia
 * de debajo. Por eso, si `data/images/` contiene los bytes de un reemplazo del mantenedor, el
 * script tiene que NEGARSE a subir en vez de confiar en que nadie copie archivos a mano.
 *
 * El fallo que esto blinda, medido: `download:images` bajaba a `data/images/` y el manifiesto
 * pasó de 1594 a 1625 objetos; una corrida del publicador habría subido 31 fondos del
 * mantenedor como si fueran del catálogo.
 *
 * Se prueba con un cliente FALSO (no hay credenciales en CI): lo que se comprueba es la REGLA
 * —qué archivos se consideran contaminados—, no el viaje a Turso.
 */
import { describe, expect, it } from 'vitest';

import { reemplazosEnElArbolDelCatalogo } from '../scripts/publish-images.mjs';

/** Cliente falso: responde a la única consulta que hace la guarda. */
const clienteFalso =
  (filas: Array<{ slug: string; kind: string; size: number | string }>) =>
  ({
    execute: async (sql: string) => {
      if (!/origen = 'mantenedor'/.test(sql)) throw new Error(`consulta inesperada: ${sql}`);
      return { rows: filas };
    },
  }) as never;

describe('reemplazosEnElArbolDelCatalogo', () => {
  it('detecta el archivo cuyo TAMAÑO coincide con un reemplazo del mantenedor', () => {
    // El tamaño es lo que decide la subida en el publicador, así que es lo que se compara: un
    // archivo del mismo peso es, en la práctica, los mismos bytes.
    const db = clienteFalso([{ slug: 'stella', kind: 'background', size: 87070 }]);
    const todos = [
      { rel: 'images/background/stella.webp', kind: 'background', slug: 'stella', bytes: 87070 },
      { rel: 'images/character/stella.webp', kind: 'character', slug: 'stella', bytes: 129924 },
    ];
    return expect(reemplazosEnElArbolDelCatalogo(db, todos)).resolves.toEqual([
      'images/background/stella.webp',
    ]);
  });

  it('no marca un archivo del catálogo que no tiene reemplazo', () => {
    // El caso normal: el catálogo vive en data/images/ y sus tamaños no coinciden con ninguno de
    // los del mantenedor. Un falso positivo aquí bloquearía la publicación legítima.
    const db = clienteFalso([{ slug: 'stella', kind: 'background', size: 87070 }]);
    const todos = [{ rel: 'images/character/kiki.webp', kind: 'character', slug: 'kiki', bytes: 56116 }];
    return expect(reemplazosEnElArbolDelCatalogo(db, todos)).resolves.toEqual([]);
  });

  it('no marca nada cuando el mantenedor no tiene reemplazos', () => {
    const db = clienteFalso([]);
    const todos = [{ rel: 'images/character/stella.webp', kind: 'character', slug: 'stella', bytes: 1 }];
    return expect(reemplazosEnElArbolDelCatalogo(db, todos)).resolves.toEqual([]);
  });

  it('compara por CLAVE (kind + slug), no por tamaño solo', () => {
    // Un archivo del mismo peso pero de OTRA carta no es un reemplazo: comparar solo el tamaño
    // bloquearía publicaciones legítimas (hay muchas imágenes de 65764 B).
    const db = clienteFalso([{ slug: 'detectibear', kind: 'character', size: 65764 }]);
    const todos = [{ rel: 'images/character/otra.webp', kind: 'character', slug: 'otra', bytes: 65764 }];
    return expect(reemplazosEnElArbolDelCatalogo(db, todos)).resolves.toEqual([]);
  });

  it('normaliza el `size` que Turso devuelve como cadena', () => {
    // Las columnas numéricas de libSQL llegan como `bigint` o cadena según el camino; sin la
    // conversión la comparación estricta fallaría en silencio y la guarda no saltaría.
    const db = clienteFalso([{ slug: 'stella', kind: 'logo', size: '135240' }]);
    const todos = [{ rel: 'images/logo/stella.webp', kind: 'logo', slug: 'stella', bytes: 135240 }];
    return expect(reemplazosEnElArbolDelCatalogo(db, todos)).resolves.toEqual([
      'images/logo/stella.webp',
    ]);
  });
});
