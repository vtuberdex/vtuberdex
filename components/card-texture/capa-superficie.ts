/**
 * CAPA 0 — LA SUPERFICIE DE LA CARTA (no una capa sobre ella).
 *
 * POR QUÉ SE LLAMA "SUPERFICIE" Y NO "FONDO" (cambio de arquitectura)
 * ------------------------------------------------------------------
 * Antes esto se llamaba `drawBackgroundLayer` y dibujaba una imagen OPCIONAL que luego se
 * componía encima de un degradado que vivía en el shader. Con un fondo subido el resultado
 * tenía tres problemas, todos vistos en pantalla:
 *
 *   1. El arte del fondo se leía como una imagen PEGADA: el shader la mezclaba con
 *      `mix(base, layer0.rgb, layer0.a)` y por encima había una cobertura calculada
 *      (`bgCover`) que reemplazaba los dos canales. La imagen no era la superficie, era un
 *      pegote encima de ella.
 *   2. El degradado del color de tema seguía por debajo en el shader, así que el arte no
 *      llegaba nunca a ser el material de la carta: era una ventana sobre otro material.
 *   3. Sin imagen subida, la carta SÍ tenía degradado, pero con imagen el acabado lo
 *      aportaba otra cosa — de ahí que la textura del fondo y la del resto no cuadraran.
 *
 * Ahora este canvas ES la carta: se pinta el degradado del color de tema y, si hay imagen,
 * se encaja ENCIMA y a sangre. El canvas sale SIEMPRE opaco, así que el shader no necesita
 * cobertura ni composición: la capa 0 es el sustrato y el personaje y la UI se imprimen
 * sobre él. Eso es lo que hace que el fondo sea la textura del mesh.
 */
import { BACKGROUND } from '../card3d-config';
import { cardPalette, mixHex } from '@/lib/color';
import type { VtuberCard } from '@/lib/types';
import { createLayer } from './lienzo';

/** Color profundo del degradado de tema; el mismo que usaba el shader. */
const DEEP = '#080a10';
/** Peso del acento en la mezcla del degradado (el shader usaba 0.55). */
const ACCENT_MIX = 0.55;

/**
 * Capa 0: la superficie de la carta. Opaque por construcción.
 *
 * El degradado se construye con DOS paradas lineales en Y porque así el resultado es
 * idéntico al que calculaba el shader píxel a píxel: allí era
 * `mix(secondary, mix(accent, DEEP, vUv.y), 0.55)`, y la mezcla de mezclas es LINEAL en
 * `vUv.y`, así que una interpolación de dos paradas la reproduce exactamente.
 */
export function drawSurfaceLayer({ card, background, width }: { card: VtuberCard; background: HTMLImageElement | null; width: number }): HTMLCanvasElement {
  const { canvas, ctx, W, H } = createLayer(width);
  if (!ctx) return canvas;

  const { accent, secondary } = cardPalette(card.themeColor, card.secondaryColor);
  const gradiente = ctx.createLinearGradient(0, 0, 0, H);
  gradiente.addColorStop(0, mixHex(secondary, accent, ACCENT_MIX));
  gradiente.addColorStop(1, mixHex(secondary, DEEP, ACCENT_MIX));
  ctx.fillStyle = gradiente;
  ctx.fillRect(0, 0, W, H);

  if (background) {
    /**
     * ENCUADRE del arte de la superficie.
     *
     * ESCALA: 1.10 daba el margen justo para el paralaje y el usuario pidió el fondo un 10%
     * MÁS GRANDE: 1.10 * 1.10 = 1.21. El encuadre se calcula por el lado más pequeño que
     * cubre el canvas, así que subirlo recorta más la imagen y el arte llena la carta con
     * menos borde visible.
     *
     * A SANGRE: la imagen cubre el lienzo entero, sin dejar marco. Antes esto no importaba
     * porque el degradado del shader se veía por debajo; ahora el arte ES la carta, y
     * cualquier hueco dejaría ver el degradado como un borde.
     */
    const cover = BACKGROUND.cover;
    const s = Math.max((W * cover) / background.width, (H * cover) / background.height);
    const dw = background.width * s;
    const dh = background.height * s;
    ctx.drawImage(background, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  return canvas;
}
