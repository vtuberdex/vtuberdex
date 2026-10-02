'use client';
/**
 * Texturas, uniforms y materiales de UNA carta holográfica, como hook reutilizable.
 *
 * POR QUÉ SALIÓ DE `holo-card.tsx`
 * -------------------------------
 * `CardMesh` mezclaba dos cosas: cómo se PINTA la carta (capas, máscaras, uniforms,
 * perillas en vivo) y cómo se MUEVE en su escena (inclinación hacia el puntero,
 * flotación, cámara). El libro del catálogo (`card-binder.tsx`) necesita la primera
 * mitad exacta para 8 cartas en UNA escena y una física distinta (las cartas van planas
 * en su funda, el libro es lo que se inclina). Duplicar la generación de texturas habría
 * dejado dos copias que divergen; aquí hay una sola y las dos escenas la consumen.
 *
 * El guard `npm run check:shaders` compara los uniforms que crea la CPU con los que
 * leen los shaders, y lee ESTE archivo (`DECLARANTE` en `scripts/check-shaders.mjs`):
 * si un uniform se crea en otro sitio, el guard no lo ve.
 *
 * MEMORIA COMPARTIDA ENTRE CARTAS DE UNA MISMA ESCENA
 * ---------------------------------------------------
 * El mapa de entorno del metal (`metal-env.webp`) y su versión prefiltrada (PMREM) son
 * iguales para todas las cartas. Con un canvas por carta no había forma de compartirlos;
 * en el libro se cargan UNA vez (`CardEnvProvider`) y las cartas los reciben por
 * contexto. La carta suelta del detalle sigue cargando el suyo, como siempre.
 *
 * La GENERACIÓN de texturas (canvas 2D, el coste dominante medido en `card-quality.ts`)
 * pasa por una cola de UNA en una con un respiro entre trabajos: ocho cartas que llegan
 * juntas de la API ya no bloquean el hilo en un solo tramo largo; cada una aparece en
 * cuanto termina la suya.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { VtuberCard } from '@/lib/types';
import metalEnvUrl from './metal-env.webp';
import { cardPalette } from '@/lib/color';
import * as CFG from '@/components/card3d-config';
import { LAYER_UNIFORM_NAMES } from '@/components/card3d-config';
import { live, tocada } from '@/components/card3d-live';
import {
  CARD_TEXTURE_FULL_WIDTH,
  drawCardLayers,
  inkAndSkinMask,
  logoMask,
  logoSticker,
  loadImage,
} from '@/components/card-texture';
import { cardFragmentShader, cardVertexShader, glowFragmentShader, glowVertexShader } from '@/components/shaders';
import { buildCardBodyGeometry } from '@/components/card3d-geometry';
import { iconosDeFaccion } from '@/components/card-texture/facciones';
import { colorPredominante, type ColorPredominante } from '@/components/card-texture/predominante';

/** Proporción real de una carta coleccionable (5x7 pulgadas -> 1.4). */
const CARD_W = CFG.GEOMETRY.cardWidth;
const CARD_H = CARD_W * CFG.GEOMETRY.aspect;

/* ----------------------------------------------------------------------------
 * Cola de generación de texturas.
 * ------------------------------------------------------------------------- */

let cola: Promise<void> = Promise.resolve();

/**
 * Encola un trabajo de CPU y lo ejecuta cuando terminen los anteriores, cediendo el
 * hilo entre uno y otro (`setTimeout 0`) para que el navegador pueda pintar y atender
 * la entrada. El trabajo puede comprobar su propia cancelación antes de hacer nada.
 */
export function encolarTrabajo(trabajo: () => void): Promise<void> {
  cola = cola
    .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    .then(trabajo)
    .catch((error) => {
      console.warn('[card-material] fallo al generar texturas', error);
    });
  return cola;
}

/* ----------------------------------------------------------------------------
 * Entorno compartido.
 * ------------------------------------------------------------------------- */

export interface SharedCardEnv {
  /** Equirectangular del cielo metálico (reflejo de espejo de la cara). */
  envMap: THREE.Texture | null;
  /** El mismo cielo prefiltrado con PMREM: lo único que `MeshStandardMaterial` usa. */
  bodyEnvMap: THREE.Texture | null;
}

export const CardEnvContext = createContext<SharedCardEnv | null>(null);

/**
 * Carga el entorno UNA vez por escena y lo reparte por contexto. Montarlo dentro del
 * `<Canvas>`: necesita el renderer para el PMREM.
 */
export function useSharedCardEnv(): SharedCardEnv {
  const { gl } = useThree();
  const [envMap, setEnvMap] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadImage(metalEnvUrl as unknown as string)
      .then((img) => {
        if (cancelled || !img) return;
        const tex = new THREE.CanvasTexture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        setEnvMap(tex);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const bodyEnvMap = useMemo(() => {
    if (!envMap) return null;
    const pmrem = new THREE.PMREMGenerator(gl);
    const prefiltrada = pmrem.fromEquirectangular(envMap).texture;
    pmrem.dispose();
    return prefiltrada;
  }, [envMap, gl]);

  useEffect(
    () => () => {
      envMap?.dispose();
      bodyEnvMap?.dispose();
    },
    [envMap, bodyEnvMap],
  );

  return useMemo(() => ({ envMap, bodyEnvMap }), [envMap, bodyEnvMap]);
}

/* ----------------------------------------------------------------------------
 * El hook.
 * ------------------------------------------------------------------------- */

export interface CardMaterialOptions {
  holo?: number;
  gloss?: number;
  textureWidth?: number;
  /** Geometría del cuerpo compartida (el libro construye una para las 8 cartas). */
  bodyGeometry?: THREE.BufferGeometry;
}

export interface CardUniforms {
  front: Record<string, { value: unknown }>;
  glow: Record<string, { value: unknown }>;
}

export interface CardMaterials {
  /** `true` cuando las capas ya están en la GPU: antes la carta no tiene nada que mostrar. */
  ready: boolean;
  uniforms: CardUniforms;
  frontMaterial: THREE.ShaderMaterial;
  glowMaterial: THREE.ShaderMaterial;
  bodyGeometry: THREE.BufferGeometry;
  bodyEnvMap: THREE.Texture | null;
  cardWidth: number;
  cardHeight: number;
  /** Actualización por frame: tiempo, puntero (NDC) e inclinación (rad) que ve el shader. */
  tick: (time: number, pointer: { x: number; y: number }, tilt: { x: number; y: number }) => void;
}

interface CardTextures {
  /** Color predominante de la superficie: tiñe el foil del fondo (ver `DOMINANT`). */
  dominant: ColorPredominante;
  layers: THREE.CanvasTexture[];
  edge: THREE.CanvasTexture;
  logoMask: THREE.CanvasTexture;
  logoSticker: THREE.CanvasTexture;
  /** Mapa de entorno propio (solo cuando NO hay uno compartido; puede faltar). */
  envMap: THREE.CanvasTexture | null;
}

export function useCardMaterials(card: VtuberCard, options: CardMaterialOptions = {}): CardMaterials {
  const {
    holo = CFG.INTENSITY.holo.default,
    gloss = CFG.INTENSITY.gloss.default,
    textureWidth,
    bodyGeometry: sharedBody,
  } = options;
  const shared = useContext(CardEnvContext);
  const { gl } = useThree();
  const [textures, setTextures] = useState<CardTextures | null>(null);
  const palette = useMemo(() => cardPalette(card.themeColor, card.secondaryColor), [card.themeColor, card.secondaryColor]);

  const ownBody = useMemo(() => (sharedBody ? null : buildCardBodyGeometry()), [sharedBody]);
  useEffect(() => () => ownBody?.dispose(), [ownBody]);
  const bodyGeometry = sharedBody ?? (ownBody as THREE.BufferGeometry);

  /**
   * ENTORNO DEL CANTO por PMREM.
   *
   * POR QUE NO BASTA PASAR EL WEBP COMO `envMap`
   * --------------------------------------------
   * Medido: con `envMap={textura}` el render salia BYTE-IDENTICO al caso sin entorno
   * (maxdiff 0 en 1,4 M de bytes). La causa esta en three.js: un MeshStandardMaterial solo
   * usa el mapa de entorno por la via IBL del shader
   * (envmap_physical_pars_fragment), y ahi `getIBLRadiance`/`getIBLIrradiance` devuelven
   * vec3(0.0) salvo que la textura sea CubeUV:
   *
   *   #ifdef ENVMAP_TYPE_CUBE_UV  ...  #else  return vec3( 0.0 );  #endif
   *
   * Una textura equirect de imagen normal NO tiene ese tipo, asi que no aporta NADA. Hay que
   * prefiltrarla con PMREMGenerator para obtener el CubeUV (y de paso le da los mips que
   * necesita el desenfoque por rugosidad). Con el PMREM: maxdiff 204, 12062 px cambiados y el
   * canto pasa de 129.4 a 169.6 de luminancia — se ve el bisel en vez de una pared negra.
   *
   * Con entorno COMPARTIDO (el libro) el PMREM ya viene hecho y aquí no se calcula otro.
   */
  const ownEnv = shared ? null : textures?.envMap ?? null;
  const ownBodyEnvMap = useMemo(() => {
    if (!ownEnv) return null;
    const pmrem = new THREE.PMREMGenerator(gl);
    const prefiltrada = pmrem.fromEquirectangular(ownEnv).texture;
    pmrem.dispose();
    return prefiltrada;
  }, [ownEnv, gl]);
  useEffect(() => () => ownBodyEnvMap?.dispose(), [ownBodyEnvMap]);
  const bodyEnvMap = shared ? shared.bodyEnvMap : ownBodyEnvMap;

  useEffect(() => {
    let cancelled = false;
    const artSrc = card.images.character ?? card.images.card ?? '';
    /**
     * El MAPA DE ENTORNO del reflejo de espejo se carga en el MISMO Promise.all que las
     * capas. Va aparte del fondo a propósito: el reflejo describe dónde está el metal, no
     * qué hay impreso detrás (ver METAL_REFLECT). Se pide el arte del personaje como
     * respaldo para que el conjunto no se rechace si el entorno no está. Si la escena ya
     * trae un entorno compartido, no se vuelve a descargar ni a decodificar.
     */
    Promise.all([
      loadImage(artSrc),
      loadImage(card.images.logo ?? ''),
      loadImage(card.images.background ?? ''),
      shared ? Promise.resolve(null) : loadImage(metalEnvUrl as unknown as string).catch(() => null),
    ]).then(([art, logo, background, envMap]) => {
      if (cancelled) return;
      encolarTrabajo(() => {
        if (cancelled) return;
        const width = textureWidth ?? CARD_TEXTURE_FULL_WIDTH;

        // 7 capas: fondo, personaje, logo, título, textos, tags, wordmark.
        const layerCanvases = drawCardLayers({ card, art, logo, background, width });
        const layers = [
          layerCanvases.background,
          layerCanvases.character,
          layerCanvases.logo,
          layerCanvases.title,
          layerCanvases.texts,
          layerCanvases.tags,
          layerCanvases.wordmark,
        ].map((canvas) => {
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          tex.needsUpdate = true;
          return tex;
        });

        /**
         * Capa COMBINADA: se usa SOLO como fuente de la máscara de tinta y piel.
         *
         * Antes también alimentaba un uMap de respaldo, que se eliminó al pasarse el
         * shader a las 7 capas (18 samplers contra el límite de 16 del driver: la carta
         * salía negra). La máscara de tinta no se puede calcular por capa porque el
         * lineart y la piel son propiedades del ARTE, así que la combinada se mantiene
         * para ese único cálculo y no se sube como textura.
         */
        const flatCanvas = document.createElement('canvas');
        flatCanvas.width = width;
        flatCanvas.height = layers[0].image.height;
        const flatCtx = flatCanvas.getContext('2d');
        if (flatCtx) {
          flatCtx.drawImage(layerCanvases.background, 0, 0);
          flatCtx.drawImage(layerCanvases.character, 0, 0);
          flatCtx.drawImage(layerCanvases.logo, 0, 0);
          flatCtx.drawImage(layerCanvases.title, 0, 0);
          flatCtx.drawImage(layerCanvases.texts, 0, 0);
          flatCtx.drawImage(layerCanvases.tags, 0, 0);
          flatCtx.drawImage(layerCanvases.wordmark, 0, 0);
        }

        const edgeTexture = new THREE.CanvasTexture(inkAndSkinMask(flatCanvas, width, flatCanvas.height));
        edgeTexture.colorSpace = THREE.SRGBColorSpace;
        edgeTexture.anisotropy = 4;
        edgeTexture.needsUpdate = true;

        const logoBox = layerCanvases.info.logoBox;
        const emptyCanvas = document.createElement('canvas');
        emptyCanvas.width = width;
        emptyCanvas.height = flatCanvas.height;
        const logoMaskTexture = new THREE.CanvasTexture(
          logoBox && logo ? logoMask(logo, logoBox, width, flatCanvas.height) : emptyCanvas,
        );
        const logoStickerTexture = new THREE.CanvasTexture(
          logoBox && logo ? logoSticker(logo, logoBox, width, flatCanvas.height) : emptyCanvas,
        );

        const envTexture = envMap
          ? (() => {
              const t = new THREE.CanvasTexture(envMap);
              t.colorSpace = THREE.SRGBColorSpace;
              t.anisotropy = 8;
              t.needsUpdate = true;
              return t;
            })()
          : null;

        setTextures({
          dominant: colorPredominante(layerCanvases.background),
          layers,
          edge: edgeTexture,
          logoMask: logoMaskTexture,
          logoSticker: logoStickerTexture,
          envMap: envTexture,
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [card, textureWidth, shared]);

  useEffect(
    () => () => {
      textures?.layers.forEach((t) => t.dispose());
      textures?.edge.dispose();
      textures?.logoMask.dispose();
      textures?.logoSticker.dispose();
      textures?.envMap?.dispose();
    },
    [textures],
  );

  const [factionTextures, setFactionTextures] = useState<THREE.Texture[]>([]);
  useEffect(() => {
    let cancelled = false;
    // La MISMA lista que usa la textura del título para pintar los engarces.
    const icons = iconosDeFaccion(card);
    setFactionTextures([]);
    if (icons.length === 0) return undefined;
    Promise.all(icons.map((src) => loadImage(src))).then((imgs) => {
      if (cancelled) return;
      const texs = imgs
        .filter((img): img is HTMLImageElement => Boolean(img))
        .map((img) => {
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          tex.needsUpdate = true;
          return tex;
        });
      setFactionTextures(texs);
    });
    return () => {
      cancelled = true;
    };
  }, [card]);

  useEffect(() => () => factionTextures.forEach((t) => t.dispose()), [factionTextures]);

  const uniforms = useMemo<CardUniforms>(() => {
    const accent = new THREE.Color(palette.accent);
    const secondary = new THREE.Color(palette.secondary);
    const front: Record<string, { value: unknown }> = {
      uEdgeMap: { value: null as THREE.Texture | null },
      uEdgeStrength: { value: CFG.EDGE.strength as number },
      uFactionMap0: { value: null as THREE.Texture | null },
      uFactionMap1: { value: null as THREE.Texture | null },
      uFactionCounts: { value: new THREE.Vector2(0, 0) },
      uBgDominant: { value: new THREE.Vector3(0, 0, 0) },
      uBgDominantAmount: { value: 0 },
      uBgDominantMix: { value: CFG.DOMINANT.mix as number },
      uFactionStrength: { value: CFG.FACTION.strength as number },
      uAccent: { value: accent },
      uSecondary: { value: secondary },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uTilt: { value: new THREE.Vector2(0, 0) },
      uTime: { value: 0 },
      uHolo: { value: holo },
      uHasHolo: { value: card.themeColor ? 1 : CFG.INTENSITY.holo.noThemeFloor },
      uGloss: { value: gloss },
      uCardSize: { value: new THREE.Vector2(CARD_W, CARD_H) },
      uArtZone: { value: new THREE.Vector2(CFG.ART_ZONE.top, CFG.ART_ZONE.bottom) },
      uLogoMask: { value: null as THREE.Texture | null },
      uLogoSticker: { value: null as THREE.Texture | null },
      uCardRadius: { value: CFG.GEOMETRY.cornerRadius },
      uLayerWeight: { value: CFG.HOLOGRAM.layerWeight as number },
      uGlareStrength: { value: CFG.HOLOGRAM.glareStrength as number },
      uSheenStrength: { value: CFG.LIVE_SHEEN.strength as number },
      uTiltFactor: { value: CFG.HOLOGRAM.tiltFactor as number },
      uBaseMask: { value: CFG.HOLOGRAM.baseMask as number },
      uGlossSelf: { value: CFG.COMPOSITE.glossSelf as number },
      uHoloSelf: { value: CFG.COMPOSITE.holoSelf as number },
      uHighlightWeight: { value: CFG.GLOSS.highlightWeight as number },
      /**
       * HDR: ganancia de luces y techo del canal de luz. Van como uniforms (no como
       * literales del shader) para poder medirlos y ajustarlos en vivo: el techo decide
       * cuánta luz puede llegar a sumarse sobre el arte, y sin poder moverlo no habría
       * forma de calibrarlo.
       */
      uHdrBoost: { value: CFG.HDR.highlightBoost as number },
      uHdrCeiling: { value: CFG.HDR.lightCeiling as number },
      /**
       * Textura de micro-superficie del fondo. Es un uniform y no una constante del
       * shader por la misma razón: con 0 el fondo vuelve a ser la lámina lisa, que es la
       * comparación exacta para medir cuánto aporta el ruido.
       */
      uBgNoiseStrength: { value: CFG.BG_NOISE.normalStrength as number },
      uMetalReflect: { value: CFG.METAL_REFLECT.strength as number },
      uMetalBump: { value: CFG.METAL_REFLECT.bump as number },
      uMetalBumpScale: { value: CFG.METAL_REFLECT.bumpScale as number },
      uMetalEnvMap: { value: null as THREE.Texture | null },
      uMetalGain: { value: CFG.METAL_REFLECT.gain as number },
      uLogoParallax: { value: CFG.LOGO.parallax as number },
      uParallaxFactors: { value: new Float32Array(CFG.LAYER_PARALLAX_FACTORS) },
      uBgHolo: { value: CFG.BACKGROUND.holo as number },
      uBgLayerWeight: { value: CFG.BACKGROUND.layerWeight as number },
      uBgBaseMask: { value: CFG.BACKGROUND.baseMask as number },
      uBgTiltFactor: { value: CFG.BACKGROUND.tiltFactor as number },
      uBgArtFloor: { value: CFG.BACKGROUND.artFloor as number },
      uBgArtGain: { value: CFG.BACKGROUND.artGain as number },
      uBgFoilX: { value: CFG.BACKGROUND.foilX as number },
      uBgFoilY: { value: CFG.BACKGROUND.foilY as number },
      uBgFoilViewAngle: { value: CFG.BACKGROUND.foilViewAngle as number },
      uBgFoilDesaturation: { value: CFG.BACKGROUND.foilDesaturation as number },
    };

    // Generar uniforms de capas desde la config.
    LAYER_UNIFORM_NAMES.forEach((name) => {
      front[name] = { value: null as THREE.Texture | null };
    });

    return {
      front,
      glow: {
        uGlowColor: { value: accent.clone() },
        uGlowStrength: { value: CFG.GLOW.strength as number },
        uCardRect: { value: new THREE.Vector2(1 / CFG.GEOMETRY.glowSpread, 1 / CFG.GEOMETRY.glowSpread) },
        uCardRadius: { value: CFG.GEOMETRY.cornerRadius / CFG.GEOMETRY.glowSpread },
        uTime: { value: 0 },
        uSmokeScale: { value: CFG.GLOW.smokeScale as number },
        uSmokeSpeed: { value: CFG.GLOW.smokeSpeed as number },
        uSmokeOctaves: { value: CFG.GLOW.smokeOctaves as number },
        uSpectralScale: { value: CFG.GLOW.spectralScale as number },
        uSpectralSpeed: { value: CFG.GLOW.spectralSpeed as number },
        uSpectralMix: { value: CFG.GLOW.spectralMix as number },
      },
    };
  }, [palette.accent, palette.secondary, holo, gloss, card.themeColor]);

  /**
   * `useLayoutEffect`, no `useEffect`: `ready` se enciende en el MISMO commit en que
   * llegan las texturas, y R3F pinta en rAF, que puede caer ENTRE ese commit y un efecto
   * pasivo. En ese hueco la carta era visible con los samplers aún a null y el shader
   * descartaba toda la cara: una placa gris (solo el cuerpo metálico) durante un frame.
   * A 60 fps es un parpadeo; en el libro, con 8 cartas llegando en cola, se veía. El
   * efecto de layout corre antes de que el navegador pinte, así que no hay hueco.
   */
  useLayoutEffect(() => {
    if (!textures) return;
    LAYER_UNIFORM_NAMES.forEach((name, i) => {
      (uniforms.front[name] as { value: THREE.Texture | null }).value = textures.layers[i] ?? null;
    });
    uniforms.front.uEdgeMap.value = textures.edge;
    uniforms.front.uLogoMask.value = textures.logoMask;
    uniforms.front.uLogoSticker.value = textures.logoSticker;
    (uniforms.front.uBgDominant.value as THREE.Vector3).set(...textures.dominant.rgb);
    uniforms.front.uBgDominantAmount.value = textures.dominant.amount;
  }, [textures, uniforms]);

  const envMapForFace = shared ? shared.envMap : textures?.envMap ?? null;
  useLayoutEffect(() => {
    uniforms.front.uMetalEnvMap.value = envMapForFace;
  }, [envMapForFace, uniforms]);

  useLayoutEffect(() => {
    /**
     * Con UNA facción el emblema va al slot de la DERECHA (el 1), pegado al borde de la placa,
     * igual que su engarce en la textura del título; con dos, cada uno en el suyo. Rellenar desde
     * el slot 0 dejaba el único emblema separado de su engarce.
     */
    const [primero, segundo] = factionTextures;
    const derecha = segundo ?? primero ?? null;
    const izquierda = segundo ? primero : null;
    uniforms.front.uFactionMap0.value = izquierda ?? null;
    uniforms.front.uFactionMap1.value = derecha;
    (uniforms.front.uFactionCounts.value as THREE.Vector2).set(izquierda ? 1 : 0, derecha ? 1 : 0);
  }, [factionTextures, uniforms]);

  useEffect(() => {
    uniforms.front.uHolo.value = holo;
  }, [holo, uniforms]);

  useEffect(() => {
    uniforms.front.uGloss.value = gloss;
  }, [gloss, uniforms]);

  const frontMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: cardVertexShader,
        fragmentShader: cardFragmentShader,
        uniforms: uniforms.front,
        transparent: true,
        side: THREE.FrontSide,
      }),
    [uniforms],
  );

  const glowMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: glowVertexShader,
        fragmentShader: glowFragmentShader,
        uniforms: uniforms.glow,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );

  useEffect(
    () => () => {
      frontMaterial.dispose();
      glowMaterial.dispose();
    },
    [frontMaterial, glowMaterial],
  );

  const tick = useMemo(
    () => (t: number, pointer: { x: number; y: number }, tilt: { x: number; y: number }) => {
      uniforms.front.uTime.value = t;
      uniforms.front.uLayerWeight.value = live.layerWeight;
      uniforms.front.uGlareStrength.value = live.glareStrength;
      uniforms.front.uSheenStrength.value = live.sheenStrength;
      uniforms.front.uTiltFactor.value = live.tiltFactor;
      uniforms.front.uBaseMask.value = live.baseMask;
      uniforms.front.uBgNoiseStrength.value = live.bgNoise;
      uniforms.front.uMetalReflect.value = live.metalReflect;
      uniforms.front.uHdrBoost.value = live.hdrBoost;
      uniforms.front.uHdrCeiling.value = live.hdrCeiling;
      uniforms.front.uLogoParallax.value = live.logoParallax;
      uniforms.front.uGlossSelf.value = live.glossSelf;
      uniforms.front.uHoloSelf.value = live.holoSelf;
      uniforms.front.uHighlightWeight.value = live.highlightWeight;
      uniforms.front.uBgHolo.value = live.bgHolo;
      uniforms.front.uBgLayerWeight.value = live.bgLayerWeight;
      uniforms.front.uBgBaseMask.value = live.bgBaseMask;
      uniforms.front.uBgTiltFactor.value = live.bgTiltFactor;
      uniforms.front.uBgArtFloor.value = live.bgArtFloor;
      uniforms.front.uBgArtGain.value = live.bgArtGain;
      uniforms.front.uBgFoilX.value = live.bgFoilX;
      uniforms.front.uBgFoilY.value = live.bgFoilY;
      uniforms.front.uBgFoilViewAngle.value = live.bgFoilViewAngle;
      uniforms.front.uBgFoilDesaturation.value = live.bgFoilDesaturation;
      uniforms.front.uBgDominantMix.value = live.bgDominantMix;
      if (tocada('holo')) uniforms.front.uHolo.value = live.holo;
      if (tocada('gloss')) uniforms.front.uGloss.value = live.gloss;
      uniforms.front.uEdgeStrength.value = live.edge;
      uniforms.front.uFactionStrength.value = live.faction;
      uniforms.glow.uGlowStrength.value = live.glow;
      uniforms.glow.uTime.value = t;
      (uniforms.front.uPointer.value as THREE.Vector2).set(pointer.x, pointer.y);
      /**
       * LA CAPA 0 NO SE DESPLAZA: ES LA SUPERFICIE DE LA CARTA.
       *
       * Aquí se escribía `live.bgParallax` en uParallaxFactors[0] en cada frame, y ese valor
       * (0.06) era el paralaje MÁS GRANDE de la carta — doce veces el del personaje. Era el
       * diseño de "capa de fondo lejana", y es justo lo que hay que quitar: el arte del fondo
       * ya se pinta en la capa 0 opaca (`drawSurfaceLayer`), así que desplazarlo haría que la
       * TEXTURA DEL MESH se despegara de su propia geometría.
       *
       * El factor 0 lo pone PARALLAX_LAYERS[0] al construir el uniforme, y aquí no se toca.
       * Lo que conserva la profundidad son las otras capas (personaje, logo, textos), que sí
       * son planos distintos del sustrato.
       */
      /**
       * El LOGO se dibuja DOS veces: la capa 2 (el arte de la marca en su caja) y el
       * STICKER final (sus píxeles originales, sin efectos, recompuestos encima). Cada
       * uno tenía su PROPIA fuente de desplazamiento:
       *
       *   - la capa 2 lee uParallaxFactors[2], que es un valor de CONFIG que solo se
       *     escribe al crear los uniformes;
       *   - el sticker lee uLogoParallax, que es el que mueve el slider "Paralaje del
       *     logo" en cada frame.
       *
       * Coincidían por casualidad (ambos -0.03), así que en el estado por defecto el
       * logo se veía bien — pero en cuanto el slider se movía, solo se desplazaba el
       * sticker y quedaban DOS copias de la marca, una por cada fuente. Es el
       * "logo duplicado" que reportaba el usuario, y se reproduce de forma
       * determinista moviendo el slider.
       *
       * Los dos tienen que salir del MISMO número: el logo es una capa, y su sticker
       * es la recomposición de esa misma capa, así que no pueden desincronizarse.
       */
      (uniforms.front.uParallaxFactors.value as Float32Array)[2] = live.logoParallax;
      (uniforms.front.uTilt.value as THREE.Vector2).set(tilt.x, tilt.y);
    },
    [uniforms],
  );

  return useMemo(
    () => ({
      ready: textures !== null,
      uniforms,
      frontMaterial,
      glowMaterial,
      bodyGeometry,
      bodyEnvMap,
      cardWidth: CARD_W,
      cardHeight: CARD_H,
      tick,
    }),
    [textures, uniforms, frontMaterial, glowMaterial, bodyGeometry, bodyEnvMap, tick],
  );
}
