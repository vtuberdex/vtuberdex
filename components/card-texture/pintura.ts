/**
 * Primitivas de dibujo compartidas por las capas (texto, metal, relieve).
 */
import { mixHex, rgba } from '@/lib/color';
import { TEXT_FINISH } from '../card3d-config';
import { FONT } from './dimensiones';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startSize: number, weight = '700'): number {
  let size = startSize;
  do {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  } while (size > 16);
  return size;
}

/**
 * CÓMO SE DIBUJA EL METAL (la técnica vive aquí, los valores en TEXT_FINISH).
 *
 * Un canvas 2D no tiene reflejo especular, así que el metal se SIMULA con el perfil de
 * luminancia de una lámina pulida: muchas paradas con un filo claro arriba, el cuerpo
 * medio, un brillo ancho en el centro y la sombra del canto abajo. El bisel —filo claro
 * y línea oscura— es lo que da el ESPESOR, y es lo que separa "plástico brillante" de
 * "placa metálica".
 *
 * Este bloque se había quedado fuera al trocear la carta en 7 capas (la versión plana de
 * `drawCardFront` lo tenía y las capas nuevas nacieron sin él). Se recupera aquí y lo
 * consumen la placa del título, el badge del número y el wordmark.
 */

/** Relleno metálico: gradiente de paradas + tinte de marca. */
export function metalFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: readonly { at: number; color: string }[],
  brand: string,
  brandTint: number,
): CanvasGradient {
  const g = ctx.createLinearGradient(x, y, x + w * 0.25, y + h);
  for (const s of stops) g.addColorStop(s.at, mixHex(s.color, brand, brandTint));
  return g;
}

/**
 * Barrido diagonal del metal: bandas casi transparentes que dan el reflejo.
 *
 * Se recorta al área ANTES de pintar porque el gradiente es del ancho del área y
 * cualquier trazo se saldría por las esquinas redondeadas de la placa.
 */
export function metalSheen(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w * 0.55, y + h);
  for (const s of TEXT_FINISH.sheen) g.addColorStop(s.at, `rgba(255, 255, 255, ${s.alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Bisel: filo claro arriba y línea oscura abajo, dentro del área redondeada. */
export function metalBevel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  const { bevel } = TEXT_FINISH;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.lineWidth = bevel.width;
  ctx.strokeStyle = rgba(bevel.light, bevel.lightAlpha);
  ctx.beginPath();
  ctx.moveTo(x, y + bevel.width / 2);
  ctx.lineTo(x + w, y + bevel.width / 2);
  ctx.stroke();
  ctx.strokeStyle = rgba(bevel.dark, bevel.darkAlpha);
  ctx.beginPath();
  ctx.moveTo(x, y + h - bevel.width / 2);
  ctx.lineTo(x + w, y + h - bevel.width / 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Letra GRABADA sobre metal: copia clara desplazada hacia abajo bajo el texto oscuro.
 *
 * Se dibuja ANTES del texto real y en la misma posición, así que solo asoma por el filo
 * inferior de cada letra: es lo que hace que la letra parezca hundida en la placa.
 */
export function drawEngrave(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  align: CanvasTextAlign,
): void {
  const { engrave } = TEXT_FINISH;
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.filter = `blur(${engrave.blur}px)`;
  ctx.fillStyle = rgba(engrave.color, engrave.alpha);
  ctx.fillText(text, x, y + engrave.offsetY);
  ctx.restore();
}

/**
 * TEXTO BLANCO CON SOMBRA NEGRA.
 *
 * Por qué existe: el texto de la carta es `#e8ecf5` casi opaco y, sobre un fondo subido
 * con imágenes claras (mar, nieve, cielos), se perdía. La sombra es negra y va desplazada
 * abajo-derecha —la misma dirección de luz que el bisel del metal— para que toda la carta
 * parezca iluminada desde el mismo sitio. `blur` corto: por encima de ~8 px la letra se
 * ensucia.
 *
 * Se centraliza aquí porque lo usan la frase, los chips de estado, el pie y los tags: si
 * cada sitio se configurara la suya, la dirección de luz dejaría de ser consistente.
 */
export function fillShadowedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  alpha = 0.9,
): void {
  const s = TEXT_FINISH.shadow;
  ctx.save();
  ctx.shadowColor = rgba(s.color, s.alpha);
  ctx.shadowBlur = s.blur;
  ctx.shadowOffsetX = s.offsetX;
  ctx.shadowOffsetY = s.offsetY;
  ctx.fillStyle = rgba(color, alpha);
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * MARCA metálica del pie: solo las LETRAS llevan metal.
 *
 * No se puede rellenar el texto con un gradiente y ya —eso daría una letra plana—: se
 * pinta el texto tres veces para que lea como una pieza recortada y no como una
 * tipografía con color. Copia oscura desplazada ABAJO, copia clara desplazada ARRIBA y
 * encima el gradiente. Lo que asoma por los lados de esa última es el bisel.
 */
export function drawMetalWordmark(
  ctx: CanvasRenderingContext2D,
  text: string,
  right: number,
  y: number,
  font: string,
  brand: string,
): void {
  const { wordmark } = TEXT_FINISH;
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = rgba('#05060a', wordmark.bevelDarkAlpha);
  ctx.fillText(text, right, y + wordmark.bevelDarkOffset);
  ctx.fillStyle = rgba('#ffffff', wordmark.bevelLightAlpha);
  ctx.fillText(text, right, y + wordmark.bevelLightOffset);
  const g = ctx.createLinearGradient(right - ctx.measureText(text).width, y - 16, right, y + 16);
  for (const s of wordmark.stops) g.addColorStop(s.at, mixHex(s.color, brand, wordmark.brandTint));
  ctx.fillStyle = g;
  ctx.fillText(text, right, y);
  ctx.restore();
}
