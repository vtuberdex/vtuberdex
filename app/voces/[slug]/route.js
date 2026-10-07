/**
 * `GET /voces/<slug>.mp3` — sirve el clip de voz de una ficha.
 *
 * Los clips se generan UNA vez con Piper + ffmpeg (`~/voces/pokedex-voz.sh`) y viven en disco,
 * en `VTUBERDEX_VOCES_DIR` (por defecto `data/voces/`). No van en la base: son ~110 KB por
 * ficha y se sirven tal cual. Una ficha sin clip responde 404 (el botón de la ficha lo usa para
 * decidir si se muestra).
 *
 * Soporta `Range`: Safari no reproduce un `<audio>` si el servidor no contesta 206.
 * El slug se valida contra una lista blanca de caracteres: es lo único que llega de la URL y
 * compone una ruta de archivo.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const SLUG_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function carpeta() {
  return process.env.VTUBERDEX_VOCES_DIR || path.join(process.cwd(), 'data', 'voces');
}

/** `bytes=a-b` → { inicio, fin } acotado al archivo, o null si no es un rango válido. */
function parsearRango(cabecera, tamano) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecera ?? '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let inicio;
  let fin;
  if (m[1] === '') {
    inicio = Math.max(0, tamano - Number(m[2]));
    fin = tamano - 1;
  } else {
    inicio = Number(m[1]);
    fin = m[2] === '' ? tamano - 1 : Math.min(Number(m[2]), tamano - 1);
  }
  return inicio <= fin && inicio < tamano ? { inicio, fin } : null;
}

export async function GET(request, { params }) {
  const { slug: crudo } = await params;
  const slug = String(crudo).replace(/\.mp3$/, '');
  if (!SLUG_VALIDO.test(slug)) return Response.json({ error: 'no_encontrado' }, { status: 404 });

  const archivo = path.join(carpeta(), `${slug}.mp3`);
  let info;
  try {
    info = await stat(archivo);
  } catch {
    return Response.json({ error: 'sin_voz' }, { status: 404 });
  }

  const cuerpo = await readFile(archivo);
  const base = {
    'content-type': 'audio/mpeg',
    'accept-ranges': 'bytes',
    // Se puede regenerar al editar la ficha: la caché es corta.
    'cache-control': 'public, max-age=300, s-maxage=300',
    'last-modified': info.mtime.toUTCString(),
  };

  const cabeceraRango = request.headers.get('range');
  if (cabeceraRango) {
    const rango = parsearRango(cabeceraRango, cuerpo.length);
    if (!rango) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${cuerpo.length}` } });
    const trozo = cuerpo.subarray(rango.inicio, rango.fin + 1);
    return new Response(trozo, {
      status: 206,
      headers: { ...base, 'content-range': `bytes ${rango.inicio}-${rango.fin}/${cuerpo.length}`, 'content-length': String(trozo.length) },
    });
  }
  return new Response(cuerpo, { headers: { ...base, 'content-length': String(cuerpo.length) } });
}
