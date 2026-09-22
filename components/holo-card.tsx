'use client';
/**
 * Carta holográfica 3D del VTuber (react-three-fiber + shaders propios).
 *
 * Un único canvas WebGL dibuja la carta y su interacción; el texto vive en la
 * textura del frente (generada en canvas 2D) y el brillo iridiscente, el
 * barrido y el color de marca en los shaders.
 *
 * Si el contexto WebGL no está disponible (navegadores viejos, GPU bloqueada),
 * se degrada a una carta 2D con el mismo arte en vez de dejar un hueco negro.
 *
 * LOS VALORES AJUSTABLES VIVEN EN `components/card3d-config.ts`: geometría,
 * intensidades, luces y constantes del shader. Este archivo es la ESCENA —qué
 * mallas hay, cómo se mueven, cómo se reparten los recursos—, no el mando del
 * efecto.
 */
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { VtuberCard } from '@/lib/types';
import { cardPalette } from '@/lib/color';
import * as CFG from '@/components/card3d-config';
import { live, tocada } from '@/components/card3d-live';
import {
  CARD_TEXTURE_HEIGHT,
  CARD_TEXTURE_WIDTH,
  CARD_TEXTURE_FULL_WIDTH,
  CARD_TEXTURE_TILE_WIDTH,
  drawCardFront,
  characterAlphaMask,
  getLastSafeZone,
  getLastLogoBox,
  inkAndSkinMask,
  logoMask,
  logoSticker,
  loadImage,
} from '@/components/card-texture';
import { cardFragmentShader, cardVertexShader, glowFragmentShader, glowVertexShader } from '@/components/shaders';

/** Proporción real de una carta coleccionable (5x7 pulgadas -> 1.4). */
const ASPECT = CARD_TEXTURE_HEIGHT / CARD_TEXTURE_WIDTH;
const CARD_W = CFG.GEOMETRY.cardWidth;
const CARD_H = CARD_W * ASPECT;

/**
 * Distancia de la cámara, derivada de `GEOMETRY.cameraFill` y el fov: es lo que
 * decide qué fracción de la altura visible ocupa la carta. Calculada y no escrita
 * para que siga siendo correcta si cambia el tamaño de la carta.
 */
const CARD_CAMERA_Z =
  (CARD_H / CFG.GEOMETRY.cameraFill / 2) / Math.tan((CFG.GEOMETRY.cameraFov * Math.PI) / 180 / 2);

/**
 * ¿El navegador puede crear contextos WebGL? (jsdom siempre dice que no).
 *
 * OJO: hay que LIBERAR el contexto de prueba. Este sondeo se ejecuta una vez por
 * tarjeta (8 en la grilla), y un contexto creado con `getContext` no se libera solo
 * al soltar el canvas: se queda contado contra el límite del navegador. Medido: Chrome
 * sostiene 16 vivos y mata los MÁS ANTIGUOS al pasarse, así que 8 contextos de sonda
 * fantasma acortan la vida de las cartas que sí se ven (y eran la causa de varios
 * "WebGL context lost" en consola, al empujar a otras a perder el suyo).
 *
 * `WEBGL_lose_context.loseContext()` libera el contexto de inmediato. No todos los
 * navegadores exponen la extensión, así que es un extra, no un requisito.
 */
export function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = (canvas.getContext('webgl2') ??
      canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!context) return false;
    // Se suelta el contexto de prueba antes de devolver el resultado.
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface HoloCardSceneProps {
  card: VtuberCard;
  /** Intensidad del efecto foil holográfico (0 = sin holografía). */
  holo?: number;
  /** Intensidad del barniz realista superpuesto (reflejo especular). */
  gloss?: number;
  /**
   * Ancho del lienzo de la textura. El detalle usa la resolución completa (1008);
   * la grilla, la reducida (512), porque ahí la tarjeta se ve a ~163 px.
   */
  textureWidth?: number;
}

/** Sigue al puntero para inclinar la carta (sin re-render de React). */
function usePointerTilt(ref: React.RefObject<THREE.Group | null>) {
  const target = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const { innerWidth, innerHeight } = window;
      target.current = {
        x: (event.clientX / innerWidth) * 2 - 1,
        y: (event.clientY / innerHeight) * 2 - 1,
      };
    };
    const onLeave = () => {
      target.current = { x: 0, y: 0 };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  useFrame((_, delta) => {
    const group = ref.current;
    if (!group) return;
    const damp = 1 - Math.pow(CFG.MOTION.dampingBase, delta);
    group.rotation.y += (target.current.x * CFG.MOTION.tiltY - group.rotation.y) * damp;
    group.rotation.x += (-target.current.y * CFG.MOTION.tiltX - group.rotation.x) * damp;
    group.position.x += (target.current.x * CFG.MOTION.driftX - group.position.x) * damp;
  });

  return target;
}

/** Geometría + materiales de la carta; las texturas se generan fuera del render. */
function CardMesh({
  card,
  holo = CFG.INTENSITY.holo.default,
  gloss = CFG.INTENSITY.gloss.default,
  textureWidth,
}: HoloCardSceneProps) {
  const group = useRef<THREE.Group>(null);
  const pointer = usePointerTilt(group);

  const { camera } = useThree();
  const [textures, setTextures] = useState<{
    front: THREE.CanvasTexture;
    edge: THREE.CanvasTexture;
    logoMask: THREE.CanvasTexture;
    logoSticker: THREE.CanvasTexture;
    /** Cobertura del fondo: 1 donde el personaje es transparente y cabe el fondo. */
    backgroundMask: THREE.CanvasTexture;
  } | null>(null);
  /**
   * ARTE del fondo, aparte de `textures` porque es OPCIONAL: solo hay textura si la
   * ficha tiene fondo subido. Guardarlo aparte deja el resto de texturas (que existen
   * siempre) sin un `null` que comprobar en cada uso.
   */
  const [backgroundTexture, setBackgroundTexture] = useState<THREE.CanvasTexture | null>(null);
  const palette = useMemo(() => cardPalette(card.themeColor, card.secondaryColor), [card.themeColor, card.secondaryColor]);
  /**
   * La geometría del canto se crea como INSTANCIA con `useMemo`, no como elemento
   * JSX. R3F intenta instanciar la clase al montarla desde JSX, y en el bundle de
   * producción eso acaba en "Class constructor cannot be invoked without 'new'"
   * porque la clase llega transformada y se invoca como función: la carta salía
   * en negro. Pasando la instancia ya construida no hay nada que invocar.
   */
  const bodyGeometry = useMemo(() => {
    /**
     * CANTO del cuerpo: un rectángulo REDONDEADO extruido con bisel.
     *
     * Por qué no `RoundedBoxGeometry`, que era lo que había: esa clase no puede
     * redondear más de MEDIO GROSOR. Con el grosor de la config el radio máximo
     * válido es la mitad de ese grosor, pero se le pasaba el radio de la CARA. Al
     * ser imposible, la geometría degeneraba en una CAJA DE ESQUINA VIVA que
     * quedaba DETRÁS de la cara redondeada: su contorno recto era el "borde filoso"
     * que se veía asomar.
     *
     * `ExtrudeGeometry` sí resuelve el caso real: la silueta se dibuja en el plano
     * con el radio que queramos (el mismo de la cara) y la profundidad se le
     * añade extruyendo, con un bisel pequeño en los cantos para que no queden
     * aristas vivas.
     *
     * POR QUÉ LA FORMA VA INSETADA POR EL BISEL
     * -----------------------------------------
     * Medido con la bounding box de la geometría: el bisel EXPANDE la forma hacia
     * fuera. Con la forma a tamaño completo salía un cuerpo de 2.2270 x 3.1066 contra
     * una cara de 2.2000 x 3.0796 — o sea, **1,30 px de canto asomando por lado en la
     * grilla y 2,02 px en la ficha** (por eso allí se veía peor). Ese canto es
     * GEOMETRÍA: no lo toca el antialiasing analítico del recorte de la cara, y se ve
     * escalonado.
     *
     * Insetando la forma por el tamaño del bisel, la expansión lo devuelve justo al
     * tamaño de la cara: medido, 2.2000 x 3.0796 exacto, 0,00 px de sobra. Así el
     * canto queda DETRÁS del borde recortado de la cara, que es el que tiene el
     * suavizado, en vez de sobresalir con una arista dura.
     */
    const bevelSize = CFG.GEOMETRY.cardDepth * CFG.GEOMETRY.bevelRatio;
    const r = CFG.GEOMETRY.cornerRadius - bevelSize;
    const ancho = CARD_W - bevelSize * 2;
    const alto = CARD_H - bevelSize * 2;
    const x0 = -ancho / 2;
    const y0 = -alto / 2;
    const shape = new THREE.Shape();
    // Contorno del rectángulo redondeado, recorriendo las cuatro esquinas.
    shape.moveTo(x0 + r, y0);
    shape.lineTo(x0 + ancho - r, y0);
    shape.absarc(x0 + ancho - r, y0 + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(x0 + ancho, y0 + alto - r);
    shape.absarc(x0 + ancho - r, y0 + alto - r, r, 0, Math.PI / 2, false);
    shape.lineTo(x0 + r, y0 + alto);
    shape.absarc(x0 + r, y0 + alto - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(x0, y0 + r);
    shape.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: CFG.GEOMETRY.cardDepth,
      bevelEnabled: true,
      // Bisel fino: suficiente para que el canto no sea una arista viva, sin
      // comerse el grosor (el total sigue siendo ~cardDepth).
      bevelThickness: bevelSize,
      bevelSize,
      // El bisel se redondea con más segmentos porque su contorno es lo que separa
      // la cara del fondo: con 1 segmento el bisel es un chaflán plano y su arista se
      // ve como un filo. Con 4 el canto queda curvo y se funde con la silueta.
      bevelSegments: CFG.GEOMETRY.bevelSegments,
      // La curva de las esquinas: 12 segmentos en una esquina de radio 0.16 a 212 px
      // de carta dan ~1,3 px por segmento, que se ve como un polígono. Con 24 lo deja
      // suave en los dos tamaños (grilla y ficha) sin coste apreciable: es una
      // geometría por carta, no por frame.
      curveSegments: CFG.GEOMETRY.curveSegments,
    });
    // La extrusión va de z=0 a z=depth: se centra para que la carta gire sobre su
    // propio plano y la cara frontal coincida con la superficie del cuerpo.
    geometry.translate(0, 0, -(CFG.GEOMETRY.cardDepth / 2 + bevelSize));
    return geometry;
  }, []);

  useEffect(() => {
    let cancelled = false;
    /**
     * La carta 3D compone sobre el PERSONAJE normalizado al lienzo de carta
     * (720x1008, 1.4). Se prefiere `character` porque viene recortado y en la
     * proporción exacta; la galería cruda NO sirve como base: llega con la proporción
     * del sitio (medidos entre 0.42 y 1.78) y al ajustarlo al marco de la carta
     * el personaje salía estirado. `card` es la carta ya compuesta con su marco:
     * usarla metería un marco dentro de otro.
     */
    const artSrc = card.images.character ?? card.images.card ?? '';
    Promise.all([
      loadImage(artSrc),
      loadImage(card.images.logo ?? ''),
      /**
       * El FONDO se carga SIEMPRE, aunque la ficha no tenga: `loadImage` de una cadena
       * vacía devuelve `null` sin lanzar, así que no hace falta ramificar. Cuando la
       * hay, su textura es la que el shader pinta por detrás del personaje.
       */
      loadImage(card.images.background ?? ''),
    ]).then(([art, logo, background]) => {
      if (cancelled) return;
      const canvas = drawCardFront({ card, art, logo, width: textureWidth });
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;

      // Máscara de TINTA Y PIEL: aísla el lineart negro y los tonos de piel del
      // dibujo (no un realce de bordes genérico, que encendía también el fondo y
      // el ruido). Mismo encuadre que el arte, así cae exactamente encima.
      const edgeTexture = new THREE.CanvasTexture(inkAndSkinMask(canvas, canvas.width, canvas.height));

      /**
       * Máscara del LOGO: su silueta real, en la caja donde se dibujó. Sirve para
       * suprimir el holográfico dentro de la marca sin borrar los reflejos, y sin
       * el parche rectangular que dejaba la aproximación anterior; el sticker la usa
       * además para saber dónde recomponer la marca al final del shader.
       */
      const logoBox = getLastLogoBox();
      /**
       * Si no hay logo (o no se dibujó), la máscara es un canvas VACÍO: así el
       * shader lee cobertura 0 y el holográfico se aplica a toda la imagen. Se
       * evita el ternario anterior, que construía una textura anidada sin sentido.
       */
      const logoMaskCanvas = document.createElement('canvas');
      logoMaskCanvas.width = canvas.width;
      logoMaskCanvas.height = canvas.height;
      const logoMaskTexture = new THREE.CanvasTexture(
        logoBox && logo ? logoMask(logo, logoBox, canvas.width, canvas.height) : logoMaskCanvas,
      );
      /**
       * El STICKER: los píxeles del logo en su caja, para recomponerlo al final del
       * shader sobre todas las capas de efecto. Si no hay logo, el canvas vacío hace
       * que su alfa sea 0 y no se dibuje nada.
       */
      const logoStickerCanvas = document.createElement('canvas');
      logoStickerCanvas.width = canvas.width;
      logoStickerCanvas.height = canvas.height;
      const logoStickerTexture = new THREE.CanvasTexture(
        logoBox && logo ? logoSticker(logo, logoBox, canvas.width, canvas.height) : logoStickerCanvas,
      );
      /**
       * COBERTURA DEL FONDO: dónde puede verse el fondo (fuera del personaje y dentro
       * de la banda segura de texto). Se calcula desde el ARTE original, no desde la
       * carta compuesta, porque en la carta la transparencia del personaje ya se ha
       * perdido bajo el degradado de tema. La zona segura la acaba de publicar
       * `drawCardFront` para ESTA ficha concreta (depende de su frase y su logo), así
       * que se lee aquí y no de una constante.
       */
      const backgroundMaskTexture = new THREE.CanvasTexture(
        characterAlphaMask(art, canvas.width, canvas.height, getLastSafeZone()),
      );
      /**
       * TEXTURA DEL FONDO: el arte subido, o un canvas VACÍO cuando la ficha no tiene.
       * El canvas vacío es transparente, así que si por lo que sea se muestreara (el
       * shader no lo hace: `uHasBackground` vale 0) no aportaría nada. `colorSpace`
       * sRGB como el resto de texturas de color: sin esto el fondo saldría con un
       * contraste distinto al de la carta.
       */
      const backgroundCanvas = document.createElement('canvas');
      backgroundCanvas.width = canvas.width;
      backgroundCanvas.height = canvas.height;
      if (background) {
        const bgCtx = backgroundCanvas.getContext('2d');
        bgCtx?.drawImage(background, 0, 0, canvas.width, canvas.height);
      }
      const backgroundTexture = new THREE.CanvasTexture(backgroundCanvas);
      backgroundTexture.colorSpace = THREE.SRGBColorSpace;
      backgroundTexture.anisotropy = 4;
      backgroundTexture.needsUpdate = true;
      edgeTexture.colorSpace = THREE.SRGBColorSpace;
      edgeTexture.anisotropy = 4;
      edgeTexture.needsUpdate = true;

      setTextures({
        front: texture,
        edge: edgeTexture,
        logoMask: logoMaskTexture,
        logoSticker: logoStickerTexture,
        backgroundMask: backgroundMaskTexture,
      });
      setBackgroundTexture(backgroundTexture);
    });
    return () => {
      cancelled = true;
    };
  }, [card, textureWidth]);

  useEffect(
    () => () => {
      textures?.front.dispose();
      textures?.edge.dispose();
      textures?.logoMask.dispose();
      textures?.logoSticker.dispose();
      textures?.backgroundMask.dispose();
    },
    [textures],
  );

  /** El arte del fondo vive fuera de `textures`: solo existe si la ficha lo tiene. */
  useEffect(() => () => backgroundTexture?.dispose(), [backgroundTexture]);

  /**
   * Emblemas de las facciones del VTuber (PNG con alfa). Un VTuber tiene entre 2
   * y 4, y el shader los reparte en cuatro posiciones de la lámina. Si una facción
   * no tiene emblema se omite, así que el array puede ser más corto.
   */
  const [factionTextures, setFactionTextures] = useState<THREE.Texture[]>([]);
  useEffect(() => {
    let cancelled = false;
    const icons = (card.factionIcons ?? [])
      .map((f) => f.icon)
      .filter((icon): icon is string => Boolean(icon))
      .slice(0, CFG.FACTION.slots.length);
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

  const uniforms = useMemo(() => {
    const accent = new THREE.Color(palette.accent);
    const secondary = new THREE.Color(palette.secondary);
    return {
      front: {
        uMap: { value: null as THREE.Texture | null },
        uEdgeMap: { value: null as THREE.Texture | null },
        uEdgeStrength: { value: CFG.EDGE.strength as number },
        uFactionMap0: { value: null as THREE.Texture | null },
        uFactionMap1: { value: null as THREE.Texture | null },
        uFactionMap2: { value: null as THREE.Texture | null },
        uFactionMap3: { value: null as THREE.Texture | null },
        uFactionCounts: { value: new THREE.Vector4(0, 0, 0, 0) },
        uFactionStrength: { value: CFG.FACTION.strength as number },
        uAccent: { value: accent },
        uSecondary: { value: secondary },
        uPointer: { value: new THREE.Vector2(0, 0) },
        uTilt: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uHolo: { value: holo },
        /**
         * Perillas que el panel de ajuste en vivo puede mover. Se inicializan con los
         * valores de la config y luego las refresca el `useFrame` desde `live` (ver
         * `card3d-live.ts`): así arrastrar un slider NO re-renderiza React ni remonta
         * la escena, que es lo que hace comparables dos ajustes.
         */
        uLayerWeight: { value: CFG.HOLOGRAM.layerWeight as number },
        uGlareStrength: { value: CFG.HOLOGRAM.glareStrength as number },
        uTiltFactor: { value: CFG.HOLOGRAM.tiltFactor as number },
        uBaseMask: { value: CFG.HOLOGRAM.baseMask as number },
        uGlossSelf: { value: CFG.COMPOSITE.glossSelf as number },
        uHoloSelf: { value: CFG.COMPOSITE.holoSelf as number },
        uHighlightWeight: { value: CFG.GLOSS.highlightWeight as number },
        // Sin color de tema (ficha sin THEME) el holograma no desaparece: baja a un
        // piso, porque la carta todavía tiene que leerse como una lámina.
        uHasHolo: { value: card.themeColor ? 1 : CFG.INTENSITY.holo.noThemeFloor },
        uGloss: { value: gloss },
        uCardSize: { value: new THREE.Vector2(CARD_W, CARD_H) },
        // Zona de la IMAGEN en UV, derivada del layout real de `card-texture.ts`
        // (ver ART_ZONE en la config): el efecto se limita a esa banda y no tiñe la
        // cabecera, los chips, la frase ni el pie.
        uArtZone: { value: new THREE.Vector2(CFG.ART_ZONE.top, CFG.ART_ZONE.bottom) },
        uLogoMask: { value: null as THREE.Texture | null },
        uLogoSticker: { value: null as THREE.Texture | null },
        uCardRadius: { value: CFG.GEOMETRY.cornerRadius },
        /**
         * FONDO: arte + cobertura. `uHasBackground` es el interruptor; con 0 el shader
         * ni muestrea, así que una ficha sin fondo se dibuja exactamente como antes de
         * que esta capa existiera. El paralaje arranca del valor de la config.
         */
        uBackgroundMap: { value: null as THREE.Texture | null },
        uBackgroundMask: { value: null as THREE.Texture | null },
        uHasBackground: { value: 0 },
        uBgHolo: { value: CFG.BACKGROUND.holo as number },
        uBgLayerWeight: { value: CFG.BACKGROUND.layerWeight as number },
        uBgGlareStrength: { value: CFG.BACKGROUND.glareStrength as number },
        uBgBaseMask: { value: CFG.BACKGROUND.baseMask as number },
        uBgTiltFactor: { value: CFG.BACKGROUND.tiltFactor as number },
        uBgParallax: { value: CFG.BACKGROUND.parallax as number },
      },
      glow: {
        /**
         * Resplandor de marca ALREDEDOR de la carta.
         *
         * uCardRect dice qué fracción del plano del glow ocupa la carta: el plano
         * mide `GEOMETRY.glowSpread` veces la carta, así que la carta es
         * 1/glowSpread del plano. Se usa el mismo radio que la cara para que el
         * anillo siga la curva de las esquinas.
         */
        uGlowColor: { value: accent.clone() },
        uGlowStrength: { value: CFG.GLOW.strength as number },
        uCardRect: { value: new THREE.Vector2(1 / CFG.GEOMETRY.glowSpread, 1 / CFG.GEOMETRY.glowSpread) },
        uCardRadius: { value: CFG.GEOMETRY.cornerRadius / CFG.GEOMETRY.glowSpread },
      },
    };
  }, [palette.accent, palette.secondary, holo, gloss, card.themeColor]);

  useEffect(() => {
    if (!textures) return;
    uniforms.front.uMap.value = textures.front;
    uniforms.front.uEdgeMap.value = textures.edge;
    uniforms.front.uLogoMask.value = textures.logoMask;
    uniforms.front.uLogoSticker.value = textures.logoSticker;
    uniforms.front.uBackgroundMask.value = textures.backgroundMask;
  }, [textures, uniforms]);

  /**
   * El fondo es opcional, así que su uniforme se sincroniza en su propio efecto y no
   * en el de arriba: si la ficha no tiene fondo, `uHasBackground` queda en 0 y el
   * shader ni lee las texturas (evita muestrear dos mapas por píxel para nada).
   */
  useEffect(() => {
    uniforms.front.uBackgroundMap.value = backgroundTexture;
    uniforms.front.uHasBackground.value = backgroundTexture ? 1 : 0;
  }, [backgroundTexture, uniforms]);

  /**
   * Reparte los emblemas cargados en los cuatro slots del shader. `uFactionCounts`
   * actúa como máscara: el shader solo dibuja los slots marcados con 1, así que un
   * VTuber con 3 facciones deja el cuarto slot apagado sin coste.
   */
  useEffect(() => {
    const maps = [
      uniforms.front.uFactionMap0,
      uniforms.front.uFactionMap1,
      uniforms.front.uFactionMap2,
      uniforms.front.uFactionMap3,
    ];
    maps.forEach((map, index) => {
      map.value = factionTextures[index] ?? null;
    });
    uniforms.front.uFactionCounts.value.set(
      factionTextures[0] ? 1 : 0,
      factionTextures[1] ? 1 : 0,
      factionTextures[2] ? 1 : 0,
      factionTextures[3] ? 1 : 0,
    );
  }, [factionTextures, uniforms]);

  // Las intensidades deben afectar en vivo, sin remontar la escena. El panel de ajuste
  // escribe en `live`, así que un slider se ve al instante aunque `holo`/`gloss` no
  // cambien como props.
  useEffect(() => {
    uniforms.front.uHolo.value = holo;
  }, [holo, uniforms]);

  useEffect(() => {
    uniforms.front.uGloss.value = gloss;
  }, [gloss, uniforms]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    uniforms.front.uTime.value = t;
    // Ajuste en vivo: se lee el objeto mutable, no estado de React. Ver card3d-live.ts.
    uniforms.front.uLayerWeight.value = live.layerWeight;
    uniforms.front.uGlareStrength.value = live.glareStrength;
    uniforms.front.uTiltFactor.value = live.tiltFactor;
    uniforms.front.uBaseMask.value = live.baseMask;
    // Perillas del FONDO: se ajustan aparte de las del personaje, que es el punto.
    uniforms.front.uBgHolo.value = live.bgHolo;
    uniforms.front.uBgLayerWeight.value = live.bgLayerWeight;
    uniforms.front.uGlossSelf.value = live.glossSelf;
    uniforms.front.uHoloSelf.value = live.holoSelf;
    uniforms.front.uHighlightWeight.value = live.highlightWeight;
    // `holo` y `gloss` también son props (`tile` en la grilla, `detail` en la ficha), y
    // esa prop es la que manda: el panel solo gana si MOVIÓ la perilla. Se pregunta a
    // `tocada` en vez de comparar el valor con el de partida, porque comparar falla en
    // cuanto las dos vistas tienen el mismo número.
    if (tocada('holo')) uniforms.front.uHolo.value = live.holo;
    if (tocada('gloss')) uniforms.front.uGloss.value = live.gloss;
    uniforms.front.uEdgeStrength.value = live.edge;
    uniforms.front.uFactionStrength.value = live.faction;
    uniforms.glow.uGlowStrength.value = live.glow;
    const px = pointer.current.x;
    const py = pointer.current.y;
    uniforms.front.uPointer.value.set(px, py);
    const group3d = group.current;
    if (group3d) {
      uniforms.front.uTilt.value.set(group3d.rotation.x, group3d.rotation.y);
      group3d.position.y = Math.sin(t * CFG.MOTION.floatSpeed) * CFG.MOTION.floatAmplitude;
      group3d.rotation.z = Math.sin(t * CFG.MOTION.rollSpeed) * CFG.MOTION.rollAmplitude;
    }
  });

  useEffect(() => {
    // La distancia sale de GEOMETRY.cameraFill (ver CARD_CAMERA_Z): con la carta
    // ocupando el 98% de la altura visible se cortaba por arriba y por abajo al
    // inclinarse y parecía más grande de lo que es.
    camera.position.set(0, 0, CARD_CAMERA_Z);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  const frontMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: cardVertexShader,
        fragmentShader: cardFragmentShader,
        uniforms: uniforms.front,
        transparent: true,
        side: THREE.FrontSide,
        // El suavizado del canto usa fwidth(). No hace falta pedir extensiones: en
        // WebGL2 las derivadas son parte del núcleo (los tipos de three ya solo
        // declaran `clipCullDistance`/`multiDraw`), y three renderiza con WebGL2.
      }),
    [uniforms],
  );

  /**
   * Material del RESPLANDOR que rodea la carta.
   *
   * Aditivo y sin escritura de profundidad: la luz se suma al fondo y no deja
   * registro en el z-buffer, así que la carta (que va delante) no lo recorta por
   * accidente. `depthTest` sí queda activo para que el cuerpo metálico pueda taparlo
   * cuando la carta se inclina.
   */
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

  return (
    <group ref={group}>
      {/*
        RESPLANDOR ALREDEDOR DE LA CARTA.

        Es el PRIMER elemento del grupo (y a z negativo) para quedar por detrás de
        todo: la carta lo ocluye por el centro y solo asoma el anillo de luz exterior.
        El plano mide GEOMETRY.glowSpread veces la carta y su shader deja la silueta
        HUECA por dentro, así que el arte nunca se tiñe — el error del intento
        anterior, donde el brillo se pintaba encima porque vivía en la cara recortada.

        Como vive en la escena, se inclina con la carta y cambia de perspectiva: eso
        es lo que lo lee como luz sobre un objeto y no como una imagen pegada detrás.
      */}
      <mesh position={[0, 0, CFG.GEOMETRY.glowZ]} material={glowMaterial}>
        <planeGeometry args={[CARD_W * CFG.GEOMETRY.glowSpread, CARD_H * CFG.GEOMETRY.glowSpread]} />
      </mesh>

      {/* Cuerpo: da el CANTO de la carta. Es la única geometría de fondo que se
          conserva: sin él la carta volvería a ser una lámina sin profundidad. */}
      <mesh geometry={bodyGeometry}>
        {/* El CANTO es metal: brillo alto (roughness baja), mucha componente
            metálica y un tono claro de acero en vez del color oscuro anterior, que
            hacía que el borde se leyera como plástico y no como lámina. */}
        <meshStandardMaterial
          color={CFG.BODY.color}
          roughness={CFG.BODY.roughness}
          metalness={CFG.BODY.metalness}
          envMapIntensity={CFG.BODY.envMapIntensity}
        />
      </mesh>

      {/* Cara frontal. */}
      <mesh position={[0, 0, CFG.GEOMETRY.cardDepth / 2 + CFG.GEOMETRY.faceZGap]}>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <primitive object={frontMaterial} attach="material" />
      </mesh>

      {/* Cara trasera: ELIMINADA. La carta siempre se muestra de frente y con una
          inclinación leve, así que el reverso nunca entra en cuadro; mantener esa
          malla solo servía para que su contorno asomara por los cantos (era el
          rectángulo que se veía detrás). Su shader y sus uniformes se eliminaron con
          ella: si se repone la malla hace falta también un `backFragmentShader`. */}
    </group>
  );
}

/**
 * Fuentes de luz coherentes con el color del VTuber. Valores en `LIGHTS`.
 *
 * La CARA de la carta usa un `ShaderMaterial` propio: no la iluminan estas luces.
 * Quien las recibe es el CUERPO, que es metal, así que encienden el canto.
 */
function Rig({ accent }: { accent: string }) {
  return (
    <>
      <ambientLight intensity={CFG.LIGHTS.ambient} />
      <directionalLight position={CFG.LIGHTS.key.position} intensity={CFG.LIGHTS.key.intensity} />
      {/* Luces de relleno laterales: un metal con `metalness` alto refleja el
          entorno, y sin fuentes a los lados el canto quedaba plano. Con estas dos
          el filo metálico tiene luces que barrer al inclinar la carta. */}
      <directionalLight
        position={CFG.LIGHTS.fillLeft.position}
        intensity={CFG.LIGHTS.fillLeft.intensity}
        color={CFG.LIGHTS.fillLeft.color}
      />
      <directionalLight
        position={CFG.LIGHTS.fillBottom.position}
        intensity={CFG.LIGHTS.fillBottom.intensity}
        color={CFG.LIGHTS.fillBottom.color}
      />

      <pointLight
        position={CFG.LIGHTS.accent.position}
        intensity={CFG.LIGHTS.accent.intensity}
        color={accent}
        distance={CFG.LIGHTS.accent.distance}
      />
      <pointLight
        position={CFG.LIGHTS.top.position}
        intensity={CFG.LIGHTS.top.intensity}
        color={CFG.LIGHTS.top.color}
        distance={CFG.LIGHTS.top.distance}
      />
      {/*
        El CONTRALUZ de marca NO vive aquí: se probó con `pointLight` detrás de la
        carta y el A/B dio un borde idéntico. El resplandor de marca es el plano de
        `glowFragmentShader`, que solo enciende el anillo exterior.

        Fondo de la escena: un degradado CLARO, no la niebla oscura anterior
        (#05060a). El fondo oscuro hacía que la carta flotara sobre un vacío negro y
        apagaba su lectura; con un gris claro detrás, el canto y las esquinas se
        distinguen y la carta parece un objeto sobre una superficie. `fog` solo aplica
        a los materiales de la escena (no al fondo del canvas), así que se aclara
        también para que el canto del cuerpo no se ennegrezca.
      */}
      <fog attach="fog" args={[CFG.FOG.color, CFG.FOG.near, CFG.FOG.far]} />
    </>
  );
}

export interface HoloCardProps extends HoloCardSceneProps {
  /** Clase del contenedor (el canvas ocupa el 100%). */
  className?: string;
  /** Desactiva el render 3D (listas largas o entornos sin WebGL). */
  active?: boolean;
  /**
   * Calidad del render.
   *
   *   · `full` — el detalle: DPR hasta 1.8, textura a resolución completa.
   *   · `tile` — la grilla en un equipo normal: DPR 1, textura a la mitad.
   *   · `lite` — equipo modesto o móvil: además se pide menos contexto
   *     (`powerPreference` sin `high-performance`), que hace que el navegador no
   *     reserve la GPU dedicada para 8 canvas a la vez.
   *
   * La diferencia visual entre `tile` y `lite` a 163px de ancho es inapreciable; lo
   * que cambia de verdad es cuántos píxeles se generan y cuánta memoria de GPU
   * ocupa cada contexto.
   */
  quality?: 'full' | 'tile' | 'lite';
  /**
   * Ancho del lienzo de textura, si quien llama quiere fijarlo (el plan de calidad
   * lo decide por dispositivo). Sin esto se deriva de `quality`.
   */
  textureWidth?: number;
  /** Techo de DPR del canvas, si quien llama quiere fijarlo. Sin esto, `quality` decide. */
  dprCap?: number;
}

/** Captura fallos del árbol WebGL y los sustituye por la vista 2D. */
class WebGLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[holo-card] WebGL no disponible, se usa la vista 2D', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Vista 2D de respaldo: mismo arte y color de marca, sin WebGL.
 *
 * Se usa cuando no hay WebGL, cuando la carta aún no tiene contexto concedido y
 * cuando el navegador se lleva el contexto por su cuenta. Como puede ser la vista
 * de varias tarjetas a la vez en la grilla, el fondo NO lleva el color del tema:
 * el color fuerte de cada VTuber detrás de su arte teñía la rejilla entera. El
 * color lo aporta el halo de la tarjeta, fuera de la carta.
 */
function CardFallback({ card, className }: { card: VtuberCard; className?: string }) {
  // El PERSONAJE primero: es el arte real de la carta. La ficha apaisada solo
  // entra como respaldo cuando el VTuber no tiene personaje.
  const image = card.images.character ?? card.images.card;
  return (
    <div className={className} data-testid="holo-card-fallback">
      <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-dex-panel">
        {image ? (
          <img
            src={image}
            alt={card.name}
            className="h-full w-full object-cover"
            loading="lazy"
            // El canvas ya reserva proporción de carta; el `<img>` la respeta para
            // que no haya reflow al aparecer el arte.
            width={CARD_TEXTURE_WIDTH}
            height={CARD_TEXTURE_HEIGHT}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-dex-muted">Sin imagen</div>
        )}
        <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 font-mono text-xs text-white">
          #{String(card.dexNumber).padStart(3, '0')}
        </span>
      </div>
    </div>
  );
}

export function HoloCard({
  card,
  holo = CFG.INTENSITY.holo.default,
  gloss = CFG.INTENSITY.gloss.default,
  className,
  active = true,
  quality = 'full',
  textureWidth,
  dprCap,
}: HoloCardProps) {
  const [webgl] = useState(() => supportsWebGL());
  /**
   * El navegador puede llevarse el contexto por su cuenta si se pasa de su límite
   * (en Safari/iOS ronda los 8, por debajo del presupuesto de la grilla). Cuando
   * eso pasa, el canvas queda MUERTO y se ve negro. Con este estado esa carta cae
   * a la vista 2D — el mismo arte — en vez de mostrar un rectángulo negro.
   */
  const [lost, setLost] = useState(false);
  /**
   * La paleta se memoiza por los DOS colores que la definen: `cardPalette` recorre
   * conversiones de color y la carta se re-renderiza con cada cambio de `active`,
   * así que recalcularla en cada render era trabajo repetido.
   */
  const palette = useMemo(
    () => cardPalette(card.themeColor, card.secondaryColor),
    [card.themeColor, card.secondaryColor],
  );

  /**
   * Ajustes por calidad. Quien llama puede imponerlos (el plan de calidad de
   * `card-quality.ts` los decide por dispositivo), y si no, se derivan del nivel.
   */
  const plan = useMemo(() => {
    const tile = quality !== 'full';
    const lite = quality === 'lite';
    return {
      tile,
      // `antialias` del canvas: SE MIDE, no se supone.
      //
      // El primer A/B (con el canto de geometría asomando por fuera) dio que activarlo
      // NO cambiaba la transición del borde: ese borde era el de la CARA, recortada con
      // discard, y MSAA no toca los fragmentos descartados. Pero el CUERPO sí es
      // geometría y su bisel tiene aristas; ahora que el cuerpo ya no sobresale y el
      // bisel es curvo (bevelSegments 4), MSAA sí tiene qué suavizar. Se vuelve a medir
      // con las dos condiciones buenas en vez de arrastrar la conclusión anterior.
      antialias: true,
      dpr: (dprCap ?? (tile ? 1 : 1.8)) as number | [number, number],
      // `high-performance` pide la GPU dedicada. En un equipo modesto, con 8 canvas
      // a la vez, es mejor no exigirla; en el detalle hay uno solo y sí compensa.
      powerPreference: (lite ? 'default' : 'high-performance') as WebGLPowerPreference,
      textureWidth: textureWidth ?? (tile ? CARD_TEXTURE_TILE_WIDTH : CARD_TEXTURE_FULL_WIDTH),
    };
  }, [quality, dprCap, textureWidth]);

  if (!active || !webgl || lost) {
    return <CardFallback card={card} className={className} />;
  }

  return (
    <div className={className} data-testid="holo-card">
      <WebGLBoundary fallback={<CardFallback card={card} className="h-full w-full" />}>
        <Canvas
          dpr={plan.dpr}
          gl={{ antialias: plan.antialias, alpha: true, powerPreference: plan.powerPreference }}
          camera={{ fov: CFG.GEOMETRY.cameraFov, position: [0, 0, CARD_CAMERA_Z] }}
          onCreated={({ gl }) => {
            // El aviso llega antes de que el contexto se pierda del todo: se marca
            // el estado y React reemplaza el canvas por la vista 2D.
            gl.domElement.addEventListener('webglcontextlost', (event) => {
              event.preventDefault();
              setLost(true);
            });
          }}
        >
          <Rig accent={palette.accent} />
          <CardMesh card={card} holo={holo} gloss={gloss} textureWidth={plan.textureWidth} />
        </Canvas>
      </WebGLBoundary>
    </div>
  );
}

export default HoloCard;
