/**
 * ESTADO EN DIRECTO de un VTuber en Twitch, YouTube y Kick, a partir de las redes de su ficha.
 *
 * Qué ofrece cada plataforma (y qué NO) con una credencial de APLICACIÓN, sin que el VTuber autorice nada:
 *   · Twitch  (Helix `streams`): en vivo, título, espectadores, juego, inicio. Los seguidores exigen el token
 *     del propio streamer, así que no se piden.
 *   · YouTube (Data API v3): estadísticas públicas del canal (las suscripciones pueden estar ocultas), últimos
 *     vídeos y directo en curso. Se busca el directo entre los últimos subidos (`playlistItems` + `videos`,
 *     3 unidades cuota) y NO con `search.list` (100 unidades: con 10.000 diarias no alcanzaría para nada).
 *     Límite honesto: un directo que no aparece aún en la lista de subidas no se detecta.
 *   · Kick    (API pública oficial): en vivo, título, categoría y espectadores. No publica seguidores.
 *
 * Sin credenciales de una plataforma, sus canales salen con `estado: 'sin_credenciales'` y la ficha no
 * muestra nada de ella: ni local ni CI necesitan cuenta ni red (mismo criterio que Turso en `ediciones.mjs`).
 *
 * El visitante nunca habla con las plataformas: pregunta a la ruta de la ficha y esta consulta con UNA
 * caché en memoria (TTL corto para «en vivo», más largo para YouTube por cuota) y compartiendo las peticiones
 * en vuelo, así mil visitantes a la misma ficha cuestan una llamada. El estado vive en `globalThis` por la
 * misma razón que `anti-scraping.mjs`: Next compila cada ruta como una entrada distinta. Se pierde al reiniciar.
 *
 * Todo lo que viene de la red se acota y se valida antes de devolverlo: el título lo escribe el streamer.
 */

export const PLATAFORMAS = ["twitch", "youtube", "kick"];

/** Cuánto vale una respuesta buena. Twitch y Kick cuestan poco y «en vivo» caduca rápido; YouTube cuida cuota. */
export const TTL_MS = { twitch: 60_000, kick: 60_000, youtube: 5 * 60_000 };
/** Un fallo se recuerda poco, solo para no martillar a la plataforma mientras está caída. */
export const TTL_ERROR_MS = 30_000;
const MAX_CACHE = 2000;
const TIEMPO_MAXIMO_MS = 5000;
const VIDEOS_MAX = 5;
const TEXTO_MAX = 200;

const CLAVE = Symbol.for("vtuberdex.directos");
function estado() {
  const g = globalThis;
  if (!g[CLAVE]) g[CLAVE] = { cache: new Map(), vuelo: new Map(), tokens: new Map() };
  return g[CLAVE];
}

/** Para los tests: olvida cachés y tokens. */
export function __reiniciarDirectos() {
  delete globalThis[CLAVE];
}

// ---------------------------------------------------------------------------------------------
// De la red social al canal
// ---------------------------------------------------------------------------------------------

const RESERVADOS_TWITCH = new Set([
  "directory",
  "videos",
  "downloads",
  "turbo",
  "settings",
  "p",
  "jobs",
  "store",
  "search",
  "friends",
  "subscriptions",
  "inventory",
  "wallet",
  "u",
]);
const RESERVADOS_KICK = new Set(["categories", "category", "browse", "search", "video", "dashboard"]);

function urlDe(texto) {
  try {
    const url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function hostDe(url) {
  return url.hostname.toLowerCase().replace(/^(www|m)\./, "");
}

/**
 * Reconoce el canal en una URL de red social. Devuelve `null` si no es de una plataforma soportada o no
 * apunta a un canal (una URL de vídeo, una categoría…). El dominio manda sobre el nombre de la red, que es
 * texto libre («Twitch», «twitch.tv», «you tube»).
 * @returns {{ plataforma: string, clave: string, url: string, ref: object } | null}
 */
export function canalDeUrl(texto) {
  const url = typeof texto === "string" ? urlDe(texto.trim()) : null;
  if (!url) return null;
  const host = hostDe(url);
  const [primero = "", segundo = ""] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (host === "twitch.tv") {
    const login = primero.toLowerCase();
    if (!/^[a-z0-9_]{3,25}$/.test(login) || RESERVADOS_TWITCH.has(login)) return null;
    return { plataforma: "twitch", clave: login, url: `https://www.twitch.tv/${login}`, ref: { login } };
  }
  if (host === "kick.com") {
    const slug = primero.toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(slug) || RESERVADOS_KICK.has(slug)) return null;
    return { plataforma: "kick", clave: slug, url: `https://kick.com/${slug}`, ref: { slug } };
  }
  if (host === "youtube.com") {
    if (/^@[\p{L}\p{N}._-]{3,60}$/u.test(primero)) {
      const handle = primero.toLowerCase();
      return { plataforma: "youtube", clave: handle, url: `https://www.youtube.com/${handle}`, ref: { handle } };
    }
    if (primero === "channel" && /^UC[\w-]{22}$/.test(segundo)) {
      return { plataforma: "youtube", clave: segundo, url: `https://www.youtube.com/channel/${segundo}`, ref: { id: segundo } };
    }
    if (primero === "user" && /^[\w.-]{1,60}$/.test(segundo)) {
      const user = segundo.toLowerCase();
      return { plataforma: "youtube", clave: `user:${user}`, url: `https://www.youtube.com/user/${user}`, ref: { user } };
    }
    // `/c/Nombre` y `/Nombre` (URL personalizada antigua): resolverlas costaría 100 unidades de cuota.
  }
  return null;
}

/** Los canales de las redes de una ficha: uno por plataforma+canal, en el orden en que están. */
export function canalesDeRedes(socials) {
  const vistos = new Set();
  const canales = [];
  for (const red of Array.isArray(socials) ? socials : []) {
    const canal = canalDeUrl(red?.url);
    if (!canal) continue;
    const id = `${canal.plataforma}:${canal.clave}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    canales.push(canal);
  }
  return canales;
}

// ---------------------------------------------------------------------------------------------
// Utilidades de respuesta
// ---------------------------------------------------------------------------------------------

function texto(valor, max = TEXTO_MAX) {
  if (typeof valor !== "string") return "";
  // Códigos de control fuera (el título lo escribe el streamer), sin regex: `no-control-regex` los prohíbe.
  const limpio = Array.from(valor, (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c)).join("");
  return limpio.trim().slice(0, max);
}
function entero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
function fechaIso(valor) {
  const t = Date.parse(valor);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
/** Solo se aceptan miniaturas por https: lo que se devuelve termina en un `<img src>`. */
function imagenHttps(valor) {
  return typeof valor === "string" && /^https:\/\//i.test(valor) ? valor.slice(0, 500) : null;
}

class ErrorDePlataforma extends Error {
  constructor(mensaje, status) {
    super(mensaje);
    this.status = status;
  }
}

async function pedirJson(ctx, url, opciones = {}) {
  const respuesta = await ctx.fetch(url, {
    ...opciones,
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    headers: { accept: "application/json", ...opciones.headers },
  });
  if (!respuesta.ok) throw new ErrorDePlataforma(`HTTP ${respuesta.status}`, respuesta.status);
  return respuesta.json();
}

/** Token de aplicación (client credentials), cacheado hasta un minuto antes de caducar. */
async function tokenDeApp(ctx, plataforma, urlToken, id, secreto, { forzar = false } = {}) {
  const guardado = estado().tokens.get(plataforma);
  if (!forzar && guardado && guardado.expira > ctx.ahora()) return guardado.token;
  const cuerpo = new URLSearchParams({ client_id: id, client_secret: secreto, grant_type: "client_credentials" });
  const datos = await pedirJson(ctx, urlToken, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: cuerpo,
  });
  if (typeof datos?.access_token !== "string") throw new ErrorDePlataforma("sin_token", 502);
  const segundos = Number(datos.expires_in) > 0 ? Number(datos.expires_in) : 3600;
  estado().tokens.set(plataforma, { token: datos.access_token, expira: ctx.ahora() + (segundos - 60) * 1000 });
  return datos.access_token;
}

/** Ejecuta `pedir(token)`; si la plataforma responde 401 el token caducó antes de lo previsto: lo renueva UNA vez. */
async function conToken(obtener, pedir) {
  try {
    return await pedir(await obtener({}));
  } catch (error) {
    if (error?.status !== 401) throw error;
    return pedir(await obtener({ forzar: true }));
  }
}

// ---------------------------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------------------------

async function consultarTwitch(canal, ctx) {
  const { TWITCH_CLIENT_ID: id, TWITCH_CLIENT_SECRET: secreto } = ctx.env;
  const datos = await conToken(
    (o) => tokenDeApp(ctx, "twitch", "https://id.twitch.tv/oauth2/token", id, secreto, o),
    (token) =>
      pedirJson(ctx, `https://api.twitch.tv/helix/streams?${new URLSearchParams({ user_login: canal.ref.login })}`, {
        headers: { "client-id": id, authorization: `Bearer ${token}` },
      }),
  );
  const directo = Array.isArray(datos?.data) ? datos.data.find((s) => s?.type === "live") : null;
  if (!directo) return { enVivo: false };
  return {
    enVivo: true,
    titulo: texto(directo.title),
    espectadores: entero(directo.viewer_count),
    categoria: texto(directo.game_name, 80) || null,
    inicio: fechaIso(directo.started_at),
    miniatura: imagenHttps(String(directo.thumbnail_url ?? "").replace("{width}", "440").replace("{height}", "248")),
  };
}

async function consultarKick(canal, ctx) {
  const { KICK_CLIENT_ID: id, KICK_CLIENT_SECRET: secreto } = ctx.env;
  const datos = await conToken(
    (o) => tokenDeApp(ctx, "kick", "https://id.kick.com/oauth/token", id, secreto, o),
    (token) =>
      pedirJson(ctx, `https://api.kick.com/public/v1/channels?${new URLSearchParams({ slug: canal.ref.slug })}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
  );
  const ficha = Array.isArray(datos?.data) ? datos.data[0] : null;
  if (!ficha) throw new ErrorDePlataforma("canal_no_encontrado", 404);
  const directo = ficha.stream;
  if (!directo?.is_live) return { enVivo: false };
  return {
    enVivo: true,
    titulo: texto(ficha.stream_title),
    espectadores: entero(directo.viewer_count),
    categoria: texto(ficha.category?.name, 80) || null,
    inicio: fechaIso(directo.start_time),
    miniatura: imagenHttps(directo.thumbnail),
  };
}

const API_YOUTUBE = "https://www.googleapis.com/youtube/v3";

async function consultarYoutube(canal, ctx) {
  const key = ctx.env.YOUTUBE_API_KEY;
  const llamar = (ruta, parametros) => pedirJson(ctx, `${API_YOUTUBE}/${ruta}?${new URLSearchParams({ ...parametros, key })}`);

  const filtro = canal.ref.id
    ? { id: canal.ref.id }
    : canal.ref.handle
      ? { forHandle: canal.ref.handle }
      : { forUsername: canal.ref.user };
  const canales = await llamar("channels", { part: "statistics,contentDetails", ...filtro });
  const datosCanal = canales?.items?.[0];
  if (!datosCanal) throw new ErrorDePlataforma("canal_no_encontrado", 404);

  const estadisticas = datosCanal.statistics ?? {};
  const resultado = {
    enVivo: false,
    estadisticas: {
      // Muchos canales ocultan sus suscriptores: ahí la API trae `hiddenSubscriberCount` y ninguna cifra.
      suscriptores: estadisticas.hiddenSubscriberCount ? null : entero(estadisticas.subscriberCount),
      vistas: entero(estadisticas.viewCount),
      videos: entero(estadisticas.videoCount),
    },
    videos: [],
  };

  const subidas = datosCanal.contentDetails?.relatedPlaylists?.uploads;
  if (typeof subidas !== "string") return resultado;
  const lista = await llamar("playlistItems", { part: "contentDetails", playlistId: subidas, maxResults: "10" });
  const ids = (lista?.items ?? [])
    .map((i) => i?.contentDetails?.videoId)
    .filter((v) => typeof v === "string" && /^[\w-]{11}$/.test(v));
  if (!ids.length) return resultado;

  const detalle = await llamar("videos", { part: "snippet,statistics,liveStreamingDetails", id: ids.join(",") });
  const videos = Array.isArray(detalle?.items) ? detalle.items : [];

  const vivo = videos.find((v) => v?.snippet?.liveBroadcastContent === "live");
  if (vivo) {
    resultado.enVivo = true;
    resultado.titulo = texto(vivo.snippet.title);
    resultado.espectadores = entero(vivo.liveStreamingDetails?.concurrentViewers);
    resultado.inicio = fechaIso(vivo.liveStreamingDetails?.actualStartTime);
    resultado.miniatura = imagenHttps(vivo.snippet.thumbnails?.medium?.url);
    resultado.enlace = `https://www.youtube.com/watch?v=${vivo.id}`;
  }
  resultado.videos = videos
    .filter((v) => v?.snippet?.liveBroadcastContent === "none" && /^[\w-]{11}$/.test(String(v.id)))
    .slice(0, VIDEOS_MAX)
    .map((v) => ({
      id: v.id,
      titulo: texto(v.snippet.title),
      publicado: fechaIso(v.snippet.publishedAt),
      miniatura: imagenHttps(v.snippet.thumbnails?.medium?.url),
      vistas: entero(v.statistics?.viewCount),
      url: `https://www.youtube.com/watch?v=${v.id}`,
    }));
  return resultado;
}

const PROVEEDORES = {
  twitch: { consultar: consultarTwitch, requiere: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"] },
  kick: { consultar: consultarKick, requiere: ["KICK_CLIENT_ID", "KICK_CLIENT_SECRET"] },
  youtube: { consultar: consultarYoutube, requiere: ["YOUTUBE_API_KEY"] },
};

/** ¿Hay credenciales para esta plataforma? */
export function plataformaConfigurada(plataforma, env = process.env) {
  return PROVEEDORES[plataforma]?.requiere.every((v) => Boolean(env[v])) ?? false;
}

// ---------------------------------------------------------------------------------------------
// Caché + consulta
// ---------------------------------------------------------------------------------------------

function podar(cache, ahora) {
  if (cache.size < MAX_CACHE) return;
  for (const [clave, entrada] of cache) if (entrada.expira <= ahora) cache.delete(clave);
  // Todo vigente y aun así lleno: se suelta lo más antiguo (el Map conserva el orden de inserción).
  while (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
}

/**
 * Estado de UN canal, ya normalizado. Nunca lanza: un fallo de la plataforma es `estado: 'error'`, y
 * la ficha sigue (esto es un adorno, no puede tumbarla).
 * @returns {Promise<Record<string, any>>} `{ plataforma, url, estado: 'ok'|'sin_credenciales'|'error', enVivo?, … }`
 */
export async function estadoDeCanal(canal, { fetch: fetchFn = globalThis.fetch, env = process.env, ahora = Date.now } = {}) {
  const base = { plataforma: canal.plataforma, url: canal.url };
  const proveedor = PROVEEDORES[canal.plataforma];
  if (!proveedor || !plataformaConfigurada(canal.plataforma, env)) return { ...base, estado: "sin_credenciales" };

  const { cache, vuelo } = estado();
  const clave = `${canal.plataforma}:${canal.clave}`;
  const hit = cache.get(clave);
  if (hit && hit.expira > ahora()) return hit.valor;
  if (vuelo.has(clave)) return vuelo.get(clave);

  const trabajo = (async () => {
    let valor;
    let ttl = TTL_MS[canal.plataforma];
    try {
      valor = { ...base, estado: "ok", ...(await proveedor.consultar(canal, { fetch: fetchFn, env, ahora })) };
    } catch (error) {
      // El mensaje puede traer detalles de la plataforma: al registro, no a la respuesta.
      console.error(`[directos] ${clave}: ${error.message}`);
      valor = { ...base, estado: "error" };
      ttl = TTL_ERROR_MS;
    }
    podar(cache, ahora());
    cache.set(clave, { valor, expira: ahora() + ttl });
    return valor;
  })().finally(() => vuelo.delete(clave));
  vuelo.set(clave, trabajo);
  return trabajo;
}

/** Estado de todos los canales de las redes de una ficha, en paralelo. */
/** @returns {Promise<Array<Record<string, any>>>} */
export async function estadoDeRedes(socials, opciones) {
  return Promise.all(canalesDeRedes(socials).map((c) => estadoDeCanal(c, opciones)));
}
