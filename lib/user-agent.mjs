/**
 * Clasifica un `User-Agent` en FAMILIAS CERRADAS: navegador y sistema operativo. Pura (sin Node ni DOM).
 *
 * PRIVACIDAD: el texto original NO se guarda ni se reenvía: sale de aquí solo una de las etiquetas de abajo. Un
 * `User-Agent` completo (versión exacta, modelo del móvil…) puede ayudar a reconocer a una persona; la familia no.
 * Tampoco se confía en nada que el cliente diga de sí mismo: se lee del encabezado de la petición y se desecha.
 *
 * EL ORDEN IMPORTA, y es la parte donde estas listas suelen fallar: casi todos los navegadores dicen ser «Chrome» y
 * «Safari» a la vez, así que se miran primero los más específicos (Edge, Opera, Samsung, Firefox y las variantes de
 * iOS) y Chrome/Safari se dejan para el final.
 */

export const NAVEGADORES = ['chrome', 'edge', 'firefox', 'safari', 'opera', 'samsung', 'otros'];
export const SISTEMAS = ['windows', 'macos', 'linux', 'android', 'ios', 'chromeos', 'otros'];

/** Robots y previsualizadores de enlaces: no son personas y no deben inflar ni ensuciar las cifras. */
const ROBOT = /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|curl\/|wget|python-requests|go-http-client|axios|node-fetch|lighthouse|pingdom|uptime|monitor/i;

export function clasificarUserAgent(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 600) : '';
  if (!ua) return { navegador: 'otros', so: 'otros', robot: false };

  const so = (() => {
    // iOS antes que macOS: el UA de un iPhone dice «like Mac OS X». Un iPad moderno se presenta como Mac: no se distingue.
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/CrOS/i.test(ua)) return 'chromeos';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
    if (/Linux|X11/i.test(ua)) return 'linux';
    return 'otros';
  })();

  const navegador = (() => {
    if (/\bEdg(e|A|iOS)?\//.test(ua)) return 'edge';
    if (/\bOPR\/|\bOpera\b|\bOPT\//.test(ua)) return 'opera';
    if (/SamsungBrowser\//.test(ua)) return 'samsung';
    if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
    if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'safari';
    if (/Safari\//.test(ua)) return 'safari';
    return 'otros';
  })();

  return { navegador, so, robot: ROBOT.test(ua) };
}
