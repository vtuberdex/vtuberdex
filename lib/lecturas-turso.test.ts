/**
 * El CONTRATO DE RENDIMIENTO de las lecturas que hablan con Turso.
 *
 * POR QUÉ ESTE TEST EXISTE (medido en producción)
 * -----------------------------------------------
 * Pintar una página del catálogo hacía **292 peticiones** a Turso con `perPage=24` y 1.204
 * con `perPage=100`: `asegurarTablas()` (3 sentencias DDL) se ejecutaba en CADA lectura, y
 * `aplicarReemplazosALista` preguntaba tipo por tipo para cada carta (3 viajes por ficha).
 * El síntoma era que la API escalaba linealmente —1 → 0,417 s · 24 → 0,824 s · 100 → 1,854 s—
 * cuando el catálogo local cuesta 2,2 ms, y el escalado se comía cualquier caché que se
 * añadiera encima, porque el coste viajaba DENTRO de la función.
 *
 * Ningún gate lo veía: `lint`, `typecheck`, `build` y las 118 pruebas pasaban en verde, y el
 * comportamiento era correcto — solo que multiplicaba el trabajo por 146. Es exactamente el
 * tipo de fallo que no se ve mirando el resultado, así que aquí se fija el NÚMERO de
 * consultas, no solo la forma de la respuesta.
 *
 * El cliente de Turso se sustituye por uno falso: contar consultas no necesita red, y la
 * suite tiene que correr en CI sin credenciales.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

/** Consultas que el código hizo al cliente falso, separadas por método. */
const registro = {
  execute: [] as Array<{ sql: string; args: unknown[] }>,
  executeMultiple: [] as string[],
  batch: 0,
};

/** Filas que devolverá la próxima consulta que no sea el DDL. */
let filasAResponder: Array<Record<string, unknown>> = [];

const clienteFalso = {
  execute: async (arg: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof arg === 'string' ? arg : arg.sql;
    const args = typeof arg === 'string' ? [] : (arg.args ?? []);
    registro.execute.push({ sql, args });
    return { rows: filasAResponder, rowsAffected: filasAResponder.length };
  },
  executeMultiple: async (sql: string) => {
    registro.executeMultiple.push(sql);
    return {};
  },
  batch: async () => {
    registro.batch += 1;
    return {};
  },
};

vi.mock('@libsql/client/node', () => ({ createClient: () => clienteFalso }));

/** Importa el módulo con el memo a cero: cada caso mide una instancia nueva. */
async function moduloLimpio() {
  vi.resetModules();
  return import('@/lib/ediciones.mjs');
}

const SLUGS = Array.from({ length: 24 }, (_, i) => `ficha-${i}`);

beforeEach(() => {
  registro.execute = [];
  registro.executeMultiple = [];
  registro.batch = 0;
  filasAResponder = [];
  process.env.TURSO_DATABASE_URL = 'http://turso-de-mentira';
  process.env.TURSO_AUTH_TOKEN = 'no-hace-falta';
});

/** Las consultas de DATOS (las que no son el DDL de arranque). */
function consultasDeDatos() {
  return registro.execute.filter((c) => /slug IN \(/.test(c.sql));
}

describe('consultas por página', () => {
  test('24 fichas se resuelven con UNA consulta, no con 72', async () => {
    const { reemplazosDePagina } = await moduloLimpio();
    await reemplazosDePagina(SLUGS);

    // Una sola consulta de datos: antes eran 3 por carta (una por tipo gestionable).
    expect(consultasDeDatos()).toHaveLength(1);
  });

  test('el DDL no se repite entre lecturas de la misma instancia', async () => {
    const { leerEdiciones, reemplazosDePagina } = await moduloLimpio();
    await leerEdiciones();
    const ddlTrasLaPrimera = registro.executeMultiple.length;
    // La primera lectura ya creó el esquema: no puede quedar ninguna por hacer.
    expect(ddlTrasLaPrimera).toBeGreaterThan(0);

    await reemplazosDePagina(SLUGS);
    await reemplazosDePagina(SLUGS.slice(0, 5));

    // Tres lecturas, el MISMO número de sentencias de esquema: es el memo, y era la
    // mitad del coste (3 DDL por lectura, 292 lecturas por página de 24).
    expect(registro.executeMultiple).toHaveLength(ddlTrasLaPrimera);
    // Las consultas de datos sí son una por operación: una de ediciones y una por página.
    expect(consultasDeDatos()).toHaveLength(2);
    expect(registro.execute.filter((c) => /FROM edicion/.test(c.sql))).toHaveLength(1);
  });

  test('la consulta de la página filtra por slug y por tipo en el SQL', async () => {
    const { reemplazosDePagina } = await moduloLimpio();
    await reemplazosDePagina(['a', 'b']);

    const { sql, args } = consultasDeDatos()[0];
    expect(sql).toMatch(/slug IN \(\?,\s*\?\)/);
    expect(sql).toMatch(/origen = \?/);
    expect(sql).toMatch(/kind IN \(/);
    // Los slugs van como parámetros: un slug llega de la URL.
    expect(args).toContain('a');
    expect(args).toContain('b');
    expect(sql).not.toContain("'a'");
  });

  test('no pide los bytes: cada fila de asset lleva una imagen entera', async () => {
    const { reemplazosDePagina } = await moduloLimpio();
    await reemplazosDePagina(['a']);

    // Traer `bytes` multiplicaría por ~40 KB cada fila y nadie en esta ruta los usa.
    expect(consultasDeDatos()[0].sql).not.toMatch(/bytes/i);
  });

  test('una página vacía no consulta nada', async () => {
    const { reemplazosDePagina } = await moduloLimpio();
    expect(await reemplazosDePagina([])).toEqual({});
    expect(registro.execute).toHaveLength(0);
    expect(registro.executeMultiple).toHaveLength(0);
  });
});

describe('resultado de la consulta por página', () => {
  test('compone la ruta canónica de cada tipo con su extensión', async () => {
    filasAResponder = [
      { slug: 'yeicokp-harv', kind: 'character', width: 720, height: 1008, size: 90000 },
      { slug: 'yeicokp-harv', kind: 'logo', width: 720, height: 1008, size: 12000 },
      { slug: 'otra', kind: 'background', width: null, height: null, size: 5 },
    ];
    const { reemplazosDePagina } = await moduloLimpio();
    const salida = await reemplazosDePagina(['yeicokp-harv', 'otra']);

    expect(salida['yeicokp-harv'].character).toEqual({
      path: 'images/character/yeicokp-harv.webp',
      width: 720,
      height: 1008,
      bytes: 90000,
    });
    expect(salida['yeicokp-harv'].logo.path).toBe('images/logo/yeicokp-harv.webp');
    // Medidas nulas siguen siendo `null`, no `undefined` ni `NaN`: el gestor las pinta.
    expect(salida.otra.background.width).toBeNull();
  });

  test('una ficha es el caso N=1 y devuelve la MISMA forma que la consulta múltiple', async () => {
    filasAResponder = [{ slug: 'yeicokp-harv', kind: 'character', width: 720, height: 1008, size: 1 }];
    const { reemplazosDePagina, reemplazosDelMantenedor } = await moduloLimpio();

    const porPagina = await reemplazosDePagina(['yeicokp-harv']);
    const uno = await reemplazosDelMantenedor('yeicokp-harv');

    // El detalle del mantenedor y la grilla tienen que componer igual o la imagen subida
    // aparecería en una vista y no en la otra (el fallo que documenta el módulo).
    expect(uno).toEqual(porPagina['yeicokp-harv']);
  });

  test('los slugs repetidos no se piden dos veces', async () => {
    const { reemplazosDePagina } = await moduloLimpio();
    await reemplazosDePagina(['a', 'a', 'b', 'a']);

    const args = consultasDeDatos()[0].args as string[];
    expect(args.filter((a) => a === 'a')).toHaveLength(1);
    expect(args.filter((a) => a === 'b')).toHaveLength(1);
  });
});

describe('sin Turso configurado', () => {
  test('no se hace ni una consulta: local y CI no pagan la red', async () => {
    delete process.env.TURSO_DATABASE_URL;
    const { leerEdiciones, reemplazosDePagina, asegurarTablas, aplicarReemplazosALista } =
      await moduloLimpio();

    expect(await leerEdiciones()).toEqual({});
    expect(await reemplazosDePagina(SLUGS)).toEqual({});
    await asegurarTablas();
    const cartas = [{ slug: 'x' }];
    // Devuelve el MISMO array: sin Turso no hay nada que aplicar ni copia que hacer.
    expect(await aplicarReemplazosALista(cartas)).toBe(cartas);

    expect(registro.execute).toHaveLength(0);
    expect(registro.executeMultiple).toHaveLength(0);
  });
});
