/**
 * Contrato de datos: lo que entra a dibujar y las 7 capas que salen.
 */
import type { VtuberCard } from '@/lib/types';

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
