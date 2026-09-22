'use client';
/**
 * Generación de texturas en 7 capas separadas con paralaje propio.
 *
 * El usuario pidió un refactor de capas: 0=fondo 10% más grande, 1=personaje,
 * 2=logo, 3=título, 4=textos, 5=tags, 6=wordmark VTUBERDEX.
 * La estrategia es generar un canvas INDEPENDIENTE por capa, y el shader
 * las mezcla. Así cada capa tiene su propio factor de paralaje.
 *
 * En este paso se deja TODO el texto PLANO (sin metal, sin sombras, sin
 * agujeros en el fondo). Después se añadirán efectos capa por capa de forma
 * limpia.
 */
import type { VtuberCard } from '@/lib/types';
import { cardPalette, mixHex, rgba } from '@/lib/color';

export const CARD_TEXTURE_WIDTH = 1008;
export const CARD_TEXTURE_HEIGHT = 1411;
export const CARD_TEXTURE_TILE_WIDTH = 512;
export const CARD_TEXTURE_FULL_WIDTH = CARD_TEXTURE_WIDTH;

const FONT = '"Chakra Petch", "Rajdhani", system-ui, sans-serif';

/** Datos de la tarjeta que el shader necesita para posicionar capas. */
export interface CardDrawInfo {
  card: VtuberCard;
  art: HTMLImageElement | null;
  logo: HTMLImageElement | null;
  /** Background subido o null. */
  background: HTMLImageElement | null;
  /** Ancho del lienzo. */
  width?: number;
}

/** Las 7 capas que se generan. */
export interface CardLayers {
  /** 0: background o fondo (escalado 10% extra). */
  background: HTMLCanvasElement;
  /** 1: personaje. */
  character: HTMLCanvasElement;
  /** 2: logo. */
  logo: HTMLCanvasElement;
  /** 3: título (cabecera + nombre + país). */
  title: HTMLCanvasElement;
  /** 4: textos (chips de estado, frase, pie). */
  texts: HTMLCanvasElement;
  /** 5: tags/facciones/grupos + barra de stats. */
  tags: HTMLCanvasElement;
  /** 6: wordmark VTUBERDEX. */
  wordmark: HTMLCanvasElement;
  /** Info medida durante el dibujo. */
  info: {
    W: number;
    H: number;
    headerTop: number;
    headerH: number;
    headerBottom: number;
    pad: number;
    logoBox: { x: number; y: number; w: number; h: number } | null;
    typesTop: number;
    typesRight: number;
    phraseBottom: number;
    stateChipsEnd: number;
    barY: number;
  };
}

/** Crea un canvas con el tamaño destino y escala canónica. */
function createLayer(width: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; scale: number; W: number; H: number } {
  const scale = width / CARD_TEXTURE_WIDTH;
  const H = Math.round(width * (CARD_TEXTURE_HEIGHT / CARD_TEXTURE_WIDTH));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(scale, scale);
    ctx.save();
  }
  return { canvas, ctx, scale, W: CARD_TEXTURE_WIDTH, H: CARD_TEXTURE_HEIGHT };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startSize: number, weight = '700'): number {
  let size = startSize;
  do {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  } while (size > 16);
  return size;
}

/** Capa 0: background/fondo. Si no existe background, se deja transparente. */
export function drawBackgroundLayer({ background, width }: { background: HTMLImageElement | null; width: number }): HTMLCanvasElement {
  const { canvas, ctx, W, H } = createLayer(width);
  if (!ctx) return canvas;
  if (background) {
    // +10% para paralaje: escala por el lado más pequeño que cubra todo el canvas.
    const cover = 1.10;
    const scaleToWidth = (W * cover) / background.width;
    const scaleToHeight = (H * cover) / background.height;
    const s = Math.max(scaleToWidth, scaleToHeight);
    const dw = background.width * s;
    const dh = background.height * s;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    ctx.drawImage(background, dx, dy, dw, dh);
  }
  // Si no hay background, el canvas queda transparente y el shader mostrará
  // el degradado/fondo que tenga por debajo de esta capa.
  return canvas;
}

/** Capa 1: personaje, transparente, solo el arte con su alfa. */
export function drawCharacterLayer({ art, width }: { art: HTMLImageElement | null; width: number }): HTMLCanvasElement {
  const { canvas, ctx, W, H } = createLayer(width);
  if (!ctx) return canvas;
  if (art) {
    const scaleToHeight = H / art.height;
    const dw = art.width * scaleToHeight;
    const dx = (W - dw) / 2;
    ctx.drawImage(art, dx, 0, dw, H);
  } else {
    ctx.font = `700 44px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    ctx.fillText('SIN IMAGEN', W / 2, H / 2);
  }
  return canvas;
}

/** Capa 2: logo en su caja. */
export function drawLogoLayer({ logo, box, width }: { logo: HTMLImageElement | null; box: { x: number; y: number; w: number; h: number } | null; width: number }): HTMLCanvasElement {
  const { canvas, ctx } = createLayer(width);
  if (!ctx) return canvas;
  if (logo && box) {
    const scale = width / CARD_TEXTURE_WIDTH;
    ctx.scale(scale, scale);
    ctx.drawImage(logo, box.x, box.y, box.w, box.h);
  }
  return canvas;
}

/** Capa 3: título — cabecera, número de dex, nombre y país. TEXTO PLANO. */
export function drawTitleLayer({ card, width }: { card: VtuberCard; width: number }): HTMLCanvasElement {
  const { canvas, ctx, W, H } = createLayer(width);
  if (!ctx) return canvas;
  const pad = 46;
  const headerTop = 44;
  const headerH = 116;
  const headerW = W - pad * 2;
  const headerRadius = 22;

  // Placa translúcida del color de marca (sin metal por ahora).
  const { accent, secondary } = cardPalette(card.themeColor, card.secondaryColor);
  const plate = ctx.createLinearGradient(0, headerTop, 0, headerTop + headerH);
  plate.addColorStop(0, rgba(accent, 0.95));
  plate.addColorStop(1, rgba(secondary, 0.75));
  ctx.fillStyle = plate;
  roundRect(ctx, pad, headerTop, headerW, headerH, headerRadius);
  ctx.fill();

  // Número de dex.
  const badge = `#${String(card.dexNumber).padStart(3, '0')}`;
  const badgeX = pad + 16;
  const badgeY = headerTop + 21;
  const badgeW = 168;
  const badgeH = 74;
  const badgeRadius = 16;
  ctx.fillStyle = rgba('#0a0c11', 0.55);
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeRadius);
  ctx.fill();

  ctx.font = `800 44px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8ecf5';
  ctx.fillText(badge, pad + 100, headerTop + 59);

  // Nombre.
  const primary = card.countries[0];
  const countryLabel = primary ? `${primary.flag ?? ''} ${primary.name}`.trim() : '';
  ctx.font = `600 34px ${FONT}`;
  const countryWidth = countryLabel ? ctx.measureText(countryLabel).width + 28 : 0;
  const nameMax = W - pad * 2 - 232 - countryWidth;
  ctx.textAlign = 'left';
  const nameSize = fitText(ctx, card.name.toUpperCase(), nameMax, 58, '800');
  ctx.font = `800 ${nameSize}px ${FONT}`;
  ctx.fillStyle = '#0a0c11';
  ctx.fillText(card.name.toUpperCase(), pad + 212, headerTop + 59);

  // País.
  if (primary) {
    ctx.textAlign = 'right';
    ctx.font = `600 34px ${FONT}`;
    ctx.fillStyle = rgba('#05060a', 0.78);
    ctx.fillText(countryLabel, W - pad - 18, headerTop + 59);
  }

  return canvas;
}

/** Capa 4: textos — chips de estado, frase, pie. TEXTO PLANO. */
export function drawTextsLayer({ card, width, info }: { card: VtuberCard; width: number; info: CardLayers['info'] }): HTMLCanvasElement {
  const { canvas, ctx, W, H } = createLayer(width);
  if (!ctx) return canvas;
  const pad = info.pad;
  const stateY = info.headerTop + info.headerH + 34;

  ctx.textBaseline = 'middle';

  // Chips de estado.
  const stateChips = [
    card.level !== null ? `NIV ${card.level}` : null,
    card.powerScore ? `PODER ${card.powerScore}` : null,
    card.hasDetail ? 'FICHA COMPLETA' : 'SOLO FICHA BÁSICA',
  ].filter(Boolean) as string[];
  let stateX = pad;
  ctx.font = `700 24px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8ecf5';
  for (const chip of stateChips) {
    const chipW = ctx.measureText(chip).width + 30;
    ctx.fillText(chip, stateX + 15, stateY + 22);
    stateX += chipW + 10;
  }

  // Frase.
  const textWidth = W - pad * 2;
  const phrase = (card.phrase ?? '').replace(/\s+/g, ' ').trim();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 32px ${FONT}`;
  ctx.fillStyle = '#e8ecf5';
  const lineHeight = 42;
  const maxPhraseLines = Math.max(1, Math.floor((info.phraseBottom - info.typesTop + 22) / lineHeight));
  const phraseBottomLimit = info.phraseBottom;
  if (phrase) {
    const words = phrase.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > textWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    const visible = lines.slice(0, Math.max(1, maxPhraseLines));
    if (lines.length > visible.length) visible[visible.length - 1] = `${visible[visible.length - 1]}…`;
    const total = visible.length;
    let y = phraseBottomLimit - (total - 1) * lineHeight;
    for (const line of visible) {
      ctx.fillText(line, pad, y);
      y += lineHeight;
    }
  } else {
    ctx.fillStyle = 'rgba(232,236,245,0.5)';
    ctx.fillText('Sin presentación registrada', pad, phraseBottomLimit);
  }

  // Pie: redes.
  ctx.font = `600 26px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(232,236,245,0.68)';
  const socialCount = card.socialCount ?? 0;
  ctx.fillText(socialCount > 0 ? `${socialCount} redes enlazadas` : 'Sin redes enlazadas', pad, H - 86);

  // País en pie.
  ctx.textAlign = 'right';
  ctx.font = `500 22px ${FONT}`;
  ctx.fillStyle = 'rgba(232,236,245,0.5)';
  ctx.fillText(card.countries[0] ? card.countries[0].name : 'Sin país', W - pad, H - 54);

  return canvas;
}

/** Capa 5: tags / facciones / grupos + barra de stats. TEXTO PLANO. */
export function drawTagsLayer({ card, width, info }: { card: VtuberCard; width: number; info: CardLayers['info'] }): HTMLCanvasElement {
  const { canvas, ctx, W } = createLayer(width);
  if (!ctx) return canvas;
  const { accent, secondary } = cardPalette(card.themeColor, card.secondaryColor);
  const pad = info.pad;
  const typesList = [...card.factions, ...card.groups].slice(0, 4);

  // Barra de stats.
  const barY = info.barY;
  const barH = 16;
  const segments = card.statsPreview ?? [];
  let bx = pad;
  const barW = W - pad * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, pad, barY, barW, barH, 8);
  ctx.fill();
  const palette = [accent, secondary, mixHex(accent, '#ffffff', 0.4), mixHex(secondary, '#ffffff', 0.3)];
  const total = segments.reduce((sum, value) => sum + value, 0) || 1;
  segments.forEach((value, index) => {
    const w = (value / total) * barW;
    ctx.fillStyle = palette[index % palette.length];
    roundRect(ctx, bx, barY, Math.max(w - 4, 6), barH, 8);
    ctx.fill();
    bx += w;
  });

  // Chips de tipos.
  if (typesList.length > 0) {
    const chipFont = `700 24px ${FONT}`;
    const rowHeight = 54;
    const chipRows: string[][] = [];
    ctx.save();
    ctx.font = chipFont;
    for (const type of typesList) {
      const label = type.toUpperCase().slice(0, 22);
      const tw = ctx.measureText(label).width + 32;
      const row = chipRows[chipRows.length - 1];
      const used = row ? row.reduce((sum, item) => sum + ctx.measureText(item).width + 32 + 12, 0) : 0;
      if (row && used + tw <= W - pad * 2) row.push(label);
      else chipRows.push([label]);
    }
    ctx.restore();

    let ty = info.typesTop;
    for (const row of chipRows) {
      let tx = pad;
      ctx.font = chipFont;
      ctx.textBaseline = 'middle';
      for (const label of row) {
        const tw = ctx.measureText(label).width + 32;
        const typeGradient = ctx.createLinearGradient(tx, 0, tx + tw, 0);
        typeGradient.addColorStop(0, rgba(accent, 0.92));
        typeGradient.addColorStop(1, rgba(secondary, 0.85));
        ctx.fillStyle = typeGradient;
        roundRect(ctx, tx, ty, tw, 42, 21);
        ctx.fill();
        ctx.fillStyle = '#080a10';
        ctx.fillText(label, tx + 16, ty + 23);
        tx += tw + 12;
      }
      ty += rowHeight;
    }
  }

  return canvas;
}

/** Capa 6: wordmark VTUBERDEX. TEXTO PLANO. */
export function drawWordmarkLayer({ card, width }: { card: VtuberCard; width: number }): HTMLCanvasElement {
  const { canvas, ctx, W, H } = createLayer(width);
  if (!ctx) return canvas;
  const pad = 46;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 28px ${FONT}`;
  ctx.fillStyle = '#e8ecf5';
  ctx.fillText('VTUBERDEX', W - pad, H - 86);
  return canvas;
}

/** Genera todas las capas y la información de layout medida. */
export function drawCardLayers({ card, art, logo, background, width = CARD_TEXTURE_WIDTH }: CardDrawInfo): CardLayers {
  const scale = width / CARD_TEXTURE_WIDTH;
  const W = CARD_TEXTURE_WIDTH;
  const H = CARD_TEXTURE_HEIGHT;
  const pad = 46;
  const headerTop = 44;
  const headerH = 116;
  const headerBottom = headerTop + headerH;
  const barY = H - 140;

  // Pre-medir logo.
  let logoBox: { x: number; y: number; w: number; h: number } | null = null;
  const LOGO_AREA = W * H * 0.049;
  const logosBase = H - 140 - 22;
  const typesList = [...card.factions, ...card.groups].slice(0, 4);
  const chipFont = `700 24px ${FONT}`;
  const chipRows: string[][] = [];
  if (typeof document !== 'undefined') {
    const probe = document.createElement('canvas').getContext('2d');
    if (probe) {
      probe.font = chipFont;
      for (const type of typesList) {
        const label = type.toUpperCase().slice(0, 22);
        const tw = probe.measureText(label).width + 32;
        const row = chipRows[chipRows.length - 1];
        const used = row ? row.reduce((sum, item) => sum + probe.measureText(item).width + 32 + 12, 0) : 0;
        if (row && used + tw <= W - pad * 2) row.push(label);
        else chipRows.push([label]);
      }
    }
  }
  const rowHeight = 54;
  const typesHeight = chipRows.length * rowHeight + 12;
  const typesTop = barY - 22 - typesHeight;

  if (logo) {
    const scaleLogo = Math.sqrt(LOGO_AREA / (logo.width * logo.height));
    const dw = logo.width * scaleLogo;
    const dh = logo.height * scaleLogo;
    const lx = W - pad - dw;
    const ly = logosBase - typesHeight - dh - 70;
    logoBox = { x: lx, y: ly, w: dw, h: dh };
  }

  // Límite inferior de la frase.
  const phraseBottomLimit = barY - 22 - typesHeight - 26;

  // Extremo de los chips de estado (se necesita para posicionar otras capas).
  const stateChips = [
    card.level !== null ? `NIV ${card.level}` : null,
    card.powerScore ? `PODER ${card.powerScore}` : null,
    card.hasDetail ? 'FICHA COMPLETA' : 'SOLO FICHA BÁSICA',
  ].filter(Boolean) as string[];
  let stateX = pad;
  if (typeof document !== 'undefined' && stateChips.length > 0) {
    const probe = document.createElement('canvas').getContext('2d');
    if (probe) {
      probe.font = `700 24px ${FONT}`;
      for (const chip of stateChips) {
        const chipW = probe.measureText(chip).width + 30;
        stateX += chipW + 10;
      }
      stateX -= 10;
    }
  }

  const info: CardLayers['info'] = {
    W,
    H,
    headerTop,
    headerH,
    headerBottom,
    pad,
    logoBox,
    typesTop,
    typesRight: pad,
    phraseBottom: phraseBottomLimit,
    stateChipsEnd: stateChips.length > 0 ? stateX : pad,
    barY,
  };

  return {
    background: drawBackgroundLayer({ background, width }),
    character: drawCharacterLayer({ art, width }),
    logo: drawLogoLayer({ logo, box: logoBox, width }),
    title: drawTitleLayer({ card, width }),
    texts: drawTextsLayer({ card, width, info }),
    tags: drawTagsLayer({ card, width, info }),
    wordmark: drawWordmarkLayer({ card, width }),
    info,
  };
}

/** Back-compat: una textura "flat" con todo mezclado para usos que aún no migran. */
export function drawCardFront(input: CardDrawInfo): HTMLCanvasElement {
  const width = input.width ?? CARD_TEXTURE_WIDTH;
  const { canvas, ctx, W, H } = createLayer(width);
  if (!ctx) return canvas;
  const layers = drawCardLayers({ ...input, width });
  ctx.drawImage(layers.background, 0, 0, W, H);
  ctx.drawImage(layers.character, 0, 0, W, H);
  ctx.drawImage(layers.logo, 0, 0, W, H);
  ctx.drawImage(layers.title, 0, 0, W, H);
  ctx.drawImage(layers.texts, 0, 0, W, H);
  ctx.drawImage(layers.tags, 0, 0, W, H);
  ctx.drawImage(layers.wordmark, 0, 0, W, H);
  return canvas;
}

export function canvasToTextureSource(canvas: HTMLCanvasElement): HTMLCanvasElement {
  return canvas;
}

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/*
 * NOTA: aquí vivía `characterAlphaMask()`, que calculaba en CPU la silueta del
 * personaje para el fondo subido. Se eliminó junto con el sampler `uBackgroundMask`:
 * con las 7 capas separadas, el alfa de la capa del personaje (uLayer1.a) ES esa
 * silueta, así que la máscara era trabajo duplicado —y un sampler de más, que fue
 * justo lo que reventó el límite de 16 del driver.
 */

export function inkAndSkinMask(art: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const artCanvas = document.createElement('canvas');
  artCanvas.width = width;
  artCanvas.height = height;
  const artCtx = artCanvas.getContext('2d');
  if (!artCtx) return canvas;
  artCtx.drawImage(art, 0, 0, width, height);

  const src = artCtx.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);
  const a = src.data;
  const o = out.data;

  for (let i = 0; i < a.length; i += 4) {
    const alpha = a[i + 3];
    if (alpha < 8) continue;
    const r = a[i];
    const g = a[i + 1];
    const b = a[i + 2];

    const maxCh = Math.max(r, g, b);
    const minCh = Math.min(r, g, b);
    const ink = maxCh < 92 ? 1 - maxCh / 92 : 0;

    const esCalido = r > g && g >= b && r - b > 12 && r - b < 120;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = maxCh === 0 ? 0 : (maxCh - minCh) / maxCh;
    const piel = esCalido && lum > 70 && lum < 250 && sat < 0.62 ? 1 : 0;
    const skinWeight = 0.55;

    const intensidad = Math.max(ink, piel * skinWeight);
    if (intensidad <= 0) continue;

    const v = Math.round(Math.min(255, intensidad * 255));
    o[i] = v;
    o[i + 1] = v;
    o[i + 2] = v;
    o[i + 3] = alpha;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

export function logoMask(logo: CanvasImageSource, box: { x: number; y: number; w: number; h: number }, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const scale = width / CARD_TEXTURE_WIDTH;
  ctx.scale(scale, scale);
  const tmp = document.createElement('canvas');
  tmp.width = width;
  tmp.height = height;
  const tmpCtx = tmp.getContext('2d');
  if (!tmpCtx) return canvas;
  tmpCtx.scale(scale, scale);
  tmpCtx.drawImage(logo, box.x, box.y, box.w, box.h);

  const src = tmpCtx.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);
  const a = src.data;
  const o = out.data;
  for (let i = 0; i < a.length; i += 4) {
    const cubierto = a[i + 3] > 24 ? 255 : 0;
    o[i] = cubierto;
    o[i + 1] = cubierto;
    o[i + 2] = cubierto;
    o[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

export function logoSticker(logo: CanvasImageSource, box: { x: number; y: number; w: number; h: number }, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(width / CARD_TEXTURE_WIDTH, width / CARD_TEXTURE_WIDTH);
  ctx.drawImage(logo, box.x, box.y, box.w, box.h);
  return canvas;
}

export function backlightGlow(color: string, size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, rgba(color, 0.85));
  gradient.addColorStop(0.35, rgba(color, 0.4));
  gradient.addColorStop(0.68, rgba(color, 0.12));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
