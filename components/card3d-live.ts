/**
 * Ajuste EN VIVO del efecto de la carta (banco de trabajo, no producción).
 *
 * POR QUÉ EXISTE
 * --------------
 * Afinar el efecto a ojo con recargas es lento y engañoso: se cambia un número, se
 * recarga, se mira, y no se puede comparar A contra B porque la carta flota y se
 * inclina sola. Este archivo deja mover las perillas con sliders y ver el resultado
 * al instante, y al final se copian los valores numéricos a `card3d-config.ts`.
 *
 * POR QUÉ UN OBJETO MUTABLE Y NO ESTADO DE REACT
 * ----------------------------------------------
 * Los valores se leen en el `useFrame` de cada carta, así que escribirlos aquí NO
 * re-renderiza nada: mover un slider no remonta la escena de R3F ni reinicia la
 * animación (que es justo lo que se quiere comparar). Con estado de React, cada
 * arrastre del slider re-renderizaría la escena entera — 8 canvas en la grilla — y el
 * ajuste se vería a tirones, imposible de juzgar.
 *
 * QUÉ PERILLA TOCAR, MEDIDO
 * -------------------------
 * Midiendo luminancia y saturación del arte (un "velo" = el arte sale más CLARO y
 * menos saturado), el aporte de cada capa sobre el arte en reposo:
 *
 *     gloss (barniz)        Δluminancia +40.5%   Δsaturación −21.9%   ← el que lava
 *     edge  (tinta/piel)    Δluminancia +24.9%   Δsaturación  −7.5%
 *     holo  (lámina)        Δluminancia  +0.8%   Δsaturación  −3.7%   ← irrelevante
 *
 * Es decir: si la carta se ve "lavada", se toca `gloss` y `edge`. Bajar `holo` no
 * cambia nada perceptible, y ese fue el error que costó varias vueltas.
 *
 * CÓMO USARLO
 * -----------
 * Abrir el detalle con `?tune=1` (ver `card3d-tuner.tsx`). Los sliders arrancan en los
 * valores de `card3d-config.ts`; los que se muevan se copian de vuelta a la config con
 * el botón, y sin el parámetro la app se comporta exactamente igual que siempre.
 */
import * as CFG from '@/components/card3d-config';

/**
 * Nombre legible + rango de cada perilla, para el panel.
 *
 * `grupo` decide en QUÉ COLUMNA del panel se pinta. El panel tiene dos: el
 * personaje (todo lo que afecta al frente de la carta) y el fondo (su capa
 * propia). Se agrupa así y no por "importancia" porque son dos efectos
 * INDEPENDIENTES: ajustar el fondo moviendo perillas del personaje no tiene
 * sentido, y mezclados en una sola lista el panel se vuelve una lista larga donde
 * no se sabe cuál manda sobre qué.
 */
export interface Knob {
  /** Clave en el objeto `live`. */
  key: keyof LiveKnobs;
  /** Etiqueta que se muestra en el panel. */
  label: string;
  /** Qué manda, en una línea. */
  hint: string;
  min: number;
  max: number;
  step: number;
  /**
   * Ruta en `card3d-config.ts` a la que se copia el valor al terminar de ajustar. Se
   * escribe literal para que el panel pueda mostrar exactamente qué línea tocar.
   */
  config: string;
  /** Columna del panel a la que pertenece la perilla. */
  grupo: Grupo;
}

/** Las dos columnas del panel. `frente` = personaje y carta; `fondo` = su capa. */
export type Grupo = 'frente' | 'fondo';

/** Título de cada columna, para el panel. */
export const GRUPOS: ReadonlyArray<{ id: Grupo; titulo: string; nota: string }> = [
  { id: 'frente', titulo: 'Personaje y carta', nota: 'El frente: barniz, tinta, lámina, emblemas y paralaje del logo.' },
  { id: 'fondo', titulo: 'Superficie', nota: 'El arte de la carta: su encuadre, su brillo y su micro-relieve. Ya no es una capa aparte.' },
];

/**
 * Las perillas que se pueden mover en vivo.
 *
 * Solo están las que el shader lee como UNIFORME. Un valor interpolado en el GLSL se
 * compila dentro del shader, así que cambiarlo obliga a recompilar el material: en vez
 * de fingir que se puede, esos se quedaron en la config y se ajustan ahí (el panel
 * lista el rango de los que sí responden).
 *
 * El ORDEN es de más a menos impacto medido sobre el arte, para que el primer slider
 * sea el que de verdad se quiere mover.
 */
export const KNOBS: readonly Knob[] = [
  { key: 'gloss', label: 'Barniz (gloss)', hint: 'El que más lava: +40% de luz medido', min: 0, max: 1, step: 0.01, config: 'INTENSITY.gloss', grupo: 'frente' },
  { key: 'edge', label: 'Realce de contornos del fondo', hint: 'Enciende la tinta del arte del fondo. Solo actúa sobre el fondo, nunca sobre el personaje', min: 0, max: 1, step: 0.01, config: 'EDGE.strength', grupo: 'fondo' },
  { key: 'holo', label: 'Lámina (holo)', hint: 'Arcoíris: apenas +0.8% de luz', min: 0, max: 1, step: 0.01, config: 'INTENSITY.holo', grupo: 'frente' },
  { key: 'faction', label: 'Emblemas de facción', hint: 'Opacidad de los emblemas superpuestos', min: 0, max: 1, step: 0.01, config: 'FACTION.strength', grupo: 'frente' },
  { key: 'glow', label: 'Resplandor exterior', hint: 'Aro de luz alrededor de la carta', min: 0, max: 1.5, step: 0.01, config: 'GLOW.strength', grupo: 'frente' },
  { key: 'layerWeight', label: 'Peso del color espectral', hint: 'Cuánto arcoíris se SUMA al arte (saturación)', min: 0, max: 0.2, step: 0.005, config: 'HOLOGRAM.layerWeight', grupo: 'frente' },
  { key: 'glossSelf', label: 'Luz propia del barniz', hint: 'Luz que el barniz añade por su cuenta', min: 0, max: 1, step: 0.01, config: 'COMPOSITE.glossSelf', grupo: 'frente' },
  { key: 'holoSelf', label: 'Luz propia de la lámina', hint: 'Luz que la lámina añade por su cuenta', min: 0, max: 1, step: 0.01, config: 'COMPOSITE.holoSelf', grupo: 'frente' },
  { key: 'highlightWeight', label: 'Respeto por las zonas claras', hint: 'Cuánto se frena el brillo sobre arte claro', min: 0, max: 1, step: 0.01, config: 'GLOSS.highlightWeight', grupo: 'frente' },
  { key: 'glareStrength', label: 'Barrido del puntero', hint: 'Brillo que sigue al cursor', min: 0, max: 1, step: 0.01, config: 'HOLOGRAM.glareStrength', grupo: 'frente' },
  { key: 'sheenStrength', label: 'Reflejo del metal', hint: 'El brillo que BARRE sobre el título y el wordmark siguiendo al cursor (0 = solo el metal pintado)', min: 0, max: 2, step: 0.01, config: 'LIVE_SHEEN.strength', grupo: 'frente' },
  { key: 'tiltFactor', label: 'Arcoíris al inclinar', hint: 'Cuánto sube el efecto con el tilt', min: 0, max: 5, step: 0.05, config: 'HOLOGRAM.tiltFactor', grupo: 'frente' },
  { key: 'baseMask', label: 'Piso del holograma', hint: 'Efecto visible con la carta quieta', min: 0, max: 1, step: 0.01, config: 'HOLOGRAM.baseMask', grupo: 'frente' },
  { key: 'logoParallax', label: 'Paralaje del logo', hint: 'El plano de DELANTE: al inclinar, la marca se despega del personaje', min: -0.2, max: 0.2, step: 0.005, config: 'LOGO.parallax', grupo: 'frente' },
  // --- columna SUPERFICIE --------------------------------------------------
  /**
   * Perillas que gobiernan el ARTE y el refuerzo local del holograma SOBRE LA CAPA 0.
   * No son un acabado propio del fondo: el fondo ES la superficie y recibe el mismo barniz,
   * la misma lamina y el mismo tinte de canto que todo el mesh. Pero una imagen suave
   * (acuario) no tiene metal para que la holografia se marque, asi que hay un refuerzo
   * local de la tinta espectral que solo afecta a donde hay fondo.
   */
  { key: 'bgHolo', label: 'Holografía del fondo', hint: 'Intensidad de la lámina SOBRE la capa 0: 0 = solo acabado base, 1 = igual que el personaje', min: 0, max: 1, step: 0.01, config: 'BACKGROUND.holo', grupo: 'fondo' },
  { key: 'bgLayerWeight', label: 'Peso de la lámina del fondo', hint: 'Cuánto de la lámina espectral se SUMA al arte del fondo (modulación, no luz)', min: 0, max: 1, step: 0.01, config: 'BACKGROUND.layerWeight', grupo: 'fondo' },
  { key: 'bgBaseMask', label: 'Piso del holograma del fondo', hint: 'Efecto holográfico del fondo visible con la carta quieta', min: 0, max: 3, step: 0.01, config: 'BACKGROUND.baseMask', grupo: 'fondo' },
  { key: 'bgTiltFactor', label: 'Arcoíris del fondo al inclinar', hint: 'Cuánto responde el holograma del fondo al tilt', min: 0, max: 6, step: 0.05, config: 'BACKGROUND.tiltFactor', grupo: 'fondo' },
  { key: 'bgArtFloor', label: 'Suelo del arte del fondo', hint: 'Cuánto del color original del fondo se conserva bajo la tinta (1 = imagen intacta)', min: 0, max: 1, step: 0.01, config: 'BACKGROUND.artFloor', grupo: 'fondo' },
  { key: 'bgFoilX', label: 'Foil del fondo: frecuencia X', hint: 'Cuántas franjas del grabado caben en horizontal. Más = patrón más denso', min: 0, max: 8, step: 0.1, config: 'BACKGROUND.foilX', grupo: 'fondo' },
  { key: 'bgFoilY', label: 'Foil del fondo: frecuencia Y', hint: 'Cuántas franjas del grabado caben en vertical', min: 0, max: 8, step: 0.1, config: 'BACKGROUND.foilY', grupo: 'fondo' },
  { key: 'bgFoilViewAngle', label: 'Foil del fondo: respuesta al ángulo', hint: 'Cuánto recorre el arcoíris al inclinar la carta. Más = más vivo', min: 0, max: 6, step: 0.1, config: 'BACKGROUND.foilViewAngle', grupo: 'fondo' },
  { key: 'bgDominantMix', label: 'Foil del fondo: color predominante', hint: 'Cuánto del arcoíris se sustituye por el color que domina el fondo. 0 = arcoíris puro, 1 = monocromo. En fondos grises o multicolor no actúa', min: 0, max: 1, step: 0.01, config: 'DOMINANT.mix', grupo: 'fondo' },
  { key: 'bgFoilDesaturation', label: 'Foil del fondo: saturación', hint: '0 = arcoíris puro, 1 = gris metálico sin color', min: 0, max: 1, step: 0.01, config: 'BACKGROUND.foilDesaturation', grupo: 'fondo' },
  { key: 'bgNoise', label: 'Textura de la superficie', hint: 'Micro-relieve de la superficie: 0 = lisa, 0.1 = grano visible. También controla el abollado del reflejo', min: 0, max: 0.15, step: 0.01, config: 'BG_NOISE.normalStrength', grupo: 'fondo' },
  // --- columna ACABADO (HDR) ----------------------------------------------
  { key: 'hdrBoost', label: 'Intensidad de los reflejos', hint: 'Cuánto se pasan de blanco las LUCES (metal, canto, holograma). No toca el arte: subirlo hace los brillos más fogosos', min: 0, max: 4, step: 0.05, config: 'HDR.highlightBoost', grupo: 'frente' },
  { key: 'metalReflect', label: 'Reflejo de espejo', hint: 'Cuánto refleja el metal la imagen de entorno (0 = mate, 1 = espejo pleno). Afecta solo al título y al wordmark', min: 0, max: 1.5, step: 0.02, config: 'METAL_REFLECT.strength', grupo: 'frente' },
  { key: 'hdrCeiling', label: 'Techo del brillo', hint: 'Cuánta luz puede sumarse sobre la imagen. Subirlo da reflejos más luminosos; es lo que se sube para un look más fogoso', min: 0.1, max: 1.5, step: 0.02, config: 'HDR.lightCeiling', grupo: 'frente' },
];

/** Valores que se leen en cada frame. Las claves son las de `KNOBS`. */
export interface LiveKnobs {
  gloss: number;
  edge: number;
  holo: number;
  faction: number;
  glow: number;
  layerWeight: number;
  glossSelf: number;
  holoSelf: number;
  highlightWeight: number;
  glareStrength: number;
  /** Reflejo vivo del metal sobre título y wordmark. */
  sheenStrength: number;
  tiltFactor: number;
  baseMask: number;

  /** Textura de micro-superficie de la lámina. */
  bgNoise: number;
  /** Refuerzo local de la lámina holográfica SOBRE la capa 0. */
  bgHolo: number;
  /** Cuánto de esa lámina se SUMA al arte del fondo. */
  bgLayerWeight: number;
  /** Piso de la holografía local del fondo (carta quieta). */
  bgBaseMask: number;
  /** Cuánto responde la holografía local del fondo al tilt. */
  bgTiltFactor: number;
  /** Cuánto del color original del fondo se conserva bajo la tinta. */
  bgArtFloor: number;
  /** Ganancia de la modulación de la lámina por la luminancia del arte. */
  bgArtGain: number;
  /** Foil del fondo: frecuencia del grabado por eje, respuesta al ángulo y saturación. */
  bgFoilX: number;
  bgFoilY: number;
  bgFoilViewAngle: number;
  bgFoilDesaturation: number;
  /** Mezcla del foil del fondo con el color predominante de la superficie. */
  bgDominantMix: number;
  /** HDR: ganancia de luces y codo de compresión. */
  hdrBoost: number;
  hdrCeiling: number;
  /** Reflejo de espejo del metal. */
  metalReflect: number;
  /** Paralaje del LOGO: el plano de delante, el que más se desplaza. */
  logoParallax: number;
}

/**
 * Valores de partida: los de la config. Se copia a propósito en vez de leer el objeto
 * de la config en cada frame, porque este objeto se MUTA y `as const` es de solo
 * lectura.
 */
export const DEFAULTS: LiveKnobs = {
  gloss: CFG.INTENSITY.gloss.detail,
  edge: CFG.EDGE.strength,
  holo: CFG.INTENSITY.holo.detail,
  faction: CFG.FACTION.strength,
  glow: CFG.GLOW.strength,
  layerWeight: CFG.HOLOGRAM.layerWeight,
  glossSelf: CFG.COMPOSITE.glossSelf,
  holoSelf: CFG.COMPOSITE.holoSelf,
  highlightWeight: CFG.GLOSS.highlightWeight,
  glareStrength: CFG.HOLOGRAM.glareStrength,
  sheenStrength: CFG.LIVE_SHEEN.strength,
  tiltFactor: CFG.HOLOGRAM.tiltFactor,
  baseMask: CFG.HOLOGRAM.baseMask,
  bgNoise: CFG.BG_NOISE.normalStrength,
  bgHolo: CFG.BACKGROUND.holo,
  bgLayerWeight: CFG.BACKGROUND.layerWeight,
  bgBaseMask: CFG.BACKGROUND.baseMask,
  bgTiltFactor: CFG.BACKGROUND.tiltFactor,
  bgArtFloor: CFG.BACKGROUND.artFloor,
  bgArtGain: CFG.BACKGROUND.artGain,
  bgFoilX: CFG.BACKGROUND.foilX,
  bgFoilY: CFG.BACKGROUND.foilY,
  bgFoilViewAngle: CFG.BACKGROUND.foilViewAngle,
  bgFoilDesaturation: CFG.BACKGROUND.foilDesaturation,
  bgDominantMix: CFG.DOMINANT.mix,
  hdrBoost: CFG.HDR.highlightBoost,
  hdrCeiling: CFG.HDR.lightCeiling,
  metalReflect: CFG.METAL_REFLECT.strength,
  logoParallax: CFG.LOGO.parallax,
};

/**
 * El objeto que leen las cartas en cada frame. Ver la cabecera: mutable a propósito.
 *
 * Los valores iniciales son los de `DEFAULTS`, pero la carta NO los usa mientras nadie
 * mueva un slider: los de verdad son los que le pasan las props (`tile` en la grilla,
 * `detail` en la ficha). Ese "nadie lo ha tocado" se pregunta a `tocadas`, no se deduce
 * comparando el valor con el de partida: si `tile` y `detail` coinciden por casualidad,
 * o el usuario deja el slider justo en el valor inicial, comparar valores daría la
 * respuesta equivocada y el frame pisaría la prop de la vista.
 */
export const live: LiveKnobs = { ...DEFAULTS };

/** Claves que el panel de ajuste ha movido de verdad. Vacío en la app normal. */
export const tocadas = new Set<keyof LiveKnobs>();

/** ¿El panel movió esta perilla? Es lo que decide si su valor manda sobre la prop. */
export function tocada(clave: keyof LiveKnobs): boolean {
  return tocadas.has(clave);
}

/** Escribe una perilla desde el panel y la marca como tocada. */
export function setKnob(clave: keyof LiveKnobs, valor: number): void {
  live[clave] = valor;
  tocadas.add(clave);
}

/** Vuelve todo a los valores de la config. */
export function resetLive(): void {
  Object.assign(live, DEFAULTS);
  tocadas.clear();
}

/**
 * Solo los valores que se han movido y ADEMÁS difieren de la config, listos para pegar.
 *
 * Se filtra por `tocadas` y no solo por la diferencia: mover un slider y devolverlo a su
 * valor de partida no es un cambio que haya que copiar a la config.
 */
export function cambios(): Partial<LiveKnobs> {
  const out: Partial<LiveKnobs> = {};
  for (const [clave, valor] of Object.entries(live) as Array<[keyof LiveKnobs, number]>) {
    if (tocadas.has(clave) && valor !== DEFAULTS[clave]) out[clave] = valor;
  }
  return out;
}
