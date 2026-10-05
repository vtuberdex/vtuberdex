import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as resumenGET } from '../app/api/stats/resumen/route.js';
import { POST as latidoPOST } from '../app/api/stats/route.js';
import { __reiniciarHistorial } from './clientes-historial.mjs';
import { __reiniciar } from './clientes-stats.mjs';

// La resolución de fichas va contra el catálogo real; aquí se sustituye por un catálogo mínimo: 1 = Ana, 2 = Bea, 3 = retirada.
vi.mock('./ficha-id.mjs', () => {
  const publicas: Record<string, number> = { ana: 1, bea: 2 };
  return {
    idDeFichaPublica: async (slug: unknown) => (typeof slug === 'string' ? (publicas[slug] ?? null) : null),
    nombresDeFichas: async (ids: number[]) =>
      new Map(
        ids.map((id) => [
          id,
          id === 3 ? { id, nombre: 'Ficha retirada', dex: null, slug: null } : { id, nombre: id === 1 ? 'Ana' : 'Bea', dex: id * 10, slug: id === 1 ? 'ana' : 'bea' },
        ]),
      ),
  };
});

const TOKEN = 'token-de-prueba-0123456789abcdef';
const UA_CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const latido = (cuerpo: unknown, tamano?: number, userAgent?: string) =>
  latidoPOST(
    new Request('http://x/api/stats', {
      method: 'POST',
      headers: userAgent ? { 'user-agent': userAgent } : {},
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo ?? {}) + (tamano ? ' '.repeat(tamano) : ''),
    }),
  );
const resumen = (token?: string) =>
  resumenGET(new Request('http://x/api/stats/resumen', { headers: token ? { 'x-estado-token': token } : {} }));

beforeEach(() => {
  __reiniciar();
  __reiniciarHistorial();
  process.env.VTUBERDEX_STATS_TOKEN = TOKEN;
});
afterEach(() => {
  __reiniciar();
  __reiniciarHistorial();
  delete process.env.VTUBERDEX_STATS_TOKEN;
});

describe('POST /api/stats (latido)', () => {
  it('acepta un latido válido y responde 204 sin cuerpo', async () => {
    const r = await latido({ sid: 'sesion-abc12345', ruta: 'catalogo', disp: 'movil' });
    expect(r.status).toBe(204);
    expect(await r.text()).toBe('');
    const datos = await (await resumen(TOKEN)).json();
    expect(datos.conectados).toBe(1);
    expect(datos.por_dispositivo).toEqual({ movil: 1 });
  });

  it('un cuerpo basura o inválido tampoco da pistas: 204 y no cuenta', async () => {
    for (const malo of ['no es json', '{', 'null', '[]', '{"sid":"corto"}']) expect((await latido(malo)).status, malo).toBe(204);
    expect((await (await resumen(TOKEN)).json()).conectados).toBe(0);
  });

  it('rechaza cuerpos de más de 2 KB (413) y no los guarda', async () => {
    expect((await latido({ sid: 'sesion-abc12345' }, 3000)).status).toBe(413);
    expect((await (await resumen(TOKEN)).json()).conectados).toBe(0);
  });

  it('no deja pasar texto libre al panel', async () => {
    await latido({ sid: 'sesion-abc12345', ruta: '<script>alert(1)</script>', red: '/v/mi-slug' });
    const texto = JSON.stringify(await (await resumen(TOKEN)).json());
    expect(texto).not.toContain('script');
    expect(texto).not.toContain('mi-slug');
  });
});

describe('GET /api/stats/resumen (solo para el panel, con token)', () => {
  it('sin token, con token equivocado o de otro largo, responde 404 como si no existiera', async () => {
    for (const t of [undefined, 'x', 'otro-token-distinto-0123456789abcdef', TOKEN + 'x']) {
      const r = await resumen(t);
      expect(r.status, String(t)).toBe(404);
      expect(await r.json()).toEqual({ error: 'no_encontrado' });
    }
  });

  it('si el token NO está configurado (o es corto) nunca responde: no existe un modo abierto', async () => {
    delete process.env.VTUBERDEX_STATS_TOKEN;
    expect((await resumen('')).status).toBe(404);
    expect((await resumen('cualquiera')).status).toBe(404);
    process.env.VTUBERDEX_STATS_TOKEN = 'corto';
    expect((await resumen('corto')).status).toBe(404);
  });

  it('con el token correcto entrega agregados, sin caché y sin sesiones individuales', async () => {
    await latido({ sid: 'sesion-abc12345', lcp: 1500, fps: 58, gpu: 'hardware' });
    const r = await resumen(TOKEN);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const datos = await r.json();
    expect(datos).toMatchObject({ conectados: 1, rendimiento: { lcp_ms: 1500, fps: 58 }, gpu_software_pct: 0 });
    expect(JSON.stringify(datos)).not.toContain('sesion-abc');
  });
});

describe('navegador, sistema y ficha: los decide el servidor', () => {
  const sid = (n: number) => `sesion-${String(n).padStart(8, '0')}`;
  const pedir = async () => (await resumen(TOKEN)).json();

  it('el navegador y el sistema salen del User-Agent de la petición, no del cuerpo', async () => {
    await latido({ sid: sid(1), nav: true, ruta: 'catalogo' }, undefined, UA_CHROME_WIN);
    const d = await pedir();
    expect(d.por_navegador).toEqual({ chrome: 1 });
    expect(d.por_so).toEqual({ windows: 1 });
  });

  it('lo que el cliente afirme de sí mismo se IGNORA (navegador, sistema, fichaId y ficha)', async () => {
    await latido({ sid: sid(1), nav: true, ruta: 'catalogo', navegador: 'safari', so: 'ios', fichaId: 2 }, undefined, UA_CHROME_WIN);
    const d = await pedir();
    expect(d.por_navegador).toEqual({ chrome: 1 });
    expect(d.por_so).toEqual({ windows: 1 });
    expect(d.fichas_ahora).toEqual([]);
  });

  it('los robots y rastreadores no se cuentan', async () => {
    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'curl/8.5.0', 'facebookexternalhit/1.1']) {
      expect((await latido({ sid: sid(Math.floor(Math.random() * 1e6)), nav: true, ruta: 'catalogo' }, undefined, ua)).status).toBe(204);
    }
    const d = await pedir();
    expect(d.conectados).toBe(0);
    expect(d.visitas_hoy).toBe(0);
  });

  it('un slug válido se vuelve el id de una ficha pública; uno inventado no cuenta', async () => {
    await latido({ sid: sid(1), nav: true, ruta: 'ficha', ficha: 'ana' }, undefined, UA_CHROME_WIN);
    await latido({ sid: sid(2), nav: true, ruta: 'ficha', ficha: 'no-existe' }, undefined, UA_CHROME_WIN);
    await latido({ sid: sid(3), nav: true, ruta: 'catalogo', ficha: 'bea' }, undefined, UA_CHROME_WIN); // el slug solo vale en una ficha
    const d = await pedir();
    expect(d.fichas_ahora).toEqual([{ n: 1, nombre: 'Ana', dex: 10 }]);
    expect(d.historial[0].fichas).toEqual([{ n: 1, nombre: 'Ana', dex: 10 }]);
  });

  it('el panel recibe NOMBRES, nunca ids ni slugs; una ficha retirada sale anónima', async () => {
    await latido({ sid: sid(1), nav: true, ruta: 'ficha', ficha: 'bea' }, undefined, UA_CHROME_WIN);
    const crudo = JSON.stringify(await pedir());
    expect(crudo).toContain('Bea');
    expect(crudo).not.toMatch(/"slug"|"id":/);
    expect(crudo).not.toContain('"bea"');
  });

  it('el histórico mensual incluye navegador, sistema, días y el ranking de fichas', async () => {
    await latido({ sid: sid(1), nav: true, ruta: 'ficha', ficha: 'ana', disp: 'movil' }, undefined, UA_CHROME_WIN);
    const m = (await pedir()).historial[0];
    expect(m.navegador.chrome).toBe(1);
    expect(m.so.windows).toBe(1);
    expect(Object.values(m.dias).reduce((a: number, b) => a + (b as number), 0)).toBe(1);
    expect(m.fichasDistintas).toBe(1);
  });
});
