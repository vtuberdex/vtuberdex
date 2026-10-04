'use client';
/**
 * Fábrica de texturas de carta: cola con prioridades, generación progresiva, caché
 * acotada, calidad adaptativa y pregeneración de páginas vecinas.
 *
 * EL PROBLEMA MEDIDO: cargar una página de 8 cartas dejaba el hilo principal bloqueado
 * 6,5 s en total aunque la API respondiera en 11-45 ms. Generar las texturas (4 lienzos
 * por carta más dos máscaras que recorren el lienzo píxel a píxel) era lo que el usuario
 * veía como «se demora mucho»: las cartas aparecían de a una, y pasar de página volvía a
 * pagarlo todo aunque las imágenes ya estuvieran en memoria.
 *
 * LAS CUATRO MEDIDAS, y por qué cada una vive aquí y no en el hook:
 *   1. PROGRESIVA: `generarRapida` pinta superficie, personaje y título (lo barato y lo
 *      que identifica la carta) y la carta ya se ve; `completar` añade marca, máscaras y
 *      color predominante reutilizando esas capas (`reutilizar` en `drawCardLayers`), así
 *      que no se dibuja nada dos veces.
 *   2. ADAPTATIVA: se mide cuánto tarda la generación completa de cada carta y, si la
 *      mediana de `TEXTURAS.muestras` supera `lentoMs`, se baja un escalón de `anchos`
 *      para las siguientes. Decide la máquina real, no `hardwareConcurrency`.
 *   3. CACHÉ: lo generado se guarda por carta y ancho en un LRU con presupuesto en
 *      píxeles. Volver a una página no regenera nada, y las entradas de cartas montadas
 *      están ancladas (`anclar`) para no desalojarlas por debajo de quien las usa.
 *   4. PREGENERACIÓN: `pregenerar` encola, con prioridad BAJA y en tiempo ocioso, las
 *      texturas de las cartas que la caché de páginas ya trajo: al pasar de hoja las 8
 *      cartas salen de la caché ya hechas.
 *
 * Los canvases se cachean; las texturas de three (`CanvasTexture`) las crea cada montaje a
 * partir de ellos, porque una textura pertenece a un renderer y el detalle y el libro
 * tienen cada uno el suyo. La subida a GPU es barata frente a la generación.
 */
import type { VtuberCard } from '@/lib/types';
import { TEXTURAS } from '@/components/card3d-config';
import { CARD_TEXTURE_FULL_WIDTH } from './dimensiones';
import { drawCardLayers } from './componer';
import { esFichaDeteriorada } from '@/lib/premium';
import { deteriorarArte, deteriorarCabecera, planDeCarta, tarjetaParaTitulo } from './deterioro';
import { drawSurfaceLayer } from './capa-superficie';
import { drawCharacterLayer } from './capa-personaje';
import { drawTitleLayer } from './capa-titulo';
import { emptyLayer } from './lienzo';
import { loadImage } from './imagen';
import { inkAndSkinMaskAsync, logoMaskAsync, logoSticker, precalentarMascaras } from './mascaras';
import { colorPredominante, type ColorPredominante } from './predominante';

/* ----------------------------------------------------------------------------
 * Cola con prioridades.
 * ------------------------------------------------------------------------- */

type Trabajo = () => void | Promise<void>;
type Prioridad = 'alta' | 'baja';

const colaAlta: Array<{ trabajo: Trabajo; listo: () => void }> = [];
const colaBaja: Array<{ trabajo: Trabajo; listo: () => void }> = [];
let corriendo = false;

const enOcio = (fn: () => void) => {
  const w = globalThis as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: TEXTURAS.esperaOciosaMaxMs });
  else setTimeout(fn, TEXTURAS.retrasoOciosoMs);
};

async function ejecutar(entrada: { trabajo: Trabajo; listo: () => void }) {
  try {
    await entrada.trabajo();
  } catch (error) {
    console.warn('[fabrica] fallo al generar texturas', error);
  } finally {
    entrada.listo();
    corriendo = false;
    bombear();
  }
}

function bombear() {
  if (corriendo) return;
  const alta = colaAlta.shift();
  if (alta) {
    corriendo = true;
    // Un respiro entre trabajos para que el navegador pinte y atienda la entrada.
    setTimeout(() => void ejecutar(alta), 0);
    return;
  }
  const baja = colaBaja.shift();
  if (!baja) return;
  corriendo = true;
  enOcio(() => {
    // Si mientras esperaba el hueco ocioso llegó trabajo de prioridad alta, le cede el
    // turno: lo que se está mirando siempre va antes que la pregeneración.
    if (colaAlta.length > 0) {
      colaBaja.unshift(baja);
      corriendo = false;
      bombear();
      return;
    }
    void ejecutar(baja);
  });
}

/**
 * Encola un trabajo de CPU. Los de prioridad ALTA (cartas que se están mirando) van
 * antes que los de BAJA (pregeneración), que además esperan un hueco ocioso. Se ejecutan
 * de UNO en uno: ocho cartas a la vez bloqueaban el hilo en un solo tramo largo.
 */
export function encolarTrabajo(trabajo: Trabajo, prioridad: Prioridad = 'alta'): Promise<void> {
  return new Promise<void>((listo) => {
    (prioridad === 'alta' ? colaAlta : colaBaja).push({ trabajo, listo });
    bombear();
  });
}

/** Para los tests: cuántos trabajos esperan en cada cola. */
export function __pendientes(): { alta: number; baja: number } {
  return { alta: colaAlta.length, baja: colaBaja.length };
}

/* ----------------------------------------------------------------------------
 * Calidad adaptativa.
 * ------------------------------------------------------------------------- */

let techoAdaptado = Number.POSITIVE_INFINITY;
let muestras: number[] = [];

/** Ancho con el que se generan las texturas de un plan: el del plan, o menos si la máquina es lenta. */
export function anchoEfectivo(anchoDelPlan: number): number {
  return Math.min(anchoDelPlan, techoAdaptado);
}

/**
 * Registra cuánto tardó una generación completa y baja un escalón si la mediana de las
 * últimas `muestras` supera `lentoMs`. Solo se mide lo generado AL ancho efectivo actual:
 * una carta vieja a 512 no debe decidir por el escalón de 384.
 */
export function registrarMedicion(ms: number, width: number): void {
  if (width !== anchoEfectivo(width)) return;
  muestras.push(ms);
  if (muestras.length > TEXTURAS.muestras) muestras.shift();
  if (muestras.length < TEXTURAS.muestras) return;
  const ordenadas = [...muestras].sort((a, b) => a - b);
  const mediana = ordenadas[Math.floor(ordenadas.length / 2)];
  if (mediana <= TEXTURAS.lentoMs) return;
  const siguiente = TEXTURAS.anchos.find((ancho) => ancho < width);
  if (siguiente === undefined) return;
  techoAdaptado = siguiente;
  muestras = [];
}

/** Para los tests y la consola: el techo adaptado actual (Infinity = sin adaptar). */
export function __techoAdaptado(): number {
  return techoAdaptado;
}

/* ----------------------------------------------------------------------------
 * Texturas de una carta.
 * ------------------------------------------------------------------------- */

export interface TexturasDeCarta {
  /** Color predominante de la superficie: tiñe el foil del fondo (ver `DOMINANT`). */
  dominant: ColorPredominante;
  /** Las 7 capas en el orden de `uLayerN` (2, 4 y 5 vacías de 1x1). */
  layers: HTMLCanvasElement[];
  edge: HTMLCanvasElement;
  logoMask: HTMLCanvasElement;
  logoSticker: HTMLCanvasElement;
  width: number;
  /** `false` en la etapa rápida (sin marca ni máscaras); `true` cuando está todo. */
  completa: boolean;
}

interface Fuentes {
  art: HTMLImageElement | null;
  logo: HTMLImageElement | null;
  background: HTMLImageElement | null;
}

const urlsDeCarta = (card: VtuberCard) => [
  card.images.character ?? card.images.card ?? '',
  card.images.logo ?? '',
  card.images.background ?? '',
];

async function cargarFuentes(card: VtuberCard): Promise<Fuentes> {
  const [art, logo, background] = await Promise.all(urlsDeCarta(card).map((src) => loadImage(src)));
  return { art, logo, background };
}

/** Etapa RÁPIDA: superficie, personaje y título. La carta ya se reconoce; falta el acabado. */
export function generarRapida(card: VtuberCard, fuentes: Fuentes, width: number): TexturasDeCarta {
  const background = drawSurfaceLayer({ card, background: fuentes.background, width });
  const character = drawCharacterLayer({ art: fuentes.art, width });
  const title = drawTitleLayer({ card: tarjetaParaTitulo(card), width });
  const vacia = emptyLayer();
  // El color predominante se mide ANTES de estropear la superficie: una carta degradada conserva
  // el matiz de su foil aunque el arte ya se vea gris.
  const dominant = colorPredominante(background);
  const plan = planDeCarta(card);
  if (plan) {
    deteriorarArte(background, plan);
    deteriorarArte(character, plan);
    deteriorarCabecera(title, plan);
  }
  return {
    dominant,
    layers: [background, character, vacia, title, vacia, vacia, vacia],
    edge: vacia,
    logoMask: vacia,
    logoSticker: vacia,
    width,
    completa: false,
  };
}

export interface Completada {
  texturas: TexturasDeCarta;
  /**
   * Milisegundos de CPU en el HILO PRINCIPAL (dibujar, aplanar, leer y escribir píxeles),
   * sin la espera del worker: es lo que bloquea la interfaz y lo único que debe decidir la
   * calidad adaptativa. Contar la espera del primer mensaje del worker (su arranque) hacía
   * bajar un escalón a máquinas que no lo necesitaban.
   */
  msCpu: number;
}

/** Etapa COMPLETA: marca, máscaras (en el worker) y wordmark, reutilizando las capas rápidas. */
export async function completar(card: VtuberCard, fuentes: Fuentes, rapida: TexturasDeCarta): Promise<Completada> {
  const { width } = rapida;
  let msCpu = 0;
  let t0 = performance.now();
  const [background, character, , title] = rapida.layers;
  // Una ficha deteriorada (grado 1) no muestra su logo, ni siquiera donde la API lo devuelve (mantenedor).
  const logoVisible = esFichaDeteriorada(card) ? null : fuentes.logo;
  const capas = drawCardLayers({
    card,
    art: fuentes.art,
    logo: logoVisible,
    background: fuentes.background,
    width,
    reutilizar: { background, character, title },
  });
  const height = background.height;

  /**
   * Capa COMBINADA: se usa SOLO como fuente de la máscara de tinta y piel.
   *
   * Antes también alimentaba un uMap de respaldo, que se eliminó al pasarse el shader a
   * las 7 capas (18 samplers contra el límite de 16 del driver: la carta salía negra). La
   * máscara de tinta no se puede calcular por capa porque el lineart y la piel son
   * propiedades del ARTE, así que la combinada se mantiene para ese único cálculo y no se
   * sube como textura.
   *
   * `willReadFrequently`: solo se LEE (la máscara de tinta la recorre píxel a píxel), así que
   * vive en memoria de CPU y `getImageData` no fuerza una lectura sincrónica desde la GPU. La
   * máscara lo lee directamente (ver `prepararTinta`), sin copiarlo a otro canvas.
   */
  const flat = document.createElement('canvas');
  flat.width = width;
  flat.height = height;
  const flatCtx = flat.getContext('2d', { willReadFrequently: true });
  if (flatCtx) {
    for (const capa of [capas.background, capas.character, capas.logo, capas.title, capas.texts, capas.tags, capas.wordmark]) {
      flatCtx.drawImage(capa, 0, 0);
    }
  }

  const logoBox = capas.info.logoBox;
  const conLogo = Boolean(logoBox && logoVisible);
  const sticker = conLogo ? logoSticker(logoVisible!, logoBox!, width, height) : emptyLayer();
  msCpu += performance.now() - t0;

  // Las máscaras preparan su origen en este hilo y calculan en el worker: el tiempo de
  // CPU de esa parte queda dentro de las funciones y se aproxima por la diferencia.
  t0 = performance.now();
  const [edge, logoMask] = await Promise.all([
    inkAndSkinMaskAsync(flat, width, height),
    conLogo ? logoMaskAsync(logoVisible!, logoBox!, width, height) : Promise.resolve(emptyLayer()),
  ]);
  const esperaMascaras = performance.now() - t0;

  return {
    texturas: {
      dominant: rapida.dominant,
      layers: [capas.background, capas.character, capas.logo, capas.title, capas.texts, capas.tags, capas.wordmark],
      edge,
      logoMask,
      logoSticker: sticker,
      width,
      completa: true,
    },
    // La preparación de las máscaras (dibujar + getImageData + putImageData) es CPU; la
    // espera del worker no. Sin instrumentar cada función, se acota por lo medido en la
    // etapa rápida: nunca más que el tiempo de dibujo de las capas que ya pagó.
    msCpu: msCpu + Math.min(esperaMascaras, msCpu),
  };
}

/* ----------------------------------------------------------------------------
 * Caché LRU con presupuesto en píxeles.
 * ------------------------------------------------------------------------- */

interface Entrada {
  texturas: TexturasDeCarta;
  pixeles: number;
  anclas: number;
}

const cache = new Map<string, Entrada>();
let pixelesEnCache = 0;

/**
 * El grado va en la clave: subir o bajar el grado cambia el dibujo (una degradada se rompe) y con
 * la clave anterior el mantenedor seguiría viendo la textura vieja hasta recargar. Va ANTES de las
 * URLs porque `buscarEnCache` compara prefijo (`id|`) y sufijo (URLs) para encontrar otro ancho.
 */
const claveDe = (card: VtuberCard, width: number) => `${card.id}|${width}|${gradoDeCarta(card)}|${urlsDeCarta(card).join('|')}`;
const gradoDeCarta = (card: VtuberCard) => card.premium?.grade ?? '';

const pixelesDe = (t: TexturasDeCarta) =>
  [...t.layers, t.edge, t.logoMask, t.logoSticker].reduce((suma, c) => suma + c.width * c.height, 0);

function podar() {
  for (const [clave, entrada] of cache) {
    if (pixelesEnCache <= TEXTURAS.cacheMaxPixels) return;
    if (entrada.anclas > 0) continue;
    cache.delete(clave);
    pixelesEnCache -= entrada.pixeles;
  }
}

/** Texturas COMPLETAS ya generadas para la carta: al ancho pedido o, si no, a cualquier otro. */
export function buscarEnCache(card: VtuberCard, width: number): TexturasDeCarta | null {
  const exacta = cache.get(claveDe(card, width));
  if (exacta) {
    cache.delete(claveDe(card, width));
    cache.set(claveDe(card, width), exacta);
    return exacta.texturas;
  }
  const prefijo = `${card.id}|`;
  const sufijo = `|${gradoDeCarta(card)}|${urlsDeCarta(card).join('|')}`;
  for (const [clave, entrada] of cache) {
    if (clave.startsWith(prefijo) && clave.endsWith(sufijo)) return entrada.texturas;
  }
  return null;
}

export function guardarEnCache(card: VtuberCard, texturas: TexturasDeCarta): void {
  if (!texturas.completa) return;
  const clave = claveDe(card, texturas.width);
  const previa = cache.get(clave);
  if (previa) {
    cache.delete(clave);
    pixelesEnCache -= previa.pixeles;
  }
  const pixeles = pixelesDe(texturas);
  cache.set(clave, { texturas, pixeles, anclas: previa?.anclas ?? 0 });
  pixelesEnCache += pixeles;
  podar();
}

/** Marca las texturas de una carta como EN USO: no se desalojan. Devuelve cómo soltarlas. */
export function anclar(card: VtuberCard, width: number): () => void {
  const clave = claveDe(card, width);
  const entrada = cache.get(clave);
  if (!entrada) return () => undefined;
  entrada.anclas += 1;
  let suelta = false;
  return () => {
    if (suelta) return;
    suelta = true;
    const actual = cache.get(clave);
    if (actual) actual.anclas = Math.max(0, actual.anclas - 1);
    podar();
  };
}

/** Para los tests: tamaño de la caché. */
export function __estadoCache(): { entradas: number; pixeles: number } {
  return { entradas: cache.size, pixeles: pixelesEnCache };
}

/* ----------------------------------------------------------------------------
 * Flujo completo de una carta, y pregeneración.
 * ------------------------------------------------------------------------- */

/**
 * Marca estándar de rendimiento por etapa (`performance.measure`): se lee en la pestaña
 * Performance del navegador y desde una sonda sin tocar el código. Es lo que permite
 * medir la generación por separado del render WebGL, que en una máquina sin GPU domina
 * cualquier `longtask`.
 */
function medir(nombre: string, duracion: number) {
  try {
    const fin = performance.now();
    performance.measure(nombre, { start: fin - duracion, end: fin });
  } catch {
    // Navegadores sin la firma con opciones: la marca es solo diagnóstico.
  }
}

export interface OpcionesGeneracion {
  width: number;
  prioridad?: Prioridad;
  /** Se llama con la etapa rápida en cuanto existe (solo en prioridad alta: la pregeneración no muestra nada). */
  alRapida?: (texturas: TexturasDeCarta) => void;
  /** `true` para abortar entre etapas. */
  cancelada?: () => boolean;
}

/**
 * Genera (o recupera de la caché) las texturas completas de una carta. Dos trabajos de
 * cola separados por etapa, así una carta no acapara el hilo: entre su etapa rápida y la
 * completa pueden colarse las etapas rápidas de las demás, y las 8 cartas de la página
 * aparecen reconocibles antes de que ninguna tenga el acabado.
 */
export async function generarTexturas(card: VtuberCard, opciones: OpcionesGeneracion): Promise<TexturasDeCarta | null> {
  const { prioridad = 'alta', alRapida, cancelada = () => false } = opciones;
  const width = anchoEfectivo(opciones.width);
  const enCache = buscarEnCache(card, width);
  if (enCache) {
    medir('textura-cache', 0);
    return enCache;
  }

  precalentarMascaras();
  const fuentes = await cargarFuentes(card);
  if (cancelada()) return null;

  let rapida: TexturasDeCarta | null = null;
  let completa: TexturasDeCarta | null = null;
  let ms = 0;

  await encolarTrabajo(() => {
    if (cancelada()) return;
    const t0 = performance.now();
    rapida = generarRapida(card, fuentes, width);
    ms += performance.now() - t0;
    medir(`textura-rapida:${width}`, performance.now() - t0);
    if (prioridad === 'alta') alRapida?.(rapida);
  }, prioridad);
  if (!rapida || cancelada()) return null;

  await encolarTrabajo(async () => {
    if (cancelada() || !rapida) return;
    const t0 = performance.now();
    const resultado = await completar(card, fuentes, rapida);
    completa = resultado.texturas;
    ms += resultado.msCpu;
    medir(`textura-completa:${width}:${prioridad}`, performance.now() - t0);
    medir(`textura-completa-cpu:${width}`, resultado.msCpu);
    guardarEnCache(card, completa);
    registrarMedicion(ms, width);
  }, prioridad);

  return completa;
}

/**
 * Pregenera, con prioridad baja y en tiempo ocioso, las texturas de unas cartas (las
 * páginas vecinas que `lib/cache-paginas.ts` ya trajo). Lo que ya está en caché no cuesta.
 */
export function pregenerar(cards: readonly VtuberCard[], anchoDelPlan: number): void {
  for (const card of cards) {
    void generarTexturas(card, { width: anchoDelPlan, prioridad: 'baja' });
  }
}

/** Ancho de textura por defecto cuando el plan no dice otra cosa. */
export const ANCHO_POR_DEFECTO = CARD_TEXTURE_FULL_WIDTH;

/** Para los tests: olvida caché, mediciones y adaptación. */
export function __reiniciarFabrica(): void {
  cache.clear();
  pixelesEnCache = 0;
  techoAdaptado = Number.POSITIVE_INFINITY;
  muestras = [];
}
