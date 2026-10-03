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
 * luego añadir efectos capa por capa. Las 7 texturas y su sincronización con el
 * shader viven en `card-material.ts` (`useCardMaterials`), que comparte este archivo
 * con el libro del catálogo (`card-binder.tsx`); aquí queda la ESCENA de una carta
 * suelta: su cámara, su inclinación hacia el puntero y su flotación. Los efectos se
 * activan desde `card3d-config.ts` y `card-texture.ts` sin ensuciar el shader.
 */
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { VtuberCard } from '@/lib/types';
import { cardPalette } from '@/lib/color';
import * as CFG from '@/components/card3d-config';
import { RenderGovernor } from '@/components/render-governor';
import { useWebGLRecovery } from '@/components/webgl-recovery';
import {
  CARD_TEXTURE_HEIGHT,
  CARD_TEXTURE_WIDTH,
  CARD_TEXTURE_FULL_WIDTH,
  CARD_TEXTURE_TILE_WIDTH,
} from '@/components/card-texture';
import { useCardMaterials, type CardMaterials } from '@/components/card-material';
import { PremiumSlab } from '@/components/premium-slab';

/** Proporción real de una carta coleccionable (5x7 pulgadas -> 1.4). */
const ASPECT = CARD_TEXTURE_HEIGHT / CARD_TEXTURE_WIDTH;
const CARD_W = CFG.GEOMETRY.cardWidth;
const CARD_H = CARD_W * ASPECT;

export const CARD_CAMERA_Z =
  (CARD_H / CFG.GEOMETRY.cameraFill / 2) / Math.tan((CFG.GEOMETRY.cameraFov * Math.PI) / 180 / 2);

/**
 * Distancia de cámara para una carta concreta. Una carta PREMIUM va dentro de una placa más alta
 * que ella (la de la funda del libro: carta + 2 x `pocketPad`), así que la cámara se aleja en la
 * misma proporción para que la placa entera entre en el mismo encuadre que una carta normal.
 */
export function cameraZFor(card: Pick<VtuberCard, 'premium'>): number {
  return card.premium ? CARD_CAMERA_Z * ((CARD_H + 2 * CFG.BINDER.pocketPad) / CARD_H) : CARD_CAMERA_Z;
}

interface HoloCardSceneProps {
  card: VtuberCard;
  holo?: number;
  gloss?: number;
  textureWidth?: number;
}

export interface PointerTiltAmounts {
  tiltY: number;
  tiltX: number;
  driftX: number;
  dampingBase: number;
}

const ZERO_TILT = { x: 0, y: 0 };

/**
 * Inclina un grupo hacia el puntero (coordenadas NDC de toda la ventana) con
 * amortiguación exponencial. Las cantidades son parámetro porque el libro del
 * catálogo lo reutiliza con valores menores: un objeto grande no puede inclinarse
 * tanto como una carta suelta sin salirse del encuadre.
 */
export function usePointerTilt(ref: React.RefObject<THREE.Group | null>, amounts: PointerTiltAmounts = CFG.MOTION) {
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
    const damp = 1 - Math.pow(amounts.dampingBase, delta);
    group.rotation.y += (target.current.x * amounts.tiltY - group.rotation.y) * damp;
    group.rotation.x += (-target.current.y * amounts.tiltX - group.rotation.x) * damp;
    group.position.x += (target.current.x * amounts.driftX - group.position.x) * damp;
  });

  return target;
}

/**
 * Las DOS mallas de una carta: resplandor y cara. El cuerpo extruido con canto metálico se
 * retiró: costaba ~2.000 triángulos, un draw call y un PMREM por escena para un canto que
 * solo se veía al inclinar, y la cara (un plano) lleva todo el efecto. Sin transformaciones
 * propias: quien las monta decide dónde y cómo se mueven (la carta suelta flota; en el
 * libro va plana en su funda).
 *
 * Con `card.premium` la carta va DENTRO de una placa de acrílico (`premium-slab.tsx`), que la
 * escala para que quepa en su ventana. Sin `card` o sin premium, exactamente lo de siempre.
 * El HUMO brillante (el resplandor) NO va dentro de la ventana: escalado con la carta se
 * pintaría sobre la etiqueta y el marco. Se le pasa a la placa, que lo dibuja detrás de TODA ella
 * con el tamaño de la placa, así que el halo rodea el acrílico como rodea a una carta normal.
 */
export function CardMeshes({ mats, card }: { mats: CardMaterials; card?: VtuberCard }) {
  const premium = card?.premium ?? null;
  const mallas = (
    <>
      {!premium && (
        <mesh position={[0, 0, CFG.GEOMETRY.glowZ]} material={mats.glowMaterial}>
          <planeGeometry args={[mats.cardWidth * CFG.GEOMETRY.glowSpread, mats.cardHeight * CFG.GEOMETRY.glowSpread]} />
        </mesh>
      )}
      <mesh position={[0, 0, CFG.GEOMETRY.cardDepth / 2 + CFG.GEOMETRY.faceZGap]}>
        <planeGeometry args={[mats.cardWidth, mats.cardHeight]} />
        <primitive object={mats.frontMaterial} attach="material" />
      </mesh>
    </>
  );
  if (!card || !premium) return mallas;
  return (
    <PremiumSlab
      card={card}
      premium={premium}
      cardWidth={mats.cardWidth}
      cardHeight={mats.cardHeight}
      outerPad={CFG.BINDER.pocketPad}
      glowMaterial={mats.glowMaterial}
    >
      {mallas}
    </PremiumSlab>
  );
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
  const mats = useCardMaterials(card, { holo, gloss, textureWidth: textureWidth ?? CARD_TEXTURE_FULL_WIDTH });

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const group3d = group.current;
    mats.tick(t, pointer.current, group3d ? { x: group3d.rotation.x, y: group3d.rotation.y } : ZERO_TILT);
    if (group3d) {
      group3d.position.y = Math.sin(t * CFG.MOTION.floatSpeed) * CFG.MOTION.floatAmplitude;
      group3d.rotation.z = Math.sin(t * CFG.MOTION.rollSpeed) * CFG.MOTION.rollAmplitude;
    }
  });

  const cameraZ = cameraZFor(card);
  useEffect(() => {
    camera.position.set(0, 0, cameraZ);
    camera.lookAt(0, 0, 0);
  }, [camera, cameraZ]);

  return (
    <group ref={group}>
      <CardMeshes mats={mats} card={card} />
    </group>
  );
}

/**
 * Luces de la escena. `cameraZ` desplaza la niebla: sus distancias (`FOG.near/far`)
 * se afinaron para la cámara de la carta suelta, y el libro del catálogo pone la cámara
 * dos veces más lejos; sin corregirla, el canto metálico de las 8 cartas salía gris.
 */
export function Rig({ accent, cameraZ = CARD_CAMERA_Z }: { accent: string; cameraZ?: number }) {
  const shift = cameraZ - CARD_CAMERA_Z;
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
      <fog attach="fog" args={[CFG.FOG.color, CFG.FOG.near + shift, CFG.FOG.far + shift]} />
    </>
  );
}

export interface HoloCardProps extends HoloCardSceneProps {
  className?: string;
  quality?: 'full' | 'tile' | 'lite';
  dprCap?: number;
}

export class WebGLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('[holo-card] fallo al dibujar la escena 3D', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function HoloCard({
  card,
  holo = CFG.INTENSITY.holo.default,
  gloss = CFG.INTENSITY.gloss.default,
  className,
  quality = 'full',
  textureWidth,
  dprCap,
}: HoloCardProps) {
  const recovery = useWebGLRecovery();
  const [dpr, setDpr] = useState<number | null>(null);
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

  /**
   * `relative` en la raíz y el canvas dentro de una caja POSICIONADA.
   *
   * POR QUE EL CANVAS NO PUEDE MEDIR SU PROPIO CONTENEDOR
   * -----------------------------------------------------
   * three.js escribe el tamaño medido en el estilo INLINE del canvas
   * (`width: 414px; height: 579.594px`). Un canvas en el flujo normal aporta ese
   * ancho a la cadena de `min-content` de sus ancestros, así que el contenedor
   * queda con un SUELO igual al tamaño que ya tenía: no puede encoger y el
   * `ResizeObserver` que debería re-medirlo nunca ve un cambio. Es un lazo
   * cerrado — la medida vieja impide la nueva.
   *
   * Medido en la ficha, tras redimensionar 1440x900 -> 390x844 SIN recargar:
   * el canvas se quedaba en 414 px CSS (745 px de búfer) dentro de una columna
   * de 332 px, y en un viewport de 320 seguía en 694 px desbordando la página.
   * La carga en frío del mismo tamaño da 332 px exactos, así que el fallo era
   * SOLO el lazo: no había nada mal en el encuadre de la cámara.
   *
   * La grilla no lo sufría porque su caja de aspecto ya lleva `overflow: hidden`
   * (ver `card-tile.tsx`), que exime al contenedor del `min-content` del hijo.
   * Con esta caja posicionada el canvas sale del flujo en las DOS vistas y la
   * medida la fija siempre el contenedor, en cualquier orden de redimensión
   * (rotar el móvil, abrir el inspector, girar la tablet).
   *
   * Ningún gate ve este fallo: jsdom no mide, y el componente compila y renderiza
   * bien. Lo que lo fija es `holo-card-layout.test.ts`, que comprueba que esta
   * caja siga existiendo.
   */
  return (
    <div className={className ? `relative ${className}` : 'relative'} data-testid="holo-card">
      <WebGLBoundary fallback={null}>
        {recovery.canRender && (
          <div className="absolute inset-0">
            <Canvas
              key={recovery.canvasKey}
              frameloop="demand"
              dpr={dpr ?? plan.dpr}
              gl={{ antialias: plan.antialias, alpha: true, powerPreference: plan.powerPreference }}
              camera={{ fov: CFG.GEOMETRY.cameraFov, position: [0, 0, cameraZFor(card)] }}
              onCreated={({ gl }) => recovery.attach(gl.domElement)}
            >
              <RenderGovernor
                wake={card}
                idleFps={CFG.RENDER.idleFpsDetail}
                dprMax={typeof plan.dpr === 'number' ? plan.dpr : plan.dpr[1]}
                onDpr={setDpr}
              />
              <Rig accent={palette.accent} cameraZ={cameraZFor(card)} />
              <CardMesh card={card} holo={holo} gloss={gloss} textureWidth={plan.textureWidth} />
            </Canvas>
          </div>
        )}
      </WebGLBoundary>
    </div>
  );
}

export default HoloCard;
