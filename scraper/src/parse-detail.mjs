/**
 * Parser de las fichas de detalle (`/NombreSlug`).
 *
 * Cada ficha es una "terminal" con 3 paneles: Perfil/Presentación, Stats y
 * Skills. Las páginas son plantillas copiadas a mano, así que la estructura
 * varía (faltan facciones, faltan stats, el avatar viene en base64...). El
 * parser es defensivo: devuelve lo que exista y nunca lanza por un campo
 * ausente.
 */
import * as cheerio from 'cheerio';

/** Texto plano conservando saltos de línea de los `<br>`. */
function textWithBreaks($, element) {
  const clone = $(element).clone();
  clone.find('br').replaceWith('\n');
  return clone
    .text()
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toNumber(value) {
  const match = String(value ?? '').replace(/\./g, '').match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

/** Nombre de plataforma a partir del icono (`icons/twitch.png` -> twitch). */
function platformFromIcon(src) {
  const file = String(src ?? '').split('/').pop() ?? '';
  return file.replace(/\.[a-z0-9]+$/i, '').toLowerCase() || 'web';
}

export function parseDetail(html) {
  const $ = cheerio.load(html, { decodeEntities: true });

  // --- Tema de color declarado en el propio script de la ficha ---------------
  const scriptText = $('script')
    .map((_, el) => $(el).html() ?? '')
    .get()
    .join('\n');
  const themeMatch = scriptText.match(/const\s+THEME\s*=\s*["']([^"']+)["']/);
  const theme = themeMatch ? themeMatch[1].trim() : null;

  // --- Logo y frase ---------------------------------------------------------
  const logo = $('#mainLogo').attr('src')?.trim() ?? null;
  const phraseHtml = $('#vtuber-phrase').html() ?? '';
  const phrase = textWithBreaks($, '#vtuber-phrase');

  // --- Redes sociales -------------------------------------------------------
  const socials = [];
  $('.socials a[href]').each((_, el) => {
    const anchor = $(el);
    const url = anchor.attr('href')?.trim();
    if (!url) return;
    const icon = anchor.find('img').attr('src')?.trim() ?? null;
    socials.push({
      platform: platformFromIcon(icon),
      label: anchor.find('img').attr('alt')?.trim() || platformFromIcon(icon),
      url,
      icon,
    });
  });

  // --- Ficha personal -------------------------------------------------------
  const profile = [];
  $('.ficha .dato, .ficha .pais').each((_, el) => {
    const row = $(el);
    const label = row.find('.titulo').text().replace(/\s+/g, ' ').replace(/[:：]\s*$/, '').trim();
    const value = textWithBreaks($, row.find('.contenido'));
    if (label && value) profile.push({ label, value });
  });
  const birthday = profile.find((row) => /cumplea/i.test(row.label))?.value ?? null;
  const height = profile.find((row) => /altura/i.test(row.label))?.value ?? null;
  const hashtag = profile.find((row) => /hashtag/i.test(row.label))?.value ?? null;
  const favoriteColor = profile.find((row) => /color fav/i.test(row.label))?.value ?? null;

  // --- Facciones ------------------------------------------------------------
  const factions = [];
  $('.tabla-facciones thead th').each((_, el) => {
    const name = $(el).text().replace(/\s+/g, ' ').trim();
    if (name) factions.push(name);
  });
  const looksLikeFilename = (value) => value.includes('%') || /\.(png|jpe?g|webp|gif)$/i.test(value);
  $('img[src*="facciones"]').each((_, el) => {
    const alt = $(el).attr('alt')?.trim();
    if (!alt || looksLikeFilename(alt)) return;
    if (!factions.some((name) => name.toLowerCase() === alt.toLowerCase())) factions.push(alt);
  });

  // --- Stats ----------------------------------------------------------------
  const stats = {};
  $('.stats-table tr').each((_, el) => {
    const row = $(el);
    const label = row.find('.stat-col').text().replace(/\s+/g, ' ').replace(/[:：]\s*$/, '').trim();
    if (!label) return;
    const cell = row.find('.valor-col');
    if (cell.find('.stat-bar-wrapper').length > 0 || cell.attr('data-max')) {
      stats[label] = {
        current: toNumber(cell.attr('data-current') ?? cell.find('.stat-value').text()),
        max: toNumber(cell.attr('data-max')),
      };
      return;
    }
    const value = cell.text().replace(/\s+/g, ' ').trim();
    if (value) stats[label] = toNumber(value) ?? value;
  });

  const expText = $('#expText').text().trim();
  const expMatch = expText.match(/([\d.,]+)\s*\/\s*([\d.,]+)/);
  const level = toNumber($('#nivel').text());
  const experience = expMatch
    ? { current: toNumber(expMatch[1]), max: toNumber(expMatch[2]) }
    : null;

  // --- Radar ----------------------------------------------------------------
  const radar = $('.radar-image-wrap img').attr('src')?.trim() ?? null;

  // --- Galería (avatarImages declarado en JS) -------------------------------
  const gallery = [];
  const galleryMatch = scriptText.match(/const\s+avatarImages\s*=\s*\[([\s\S]*?)\];/);
  if (galleryMatch) {
    const entryRe = /src:\s*["']([^"']+)["']\s*,\s*caption:\s*["']([^"']*)["']/g;
    let match;
    while ((match = entryRe.exec(galleryMatch[1])) !== null) {
      gallery.push({ src: match[1].trim(), caption: match[2].trim() || null, isInline: false });
    }
  }
  const inlineAvatar = $('#avatarMain').attr('src')?.trim() ?? null;
  if (gallery.length === 0 && inlineAvatar) {
    gallery.push({
      src: inlineAvatar,
      caption: 'Pose principal',
      isInline: inlineAvatar.startsWith('data:'),
    });
  }
  // Solo se guarda el CONTEO de imágenes embebidas; el scraper descarta el
  // base64 antes de persistir (infla el dataset sin aportar información).
  const inlineThumbCount = $('img[src^="data:image"]').length;

  // --- Skills ---------------------------------------------------------------
  const skills = [];
  $('.skills-section .table-wrap').each((_, wrap) => {
    const section = $(wrap).find('h2.section-title').first().text().replace(/\s+/g, ' ').trim();
    const category = /active/i.test(section)
      ? 'active'
      : /passive/i.test(section)
        ? 'passive'
        : /ultimate/i.test(section)
          ? 'ultimate'
          : (section || 'other').toLowerCase();

    $(wrap)
      .find('table tbody tr')
      .each((index, row) => {
        const cells = $(row).find('td');
        if (cells.length < 3) return;
        const factionIcons = cells
          .eq(0)
          .find('img')
          .map((__, img) => ({
            src: $(img).attr('src')?.trim() ?? null,
            name: $(img).attr('alt')?.trim() || null,
          }))
          .get();
        const withText = factionIcons.length === 0;
        const offset = withText ? 0 : 1;
        const type = cells.eq(offset).text().replace(/\s+/g, ' ').trim();
        const name = cells.eq(offset + 1).text().replace(/\s+/g, ' ').trim();
        const effectNode = cells.eq(offset + 2);
        const effectHtml = (effectNode.html() ?? '').trim();
        const effect = textWithBreaks($, effectNode);
        if (!name && !effect) return;
        skills.push({
          category,
          section: section || null,
          type: type || null,
          name: name || null,
          effect,
          effectHtml,
          factions: factionIcons,
          position: index,
        });
      });
  });

  // --- Nivel de riqueza de la ficha ----------------------------------------
  const sections = $('.panel-header')
    .map((_, el) => $(el).text().trim())
    .get();

  return {
    theme,
    logo,
    phrase,
    phraseHtml: phraseHtml.trim() || null,
    socials,
    profile,
    birthday,
    height,
    hashtag,
    favoriteColor,
    factions,
    stats,
    level,
    experience,
    radar,
    gallery,
    inlineThumbCount,
    skills,
    sections,
    hasSkills: skills.length > 0,
  };
}
