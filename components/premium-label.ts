/**
 * La HOJA INTERIOR de la placa premium, dibujada en un lienzo 2D: el marco con la ventana donde va
 * la carta y la ETIQUETA con el nombre, el certificado y la nota (como la de una carta de CGC).
 *
 * POR QUÉ UN LIENZO Y NO GEOMETRÍA
 * --------------------------------
 * La etiqueta es texto, líneas y un código de barras: en 3D serían cientos de triángulos y una
 * fuente por cargar; en un lienzo son unas decenas de llamadas 2D que se pagan UNA vez por carta
 * premium y viajan a la GPU como una sola textura. La carta holográfica NO está aquí: va delante,
 * como malla propia, a través de la ventana.
 *
 * Sin contexto 2D (los tests de jsdom lo anulan a propósito) se devuelve el lienzo en blanco en
 * vez de fallar: la placa se ve sin rótulo, que es mejor que romper la carta entera.
 */
import { DETERIORO, PREMIUM } from '@/components/card3d-config';
import type { SlabLayout } from '@/components/premium-layout';
import { corromperTexto, semillaDeCarta } from '@/lib/degradado';
import { esBlackLabel, esGradoDegradado, nombreDeGrado, notaVisible, severidadDeGrado, textoDeRacha } from '@/lib/premium';
import type { PremiumInfo } from '@/lib/types';

/** Lo que la etiqueta necesita saber de la carta. */
export interface DatosDeEtiqueta {
  name: string;
  dexNumber: number;
  country: string | null;
  premium: PremiumInfo;
}

const FUENTE = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';

/**
 * Tamaño de fuente (px) con el que `texto` cabe en `ancho`: parte de `tamano` y baja de a 1 px
 * hasta `minimo`. `medir(px)` devuelve lo que mide el texto a ese tamaño. Pura: se prueba sin lienzo.
 */
export function ajustarFuente(medir: (px: number) => number, ancho: number, tamano: number, minimo = 8): number {
  let px = tamano;
  while (px > minimo && medir(px) > ancho) px -= 1;
  return px;
}

/**
 * Anchos de las barras del código de barras, derivados del certificado: la misma carta lleva
 * siempre las mismas barras. Alterna barra y hueco; cada cifra aporta una barra de 1 a 3 unidades.
 */
export function barrasDeCertificado(cert: string): number[] {
  const barras: number[] = [];
  for (const caracter of cert.replace(/\D/g, '').padStart(6, '0')) {
    const cifra = Number(caracter);
    barras.push(1 + (cifra % 3), 1 + ((cifra * 7) % 2));
  }
  return barras;
}

function rectanguloRedondeado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radio = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radio, y);
  ctx.arcTo(x + w, y, x + w, y + h, radio);
  ctx.arcTo(x + w, y + h, x, y + h, radio);
  ctx.arcTo(x, y + h, x, y, radio);
  ctx.arcTo(x, y, x + w, y, radio);
  ctx.closePath();
}

/** Texto que cabe: baja la fuente y, si ni así, lo recorta con puntos suspensivos. */
function textoAjustado(ctx: CanvasRenderingContext2D, texto: string, ancho: number, tamano: number, peso: string) {
  const medir = (px: number) => {
    ctx.font = `${peso} ${px}px ${FUENTE}`;
    return ctx.measureText(texto).width;
  };
  const px = ajustarFuente(medir, ancho, tamano, Math.round(tamano * 0.55));
  ctx.font = `${peso} ${px}px ${FUENTE}`;
  let salida = texto;
  while (salida.length > 1 && ctx.measureText(salida).width > ancho) salida = salida.slice(0, -1);
  return salida === texto ? texto : `${salida.trimEnd()}…`;
}

/** Dibuja la hoja interior y devuelve el lienzo (cuadrado de la placa a `PREMIUM.insert.pxWidth`). */
export function dibujarHojaInterior(layout: SlabLayout, datos: DatosDeEtiqueta): HTMLCanvasElement {
  const { insert, layout: medidas } = PREMIUM;
  const escala = insert.pxWidth / layout.width;
  const canvas = document.createElement('canvas');
  canvas.width = insert.pxWidth;
  canvas.height = Math.round(layout.height * escala);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const px = (unidades: number) => unidades * escala;
  const aX = (x: number) => (x + layout.width / 2) * escala;
  const aY = (y: number) => (layout.height / 2 - y) * escala;

  // Marco: gris claro con un degradado suave, como el plástico interior de la placa.
  const marco = ctx.createLinearGradient(0, 0, 0, canvas.height);
  marco.addColorStop(0, insert.frame);
  marco.addColorStop(1, insert.frameShade);
  ctx.fillStyle = marco;
  rectanguloRedondeado(ctx, 0, 0, canvas.width, canvas.height, px(medidas.cornerRadius));
  ctx.fill();

  // Ventana: fondo oscuro (si la carta aún no cargó se ve un hueco, no el marco) y un filo
  // doble: sombra por dentro y línea por fuera, que es lo que hace parecer un rebaje.
  const v = layout.window;
  const vx = aX(v.x - v.w / 2);
  const vy = aY(v.y + v.h / 2);
  ctx.fillStyle = '#0a0b10';
  rectanguloRedondeado(ctx, vx, vy, px(v.w), px(v.h), px(medidas.windowRadius));
  ctx.fill();
  ctx.lineWidth = Math.max(2, px(0.012));
  ctx.strokeStyle = insert.windowLine;
  rectanguloRedondeado(ctx, vx - 1, vy - 1, px(v.w) + 2, px(v.h) + 2, px(medidas.windowRadius));
  ctx.stroke();

  dibujarEtiqueta(ctx, layout, datos, { escala, aX, aY });
  return canvas;
}

interface Coordenadas {
  escala: number;
  aX: (x: number) => number;
  aY: (y: number) => number;
}

function dibujarEtiqueta(ctx: CanvasRenderingContext2D, layout: SlabLayout, datos: DatosDeEtiqueta, c: Coordenadas) {
  const { label } = PREMIUM;
  const { grade, cert, since } = datos.premium;
  const negra = esBlackLabel(grade);
  const colores = negra ? label.black : { paper: label.paper, ink: label.ink, mutedInk: label.mutedInk, line: null };
  const r = layout.label;
  const x = c.aX(r.x - r.w / 2);
  const y = c.aY(r.y + r.h / 2);
  const w = r.w * c.escala;
  const h = r.h * c.escala;

  // Papel de la etiqueta.
  ctx.fillStyle = colores.paper;
  rectanguloRedondeado(ctx, x, y, w, h, h * 0.08);
  ctx.fill();

  // Banda de color de arriba (según el grado) con la marca y el tipo de etiqueta.
  const [claro, oscuro] = label.bands[grade] ?? label.bands['8'];
  const bandaH = h * 0.3;
  const banda = ctx.createLinearGradient(0, y, 0, y + bandaH);
  banda.addColorStop(0, claro);
  banda.addColorStop(1, oscuro);
  ctx.save();
  rectanguloRedondeado(ctx, x, y, w, h, h * 0.08);
  ctx.clip();
  ctx.fillStyle = banda;
  ctx.fillRect(x, y, w, bandaH);
  if (colores.line) {
    ctx.fillStyle = colores.line;
    ctx.fillRect(x, y + bandaH, w, Math.max(2, h * 0.025));
  }
  ctx.restore();

  const pad = h * 0.07;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = negra ? colores.line ?? '#fff' : '#ffffff';
  ctx.font = `800 ${Math.round(bandaH * 0.52)}px ${FUENTE}`;
  ctx.textAlign = 'left';
  ctx.fillText('VTUBERDEX', x + pad, y + bandaH / 2 + 1);
  ctx.textAlign = 'right';
  ctx.font = `700 ${Math.round(bandaH * 0.4)}px ${FUENTE}`;
  const degradada = esGradoDegradado(grade);
  ctx.fillText(negra ? 'BLACK LABEL' : degradada ? 'DETERIORADA' : 'PREMIUM', x + w - pad, y + bandaH / 2 + 1);

  // Bloque derecho: la nota en grande y su nombre. Una línea fina lo separa del texto.
  const bloqueDerecho = w * 0.3;
  const divisor = x + w - bloqueDerecho;
  ctx.fillStyle = negra ? colores.mutedInk : '#d5d9e2';
  ctx.fillRect(divisor, y + bandaH + pad, 1.5, h - bandaH - pad * 2);
  ctx.fillStyle = colores.ink;
  ctx.textAlign = 'center';
  const centroDerecho = divisor + bloqueDerecho / 2;
  const nota = notaVisible(grade);
  ctx.font = `800 ${Math.round((h - bandaH) * 0.62)}px ${FUENTE}`;
  ctx.fillText(nota, centroDerecho, y + bandaH + (h - bandaH) * 0.44);
  ctx.fillStyle = colores.mutedInk;
  ctx.font = `700 ${Math.round((h - bandaH) * 0.15)}px ${FUENTE}`;
  ctx.fillText(nombreDeGrado(grade), centroDerecho, y + bandaH + (h - bandaH) * 0.83);

  // Bloque izquierdo: nombre, número y país, y el certificado con su código de barras.
  const anchoTexto = divisor - x - pad * 2;
  const resto = h - bandaH;
  ctx.textAlign = 'left';
  ctx.fillStyle = colores.ink;
  /**
   * En una carta degradada la etiqueta se rompe igual que la carta: el nombre y el país se
   * corrompen con la MISMA semilla y severidad que la cabecera (`card-texture/deterioro.ts`), y en
   * el grado 1 solo queda legible el número de dex.
   */
  const severidad = severidadDeGrado(grade);
  const semilla = semillaDeCarta(Number(cert.replace(/\D/g, '')) || 0, grade);
  const nombre = corromperTexto(datos.name.toUpperCase(), severidad, semilla);
  const pais = datos.country && severidad >= DETERIORO.hideCountryFrom ? null : datos.country;
  ctx.fillText(textoAjustado(ctx, nombre, anchoTexto, Math.round(resto * 0.26), '800'), x + pad, y + bandaH + resto * 0.26);
  ctx.fillStyle = colores.mutedInk;
  const racha = textoDeRacha(datos.premium);
  const sub = [`#${String(datos.dexNumber).padStart(3, '0')}`, pais, racha].filter(Boolean).join(' · ');
  ctx.fillText(textoAjustado(ctx, sub, anchoTexto, Math.round(resto * 0.17), '600'), x + pad, y + bandaH + resto * 0.5);

  const barraY = y + bandaH + resto * 0.64;
  const barraH = resto * 0.26;
  let barraX = x + pad;
  const unidad = Math.max(1, Math.round(resto * 0.022));
  ctx.fillStyle = colores.ink;
  barrasDeCertificado(cert).forEach((ancho, indice) => {
    const largo = ancho * unidad;
    if (indice % 2 === 0) ctx.fillRect(barraX, barraY, largo, barraH);
    barraX += largo;
  });
  ctx.fillStyle = colores.mutedInk;
  ctx.font = `600 ${Math.round(resto * 0.13)}px ${FUENTE}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${cert} · ${since.slice(0, 4)}`, barraX + pad * 0.6, barraY + barraH);
}
