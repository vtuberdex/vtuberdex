// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * PMREM sin generar mipmaps sobre un cube map VACÍO.
 *
 * EL AVISO: Firefox escribe seis veces «generateMipmap: Tex image TEXTURE_CUBE_MAP_* level 0 is
 * incurring lazy initialization» al cargar el libro. Medido con una sonda sobre `generateMipmap`
 * (Chromium + CDP): sale de `PMREMGenerator.fromEquirectangular` de three r187. El generador copia
 * primero la textura a un cube map de ORIGEN (`_sourceTarget`) que crea con `generateMipmaps: true`,
 * y three genera los mipmaps de un render target al RESERVARLO (`setupRenderTarget`), antes de
 * dibujar nada: el navegador tiene que rellenar con ceros seis caras que nadie escribió. No se ve
 * nada mal (los mipmaps buenos se generan después de dibujar), pero es trabajo tirado y ruido.
 *
 * EL ARREGLO: se le da al generador ese cube map de origen ya reservado SIN mipmaps
 * (`initRenderTarget`) y solo entonces se encienden los mipmaps: el reservado no los genera y la
 * actualización de después de dibujar (`updateRenderTargetMipmap`) sí, ya con datos.
 *
 * Usa un campo privado de three (`_sourceTarget`). Si una versión futura lo cambia, esto no hace
 * nada (vuelve el aviso, no se rompe el entorno): si el tamaño no cuadra, three suelta el nuestro y
 * crea el suyo como siempre.
 */
import {
  HalfFloatType,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  MathUtils,
  PMREMGenerator,
  WebGLCubeRenderTarget,
  type Texture,
  type WebGLRenderer,
} from "three";

/** `MIN_SIZE` de `PMREMGenerator` (r187): el lado del cube map nunca baja de esto. */
const LADO_MINIMO = 256;

type PmremInterno = { _sourceTarget?: WebGLCubeRenderTarget | null };

/** Lado del cube map de origen tal como lo calcula `PMREMGenerator._setSize`. */
export function ladoDeOrigen(lado: number): number {
  return Math.max(LADO_MINIMO, MathUtils.floorPowerOfTwo(lado));
}

/**
 * Entrega al generador un cube map de origen ya reservado sin mipmaps. Devuelve `false` (y no toca
 * nada) si el generador ya tiene uno o si three cambió por dentro.
 */
export function prepararOrigenDePmrem(
  pmrem: PMREMGenerator,
  renderer: Pick<WebGLRenderer, "initRenderTarget">,
  lado: number,
  profundidad: boolean,
): boolean {
  const interno = pmrem as unknown as PmremInterno;
  if (!("_sourceTarget" in interno) || interno._sourceTarget !== null) {
    return false;
  }
  if (typeof renderer.initRenderTarget !== "function") {
    return false;
  }
  const origen = new WebGLCubeRenderTarget(ladoDeOrigen(lado), {
    minFilter: LinearMipmapLinearFilter,
    generateMipmaps: false,
    type: HalfFloatType,
    colorSpace: LinearSRGBColorSpace,
    depthBuffer: profundidad,
  });
  renderer.initRenderTarget(origen);
  origen.texture.generateMipmaps = true;
  interno._sourceTarget = origen;
  return true;
}

/** `fromEquirectangular` sin el aviso. El generador se libera aquí; la textura devuelta, no. */
export function prefiltrarEquirectangular(
  renderer: WebGLRenderer,
  equirectangular: Texture,
): Texture {
  const pmrem = new PMREMGenerator(renderer);
  const ancho = (equirectangular.image as { width?: number } | null)?.width;
  if (ancho) {
    prepararOrigenDePmrem(pmrem, renderer, ancho / 4, false);
  }
  const prefiltrada = pmrem.fromEquirectangular(equirectangular).texture;
  pmrem.dispose();
  return prefiltrada;
}
