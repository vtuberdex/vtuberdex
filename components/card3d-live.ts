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

/** Nombre legible + rango de cada perilla, para el panel. */
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
}

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
  { key: 'gloss', label: 'Barniz (gloss)', hint: 'El que más lava: +40% de luz medido', min: 0, max: 1, step: 0.01, config: 'INTENSITY.gloss' },
  { key: 'edge', label: 'Tinta y piel (edge)', hint: 'Realce de contornos: +25% de luz', min: 0, max: 1, step: 0.01, config: 'EDGE.strength' },
  { key: 'holo', label: 'Lámina (holo)', hint: 'Arcoíris: apenas +0.8% de luz', min: 0, max: 1, step: 0.01, config: 'INTENSITY.holo' },
  { key: 'faction', label: 'Emblemas de facción', hint: 'Opacidad de los emblemas superpuestos', min: 0, max: 1, step: 0.01, config: 'FACTION.strength' },
  { key: 'glow', label: 'Resplandor exterior', hint: 'Aro de luz alrededor de la carta', min: 0, max: 1.5, step: 0.01, config: 'GLOW.strength' },
  { key: 'layerWeight', label: 'Peso del color espectral', hint: 'Cuánto arcoíris se SUMA al arte (saturación)', min: 0, max: 0.2, step: 0.005, config: 'HOLOGRAM.layerWeight' },
  { key: 'glossSelf', label: 'Luz propia del barniz', hint: 'Luz que el barniz añade por su cuenta', min: 0, max: 1, step: 0.01, config: 'COMPOSITE.glossSelf' },
  { key: 'holoSelf', label: 'Luz propia de la lámina', hint: 'Luz que la lámina añade por su cuenta', min: 0, max: 1, step: 0.01, config: 'COMPOSITE.holoSelf' },
  { key: 'highlightWeight', label: 'Respeto por las zonas claras', hint: 'Cuánto se frena el brillo sobre arte claro', min: 0, max: 1, step: 0.01, config: 'GLOSS.highlightWeight' },
  { key: 'glareStrength', label: 'Barrido del puntero', hint: 'Brillo que sigue al cursor', min: 0, max: 1, step: 0.01, config: 'HOLOGRAM.glareStrength' },
  { key: 'tiltFactor', label: 'Arcoíris al inclinar', hint: 'Cuánto sube el efecto con el tilt', min: 0, max: 5, step: 0.05, config: 'HOLOGRAM.tiltFactor' },
  { key: 'baseMask', label: 'Piso del holograma', hint: 'Efecto visible con la carta quieta', min: 0, max: 1, step: 0.01, config: 'HOLOGRAM.baseMask' },
  { key: 'bgHolo', label: 'Fondo: intensidad', hint: 'Holograma de la capa de fondo (más fuerte que el del personaje)', min: 0, max: 1.5, step: 0.01, config: 'BACKGROUND.holo' },
  { key: 'bgLayerWeight', label: 'Fondo: saturación', hint: 'Cuánto arcoíris se SUMA al fondo', min: 0, max: 1, step: 0.01, config: 'BACKGROUND.layerWeight' },
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
  tiltFactor: number;
  baseMask: number;
  /** Holograma de la capa de FONDO: se ajusta aparte del del personaje. */
  bgHolo: number;
  bgLayerWeight: number;
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
  tiltFactor: CFG.HOLOGRAM.tiltFactor,
  baseMask: CFG.HOLOGRAM.baseMask,
  bgHolo: CFG.BACKGROUND.holo,
  bgLayerWeight: CFG.BACKGROUND.layerWeight,
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
