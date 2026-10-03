/**
 * Máscaras calculadas en CPU y enviadas como texturas propias al shader.
 *
 * Las versiones SÍNCRONAS (`inkAndSkinMask`, `logoMask`) hacen todo en el hilo principal
 * y son las que usan los tests y el respaldo. Las ASÍNCRONAS (`inkAndSkinMaskAsync`,
 * `logoMaskAsync`) hacen el mismo cálculo en un Web Worker (`mascaras.worker.ts`): el
 * hilo principal solo dibuja el origen, lee sus píxeles y escribe el resultado; el bucle
 * por píxel, que es lo que costaba, corre aparte. Si el worker no existe o falla, caen
 * al cálculo síncrono: el resultado es idéntico porque la matemática es la misma función
 * (`mascaras-puras.ts`).
 */
import { CARD_TEXTURE_WIDTH } from './dimensiones';
import { calcularMascara, type TipoMascara } from './mascaras-puras';

/*
 * NOTA: aquí vivía `characterAlphaMask()`, que calculaba en CPU la silueta del
 * personaje para el fondo subido. Se eliminó junto con el sampler `uBackgroundMask`:
 * con las 7 capas separadas, el alfa de la capa del personaje (uLayer1.a) ES esa
 * silueta, así que la máscara era trabajo duplicado —y un sampler de más, que fue
 * justo lo que reventó el límite de 16 del driver.
 */

type Caja = { x: number; y: number; w: number; h: number };

/* ----------------------------------------------------------------------------
 * Worker compartido.
 * ------------------------------------------------------------------------- */

let worker: Worker | null | undefined;
let siguienteId = 1;
const pendientes = new Map<number, (out: Uint8ClampedArray) => void>();

/** Un solo worker por pestaña, creado la primera vez que hace falta; `null` si no se puede. */
function obtenerWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') {
      worker = null;
      return null;
    }
    worker = new Worker(new URL('./mascaras.worker.ts', import.meta.url));
    worker.onmessage = (event: MessageEvent<{ id: number; out: Uint8ClampedArray }>) => {
      const resolver = pendientes.get(event.data.id);
      if (!resolver) return;
      pendientes.delete(event.data.id);
      resolver(event.data.out);
    };
    worker.onerror = () => {
      // Un worker roto no se reintenta: lo pendiente se resuelve en el hilo principal.
      const caidos = [...pendientes.values()];
      pendientes.clear();
      worker?.terminate();
      worker = null;
      caidos.forEach((resolver) => resolver(new Uint8ClampedArray(0)));
    };
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Arranca el worker sin pedirle nada. Crear un worker cuesta descargar y compilar su
 * script (medido: ~0,7 s en una máquina lenta) y la PRIMERA máscara pagaba esa espera;
 * llamando a esto cuando empiezan a cargarse las imágenes, el arranque se solapa con la
 * red y la primera carta no lo nota.
 */
export function precalentarMascaras(): void {
  obtenerWorker();
}

/** Calcula la máscara en el worker si existe; si no (o si falla), en este hilo. */
async function mascaraAsync(tipo: TipoMascara, src: ImageData): Promise<Uint8ClampedArray> {
  const w = obtenerWorker();
  if (w) {
    const id = siguienteId++;
    const copia = new Uint8ClampedArray(src.data);
    const resultado = await new Promise<Uint8ClampedArray>((resolve) => {
      pendientes.set(id, resolve);
      w.postMessage({ id, tipo, data: copia }, [copia.buffer]);
    });
    if (resultado.length === src.data.length) return resultado;
  }
  const out = new Uint8ClampedArray(src.data.length);
  calcularMascara(tipo, src.data, out);
  return out;
}

/* ----------------------------------------------------------------------------
 * Preparación común: dibujar el origen y leer sus píxeles.
 * ------------------------------------------------------------------------- */

interface Preparada {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  src: ImageData;
  /** Esquina de la región calculada dentro del lienzo (0,0 si es el lienzo entero). */
  x: number;
  y: number;
}

function prepararTinta(art: CanvasImageSource, width: number, height: number): Preparada | HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  /**
   * Si el origen ya es un canvas del tamaño exacto (lo es: `flat` en `completar`), se leen sus
   * píxeles DIRECTAMENTE. Antes se copiaba a un canvas intermedio con `drawImage` (otro lienzo
   * completo por carta y una pasada de pintado) solo para poder llamar a `getImageData`, y el
   * resultado era idéntico: el canvas intermedio no escalaba nada.
   */
  const directo =
    typeof HTMLCanvasElement !== 'undefined' && art instanceof HTMLCanvasElement && art.width === width && art.height === height
      ? art.getContext('2d')
      : null;
  if (directo) return { canvas, ctx, src: directo.getImageData(0, 0, width, height), x: 0, y: 0 };
  const artCanvas = document.createElement('canvas');
  artCanvas.width = width;
  artCanvas.height = height;
  const artCtx = artCanvas.getContext('2d');
  if (!artCtx) return canvas;
  artCtx.drawImage(art, 0, 0, width, height);
  return { canvas, ctx, src: artCtx.getImageData(0, 0, width, height), x: 0, y: 0 };
}

function prepararCobertura(logo: CanvasImageSource, box: Caja, width: number, height: number): Preparada | HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const scale = width / CARD_TEXTURE_WIDTH;
  /**
   * Solo se lee y se calcula la REGIÓN del logo, no el lienzo entero.
   *
   * POR QUÉ: el logo ocupa ~5% de la carta, pero la máscara se leía (`getImageData`), se
   * copiaba al worker y se escribía a tamaño completo por carta: tres pasadas sobre 367.000
   * píxeles (a 512) para marcar unos 18.000. Fuera de la caja la cobertura es 0 por
   * construcción (no hay logo), así que basta con rellenar de negro opaco —que es lo que
   * `mascaraCobertura` escribe donde el alfa no supera el umbral— y calcular la caja.
   * La traslación va ANTES de la escala para que el logo caiga en los mismos subpíxeles que
   * antes: la máscara resultante es idéntica píxel a píxel.
   */
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const x = Math.max(0, Math.floor(box.x * scale) - 1);
  const y = Math.max(0, Math.floor(box.y * scale) - 1);
  const w = Math.max(1, Math.min(width, Math.ceil((box.x + box.w) * scale) + 1) - x);
  const h = Math.max(1, Math.min(height, Math.ceil((box.y + box.h) * scale) + 1) - y);
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tmpCtx = tmp.getContext('2d', { willReadFrequently: true });
  if (!tmpCtx) return canvas;
  tmpCtx.translate(-x, -y);
  tmpCtx.scale(scale, scale);
  tmpCtx.drawImage(logo, box.x, box.y, box.w, box.h);
  return { canvas, ctx, src: tmpCtx.getImageData(0, 0, w, h), x, y };
}

function escribir(p: Preparada, pixeles: Uint8ClampedArray): HTMLCanvasElement {
  const out = p.ctx.createImageData(p.src.width, p.src.height);
  out.data.set(pixeles);
  p.ctx.putImageData(out, p.x, p.y);
  return p.canvas;
}

const esPreparada = (p: Preparada | HTMLCanvasElement): p is Preparada => 'src' in p;

/* ----------------------------------------------------------------------------
 * API.
 * ------------------------------------------------------------------------- */

export function inkAndSkinMask(art: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const p = prepararTinta(art, width, height);
  if (!esPreparada(p)) return p;
  const out = new Uint8ClampedArray(p.src.data.length);
  calcularMascara('tinta', p.src.data, out);
  return escribir(p, out);
}

export async function inkAndSkinMaskAsync(art: CanvasImageSource, width: number, height: number): Promise<HTMLCanvasElement> {
  const p = prepararTinta(art, width, height);
  if (!esPreparada(p)) return p;
  return escribir(p, await mascaraAsync('tinta', p.src));
}

export function logoMask(logo: CanvasImageSource, box: Caja, width: number, height: number): HTMLCanvasElement {
  const p = prepararCobertura(logo, box, width, height);
  if (!esPreparada(p)) return p;
  const out = new Uint8ClampedArray(p.src.data.length);
  calcularMascara('cobertura', p.src.data, out);
  return escribir(p, out);
}

export async function logoMaskAsync(logo: CanvasImageSource, box: Caja, width: number, height: number): Promise<HTMLCanvasElement> {
  const p = prepararCobertura(logo, box, width, height);
  if (!esPreparada(p)) return p;
  return escribir(p, await mascaraAsync('cobertura', p.src));
}

export function logoSticker(logo: CanvasImageSource, box: Caja, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(width / CARD_TEXTURE_WIDTH, width / CARD_TEXTURE_WIDTH);
  ctx.drawImage(logo, box.x, box.y, box.w, box.h);
  return canvas;
}
