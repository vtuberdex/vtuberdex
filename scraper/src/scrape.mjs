/**
 * Orquestador del scrape.
 *
 * 1. Baja el index y lo parsea (785 cartas).
 * 2. Intenta la ficha de detalle de cada carta (por enlace del index o por slug
 *    derivado del nombre) y guarda el HTML en caché.
 * 3. Descarga y convierte imágenes (ficha, logo, avatar, radar) a WebP.
 * 4. Escribe `out/dataset.json` con todo lo extraído.
 *
 * Es reanudable: si el HTML ya está en `cache/`, no se vuelve a pedir.
 * Uso: node src/scrape.mjs [--limit N] [--force] [--no-images]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE_URL, fetchBinary, fetchText, mapLimit } from './http.mjs';
import { parseIndex } from './parse-index.mjs';
import { parseDetail } from './parse-detail.mjs';
import { COUNTRY_BY_SLUG, languagesForCountries, slugify } from './normalize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CACHE = path.join(HERE, '..', 'cache');
const DETAIL_CACHE = path.join(CACHE, 'detail');
const OUT = path.join(HERE, '..', 'out');
const IMAGES = path.join(ROOT, 'data', 'images');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const LIMIT = Number(value('limit', '0')) || Infinity;
const FORCE = flag('force');
const FROM_CACHE = flag('from-cache');
const SKIP_IMAGES = flag('no-images');
const DETAIL_CONCURRENCY = Number(value('concurrency', '8'));
const IMAGE_CONCURRENCY = Number(value('image-concurrency', '6'));

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readCache(target) {
  try {
    return await fs.readFile(target, 'utf8');
  } catch {
    return null;
  }
}

/** Slugs candidatos para una carta: enlace del index, nombre y número. */
function candidateSlugs(entry) {
  const candidates = [];
  if (entry.detailSlug) candidates.push(entry.detailSlug);
  const cleaned = (entry.name ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned) {
    candidates.push(cleaned.replace(/\s+/g, ''));
    candidates.push(cleaned.replace(/\s+/g, '_'));
    candidates.push(cleaned.replace(/\s+/g, '-'));
    candidates.push(cleaned);
  }
  if (entry.imageSrc) {
    const base = entry.imageSrc.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '');
    if (base) candidates.push(base.replace(/\s+/g, ''));
  }
  return [...new Set(candidates.filter(Boolean))];
}

/** Ruta de caché del HTML de detalle, compartida por scrape y re-parseo. */
export function detailCachePath(slug, dexNumber) {
  const safe = slugify(slug) || `v${dexNumber}`;
  return path.join(DETAIL_CACHE, `${safe}--${Buffer.from(slug).toString('base64url')}.html`);
}

/** Baja (o lee de caché) el detalle. Devuelve {html, slug} o null. */
async function loadDetail(entry) {
  for (const slug of candidateSlugs(entry)) {
    const cacheFile = detailCachePath(slug, entry.dexNumber);
    const cached = await readCache(cacheFile);
    if (cached) return { html: cached, slug, cacheFile };
    if (FROM_CACHE) continue;
    try {
      const { html, soft404 } = await fetchText(`${BASE_URL}${slug.split('/').map(encodeURIComponent).join('/')}`);
      if (!soft404 && html.includes('class="terminal-bar"')) {
        await fs.writeFile(cacheFile, html);
        return { html, slug, cacheFile };
      }
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

const EXT_BY_FORMAT = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', gif: 'gif' };

/** Convierte un data URI (base64 embebido en la ficha) en Buffer. */
function bufferFromDataUri(src) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
  if (!match) return null;
  const [, , isBase64, payload] = match;
  try {
    return isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  } catch {
    return null;
  }
}

/** Descarga una imagen y la convierte a WebP. Devuelve la ruta relativa o null. */
/**
 * Reutiliza el logo ya recortado de la carta (data/images/logo/<slug>.webp),
 * que produce `extract-logo2.mjs`. Sirve para las 574 fichas sin página de
 * detalle, donde no hay logo servido por el sitio.
 * @returns {Promise<string|null>} ruta pública relativa, o null si no existe.
 */
async function reuseCardLogo({ sharp, folder, slug }) {
  const file = path.join(IMAGES, folder, `${slug}.webp`);
  if (!(await exists(file))) return null;
  // Se normaliza el ancho como en convertImage para que el tamaño sea uniforme.
  // El PERSONAJE ya viene normalizado al lienzo de carta (720x1008) por
  // así que no se le toca el tamaño: solo se comprueba que exista.
  if (sharp && folder !== 'character') {
    const current = await sharp(file).metadata();
    if ((current.width ?? 0) > 900) {
      const resized = await sharp(file).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 92, alphaQuality: 90 }).toBuffer();
      await fs.writeFile(file, resized);
    }
  }
  return `images/${folder}/${slug}.webp`;
}

async function convertImage(src, { sharp, folder, slug, width, quality = 82, keepAlpha = false, trim = false }) {
  if (!src) return null;
  const isDataUri = src.startsWith('data:');
  const url = isDataUri ? null : `${BASE_URL}${src.replace(/^\.?\//, '')}`;
  const buffer = isDataUri ? bufferFromDataUri(src) : await fetchBinary(url);
  if (!buffer) return null;
  const targetDir = path.join(IMAGES, folder);
  await fs.mkdir(targetDir, { recursive: true });
  const file = path.join(targetDir, `${slug}.webp`);
  // Se regenera si falta O si la versión guardada es más pequeña que el ancho
  // objetivo (permite subir la resolución de un tipo de asset sin --force).
  if (!FORCE && (await exists(file))) {
    const current = await sharp(file).metadata();
    if ((current.width ?? 0) >= width) return `images/${folder}/${slug}.webp`;
  }
  try {
    let pipeline = sharp(buffer, { animated: false });
    // Los logos vienen con padding TRANSPARENTE baked en el PNG (un archivo de
    // 900x300 puede tener solo 416px de contenido). Sin recortarlo, el logo
    // parece diminuto y con márgenes enormes al colocarlo.
    if (trim) {
      try {
        pipeline = sharp(await pipeline.trim({ threshold: 1 }).png().toBuffer(), { animated: false });
      } catch {
        pipeline = sharp(buffer, { animated: false });
      }
    }
    const converted = await pipeline
      .resize({ width, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality, alphaQuality: keepAlpha ? 90 : undefined })
      .toBuffer();
    await fs.writeFile(file, converted);
    return `images/${folder}/${slug}.webp`;
  } catch {
    // Formato no soportado: guarda el original como fallback con su extensión.
    const magic = buffer.subarray(0, 12);
    const ext = magic.subarray(0, 4).toString('latin1').includes('PNG')
      ? 'png'
      : magic.subarray(0, 3).toString('latin1') === 'GIF'
        ? 'gif'
        : magic.subarray(6, 10).toString('latin1') === 'WEBP'
          ? 'webp'
          : 'jpg';
    const fallback = path.join(targetDir, `${slug}.${ext}`);
    if (!(await exists(fallback))) await fs.writeFile(fallback, buffer);
    return `images/${folder}/${slug}.${ext}`;
  }
}

async function main() {
  const started = Date.now();
  await fs.mkdir(DETAIL_CACHE, { recursive: true });
  await fs.mkdir(OUT, { recursive: true });

  // ---- 1. index ------------------------------------------------------------
  const indexPath = path.join(CACHE, 'index.html');
  let indexHtml = FORCE ? null : await readCache(indexPath);
  if (!indexHtml) {
    const { html } = await fetchText(BASE_URL);
    await fs.writeFile(indexPath, html);
    indexHtml = html;
  }
  const entries = parseIndex(indexHtml).slice(0, LIMIT);
  console.log(`[scrape] index: ${entries.length} cartas`);

  // ---- 2. detalles ---------------------------------------------------------
  let done = 0;
  const withDetail = await mapLimit(entries, DETAIL_CONCURRENCY, async (entry) => {
    const detail = await loadDetail(entry);
    done += 1;
    if (done % 50 === 0) console.log(`[scrape] detalles ${done}/${entries.length}`);
    return { entry, detail };
  });
  const found = withDetail.filter((item) => item.detail).length;
  console.log(`[scrape] detalles encontrados: ${found}/${entries.length}`);

  // ---- 3. imágenes ---------------------------------------------------------
  const { default: sharp } = SKIP_IMAGES ? { default: null } : await import('sharp');
  const imageStats = { card: 0, thumb: 0, logo: 0, character: 0, radar: 0, failed: [] };

  const dataset = await mapLimit(withDetail, IMAGE_CONCURRENCY, async ({ entry, detail }, index) => {
    const parsed = detail ? parseDetail(detail.html) : null;
    const dexNumber = entry.dexNumber ?? index + 1;
    const slug = slugify(entry.name) || `vtuber-${dexNumber}`;
    const languages = languagesForCountries(entry.countries);

    let assets = { card: null, thumb: null, logo: null, character: null, radar: null };
    if (sharp && !SKIP_IMAGES) {
      const fallbackSlug = entry.imageSrc ? `vtuber${dexNumber}` : null;
      // El logo del detalle solo existe en 211 de 785 fichas. Para el resto se
      // reutiliza el recortado de la carta por `extract-logo2.mjs`, que corre
      // como paso aparte y deja los WebP en data/images/logo/<slug>.webp.
      const logoFromCard = await reuseCardLogo({ sharp, slug, folder: 'logo' });
      // La imagen del PERSONAJE es otro asset: solo 211 fichas la traen aparte
      // (avatar). Para las 574 restantes se rescata del panel izquierdo de la
      // carta con `extract-character.mjs`.
      const characterFromCard = await reuseCardLogo({ sharp, slug, folder: 'character' });

      // ---------------------------------------------------------- IMÁGENES ---
      // REGLA DE ORO (y corrección de diseño): la única imagen propia del VTuber
      // es el PERSONAJE. La CARTA no se guarda: la compone el visor 3D en el
      // navegador (personaje + logo + marco), así que generar un asset de carta
      // era trabajo duplicado que además se quedaba obsoleto al subir una imagen
      // nueva desde el mantenedor.
      //
      // La ficha apaisada del sitio es LEGACY y se registra como `card` porque es
      // el respaldo: si un VTuber no tiene personaje, las vistas muestran la ficha
      // en su lugar en vez de un hueco vacío.
      const fichaSrc = entry.imageSrc;

      assets = {
        // La FICHA apaisada del sitio (legacy). Es el respaldo cuando no hay
        // personaje: así `card` siempre resuelve a algo mostrable.
        card: await convertImage(fichaSrc, { sharp, folder: 'ficha', slug, width: 720, quality: 82 }),
        thumb: characterFromCard
          ? await (async () => {
              // La miniatura es del PERSONAJE (no de la ficha): es lo que se ve
              // en el listado, así que debe ser la figura en formato carta.
              // `characterFromCard` ya es una ruta pública (`images/...`), así que
              // se resuelve contra la raíz del proyecto, no contra IMAGES (que ya
              // apunta a data/images y duplicaría el prefijo).
              const src = path.join(ROOT, 'data', characterFromCard);
              const buf = await sharp(src).resize({ width: 360, withoutEnlargement: true }).webp({ quality: 84, alphaQuality: 100, effort: 6 }).toBuffer();
              await fs.writeFile(path.join(IMAGES, 'thumb', `${slug}.webp`), buf);
              return `images/thumb/${slug}.webp`;
            })()
          : await convertImage(fichaSrc, { sharp, folder: 'thumb', slug, width: 360, quality: 76 }),
        logo: (await convertImage(parsed?.logo, { sharp, folder: 'logo', slug, width: 900, quality: 92, keepAlpha: true, trim: true })) ?? logoFromCard,
        // El PERSONAJE se guarda normalizado al lienzo de la carta (1.4) por
        // `extract-character.mjs`. Solo si no existe se usa la galería cruda del sitio
        // (proporción 0.53-2.95) y, en último caso, la ficha apaisada.
        character:
          characterFromCard ??
          (await convertImage(parsed?.gallery?.find((item) => item.src)?.src, { sharp, folder: 'avatar', slug, width: 640, quality: 82 })) ??
          (await convertImage(fichaSrc, { sharp, folder: 'ficha', slug, width: 720, quality: 82 })),
        radar: await convertImage(parsed?.radar, { sharp, folder: 'radar', slug, width: 512, quality: 82 }),
      };
      const wanted = [
        ['card', entry.imageSrc],
        ['logo', parsed?.logo ?? logoFromCard],
        ['character', characterFromCard ?? parsed?.gallery?.find((item) => item.src)?.src],
        ['radar', parsed?.radar],
      ];
      for (const [key, src] of wanted) {
        if (src && assets[key]) imageStats[key] += 1;
        else if (src && !assets[key]) imageStats.failed.push(`${slug}:${key}`);
      }
      if (assets.thumb) imageStats.thumb += 1;
      void fallbackSlug;
    }

    return {
      dexNumber,
      name: entry.name,
      slug,
      alt: entry.alt,
      countries: entry.countries.map((countrySlug) => ({
        slug: countrySlug,
        name: COUNTRY_BY_SLUG.get(countrySlug)?.es ?? countrySlug,
        flag: COUNTRY_BY_SLUG.get(countrySlug)?.flag ?? '🏳️',
      })),
      languages,
      groups: entry.groups,
      artists: entry.artists,
      source: {
        indexImage: entry.imageSrc,
        detailSlug: detail?.slug ?? null,
        detailUrl: detail ? `${BASE_URL}${detail.slug.split('/').map(encodeURIComponent).join('/')}` : null,
        hasDetail: Boolean(detail),
      },
      assets,
      detail: parsed,
    };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    source: BASE_URL,
    counts: {
      cards: dataset.length,
      withDetail: found,
      withoutDetail: dataset.length - found,
      images: imageStats,
    },
    vtubers: dataset,
  };

  await fs.writeFile(
    path.join(OUT, 'dataset.json'),
    JSON.stringify(output, (key, val) => (typeof val === 'string' && val.startsWith('data:') ? null : val), 1),
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[scrape] listo en ${seconds}s -> out/dataset.json`);
  console.log(`[scrape] imágenes: ${JSON.stringify({ ...imageStats, failed: imageStats.failed.length })}`);
  if (imageStats.failed.length) {
    console.log(`[scrape] fallos de imagen (muestra): ${imageStats.failed.slice(0, 10).join(', ')}`);
  }
  const missing = dataset.filter((item) => !item.source.hasDetail).map((item) => `${item.dexNumber}:${item.name}`);
  console.log(`[scrape] cartas sin ficha de detalle: ${missing.length}`);
  await fs.writeFile(path.join(OUT, 'missing-details.json'), JSON.stringify(missing, null, 1));
}

main().catch((error) => {
  console.error('[scrape] ERROR', error);
  process.exit(1);
});
