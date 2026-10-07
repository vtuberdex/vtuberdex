/**
 * Pinta el DETERIORO de una carta degradada sobre sus capas 2D (grados 7…1).
 *
 * Qué se rompe lo decide `lib/degradado.ts` (puro y probado); esto solo lo dibuja. Va ANTES de que
 * las capas suban a la GPU, así que el shader no cambia: ni uniformes nuevos ni samplers, y el
 * límite de 16 del driver queda como estaba.
 *
 * REPARTO POR CAPA (y por qué no el mismo daño en todas)
 * ------------------------------------------------------
 * Las capas se desplazan distinto con el puntero (`PARALLAX_LAYERS`: 0,04 la superficie, 0,005 el
 * personaje, 0,01 el wordmark). Un mordisco en el borde pintado en TODAS saldría repetido y
 * desfasado, como una imagen doble. Por eso:
 *   · superficie y personaje: desgaste del color, grano y pérdida de foco/pixelado (lo que hace
 *     ilegible el arte);
 *   · título: el nombre ya llega corrompido (`tarjetaParaTitulo`), más grano y pixelado — salvo la
 *     placa del número de dex, que se conserva intacta: en el grado 1 es lo único que se entiende;
 *   · wordmark (la capa de arriba): el canto blanqueado, los trozos que faltan y los rayones,
 *     que así tapan lo que haya debajo y se ven una sola vez.
 *
 * Nada de esto usa `Math.random`: todo sale del plan, que sale de la semilla de la carta.
 */
import { DETERIORO } from '../card3d-config';
import { corromperTexto, crearAzar, planDeDesgasteLeve, planDeDeterioro, type PlanDeDeterioro } from '@/lib/degradado';
import { esGradoDegradado, gradoDeDibujo } from '@/lib/premium';
import type { VtuberCard } from '@/lib/types';
import { CARD_TEXTURE_HEIGHT, CARD_TEXTURE_WIDTH, HEADER } from './dimensiones';

/**
 * Plan de la carta: el deterioro si está degradada (5…1), el desgaste LEVE si es suelta o premium de
 * entrada (6…7,5), y `null` del 8 hacia arriba (el camino de siempre no paga nada).
 */
export function planDeCarta(card: VtuberCard): PlanDeDeterioro | null {
  const grado = gradoDeDibujo(card);
  if (grado && esGradoDegradado(grado)) return planDeDeterioro(grado, card.id, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT);
  return planDeDesgasteLeve(grado, card.id, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT);
}

/**
 * La carta tal como la lee la CABECERA: nombre corrompido y, ya muy dañada, sin bandera. El resto
 * del objeto (facciones, color, número) no se toca: los engarces los dibuja la capa y el emblema
 * el shader en el mismo sitio, y mover uno sin el otro los despega.
 */
export function tarjetaParaTitulo(card: VtuberCard): VtuberCard {
  const grado = gradoDeDibujo(card);
  if (!grado || !esGradoDegradado(grado)) return card;
  const plan = planDeDeterioro(grado, card.id, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT);
  return {
    ...card,
    name: corromperTexto(card.name, plan.severidad, plan.semilla),
    countries: plan.severidad >= DETERIORO.hideCountryFrom ? [] : card.countries,
  };
}

/** Prepara el contexto para dibujar en coordenadas canónicas (1008x1411) sea cual sea el ancho de la capa. */
function conLienzo(canvas: HTMLCanvasElement, dibujar: (ctx: CanvasRenderingContext2D) => void) {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width < 2) return;
  const escala = canvas.width / CARD_TEXTURE_WIDTH;
  ctx.save();
  ctx.setTransform(escala, 0, 0, escala, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  dibujar(ctx);
  ctx.restore();
}

/** Teselas de grano: una por semilla, para no regenerar ruido en cada carta degradada igual. */
const teselas = new Map<string, HTMLCanvasElement>();

function teselaDeRuido(semilla: number): HTMLCanvasElement {
  const lado = DETERIORO.noise.tile;
  const clave = `${semilla}|${lado}`;
  const guardada = teselas.get(clave);
  if (guardada) return guardada;
  const tesela = document.createElement('canvas');
  tesela.width = lado;
  tesela.height = lado;
  const ctx = tesela.getContext('2d');
  if (ctx) {
    const azar = crearAzar(semilla ^ 0x9e3779b9);
    const datos = ctx.createImageData(lado, lado);
    for (let i = 0; i < datos.data.length; i += 4) {
      // Mezcla de grano claro y oscuro (sal y pimienta) con alfa variable: se ve como suciedad.
      const v = azar() < 0.5 ? 255 : 0;
      datos.data[i] = datos.data[i + 1] = datos.data[i + 2] = v;
      datos.data[i + 3] = Math.round(azar() * 255);
    }
    ctx.putImageData(datos, 0, 0);
  }
  if (teselas.size > 32) teselas.clear();
  teselas.set(clave, tesela);
  return tesela;
}

/** Grano sobre lo que YA está pintado (`source-atop`: no ensucia los huecos transparentes). */
function aplicarRuido(ctx: CanvasRenderingContext2D, plan: PlanDeDeterioro) {
  if (plan.ruido <= 0) return;
  const patron = ctx.createPattern(teselaDeRuido(plan.semilla), 'repeat');
  if (!patron) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = Math.min(1, plan.ruido);
  ctx.fillStyle = patron;
  ctx.fillRect(0, 0, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT);
  ctx.restore();
}

/** Apaga el color hacia gris y oscurece, solo donde hay pintura. */
function aplicarDesgaste(ctx: CanvasRenderingContext2D, plan: PlanDeDeterioro) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(128,128,128,${plan.gris.toFixed(3)})`;
  ctx.fillRect(0, 0, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT);
  ctx.fillStyle = `rgba(0,0,0,${plan.oscuridad.toFixed(3)})`;
  ctx.fillRect(0, 0, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT);
  ctx.restore();
}

/**
 * Pérdida de foco: la capa se reduce por `plan.bloque` y se vuelve a estirar. Con suavizado es un
 * desenfoque; con él apagado (desde `pixelFrom`) son bloques duros. `exento` es un rectángulo que
 * se conserva tal cual (la placa del número de dex).
 */
function perderFoco(canvas: HTMLCanvasElement, plan: PlanDeDeterioro, exento?: { x: number; y: number; w: number; h: number }) {
  if (plan.bloque <= 1) return;
  const escala = canvas.width / CARD_TEXTURE_WIDTH;
  const chico = document.createElement('canvas');
  chico.width = Math.max(2, Math.round(canvas.width / (plan.bloque * escala)));
  chico.height = Math.max(2, Math.round(canvas.height / (plan.bloque * escala)));
  const cctx = chico.getContext('2d');
  const ctx = canvas.getContext('2d');
  if (!cctx || !ctx) return;

  // La zona exenta se guarda ANTES de estropear nada y se repone después.
  let guardada: HTMLCanvasElement | null = null;
  if (exento) {
    guardada = document.createElement('canvas');
    guardada.width = Math.round(exento.w * escala);
    guardada.height = Math.round(exento.h * escala);
    guardada.getContext('2d')?.drawImage(canvas, exento.x * escala, exento.y * escala, guardada.width, guardada.height, 0, 0, guardada.width, guardada.height);
  }

  cctx.imageSmoothingEnabled = true;
  cctx.drawImage(canvas, 0, 0, chico.width, chico.height);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'copy';
  ctx.imageSmoothingEnabled = !plan.pixelar;
  ctx.drawImage(chico, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  if (exento && guardada) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    // Se limpia el hueco y se repone: sin esto el borde borroso de la zona asoma por debajo.
    ctx.clearRect(exento.x * escala, exento.y * escala, guardada.width, guardada.height);
    ctx.drawImage(guardada, exento.x * escala, exento.y * escala);
    ctx.restore();
  }
}

function trazarPoligono(ctx: CanvasRenderingContext2D, puntos: Array<[number, number]>) {
  ctx.beginPath();
  puntos.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

/** Capa 0 y 1: desgaste del color, grano y pérdida de foco (el arte deja de entenderse). */
export function deteriorarArte(canvas: HTMLCanvasElement, plan: PlanDeDeterioro): void {
  perderFoco(canvas, plan);
  conLienzo(canvas, (ctx) => {
    aplicarDesgaste(ctx, plan);
    aplicarRuido(ctx, plan);
  });
}

/** Rectángulo de la placa del número de dex en la cabecera (ver `capa-titulo.ts`): se conserva siempre. */
export const PLACA_DEL_NUMERO = { x: HEADER.pad + 16, y: HEADER.top + 21, w: 168, h: 74 } as const;

/** Capa 3: la cabecera pierde foco y se ensucia, pero la placa del número queda intacta. */
export function deteriorarCabecera(canvas: HTMLCanvasElement, plan: PlanDeDeterioro): void {
  perderFoco(canvas, plan, PLACA_DEL_NUMERO);
  conLienzo(canvas, (ctx) => {
    // Ni el apagado del color ni el grano pisan la placa del número: tiene que leerse hasta el final.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT);
    ctx.rect(PLACA_DEL_NUMERO.x, PLACA_DEL_NUMERO.y, PLACA_DEL_NUMERO.w, PLACA_DEL_NUMERO.h);
    ctx.clip('evenodd');
    aplicarDesgaste(ctx, plan);
    aplicarRuido(ctx, plan);
    ctx.restore();
  });
}

/** Capa 6 (la de arriba): canto blanqueado, trozos que faltan y rayones. */
export function deteriorarCanto(canvas: HTMLCanvasElement, plan: PlanDeDeterioro): void {
  const { whitening, window: ventana } = DETERIORO;
  conLienzo(canvas, (ctx) => {
    const W = CARD_TEXTURE_WIDTH;
    const H = CARD_TEXTURE_HEIGHT;

    // Canto blanqueado: cuatro franjas con el borde interior quebrado, más anchas cuanto peor el grado.
    const azar = crearAzar(plan.semilla ^ 0x51ed270b);
    ctx.fillStyle = whitening.color;
    ctx.globalAlpha = whitening.alpha * Math.min(1, 0.35 + plan.severidad);
    const franja = (lado: 'arriba' | 'abajo' | 'izquierda' | 'derecha') => {
      const largo = lado === 'arriba' || lado === 'abajo' ? W : H;
      const pasos = Math.round(largo / 24);
      const puntos: Array<[number, number]> = [];
      for (let i = 0; i <= pasos; i += 1) {
        const a = (largo * i) / pasos;
        const d = plan.canto * (0.35 + 0.65 * azar());
        puntos.push(lado === 'arriba' ? [a, d] : lado === 'abajo' ? [a, H - d] : lado === 'izquierda' ? [d, a] : [W - d, a]);
      }
      const orilla: Array<[number, number]> =
        lado === 'arriba' ? [[W, 0], [0, 0]] : lado === 'abajo' ? [[W, H], [0, H]] : lado === 'izquierda' ? [[0, H], [0, 0]] : [[W, H], [W, 0]];
      trazarPoligono(ctx, [...puntos, ...orilla]);
      ctx.fill();
    };
    (['arriba', 'abajo', 'izquierda', 'derecha'] as const).forEach(franja);
    ctx.globalAlpha = 1;

    // Rayones: raya clara semitransparente y, desde la mitad de la escala, surcos oscuros.
    for (const rayon of plan.rayones) {
      ctx.beginPath();
      rayon.puntos.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.lineWidth = rayon.grosor;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rayon.oscuro ? `rgba(8,9,13,${Math.min(0.9, rayon.alfa + 0.2).toFixed(2)})` : `rgba(245,245,240,${rayon.alfa.toFixed(2)})`;
      ctx.stroke();
    }

    // Trozos que faltan: del color de la ventana de la placa, con un filo claro (el cartón partido).
    for (const mordida of plan.mordidas) {
      trazarPoligono(ctx, mordida.puntos);
      ctx.fillStyle = ventana;
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(232,228,216,${(0.45 + 0.4 * plan.severidad).toFixed(2)})`;
      ctx.stroke();
    }
  });
}

