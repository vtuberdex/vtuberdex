/**
 * Tests de `scripts/descargar-imagenes.mjs`.
 *
 * QUÉ SE FIJA AQUÍ Y POR QUÉ
 * --------------------------
 * No se prueba "baja archivos" (eso necesita Turso y una cuenta): se prueban las reglas PURAS y
 * la SALVAGUARDA, que es donde este script se equivocó de verdad al escribirlo. El fallo no fue
 * un detalle: bajaba los reemplazos del mantenedor a `data/images/`, y ese árbol es la fuente
 * del manifiesto que alimenta a `publish-images.mjs`, que sube con `origen = 'catalogo'`. O sea
 * que una corrida del publicador habría subido el contenido del mantenedor **encima de la
 * imagen pública**, y con la clave `(slug, kind, origen)` no hay copia de debajo que
 * restaurar. Por eso lo primero que se testea es que el script se NIEGUE a escribir ahí.
 *
 *   1. `motivoDestinoInseguro` — el destino no puede ser el árbol publicado. Se compara por
 *      ruta resuelta y con separador, para que un prefijo de texto o un `../` no cuelen.
 *   2. `planDeDescarga` — compara TAMAÑO, no presencia. Es la misma regla que
 *      `publish-images.mjs` en el sentido contrario: si el scraper regeneró una imagen, el
 *      nombre canónico es el mismo y el contenido no, y sin esta comprobación la versión vieja
 *      se quedaría para siempre en el lado que no se miró.
 *   3. `indiceDeReemplazos` — la forma que lee la ruta local (`app/images/[...path]`), incluido
 *      que las medidas salgan como `null` y no `undefined` (van a un JSON) y que `actualizado`
 *      viaje, porque es lo que versiona la URL.
 *   4. La constante de origen coincide con la del camino de lectura.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ORIGEN_MANTENEDOR } from '../lib/ediciones.mjs';
import {
  CARPETA_TEMPORAL,
  ORIGEN_QUE_SE_BAJA,
  indiceDeReemplazos,
  motivoDestinoInseguro,
  planDeDescarga,
} from '../scripts/descargar-imagenes.mjs';

/** Un `stat` de mentira: mapa de rutas a tamaño; lo que no esté, no existe. */
const statFalso =
  (archivos: Record<string, number>) =>
  (abs: string): number | null =>
    archivos[abs] ?? null;

const RAIZ = '/tmp/dex-mantenedor';
const ROOT = path.resolve(__dirname, '..');

describe('motivoDestinoInseguro', () => {
  it('rechaza data/images, que es la fuente del manifiesto', () => {
    expect(motivoDestinoInseguro(path.join(ROOT, 'data', 'images'))).toMatch(/data\/images/);
  });

  it('rechaza un subdirectorio de data/images', () => {
    // Es la forma en que el fallo se cuela sin querer: apuntar a una carpeta concreta.
    expect(motivoDestinoInseguro(path.join(ROOT, 'data', 'images', 'character'))).toMatch(/data\/images/);
  });

  it('rechaza deploy/, que es el artefacto versionado', () => {
    expect(motivoDestinoInseguro(path.join(ROOT, 'deploy'))).toMatch(/deploy/);
    expect(motivoDestinoInseguro(path.join(ROOT, 'deploy', 'data'))).toMatch(/deploy/);
  });

  it('no se deja engañar por un prefijo de texto', () => {
    // `data/images-otra` EMPIEZA por `data/images` pero es otra carpeta: comparar por texto daría
    // un falso positivo y bloquearía un destino legítimo.
    expect(motivoDestinoInseguro(path.join(ROOT, 'data', 'images-otra'))).toBeNull();
  });

  it('acepta la carpeta temporal, que es el destino por defecto', () => {
    expect(motivoDestinoInseguro(path.join(ROOT, CARPETA_TEMPORAL))).toBeNull();
  });

  it('la carpeta temporal no está bajo data/images', () => {
    // La propiedad que hace IMPOSIBLE la contaminación, comprobada como propiedad y no como
    // valor: si alguien mueve la constante, este test avisa.
    expect(CARPETA_TEMPORAL.startsWith(path.join('data', 'images'))).toBe(false);
  });
});

describe('planDeDescarga', () => {
  it('baja lo que falta y lo que discrepa en tamaño, y respeta lo que ya está igual', () => {
    const filas = [
      { slug: 'stella', kind: 'character', size: 129924 },
      { slug: 'nueva', kind: 'background', size: 1000 },
      { slug: 'vieja', kind: 'logo', size: 2000 },
    ];
    const stat = statFalso({
      [`${RAIZ}/character/stella.webp`]: 129924,
      [`${RAIZ}/logo/vieja.webp`]: 1500,
    });

    const plan = planDeDescarga(filas, { stat, raiz: RAIZ });

    expect(plan.map((p) => [p.slug, p.motivo])).toEqual([
      ['nueva', 'falta'],
      ['vieja', 'distinto'],
    ]);
  });

  it('escribe en la raíz que recibe, no en un árbol fijo', () => {
    // Bajar a `data/images/` fue el fallo original: el destino tiene que venir de fuera para que
    // no pueda volver a colarse una ruta fija en el código.
    const plan = planDeDescarga([{ slug: 'stella', kind: 'character', size: 1 }], {
      stat: () => null,
      raiz: RAIZ,
    });
    expect(plan[0].abs.startsWith(RAIZ)).toBe(true);
    expect(plan[0].abs.includes(path.join('data', 'images'))).toBe(false);
  });

  it('usa la extensión de la carpeta y no asume `.webp`', () => {
    // Los emblemas de facción son PNG: suponer `.webp` los dejaría siempre "faltando".
    const plan = planDeDescarga([{ slug: 'abyssal', kind: 'faction', size: 10 }], {
      stat: () => null,
      raiz: RAIZ,
    });
    expect(plan[0].abs).toBe(`${RAIZ}/faction/abyssal.png`);
  });

  it('con `forzar` repite todo aunque el tamaño ya coincida', () => {
    const stat = statFalso({ [`${RAIZ}/character/stella.webp`]: 129924 });
    const plan = planDeDescarga([{ slug: 'stella', kind: 'character', size: 129924 }], {
      stat,
      raiz: RAIZ,
      forzar: true,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].motivo).toBe('forzado');
  });
});

describe('indiceDeReemplazos', () => {
  const filas = [
    { slug: 'stella', kind: 'logo', size: 135240, width: 2400, height: 1200, actualizado: '2026-09-24T00:35:28.076Z' },
    { slug: 'stella', kind: 'character', size: 129924, width: 720, height: 1008, actualizado: '2026-09-24T00:35:23.269Z' },
    { slug: 'detectibear', kind: 'character', size: 65764, width: 720, height: 1008, actualizado: '2026-09-24T00:29:48.791Z' },
  ];

  it('conserva la marca de la subida, que es lo que versiona la URL local', () => {
    // Sin `actualizado`, reemplazar una imagen dejaría la copia vieja en el navegador: el fallo
    // que ya se pagó en producción y que `marcaDeVersion` resuelve en el camino de Turso.
    for (const entrada of indiceDeReemplazos(filas)) {
      expect(entrada.actualizado).toBeTruthy();
    }
  });

  it('ordena de forma estable por kind y slug', () => {
    expect(indiceDeReemplazos(filas).map((e: { kind: string; slug: string }) => `${e.kind}/${e.slug}`)).toEqual([
      'character/detectibear',
      'character/stella',
      'logo/stella',
    ]);
  });

  it('normaliza medidas ausentes a null en vez de undefined', () => {
    // Va directo a un JSON que lee la ruta de imágenes: `undefined` desaparece al serializar y
    // la propiedad quedaría ausente en vez de nula.
    const [entrada] = indiceDeReemplazos([{ slug: 'x', kind: 'background', size: 1 }]);
    expect(entrada.width).toBeNull();
    expect(entrada.height).toBeNull();
    expect(entrada.actualizado).toBeNull();
  });

  it('el tamaño va como número, que es contra lo que se verifica el disco', () => {
    expect(indiceDeReemplazos([{ slug: 'x', kind: 'logo', size: '2000' }])[0].size).toBe(2000);
  });
});

describe('el origen que se baja es el que gana en el camino de lectura', () => {
  it('coincide con `ORIGEN_MANTENEDOR` de lib/ediciones.mjs', () => {
    // Es la comprobación que impide que este script y la app se contradigan: si uno cambia la
    // precedencia, el directorio temporal dejaría de ser lo que se sirve por encima del catálogo.
    expect(ORIGEN_QUE_SE_BAJA).toBe(ORIGEN_MANTENEDOR);
  });
});
