'use client';
/**
 * La PLACA DE ACRÍLICO de una carta premium (como las de CGC) y su material.
 *
 * Es un envoltorio: recibe la carta holográfica como `children` y la coloca DENTRO, a menor
 * escala, en la ventana de una hoja interior que lleva la etiqueta. De fuera hacia dentro:
 *
 *   cuerpo de acrílico  (transparente, bisel, reflejo)   renderOrder alto, no escribe profundidad
 *   la carta            (sus mallas de siempre)          en la ventana, escalada
 *   hoja interior       (marco + etiqueta, opaca)        un plano con una textura de lienzo
 *
 * No toca nada de la carta: ni su shader, ni sus texturas, ni sus uniformes. Por eso el libro y
 * el detalle la usan igual y `check:shaders` no tiene nada nuevo que vigilar en `shaders.ts`.
 *
 * COSTE: una placa son ~600 triángulos, una textura de ~640x1060 y un shader de unas 20 líneas
 * sin samplers. Solo existen para las cartas premium (un puñado), así que el catálogo normal no
 * paga nada. Material, geometría y textura se crean UNA vez por carta y se sueltan al desmontar.
 */
import { useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';

import type { PremiumInfo, VtuberCard } from '@/lib/types';
import { GEOMETRY, PREMIUM } from '@/components/card3d-config';
import { slabLayout, type SlabLayout } from '@/components/premium-layout';
import { dibujarHojaInterior } from '@/components/premium-label';

const VERTEX = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  varying vec3 vLocal;

  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * Acrílico: un plano casi transparente cuya gracia está en el borde y en un reflejo que se
 * mueve. Todo lo ajustable llega como UNIFORME desde `PREMIUM.acrylic`; aquí no hay perillas.
 *
 * La cara frontal es plana, así que su normal no cambia de un punto a otro y un reflejo
 * calculado con ella iluminaría la placa entera a la vez (parpadeo, no destello). Por eso la
 * normal se INCLINA según la posición local (`uCurvature`): una cara apenas abombada, que es lo
 * que hace que el reflejo recorra la placa al inclinarla en lugar de encenderla toda.
 */
const FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec2 uHalf;
  uniform vec3 uTint;
  uniform vec3 uLight;
  uniform float uBase;
  uniform float uMaxAlpha;
  uniform float uFresnel;
  uniform float uFresnelPower;
  uniform float uEdge;
  uniform float uEdgeWidth;
  uniform float uCurvature;
  uniform float uShine;
  uniform float uShineStrength;
  uniform float uBandCenter;
  uniform float uBandWidth;
  uniform float uBandStrength;

  varying vec3 vNormalView;
  varying vec3 vViewPos;
  varying vec3 vLocal;

  void main() {
    vec3 V = normalize(-vViewPos);
    vec3 N = normalize(vNormalView);
    vec2 p = vLocal.xy / uHalf;
    vec3 Nc = normalize(N + vec3(p * uCurvature, 0.0));

    float facing = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = pow(1.0 - facing, uFresnelPower);

    vec2 d = abs(p);
    float edge = smoothstep(1.0 - uEdgeWidth, 1.0, max(d.x, d.y));

    vec3 L = normalize(uLight);
    float spec = pow(max(dot(reflect(-L, Nc), V), 0.0), uShine);

    vec3 R = reflect(-V, Nc);
    float s = dot(R.xy, normalize(vec2(0.82, 0.57)));
    float t = (s - uBandCenter) / uBandWidth;
    float band = exp(-t * t);

    float luz = fres * uFresnel + edge * uEdge + spec * uShineStrength + band * uBandStrength;
    vec3 color = mix(uTint, vec3(1.0), clamp(luz, 0.0, 1.0));
    gl_FragColor = vec4(color, clamp(uBase + luz, 0.0, uMaxAlpha));
  }
`;

/** Rectángulo de esquinas redondeadas centrado en el origen. */
export function formaRedondeada(w: number, h: number, r: number): THREE.Shape {
  const x = -w / 2;
  const y = -h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + w, y + h - r);
  shape.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x + r, y + h);
  shape.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + r);
  shape.absarc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2, false);
  return shape;
}

/**
 * Cuerpo de la placa. La forma se INSETA por el bisel: un `ExtrudeGeometry` con bisel EXPANDE el
 * contorno hacia fuera, y sin esto el cuerpo sería mayor que la funda por el grosor del bisel.
 * Ocupa z de `-back` a `+front` (el insert vive entre los dos).
 */
export function crearCuerpo(layout: SlabLayout): THREE.ExtrudeGeometry {
  const { body, layout: medidas } = PREMIUM;
  const inset = body.bevel;
  const shape = formaRedondeada(layout.width - 2 * inset, layout.height - 2 * inset, medidas.cornerRadius - inset);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: body.front + body.back - 2 * body.bevel,
    bevelEnabled: true,
    bevelThickness: body.bevel,
    bevelSize: body.bevel,
    bevelSegments: body.bevelSegments,
    curveSegments: body.curveSegments,
  });
  // La extrusión nace en z = -bevel; se lleva a que su cara de atrás quede en -back.
  geometry.translate(0, 0, -body.back + body.bevel);
  return geometry;
}

export function crearMaterialDeAcrilico(layout: SlabLayout): THREE.ShaderMaterial {
  const a = PREMIUM.acrylic;
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uHalf: { value: new THREE.Vector2(layout.width / 2, layout.height / 2) },
      uTint: { value: new THREE.Color(a.tint) },
      uLight: { value: new THREE.Vector3(...a.light) },
      uBase: { value: a.base as number },
      uMaxAlpha: { value: a.maxAlpha as number },
      uFresnel: { value: a.fresnel as number },
      uFresnelPower: { value: a.fresnelPower as number },
      uEdge: { value: a.edge as number },
      uEdgeWidth: { value: a.edgeWidth as number },
      uCurvature: { value: a.curvature as number },
      uShine: { value: a.shine as number },
      uShineStrength: { value: a.shineStrength as number },
      uBandCenter: { value: a.bandCenter as number },
      uBandWidth: { value: a.bandWidth as number },
      uBandStrength: { value: a.bandStrength as number },
    },
  });
}

/** Dibuja la hoja interior de una carta y la convierte en textura (sRGB, sin mipmaps de más). */
export function crearTexturaDeHoja(layout: SlabLayout, card: VtuberCard, premium: PremiumInfo): THREE.CanvasTexture {
  const canvas = dibujarHojaInterior(layout, {
    name: card.name,
    dexNumber: card.dexNumber,
    country: card.countries[0]?.name ?? null,
    premium,
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export interface PremiumSlabProps {
  card: VtuberCard;
  premium: PremiumInfo;
  cardWidth: number;
  cardHeight: number;
  /** Holgura de la funda a cada lado: fija el alto de la placa (ver `slabLayout`). */
  outerPad: number;
  /** El humo brillante de la carta: se dibuja detrás de la placa entera, con el tamaño de la placa. */
  glowMaterial?: THREE.ShaderMaterial;
  /** La carta holográfica, que se coloca dentro de la ventana. */
  children: ReactNode;
}

export function PremiumSlab({ card, premium, cardWidth, cardHeight, outerPad, glowMaterial, children }: PremiumSlabProps) {
  const layout = useMemo(() => slabLayout(cardWidth, cardHeight, outerPad), [cardWidth, cardHeight, outerPad]);
  const body = useMemo(() => crearCuerpo(layout), [layout]);
  const acrylic = useMemo(() => crearMaterialDeAcrilico(layout), [layout]);
  // La hoja se redibuja solo si cambia algo que la etiqueta muestra, no en cada render.
  const insertTexture = useMemo(
    () => crearTexturaDeHoja(layout, card, premium),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depende de los CAMPOS que se dibujan, no de la identidad del objeto
    [layout, card.name, card.dexNumber, card.countries[0]?.name, premium.grade, premium.cert, premium.since],
  );

  useEffect(() => () => body.dispose(), [body]);
  useEffect(() => () => acrylic.dispose(), [acrylic]);
  useEffect(() => () => insertTexture.dispose(), [insertTexture]);

  return (
    <group userData={{ premium: premium.grade }}>
      {/* Humo brillante: detrás de todo. Mismo material y misma proporción que el de una carta normal. */}
      {glowMaterial && (
        <mesh position={[0, 0, GEOMETRY.glowZ]} material={glowMaterial}>
          <planeGeometry args={[layout.width * GEOMETRY.glowSpread, layout.height * GEOMETRY.glowSpread]} />
        </mesh>
      )}
      {/* Hoja interior: opaca, recortada por el alfa del lienzo (esquinas redondeadas). */}
      <mesh position={[0, 0, PREMIUM.insertZ]}>
        <planeGeometry args={[layout.width, layout.height]} />
        <meshBasicMaterial map={insertTexture} alphaTest={0.5} toneMapped={false} fog={false} />
      </mesh>
      {/* La carta, dentro de la ventana y a la escala que la hace caber. */}
      <group position={[0, layout.window.y, PREMIUM.cardZ]} scale={layout.cardScale}>
        {children}
      </group>
      {/* Cuerpo de acrílico: el último en pintarse, por encima de la carta y de la etiqueta. */}
      <mesh geometry={body} material={acrylic} renderOrder={10} />
    </group>
  );
}
