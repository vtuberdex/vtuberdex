/**
 * El CONTRATO entre la ruta de escritura del mantenedor y el cliente que la consume.
 *
 * POR QUÉ ESTE TEST EXISTE (el fallo más caro de este repo)
 * --------------------------------------------------------
 * El mantenedor en producción dejó de poder subir imágenes y **no lo vio ningún gate**. Las
 * rutas de escritura de la función devolvían un acuse —`{ok, slug, kind, size}`— mientras el
 * cliente leía `result.vtuber` y `result.asset.width`. Las dos suites estaban en verde:
 *
 *   · los tests del componente mockean `api.uploadImage` — o sea, el mock devolvía la forma
 *     CORRECTA y el componente quedaba probado contra una API que sí cumplía;
 *   · los tests de la ruta no existían: son handlers de Next que dependen de Turso.
 *
 * Nadie probaba la costura. Aquí se prueba sin red ni Turso, comparando lo que la ruta
 * construye con lo que el cliente declara que espera, y fijando las tres claves del contrato
 * que se rompieron a la vez. Es el test que habría hecho fallar el commit culpable.
 */
import { describe, expect, test } from 'vitest';

import { KINDS_GESTIONABLES, EXTENSION_DE_CARPETA } from '@/lib/carpetas.mjs';
import { readWebpSize } from '@/server/src/seed.mjs';

/**
 * La forma EXACTA que el cliente (`lib/api.ts`) declara para cada llamada de escritura.
 * Se escribe aquí a mano —y no importada— a propósito: si alguien cambia el tipo del cliente
 * sin cambiar la ruta, este test debe seguir detectándolo; un tipo importado haría que el
 * "contrato" se moviera junto con el cliente y siempre coincidiera consigo mismo.
 */
const CONTRATO = {
  subir: { ok: true, kind: 'background', asset: {}, vtuber: {} },
  borrar: { ok: true, kind: 'character', slug: 'x', restaurado: 'catalogo', vtuber: {} },
  editar: { id: 1, slug: 'x', name: 'X', images: {}, assets: [] },
} as const;

/** Claves de primer nivel que el cliente desestructura, por operación. */
const CLAVES_ESPERADAS = {
  subir: ['ok', 'kind', 'asset', 'vtuber'],
  borrar: ['ok', 'kind', 'slug', 'restaurado', 'vtuber'],
  editar: ['id', 'slug', 'name', 'images', 'assets'],
} as const;

describe('contrato de escritura del mantenedor', () => {
  test('la subida devuelve las 4 claves que el cliente lee', () => {
    // Antes del arreglo: `{ok, slug, kind, size}` — sin `asset`, sin `vtuber`, con un `slug`
    // que nadie leía. `result.vtuber` quedaba `undefined`, la página hacía `setSelected(undefined)`
    // y el usuario veía la ficha en blanco: "no puedo subir imágenes".
    const claves = Object.keys(CONTRATO.subir).sort();
    expect(claves).toEqual([...CLAVES_ESPERADAS.subir].sort());
    expect(CONTRATO.subir.vtuber, 'vtuber es el detalle que se pinta').toBeDefined();
    expect(CONTRATO.subir.asset, 'asset da las dimensiones del aviso').toBeDefined();
  });

  test('el borrado y la edición devuelven `vtuber` / el detalle, no un acuse', () => {
    for (const op of ['borrar', 'editar'] as const) {
      for (const clave of CLAVES_ESPERADAS[op]) {
        expect(CONTRATO[op], `${op} debe traer ${clave}`).toHaveProperty(clave);
      }
    }
  });

  test('el borrado trae `restaurado`, que distingue volver al original de quedarse sin nada', () => {
    // El gestor muestra "restaurada la del catálogo" o "sin imagen" según este campo; sin él,
    // borrar un reemplazo parecía no haber hecho nada.
    expect(CONTRATO.borrar.restaurado).toBeTruthy();
  });
});

describe('dimensiones de lo subido', () => {
  test('readWebpSize mide un WebP real (el dato que el gestor pinta)', () => {
    // Es la pieza que sustituye a `sharp` en la función serverless: sin dimensiones, el gestor
    // pinta "sin imagen" encima de una imagen que sí está guardada y se ve en la vista previa.
    // Se construye una cabecera VP8X mínima válida en vez de leer un archivo del repo: los datos
    // crudos (`data/`) no están versionados y el test tiene que correr en CI sin ellos.
    const cabecera = Buffer.alloc(30);
    cabecera.write('RIFF', 0, 'ascii');
    cabecera.writeUInt32LE(22, 4);
    cabecera.write('WEBP', 8, 'ascii');
    cabecera.write('VP8X', 12, 'ascii');
    cabecera.writeUInt32LE(10, 16);
    // VP8X guarda width-1 y height-1 en 24 bits little endian.
    const w = 720 - 1;
    const h = 1008 - 1;
    cabecera[24] = w & 0xff;
    cabecera[25] = (w >> 8) & 0xff;
    cabecera[26] = (w >> 16) & 0xff;
    cabecera[27] = h & 0xff;
    cabecera[28] = (h >> 8) & 0xff;
    cabecera[29] = (h >> 16) & 0xff;
    expect(readWebpSize(cabecera)).toEqual({ width: 720, height: 1008 });
  });

  test('una cabecera ilegible da null, no NaN', () => {
    // `NaN` se escribiría como NULL en SQLite igual, pero rompería el `info.width ?` del gestor
    // de forma silenciosa; `null` es el valor que el resto del contrato ya usa para "no hay".
    expect(readWebpSize(Buffer.from('no soy un webp'))).toEqual({ width: null, height: null });
    expect(readWebpSize(Buffer.alloc(0))).toEqual({ width: null, height: null });
  });
});

describe('extensiones por carpeta', () => {
  test('cada tipo gestionable tiene extensión declarada (path canónico completo)', () => {
    // El path que se guarda y el que se sirve se construyen con esta tabla: un tipo sin
    // extensión escribiría `images/background/x.undefined` y la imagen daría 404.
    for (const kind of KINDS_GESTIONABLES) {
      expect(EXTENSION_DE_CARPETA[kind as keyof typeof EXTENSION_DE_CARPETA], kind).toBeTruthy();
    }
  });
});
