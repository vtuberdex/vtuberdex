/**
 * Geometría y reglas PURAS del deterioro de una carta degradada (grados 7…1).
 *
 * Aquí no hay lienzo ni DOM: solo decide QUÉ se rompe (dónde van los trozos que faltan, por dónde
 * pasan los rayones, qué letras se corrompen) a partir del grado y de la carta. Pintarlo es de
 * `components/card-texture/deterioro.ts`. La separación permite probar sin canvas que el daño
 * crece con el grado y que es DETERMINISTA: una misma carta con el mismo grado se rompe siempre por
 * los mismos sitios, en el libro, en el detalle y en cada recarga. Con `Math.random` la carta
 * «bailaría» al volver de otra página.
 */
import { DETERIORO } from '@/components/card3d-config';
import { severidadDeGrado } from '@/lib/premium';

/** Generador pseudoaleatorio con semilla (mulberry32): mismo número de entrada, misma secuencia. */
export function crearAzar(semilla: number): () => number {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla estable de una carta y su grado (id + grado), para que el daño sea reproducible. */
export function semillaDeCarta(id: number, grado: string): number {
  let h = 2166136261 ^ id;
  for (const c of grado) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const interpolar = (rango: readonly [number, number], s: number) => rango[0] + (rango[1] - rango[0]) * s;

export type Lado = 'arriba' | 'abajo' | 'izquierda' | 'derecha';

/** Un trozo que falta: un polígono irregular pegado a un borde, en coordenadas del lienzo (1008x1411). */
export interface Mordida {
  puntos: Array<[number, number]>;
}

export interface Rayon {
  puntos: Array<[number, number]>;
  grosor: number;
  alfa: number;
  /** Surco oscuro (desde la mitad de la escala) en vez de una raya clara. */
  oscuro: boolean;
}

export interface PlanDeDeterioro {
  severidad: number;
  /** Semilla del grano y del canto: la misma carta lo pinta siempre igual. */
  semilla: number;
  mordidas: Mordida[];
  rayones: Rayon[];
  /** Lado del bloque de borrosidad/pixelado (1 = sin efecto). */
  bloque: number;
  /** Pixelar en bloques duros en vez de desenfocar suave. */
  pixelar: boolean;
  /** Opacidad del grano. */
  ruido: number;
  /** Cuánto se apaga el color hacia gris y oscuro. */
  gris: number;
  oscuridad: number;
  /** Anchura del blanqueado del canto en px del lienzo. */
  canto: number;
}

/**
 * Una mordida en un borde: una franja irregular cuyo borde interior es una línea quebrada.
 * `centro` es la posición a lo largo del lado (0..1), `ancho` su extensión y `profundidad` hasta dónde entra.
 */
export function mordidaEnLado(lado: Lado, centro: number, ancho: number, profundidad: number, azar: () => number, W: number, H: number): Mordida {
  const horizontal = lado === 'arriba' || lado === 'abajo';
  const largo = horizontal ? W : H;
  const pasos = 6 + Math.floor(azar() * 5);
  const inicio = Math.max(0, centro * largo - ancho / 2);
  const fin = Math.min(largo, inicio + ancho);
  const interior: Array<[number, number]> = [];
  for (let i = 0; i <= pasos; i += 1) {
    const t = i / pasos;
    // Abomba en el centro y queda a ras en las puntas; el ruido lo vuelve quebrado.
    const forma = Math.sin(Math.PI * t);
    const hondo = profundidad * (0.35 + 0.65 * azar()) * forma;
    interior.push([inicio + (fin - inicio) * t, hondo]);
  }
  const puntos: Array<[number, number]> = [[inicio, 0], ...interior, [fin, 0]];
  return {
    puntos: puntos.map(([a, d]) => {
      if (lado === 'arriba') return [a, d] as [number, number];
      if (lado === 'abajo') return [a, H - d] as [number, number];
      if (lado === 'izquierda') return [d, a] as [number, number];
      return [W - d, a] as [number, number];
    }),
  };
}

/** Un mordisco en la esquina: un triángulo irregular. */
function mordidaEnEsquina(esquina: number, tamano: number, azar: () => number, W: number, H: number): Mordida {
  const x0 = esquina % 2 === 0 ? 0 : W;
  const y0 = esquina < 2 ? 0 : H;
  const sx = esquina % 2 === 0 ? 1 : -1;
  const sy = esquina < 2 ? 1 : -1;
  const a = tamano * (0.7 + 0.5 * azar());
  const b = tamano * (0.7 + 0.5 * azar());
  return {
    puntos: [
      [x0, y0],
      [x0 + sx * a, y0],
      [x0 + sx * a * 0.55, y0 + sy * b * 0.35],
      [x0 + sx * a * 0.3, y0 + sy * b * 0.7],
      [x0, y0 + sy * b],
    ],
  };
}

/** Un rayón: una trayectoria que se desvía poco, de un lado de la carta hacia el interior. */
function rayonAleatorio(s: number, azar: () => number, W: number, H: number): Rayon {
  const { length, alpha, darkFrom } = DETERIORO.scratches;
  const largo = Math.hypot(W, H) * interpolar(length, azar());
  const angulo = (azar() - 0.5) * Math.PI * 1.2 + (azar() < 0.5 ? 0 : Math.PI / 2);
  let x = azar() * W;
  let y = azar() * H;
  const puntos: Array<[number, number]> = [[x, y]];
  const tramos = 4 + Math.floor(azar() * 4);
  for (let i = 0; i < tramos; i += 1) {
    const dir = angulo + (azar() - 0.5) * 0.35;
    x += (Math.cos(dir) * largo) / tramos;
    y += (Math.sin(dir) * largo) / tramos;
    puntos.push([x, y]);
  }
  return {
    puntos,
    grosor: 1 + azar() * (1.5 + 3 * s),
    alfa: interpolar(alpha, azar() * s),
    oscuro: s >= darkFrom && azar() < 0.4,
  };
}

/** Todo lo que se le hace a la carta con este grado. Severidad 0 (grado premium) = sin daño. */
export function planDeDeterioro(grado: string | null | undefined, cartaId: number, W: number, H: number): PlanDeDeterioro {
  const s = severidadDeGrado(grado);
  const vacio: PlanDeDeterioro = { severidad: 0, semilla: 0, mordidas: [], rayones: [], bloque: 1, pixelar: false, ruido: 0, gris: 0, oscuridad: 0, canto: 0 };
  if (s <= 0 || !grado) return vacio;

  const semilla = semillaDeCarta(cartaId, grado);
  const azar = crearAzar(semilla);
  const { chips, scratches, blur, noise, fade, whitening } = DETERIORO;

  const mordidas: Mordida[] = [];
  if (s >= chips.minSeverity) {
    const cuantas = Math.round(interpolar(chips.count, s));
    const lados: Lado[] = ['arriba', 'abajo', 'izquierda', 'derecha'];
    for (let i = 0; i < cuantas; i += 1) {
      const profundidad = W * chips.depth * s * (0.25 + 0.75 * azar());
      if (i < 4 && s > 0.3) mordidas.push(mordidaEnEsquina(i, profundidad * 1.4, azar, W, H));
      else {
        const lado = lados[Math.floor(azar() * lados.length)];
        const ancho = (lado === 'arriba' || lado === 'abajo' ? W : H) * (0.05 + 0.18 * azar() * (0.4 + s));
        mordidas.push(mordidaEnLado(lado, azar(), ancho, profundidad, azar, W, H));
      }
    }
  }

  const rayones: Rayon[] = [];
  const cuantosRayones = Math.round(interpolar(scratches.count, s));
  for (let i = 0; i < cuantosRayones; i += 1) rayones.push(rayonAleatorio(s, azar, W, H));

  const bloque = s < blur.minSeverity ? 1 : Math.round(1 + (blur.maxBlock - 1) * ((s - blur.minSeverity) / (1 - blur.minSeverity)) ** 1.6);

  return {
    severidad: s,
    semilla,
    mordidas,
    rayones,
    bloque,
    pixelar: s >= blur.pixelFrom,
    ruido: noise.alpha * s ** 1.3,
    gris: fade.gray * s,
    oscuridad: fade.dark * s,
    canto: W * whitening.depth * (0.5 + s),
  };
}

/**
 * Corrompe un texto: cambia por símbolos una fracción de sus letras que crece con la severidad,
 * y con la mayor la cambia ENTERA. Los dígitos y los espacios se respetan: el número de dex es lo
 * único que sigue entendiéndose en el grado 1, y los espacios conservan la silueta de las palabras.
 * Determinista (misma carta y grado, mismo texto roto).
 */
export function corromperTexto(texto: string, severidad: number, semilla: number): string {
  if (severidad <= 0) return texto;
  const { from, gain, unreadableFrom, glyphs } = DETERIORO.text;
  const prob = severidad >= unreadableFrom ? 1 : Math.min(1, Math.max(0, (severidad - from) * gain));
  if (prob <= 0) return texto;
  const azar = crearAzar(semilla);
  return Array.from(texto, (c) => {
    if (/[\s\d#]/.test(c)) return c;
    return azar() < prob ? glyphs[Math.floor(azar() * glyphs.length)] : c;
  }).join('');
}
