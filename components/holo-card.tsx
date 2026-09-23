'use client';
/**
 * Carta holográfica 3D del VTuber (react-three-fiber + shaders propios).
 *
 * Ahora compuesta por 7 capas con paralaje independiente:
 *   0 background  · fondo subido, escala 1.10
 *   1 character   · personaje
 *   2 logo        · logo
 *   3 title       · título / cabecera
 *   4 texts       · textos (chips de estado, frase, pie)
 *   5 tags        · tags / facciones / barra de stats
 *   6 wordmark    · VTUBERDEX
 *
 * El usuario pidió empezar con TODO el texto PLANO (sin metal, sin sombras) y
 * luego añadir efectos capa por capa. Este archivo genera las 7 texturas y las
 * sincroniza con el shader. Los efectos se irán activando desde
 * `card3d-config.ts` y `card-texture.ts` sin ensuciar el shader.
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
  drawCardLayers,
  inkAndSkinMask,
  logoMask,
  logoSticker,
  loadImage,
} from '@/components/card-texture';
import { cardFragmentShader, cardVertexShader, glowFragmentShader, glowVertexShader } from '@/components/shaders';
import { LAYER_UNIFORM_NAMES } from '@/components/card3d-config';

/** Proporción real de una carta coleccionable (5x7 pulgadas -> 1.4). */
const ASPECT = CARD_TEXTURE_HEIGHT / CARD_TEXTURE_WIDTH;
const CARD_W = CFG.GEOMETRY.cardWidth;
const CARD_H = CARD_W * ASPECT;

const CARD_CAMERA_Z =
  (CARD_H / CFG.GEOMETRY.cameraFill / 2) / Math.tan((CFG.GEOMETRY.cameraFov * Math.PI) / 180 / 2);

export function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = (canvas.getContext('webgl2') ??
      canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface HoloCardSceneProps {
  card: VtuberCard;
  holo?: number;
  gloss?: number;
  textureWidth?: number;
}

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
    layers: THREE.CanvasTexture[];
    edge: THREE.CanvasTexture;
    logoMask: THREE.CanvasTexture;
    logoSticker: THREE.CanvasTexture;
  } | null>(null);
  const palette = useMemo(() => cardPalette(card.themeColor, card.secondaryColor), [card.themeColor, card.secondaryColor]);

  const bodyGeometry = useMemo(() => {
    const bevelSize = CFG.GEOMETRY.cardDepth * CFG.GEOMETRY.bevelRatio;
    const r = CFG.GEOMETRY.cornerRadius - bevelSize;
    const ancho = CARD_W - bevelSize * 2;
    const alto = CARD_H - bevelSize * 2;
    const x0 = -ancho / 2;
    const y0 = -alto / 2;

    const shape = new THREE.Shape();
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
      bevelThickness: bevelSize,
      bevelSize,
      bevelSegments: CFG.GEOMETRY.bevelSegments,
      curveSegments: CFG.GEOMETRY.curveSegments,
    });
    geometry.translate(0, 0, -(CFG.GEOMETRY.cardDepth / 2 + bevelSize));
    return geometry;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const artSrc = card.images.character ?? card.images.card ?? '';
    Promise.all([
      loadImage(artSrc),
      loadImage(card.images.logo ?? ''),
      loadImage(card.images.background ?? ''),
    ]).then(([art, logo, background]) => {
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

      setTextures({
        layers,
        edge: edgeTexture,
        logoMask: logoMaskTexture,
        logoSticker: logoStickerTexture,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [card, textureWidth]);

  useEffect(
    () => () => {
      textures?.layers.forEach((t) => t.dispose());
      textures?.edge.dispose();
      textures?.logoMask.dispose();
      textures?.logoSticker.dispose();
    },
    [textures],
  );

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
    const front: Record<string, { value: unknown }> = {
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
      uBgHolo: { value: CFG.BACKGROUND.holo as number },
      uBgLayerWeight: { value: CFG.BACKGROUND.layerWeight as number },
      uBgGlareStrength: { value: CFG.BACKGROUND.glareStrength as number },
      uBgBaseMask: { value: CFG.BACKGROUND.baseMask as number },
      uBgTiltFactor: { value: CFG.BACKGROUND.tiltFactor as number },
      uBgArtFloor: { value: CFG.BACKGROUND.artFloor as number },
      /**
       * HDR: codo y ganancia de luces. Van como uniforms (no como literales del shader)
       * para poder medirlos y ajustarlos en vivo: el codo es la perilla que decide cuánto
       * se comprimen los reflejos, y sin poder moverla no habría forma de calibrarla.
       */
      uHdrBoost: { value: CFG.HDR.highlightBoost as number },
      uHdrKnee: { value: CFG.HDR.knee as number },
      /**
       * Textura de micro-superficie del fondo. Es un uniform y no una constante del
       * shader por la misma razón: con 0 el fondo vuelve a ser la lámina lisa, que es la
       * comparación exacta para medir cuánto aporta el ruido.
       */
      uBgNoiseStrength: { value: CFG.BG_NOISE.normalStrength as number },
      uLogoParallax: { value: CFG.LOGO.parallax as number },
      uParallaxFactors: { value: new Float32Array(CFG.LAYER_PARALLAX_FACTORS) },
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
      },
    };
  }, [palette.accent, palette.secondary, holo, gloss, card.themeColor]);

  useEffect(() => {
    if (!textures) return;
    LAYER_UNIFORM_NAMES.forEach((name, i) => {
      (uniforms.front[name] as { value: THREE.Texture | null }).value = textures.layers[i] ?? null;
    });
    uniforms.front.uEdgeMap.value = textures.edge;
    uniforms.front.uLogoMask.value = textures.logoMask;
    uniforms.front.uLogoSticker.value = textures.logoSticker;
  }, [textures, uniforms]);

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
    (uniforms.front.uFactionCounts.value as THREE.Vector4).set(
      factionTextures[0] ? 1 : 0,
      factionTextures[1] ? 1 : 0,
      factionTextures[2] ? 1 : 0,
      factionTextures[3] ? 1 : 0,
    );
  }, [factionTextures, uniforms]);

  useEffect(() => {
    uniforms.front.uHolo.value = holo;
  }, [holo, uniforms]);

  useEffect(() => {
    uniforms.front.uGloss.value = gloss;
  }, [gloss, uniforms]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    uniforms.front.uTime.value = t;
    uniforms.front.uLayerWeight.value = live.layerWeight;
    uniforms.front.uGlareStrength.value = live.glareStrength;
    uniforms.front.uSheenStrength.value = live.sheenStrength;
    uniforms.front.uTiltFactor.value = live.tiltFactor;
    uniforms.front.uBaseMask.value = live.baseMask;
    uniforms.front.uBgHolo.value = live.bgHolo;
    uniforms.front.uBgLayerWeight.value = live.bgLayerWeight;
    uniforms.front.uBgBaseMask.value = live.bgBaseMask;
    uniforms.front.uBgTiltFactor.value = live.bgTiltFactor;
    uniforms.front.uBgGlareStrength.value = live.bgGlareStrength;
    uniforms.front.uBgArtFloor.value = live.bgArtFloor;
    uniforms.front.uBgNoiseStrength.value = live.bgNoise;
    uniforms.front.uHdrBoost.value = live.hdrBoost;
    uniforms.front.uHdrKnee.value = live.hdrKnee;
    uniforms.front.uLogoParallax.value = live.logoParallax;
    uniforms.front.uGlossSelf.value = live.glossSelf;
    uniforms.front.uHoloSelf.value = live.holoSelf;
    uniforms.front.uHighlightWeight.value = live.highlightWeight;
    if (tocada('holo')) uniforms.front.uHolo.value = live.holo;
    if (tocada('gloss')) uniforms.front.uGloss.value = live.gloss;
    uniforms.front.uEdgeStrength.value = live.edge;
    uniforms.front.uFactionStrength.value = live.faction;
    uniforms.glow.uGlowStrength.value = live.glow;
    const px = pointer.current.x;
    const py = pointer.current.y;
    (uniforms.front.uPointer.value as THREE.Vector2).set(px, py);
    /**
     * El paralaje del FONDO sale del factor de la capa 0, que es la que lleva su arte.
     * Antes el shader tenía un uniforme propio (uBgParallax) con una textura de fondo
     * aparte; al pasarse a 7 capas, el fondo ES la capa 0 y su desplazamiento lo fija
     * uParallaxFactors[0]. El slider escribe ahí para que siga mandando en vivo.
     */
    (uniforms.front.uParallaxFactors.value as Float32Array)[0] = live.bgParallax;
    const group3d = group.current;
    if (group3d) {
      (uniforms.front.uTilt.value as THREE.Vector2).set(group3d.rotation.x, group3d.rotation.y);
      group3d.position.y = Math.sin(t * CFG.MOTION.floatSpeed) * CFG.MOTION.floatAmplitude;
      group3d.rotation.z = Math.sin(t * CFG.MOTION.rollSpeed) * CFG.MOTION.rollAmplitude;
    }
  });

  useEffect(() => {
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
      <mesh position={[0, 0, CFG.GEOMETRY.glowZ]} material={glowMaterial}>
        <planeGeometry args={[CARD_W * CFG.GEOMETRY.glowSpread, CARD_H * CFG.GEOMETRY.glowSpread]} />
      </mesh>
      <mesh geometry={bodyGeometry}>
        <meshStandardMaterial
          color={CFG.BODY.color}
          roughness={CFG.BODY.roughness}
          metalness={CFG.BODY.metalness}
          envMapIntensity={CFG.BODY.envMapIntensity}
        />
      </mesh>
      <mesh position={[0, 0, CFG.GEOMETRY.cardDepth / 2 + CFG.GEOMETRY.faceZGap]}>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <primitive object={frontMaterial} attach="material" />
      </mesh>
    </group>
  );
}

function Rig({ accent }: { accent: string }) {
  return (
    <>
      <ambientLight intensity={CFG.LIGHTS.ambient} />
      <directionalLight position={CFG.LIGHTS.key.position} intensity={CFG.LIGHTS.key.intensity} />
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
      <fog attach="fog" args={[CFG.FOG.color, CFG.FOG.near, CFG.FOG.far]} />
    </>
  );
}

export interface HoloCardProps extends HoloCardSceneProps {
  className?: string;
  active?: boolean;
  quality?: 'full' | 'tile' | 'lite';
  dprCap?: number;
}

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

function CardFallback({ card, className }: { card: VtuberCard; className?: string }) {
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
  const [lost, setLost] = useState(false);
  const palette = useMemo(
    () => cardPalette(card.themeColor, card.secondaryColor),
    [card.themeColor, card.secondaryColor],
  );
  const plan = useMemo(() => {
    const tile = quality !== 'full';
    const lite = quality === 'lite';
    return {
      tile,
      antialias: true,
      dpr: (dprCap ?? (tile ? 1 : 1.8)) as number | [number, number],
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
