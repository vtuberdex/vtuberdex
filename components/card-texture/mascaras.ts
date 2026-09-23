/**
 * Máscaras calculadas en CPU y enviadas como texturas propias al shader.
 */
import { CARD_TEXTURE_WIDTH } from './dimensiones';

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
