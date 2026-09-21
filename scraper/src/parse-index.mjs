/**
 * Parser del index de VTuberDex (la "pokédex" plana).
 *
 * El index es HTML estático: `<div class="vtuber-card cardN" data-pais data-group
 * data-artist>` con una imagen `fichas/vtuberN.jpg`, un `<h2>` y, a veces, un
 * enlace a la ficha de detalle. No hay paginación ni buscador real.
 */
import * as cheerio from 'cheerio';

import { parseCountries, parseDexNumber, splitList } from './normalize.mjs';

const NUMBER_IN_ALT = /VTuber\s+(\d+)/i;

/**
 * @param {string} html documento del index
 * @returns {Array<object>} una entrada por carta, con el enlace de detalle si existe
 */
export function parseIndex(html) {
  const $ = cheerio.load(html);
  const entries = [];

  $('.vtuber-card').each((_, element) => {
    const card = $(element);
    const classes = card.attr('class') ?? '';
    const cardClass = classes.split(/\s+/).find((name) => /^card\d+$/.test(name)) ?? null;
    const image = card.find('img').first();
    const imageSrc = image.attr('src')?.trim() ?? null;
    const alt = image.attr('alt')?.trim() ?? '';
    const name = card.find('h2').first().text().replace(/\s+/g, ' ').trim();
    const href = card.find('a[href]').first().attr('href')?.trim() ?? null;
    const detailSlug = href && /\.html$/i.test(href) ? href.replace(/\.html$/i, '').trim() : null;

    const dexNumber = parseDexNumber(
      cardClass,
      imageSrc,
      alt.match(NUMBER_IN_ALT)?.[1],
      alt,
    );

    const countries = parseCountries(card.attr('data-pais'));

    entries.push({
      dexNumber,
      name,
      imageSrc,
      detailSlug,
      countries,
      groups: splitList(card.attr('data-group')),
      artists: splitList(card.attr('data-artist')),
      cardClass,
      alt,
    });
  });

  return entries;
}
