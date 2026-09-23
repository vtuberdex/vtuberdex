/**
 * Utilidades HTTP compartidas por el scraper.
 *
 * Particularidad del origen: TODAS las URLs desconocidas devuelven el index.html
 * (soft-404 con status 200). Por eso `fetchText` expone `isSoft404` y los
 * llamadores deben validarlo antes de aceptar una ficha de detalle.
 */

export const BASE_URL = 'https://vtuberdex.com/';

/** Huella del index.html (soft-404): detecta respuestas que NO son fichas. */
export const INDEX_HTML_MARKER = 'vtuber-card card0';
export const INDEX_HTML_SIZE = 185253;

export function toAbsolute(relative) {
  return new URL(relative.replace(/^\.?\//, ''), BASE_URL).toString();
}

export function isSoft404(html) {
  return html.length === INDEX_HTML_SIZE && html.includes(INDEX_HTML_MARKER);
}

/**
 * GET de texto con reintentos y backoff exponencial.
 * @returns {Promise<{status:number, html:string, soft404:boolean, url:string}>}
 */
export async function fetchText(url, { retries = 3, timeoutMs = 30000, fetchImpl = fetch } = {}) {
  const absolute = /^https?:/.test(url) ? url : toAbsolute(url);
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(absolute, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent':
            'vtuberdex-refresh/0.1 (+scraper; contacto: madkoding@gmail.com)',
          accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
        },
      });
      const html = await response.text();
      return { status: response.status, html, soft404: isSoft404(html), url: absolute };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

/** Descarga binaria (imágenes) con reintentos. Devuelve Buffer o null si falla. */
export async function fetchBinary(url, { retries = 3, timeoutMs = 45000, fetchImpl = fetch } = {}) {
  const absolute = /^https?:/.test(url) ? url : toAbsolute(url);
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(absolute, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'vtuberdex-refresh/0.1 (+scraper)' },
      });
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) return null;
      // El soft-404 también aplica a recursos inexistentes servidos como HTML.
      if (buffer.subarray(0, 15).toString('utf8').toLowerCase().startsWith('<!doctype html')) {
        return null;
      }
      return buffer;
    } catch {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
      }
    }
  }
  return null;
}

/** Ejecuta tareas asíncronas con concurrencia limitada preservando el orden. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
