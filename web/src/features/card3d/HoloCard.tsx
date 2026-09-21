/**
 * Carta holográfica 3D del VTuber (react-three-fiber + shaders propios).
 *
 * Un único canvas WebGL dibuja la carta y su interacción; el texto vive en la
 * textura del frente (generada en canvas 2D) y el brillo iridiscente, el
 * barrido y el color de marca en los shaders.
 *
 * Si el contexto WebGL no está disponible (navegadores viejos, GPU bloqueada),
 * se degrada a una carta 2D con el mismo arte en vez de dejar un hueco negro.
 */
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';


import type { VtuberCard } from '../../lib/types';
import { cardPalette, gradientCss } from '../../lib/color';
import {
  CARD_TEXTURE_HEIGHT,
  CARD_TEXTURE_WIDTH,
  drawCardFront,
  getLastLogoBox,
  inkAndSkinMask,
  logoMask,
  logoSticker,
  loadImage,
} from './cardTexture';
import { cardFragmentShader, cardVertexShader } from './shaders';

/** Proporción real de una carta coleccionable (5x7 pulgadas -> 1.4). */
const ASPECT = CARD_TEXTURE_HEIGHT / CARD_TEXTURE_WIDTH;
const CARD_W = 2.2;
const CARD_H = CARD_W * ASPECT;

/**
 * Distancia de la cámara. Calculada para que la carta ocupe ~80% de la altura
 * visible y quede margen para el tilt y la flotación; con z=4.1 ocupaba el 98% y
 * se cortaba al inclinarse. Se deriva de CARD_H y el fov para que siga siendo
 * correcta si cambia el tamaño de la carta.
 */
const CARD_CAMERA_Z = (CARD_H / 0.8 / 2) / Math.tan((42 * Math.PI) / 180 / 2);

/**
 * Grosor del cuerpo. Una carta de verdad no es una lámina: tiene canto. 0.035
 * era una lámina casi plana (1.6% del ancho) y al inclinarla no se veía canto
 * alguno; 0.075 le da presencia de objeto sin volverla un ladrillo.
 */
const CARD_DEPTH = 0.075;

/**
 * Radio de las esquinas. Se comparte entre la máscara del shader (que recorta
 * la textura) y la geometría del cuerpo, para que el canto y la cara terminen
 * exactamente en la misma curva; si divergieran, se vería el canto asomar por
 * las esquinas de la cara.
 */
const CARD_CORNER_RADIUS = 0.16;

/**
 * Opacidad del emblema de facción sobre la carta. Es un holograma SUPERPUESTO:
 * se mezcla en modo luz, así que no debe tapar el arte. Valor fijo (sin slider)
 * para que todas las cartas se vean igual. Se probó 0.75 y los emblemas apenas
 * se distinguían sobre arte oscuro; 1.0 con el trazo ya filtrado por brillo es
 * visible sin llegar a tapar.
 */
export const FACTION_STRENGTH = 1.0;
/**
 * Intensidad de la capa de TINTA Y PIEL sobre la lámina: el lineart negro y los
 * tonos de piel del personaje que se suman en modo luz, tintados con el espectro
 * real. 0.6 los enciende de forma perceptible sin lavar el dibujo.
 */
export const EDGE_STRENGTH = 0.6;

/** ¿El navegador puede crear contextos WebGL? (jsdom siempre dice que no). */
export function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    return Boolean(context);
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
    const damp = 1 - Math.pow(0.0015, delta);
    group.rotation.y += (target.current.x * 0.38 - group.rotation.y) * damp;
    group.rotation.x += (-target.current.y * 0.28 - group.rotation.x) * damp;
    group.position.x += (target.current.x * 0.05 - group.position.x) * damp;
  });

  return target;
}

/** Geometría + materiales de la carta; las texturas se generan fuera del render. */
function CardMesh({ card, holo = 0.75, gloss = 0.55 }: HoloCardSceneProps) {
  const group = useRef<THREE.Group>(null);
  const pointer = usePointerTilt(group);
  const { camera } = useThree();
  const [textures, setTextures] = useState<{ front: THREE.CanvasTexture; edge: THREE.CanvasTexture; logoMask: THREE.CanvasTexture; logoSticker: THREE.CanvasTexture; aspect: number } | null>(null);
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
     * redondear más de MEDIO GROSOR. Con grosor 0.075 el radio máximo válido es
     * 0.0375, pero se le pasaba 0.16 (el radio de la CARA). Al ser imposible, la
     * geometría degeneraba en una CAJA DE ESQUINA VIVA que quedaba DETRÁS de la
     * cara redondeada: su contorno recto era el "borde filoso" que se veía asomar.
     *
     * `ExtrudeGeometry` sí resuelve el caso real: la silueta se dibuja en el plano
     * con el radio que queramos (0.16, el mismo de la cara) y la profundidad se le
     * añade extruyendo, con un bisel pequeño en los cantos para que no queden
     * aristas vivas. Así el borde del cuerpo coincide con el de la cara.
     */
    const r = CARD_CORNER_RADIUS;
    const x0 = -CARD_W / 2;
    const y0 = -CARD_H / 2;
    const shape = new THREE.Shape();
    // Contorno del rectángulo redondeado, recorriendo las cuatro esquinas.
    shape.moveTo(x0 + r, y0);
    shape.lineTo(x0 + CARD_W - r, y0);
    shape.absarc(x0 + CARD_W - r, y0 + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(x0 + CARD_W, y0 + CARD_H - r);
    shape.absarc(x0 + CARD_W - r, y0 + CARD_H - r, r, 0, Math.PI / 2, false);
    shape.lineTo(x0 + r, y0 + CARD_H);
    shape.absarc(x0 + r, y0 + CARD_H - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(x0, y0 + r);
    shape.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: CARD_DEPTH,
      bevelEnabled: true,
      // Bisel fino: suficiente para que el canto no sea una arista viva, sin
      // comerse el grosor (el total sigue siendo ~CARD_DEPTH).
      bevelThickness: CARD_DEPTH * 0.18,
      bevelSize: CARD_DEPTH * 0.18,
      bevelSegments: 3,
      curveSegments: 12,
    });
    // La extrusión va de z=0 a z=depth: se centra para que la carta gire sobre su
    // propio plano y la cara frontal coincida con la superficie del cuerpo.
    geometry.translate(0, 0, -(CARD_DEPTH / 2 + CARD_DEPTH * 0.18));
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
    Promise.all([loadImage(artSrc), loadImage(card.images.logo ?? '')]).then(([art, logo]) => {
      if (cancelled) return;
      const canvas = drawCardFront({ card, art, logo });
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
       * el parche rectangular que dejaba la aproximación anterior.
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
      edgeTexture.colorSpace = THREE.SRGBColorSpace;
      edgeTexture.anisotropy = 4;
      edgeTexture.needsUpdate = true;

      setTextures({ front: texture, edge: edgeTexture, logoMask: logoMaskTexture, logoSticker: logoStickerTexture, aspect: canvas.height / canvas.width });
    });
    return () => {
      cancelled = true;
    };
  }, [card]);

  useEffect(() => () => { textures?.front.dispose(); textures?.edge.dispose(); textures?.logoMask.dispose(); textures?.logoSticker.dispose(); }, [textures]);

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
      .slice(0, 4);
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
        uHoloMap: { value: null as THREE.Texture | null },
        uEdgeMap: { value: null as THREE.Texture | null },
        uEdgeStrength: { value: EDGE_STRENGTH },
        uFactionMap0: { value: null as THREE.Texture | null },
        uFactionMap1: { value: null as THREE.Texture | null },
        uFactionMap2: { value: null as THREE.Texture | null },
        uFactionMap3: { value: null as THREE.Texture | null },
        uFactionCounts: { value: new THREE.Vector4(0, 0, 0, 0) },
        uFactionStrength: { value: FACTION_STRENGTH },
        uAccent: { value: accent },
        uSecondary: { value: secondary },
        uPointer: { value: new THREE.Vector2(0, 0) },
        uTilt: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uHolo: { value: holo },
        uHasHolo: { value: card.themeColor ? 1 : 0.45 },
        uOverlay: { value: 1 },
        uGloss: { value: gloss },
        uCardSize: { value: new THREE.Vector2(CARD_W, CARD_H) },
        /**
         * Zona de la IMAGEN, derivada del layout real de la textura
         * (`cardTexture.ts`): la cabecera ocupa de y=44 a y=160 y el pie arranca
         * en y = alto - 140. El personaje vive entre ambos, así que el efecto
         * holográfico se limita a esa banda y no toca los items de la carta.
         */
        /**
         * Zona del LOGO en UV, para excluirlo del efecto holográfico. Se replica
         * el cálculo de `cardTexture.ts`: el logo va abajo a la derecha, con el
         * borde derecho en `pad` y su alto pegado sobre la banda de chips/frase.
         * Se dan márgenes generosos porque el logo varía de proporción y es peor
         * teñir de menos que dejar un halo alrededor de la marca.
         */
        uLogoMask: { value: null as THREE.Texture | null },
        uLogoSticker: { value: null as THREE.Texture | null },
        uArtZone: {
          value: new THREE.Vector2(
            (44 + 116 + 10) / CARD_TEXTURE_HEIGHT,
            (CARD_TEXTURE_HEIGHT - 140 - 34) / CARD_TEXTURE_HEIGHT,
          ),
        },
        uCardRadius: { value: CARD_CORNER_RADIUS },
      },
      back: {
        uAccent: { value: accent },
        uSecondary: { value: secondary },
        uPointer: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        // La cara trasera también es un plano: necesita forma y zona para
        // recortarse con la misma curva que el cuerpo (si no, asoma el filo).
        uCardSize: { value: new THREE.Vector2(CARD_W, CARD_H) },
        uCardRadius: { value: CARD_CORNER_RADIUS },
        uArtZone: { value: new THREE.Vector2(0, 1) },
      },
    };
  }, [palette.accent, palette.secondary, holo, gloss, card.themeColor]);

  useEffect(() => {
    if (!textures) return;
    uniforms.front.uMap.value = textures.front;
    uniforms.front.uEdgeMap.value = textures.edge;
    uniforms.front.uLogoMask.value = textures.logoMask;
    uniforms.front.uLogoSticker.value = textures.logoSticker;
  }, [textures, uniforms]);

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

  // Los sliders deben afectar en vivo, sin remontar la escena.
  useEffect(() => {
    uniforms.front.uHolo.value = holo;
  }, [holo, uniforms]);

  useEffect(() => {
    uniforms.front.uGloss.value = gloss;
  }, [gloss, uniforms]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    uniforms.front.uTime.value = t;
    uniforms.back.uTime.value = t;
    const px = pointer.current.x;
    const py = pointer.current.y;
    uniforms.front.uPointer.value.set(px, py);
    uniforms.back.uPointer.value.set(px, py);
    const group3d = group.current;
    if (group3d) {
      uniforms.front.uTilt.value.set(group3d.rotation.x, group3d.rotation.y);
      group3d.position.y = Math.sin(t * 0.7) * 0.045;
      group3d.rotation.z = Math.sin(t * 0.45) * 0.02;
    }
  });

  useEffect(() => {
    // La carta mide CARD_H de alto. A z=4.1 ocupaba el 98% de la altura visible,
    // así que al inclinarse se cortaba por arriba y por abajo y parecía más grande
    // de lo que es. A z=5.02 ocupa ~80% y queda margen para el tilt y la flotación.
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
      }),
    [uniforms],
  );

  useEffect(
    () => () => {
      frontMaterial.dispose();
    },
    [frontMaterial],
  );

  return (
    <group ref={group}>
      {/* Cuerpo: da el CANTO de la carta. Es la única geometría de fondo que se
          conserva: sin él la carta volvería a ser una lámina sin profundidad. */}
      <mesh geometry={bodyGeometry}>
        {/* El CANTO es metal: brillo alto (roughness baja), mucha componente
            metálica y un tono claro de acero en vez del color oscuro anterior, que
            hacía que el borde se leyera como plástico y no como lámina. */}
        <meshStandardMaterial
          color="#d8dde6"
          roughness={0.18}
          metalness={0.92}
          envMapIntensity={1.2}
        />
      </mesh>

      {/* Cara frontal. */}
      <mesh position={[0, 0, CARD_DEPTH / 2 + 0.001]}>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <primitive object={frontMaterial} attach="material" />
      </mesh>


      {/* Cara trasera: ELIMINADA. La carta siempre se muestra de frente y con una
          inclinación leve, así que el reverso nunca entra en cuadro; mantener esa
          malla solo servía para que su contorno asomara por los cantos (era el
          rectángulo que se veía detrás). Sin ella no hay nada que recortar. */}
    </group>
  );
}

/** Fuentes de luz coherentes con el color del VTuber. */
function Rig({ accent }: { accent: string }) {
  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[3, 4, 6]} intensity={1.15} />
      {/* Luces de relleno laterales: un metal con `metalness` alto refleja el
          entorno, y sin fuentes a los lados el canto quedaba plano. Con estas dos
          el filo metálico tiene luces que barrer al inclinar la carta. */}
      <directionalLight position={[-5, 2, 3]} intensity={0.55} color="#eef2ff" />
      <directionalLight position={[0, -4, 2]} intensity={0.35} color="#cdd6e6" />
      <pointLight position={[-3, -2, 3]} intensity={18} color={accent} distance={12} />
      <pointLight position={[0, 3, -4]} intensity={8} color="#ffffff" distance={10} />
      /**
       * Fondo de la escena: un degradado CLARO, no la niebla oscura anterior
       * (#05060a). El fondo oscuro hacía que la carta flotara sobre un vacío negro
       * y apagaba su lectura; con un gris claro detrás, el canto y las esquinas se
       * distinguen y la carta parece un objeto sobre una superficie.
       *
       * `fog` solo aplica a los materiales de la escena (no al fondo del canvas),
       * así que se aclara también para que el canto del cuerpo no se ennegrezca.
       */
      <fog attach="fog" args={['#c9cdd6', 8, 20]} />
    </>
  );
}

export interface HoloCardProps extends HoloCardSceneProps {
  /** Clase del contenedor (el canvas ocupa el 100%). */
  className?: string;
  /** Desactiva el render 3D (listas largas o entornos sin WebGL). */
  active?: boolean;
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

/** Vista 2D de respaldo: mismo arte y color de marca, sin WebGL. */
function CardFallback({ card, className }: { card: VtuberCard; className?: string }) {
  const palette = cardPalette(card.themeColor, card.secondaryColor);
  // El PERSONAJE primero: es el arte real de la carta. La ficha apaisada solo
  // entra como respaldo cuando el VTuber no tiene personaje.
  const image = card.images.character ?? card.images.card;
  return (
    <div className={className} data-testid="holo-card-fallback">
      <div
        className="relative h-full w-full overflow-hidden rounded-2xl border border-dex-line"
        style={{ background: gradientCss(palette.deep, palette.mid) }}
      >
        {image ? (
          <img src={image} alt={card.name} className="h-full w-full object-cover" loading="lazy" />
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

export function HoloCard({ card, holo = 0.75, gloss = 0.55, className, active = true }: HoloCardProps) {
  const [webgl] = useState(() => supportsWebGL());
  const palette = cardPalette(card.themeColor, card.secondaryColor);

  if (!active || !webgl) {
    return <CardFallback card={card} className={className} />;
  }

  return (
    <div className={className} data-testid="holo-card">
      <WebGLBoundary fallback={<CardFallback card={card} className="h-full w-full" />}>
        <Canvas
          dpr={[1, 1.8]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ fov: 42, position: [0, 0, CARD_CAMERA_Z] }}
        >
          <Rig accent={palette.accent} />
          <CardMesh card={card} holo={holo} gloss={gloss} />
        </Canvas>
      </WebGLBoundary>
    </div>
  );
}

export default HoloCard;
