/**
 * Atlas de números de un dado: UN lienzo en escala de grises con una casilla por cara.
 *
 * El mismo lienzo hace tres trabajos en el material (`escena-dados.tsx`), y por eso es gris y no color:
 *  - `roughnessMap`: el fondo casi negro deja el cristal pulido; el número, claro, queda ESMERILADO,
 *    que es como se ve un grabado en vidrio de verdad.
 *  - `bumpMap` con escala NEGATIVA: lo claro se HUNDE. Es el «relieve inverso» (número grabado hacia
 *    dentro, no en relieve).
 *  - `emissiveMap`: un brillo leve en el grabado para que el número se lea a través del cristal.
 * Un desenfoque suave en el trazo hace de chaflán del grabado: con el borde duro el relieve salía
 * escalonado.
 *
 * El d4 se lee en los VÉRTICES: cada cara lleva los tres números de sus esquinas, girados hacia ellas.
 * 6 y 9 llevan un subrayado cuando el dado tiene los dos (si no, no hay forma de distinguirlos).
 */
import { CanvasTexture, NoColorSpace } from 'three';

import { CARAS, formaDe, rejillaDelAtlas, uvEnCara, type TipoDeDado } from '@/components/dados/dados-geometria';

const LADO_PX = 1024;
const FONDO = '#101010';
const TRAZO = '#e6e6e6';

/** Distancia del centro de la cara a su lado más cercano (radio inscrito), en unidades de mundo. */
function radioInscrito(centro: import('three').Vector3, vertices: import('three').Vector3[]): number {
  let minimo = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const ab = b.clone().sub(a);
    const t = Math.max(0, Math.min(1, centro.clone().sub(a).dot(ab) / ab.lengthSq()));
    minimo = Math.min(minimo, a.clone().add(ab.multiplyScalar(t)).distanceTo(centro));
  }
  return minimo;
}

function texto(ctx: CanvasRenderingContext2D, valor: number, x: number, y: number, px: number, angulo: number, subrayar: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angulo);
  ctx.font = `700 ${px}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(valor), 0, px * 0.04);
  if (subrayar) ctx.fillRect(-px * 0.28, px * 0.48, px * 0.56, px * 0.09);
  ctx.restore();
}

export function crearAtlas(tipo: TipoDeDado): CanvasTexture {
  const forma = formaDe(tipo);
  const { lado } = rejillaDelAtlas(tipo);
  const lienzo = document.createElement('canvas');
  lienzo.width = LADO_PX;
  lienzo.height = LADO_PX;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('sin_canvas_2d');
  ctx.fillStyle = FONDO;
  ctx.fillRect(0, 0, LADO_PX, LADO_PX);
  ctx.fillStyle = TRAZO;
  ctx.filter = 'blur(1.4px)';

  const aPx = ([u, v]: [number, number]) => [u * LADO_PX, (1 - v) * LADO_PX] as const;
  const casillaPx = LADO_PX / lado;
  const ambiguos = CARAS[tipo] >= 9;

  forma.caras.forEach((cara, i) => {
    const R = Math.max(...cara.vertices.map((p) => p.distanceTo(cara.centro)));
    const r = radioInscrito(cara.centro, cara.vertices);
    const [cx, cy] = aPx(uvEnCara(tipo, i, cara.centro));
    if (tipo === 'd4') {
      // Tres números por cara, cada uno cerca de su vértice y con la parte de arriba apuntándole.
      for (const p of cara.vertices) {
        const numero = forma.verticesNumerados.find((v) => v.punto.distanceToSquared(p) < 1e-10)!.numero;
        const [vx, vy] = aPx(uvEnCara(tipo, i, p));
        const dx = vx - cx;
        const dy = vy - cy;
        texto(ctx, numero, cx + dx * 0.52, cy + dy * 0.52, casillaPx * 0.2, Math.atan2(dx, -dy), false);
      }
      return;
    }
    const digitos = String(cara.numero).length;
    const px = casillaPx * 0.46 * (r / R) * (digitos > 1 ? 1.05 : 1.3);
    texto(ctx, cara.numero, cx, cy, px, 0, ambiguos && (cara.numero === 6 || cara.numero === 9));
  });

  const textura = new CanvasTexture(lienzo);
  // Es un mapa de DATOS (rugosidad, relieve), no un color: sin conversión sRGB.
  textura.colorSpace = NoColorSpace;
  textura.anisotropy = 8;
  return textura;
}
