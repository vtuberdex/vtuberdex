/**
 * La matemática de las máscaras, sin DOM: recorre píxeles RGBA y escribe píxeles RGBA.
 *
 * POR QUÉ ESTÁ APARTE DE `mascaras.ts`: estos dos bucles recorren el lienzo completo de
 * cada carta (a 512 px, 367.000 píxeles por máscara, dos máscaras por carta, ocho cartas
 * por página) y eran la parte del trabajo que se podía sacar del hilo principal. Un Web
 * Worker no tiene `document` ni canvas 2D, pero sí `Uint8ClampedArray`: aquí vive lo que
 * el worker (`mascaras.worker.ts`) y el camino síncrono de respaldo ejecutan por igual,
 * así que no hay dos implementaciones que puedan divergir y el test las cubre a las dos.
 */

/**
 * Máscara de TINTA y PIEL del arte: lineart oscuro a 1, piel a `skinWeight`, el resto 0.
 * El alfa de salida es el del arte, así que la máscara no existe fuera de la silueta.
 */
export function mascaraTintaYPiel(a: Uint8ClampedArray, o: Uint8ClampedArray): void {
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
}

/** Máscara de COBERTURA: blanco opaco donde el alfa de origen supera el umbral, negro opaco si no. */
export function mascaraCobertura(a: Uint8ClampedArray, o: Uint8ClampedArray): void {
  for (let i = 0; i < a.length; i += 4) {
    const cubierto = a[i + 3] > 24 ? 255 : 0;
    o[i] = cubierto;
    o[i + 1] = cubierto;
    o[i + 2] = cubierto;
    o[i + 3] = 255;
  }
}

export type TipoMascara = 'tinta' | 'cobertura';

export function calcularMascara(tipo: TipoMascara, a: Uint8ClampedArray, o: Uint8ClampedArray): void {
  if (tipo === 'tinta') mascaraTintaYPiel(a, o);
  else mascaraCobertura(a, o);
}
