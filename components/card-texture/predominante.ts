/**
 * Color PREDOMINANTE de la superficie de la carta, para teñir el holograma del fondo.
 *
 * POR QUÉ NO BASTA CON EL MATIZ DEL PÍXEL: el arcoíris del foil se suma como luz y cambia el
 * matiz del arte (un rojo con luz verde se vuelve oliva). `protegerMatiz` (shaders.ts) ya lo
 * evita píxel a píxel, pero con un fondo de varias zonas el destello cambia de tono de un lado a
 * otro. El predominante da UN tono estable para toda la carta, que es lo que se pidió.
 *
 * CÓMO SE ELIGE: no es el promedio (rojo + azul darían un morado que no existe en la imagen).
 * Se agrupa por MATIZ en `hueBins` cubos, pesando cada píxel por su croma, se toma el cubo más
 * pesado y se promedia solo ese. Los grises se ignoran: no tienen matiz que respetar.
 *
 * `amount` (0..1) dice cuánto fiarse del resultado: baja si casi no hay color (fondo gris,
 * blanco o negro: ahí el arcoíris debe quedar completo) o si hay varios colores igual de
 * fuertes (ningún tono representa a la carta).
 */
import { DOMINANT } from '../card3d-config';

export interface ColorPredominante {
  /** Canales 0..1 del color predominante. */
  rgb: [number, number, number];
  /** 0 = ignorar (sin color dominante), 1 = confiar del todo. */
  amount: number;
}

const SIN_COLOR: ColorPredominante = { rgb: [0, 0, 0], amount: 0 };

const suave = (valor: number, desde: number, hasta: number) => {
  const t = Math.min(1, Math.max(0, (valor - desde) / (hasta - desde)));
  return t * t * (3 - 2 * t);
};

/** Matiz 0..1 de un color RGB 0..255 (solo se llama con croma > 0). */
function matiz(r: number, g: number, b: number, max: number, min: number): number {
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h / 6) % 1 + 1) % 1;
}

export function colorPredominante(fuente: CanvasImageSource | null): ColorPredominante {
  if (!fuente || typeof document === 'undefined') return SIN_COLOR;
  const lado = DOMINANT.grid;
  const canvas = document.createElement('canvas');
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return SIN_COLOR;
  ctx.drawImage(fuente, 0, 0, lado, lado);
  const datos = ctx.getImageData(0, 0, lado, lado).data;

  const cubos = Array.from({ length: DOMINANT.hueBins }, () => ({ peso: 0, r: 0, g: 0, b: 0 }));
  let pesoTotal = 0;
  let pixeles = 0;
  for (let i = 0; i < datos.length; i += 4) {
    if (datos[i + 3] < 8) continue;
    pixeles += 1;
    const [r, g, b] = [datos[i], datos[i + 1], datos[i + 2]];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const croma = (max - min) / 255;
    if (croma < DOMINANT.minChroma) continue;
    // El brillo también pesa: un píxel casi negro con algo de croma no «es» ese color.
    const peso = croma * (max / 255);
    const cubo = cubos[Math.min(DOMINANT.hueBins - 1, Math.floor(matiz(r, g, b, max, min) * DOMINANT.hueBins))];
    cubo.peso += peso;
    cubo.r += r * peso;
    cubo.g += g * peso;
    cubo.b += b * peso;
    pesoTotal += peso;
  }
  if (pixeles === 0 || pesoTotal === 0) return SIN_COLOR;

  const ganador = cubos.reduce((mejor, cubo) => (cubo.peso > mejor.peso ? cubo : mejor), cubos[0]);
  const cobertura = Math.min(1, ganador.peso / (pixeles * DOMINANT.coverageFull));
  const dominancia = suave(ganador.peso / pesoTotal, DOMINANT.dominanceFrom, DOMINANT.dominanceTo);
  return {
    rgb: [ganador.r / ganador.peso / 255, ganador.g / ganador.peso / 255, ganador.b / ganador.peso / 255],
    amount: cobertura * dominancia,
  };
}
