/**
 * `POST /api/stats` — latido anónimo de una pestaña abierta (ver `lib/clientes-stats.mjs`).
 *
 * Es un "beacon": responde 204 siempre que se pueda y NUNCA da pistas a quien lo llama. No lee la IP ni cookies. El
 * cuerpo se limita a 2 KB y se valida campo a campo antes de guardar.
 *
 * LO QUE DECIDE EL SERVIDOR, no el cliente: el navegador y el sistema operativo se leen del encabezado `User-Agent` de
 * ESTA petición y se reducen a una familia (`lib/user-agent.mjs`; el texto original se descarta), y la ficha se
 * resuelve de slug a ID de una ficha pública real (`lib/ficha-id.mjs`). Cualquier `navegador`, `so`, `fichaId` o
 * `ficha` que traiga el cuerpo se ignora. Los robots no se cuentan.
 */
import { registrar } from '../../../lib/clientes-stats.mjs';
import { idDeFichaPublica } from '../../../lib/ficha-id.mjs';
import { clasificarUserAgent } from '../../../lib/user-agent.mjs';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 2048;

export async function POST(request) {
  try {
    const texto = await request.text();
    if (texto.length > MAX_BYTES) return new Response(null, { status: 413 });
    const cuerpo = JSON.parse(texto);
    if (cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo)) {
      const { navegador, so, robot } = clasificarUserAgent(request.headers.get('user-agent'));
      if (!robot) {
        const fichaId = cuerpo.ruta === 'ficha' ? await idDeFichaPublica(cuerpo.ficha) : null;
        // Lo que el cliente diga de sí mismo se IGNORA: estas cuatro claves las pone solo el servidor.
        const resto = { ...cuerpo };
        for (const clave of ['ficha', 'navegador', 'so', 'fichaId']) delete resto[clave];
        registrar({ ...resto, navegador, so, fichaId });
      }
    }
  } catch {
    /* un cuerpo ilegible no es un error del servidor ni merece respuesta distinta */
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
