'use client';
/**
 * Compila en reposo los programas de shader que, sin esto, nacen en mitad del primer giro.
 *
 * POR QUÉ (medido): el perfil de CPU del primer giro de página mostró 2,6 s en
 * `getProgramInfoLog` + 0,6 s en `getShaderInfoLog` (SwiftShader, sin GPU; en una GPU real el
 * tramo es menor, no cero). Contando `linkProgram` hubo 7 enlaces en la carga y 3 más DURANTE
 * el giro: la etiqueta de la
 * placa premium (`MeshBasicMaterial` con mapa y alpha test) y el acrílico (`ShaderMaterial`).
 * Los tres solo se montaban cuando hacían falta, es decir, justo cuando el usuario pulsa.
 *
 * Cómo: se mantienen montados, en un grupo OCULTO (no se dibujan, no cuestan nada por frame),
 * dos mallas con los MISMOS parámetros de material que las reales. three comparte el programa
 * entre materiales con la misma clave de caché, así que el material real del giro lo reutiliza.
 * Permanecen montadas a propósito: si se desmontaran, el material se liberaría y three
 * destruiría el programa recién compilado. `compile` recorre todo el árbol (no solo lo visible),
 * y `compileAsync` espera a `KHR_parallel_shader_compile` si el navegador lo ofrece.
 *
 * COMPILAR NO BASTA (medido): tras `compileAsync` el perfil seguía mostrando ~2 s de espera en
 * `getProgramInfoLog` en el primer giro, porque muchos controladores (SwiftShader, ANGLE) terminan
 * de generar el código en el primer DIBUJO del programa. Por eso, además, el grupo se hace
 * visible durante un frame en reposo: dos mallas diminutas, detrás del libro (el cuerpo opaco
 * las tapa por profundidad), que obligan a ese primer dibujo cuando nadie está mirando.
 *
 * Si cambias los parámetros del material de `PremiumSlab` (side, alphaTest,
 * transparent, toneMapped, fog, mapa), cámbialos aquí también: con otra clave el calentamiento no sirve.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { slabLayout } from '@/components/premium-layout';
import { crearMaterialDeAcrilico } from '@/components/premium-slab';

/** Detrás del libro (que está en z ≈ 0, con las cartas por delante). */
const WARMUP_Z = -5;

/** Un mapa mínimo: para la clave del programa solo importa que EXISTA un mapa. */
function mapaVacio(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** Espera a que el navegador esté ocioso: el calentamiento no debe competir con las texturas. */
function enReposo(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 600);
  return () => window.clearTimeout(id);
}

export function ShaderWarmup() {
  const { gl, scene, camera, invalidate } = useThree();
  const grupo = useRef<THREE.Group>(null);
  /** 'espera' → compilando; 'dibujando' → visible 1 frame; 'hecho' → oculto para siempre. */
  const fase = useRef<'espera' | 'dibujando' | 'hecho'>('espera');
  const framesDibujando = useRef(0);
  const mapa = useMemo(() => mapaVacio(), []);
  // Las medidas no cambian la clave del programa (solo los uniforms), así que sirven unas cualquiera.
  const acrilico = useMemo(() => crearMaterialDeAcrilico(slabLayout(1, 1.4, 0.1)), []);
  useEffect(
    () => () => {
      mapa.dispose();
      acrilico.dispose();
    },
    [mapa, acrilico],
  );

  useEffect(() => {
    let vivo = true;
    const cancelar = enReposo(() => {
      if (!vivo) return;
      const dibujar = () => {
        if (!vivo || fase.current !== 'espera') return;
        fase.current = 'dibujando';
        invalidate();
      };
      gl.compileAsync(scene, camera).then(dibujar, dibujar);
    });
    return () => {
      vivo = false;
      cancelar();
    };
  }, [gl, scene, camera, invalidate]);

  useFrame(() => {
    const g = grupo.current;
    if (!g || fase.current === 'espera') return;
    if (fase.current === 'dibujando') {
      if (framesDibujando.current === 0) {
        // Detrás del libro, centrado donde mira la cámara: la profundidad lo esconde.
        g.position.set(camera.position.x, 0, WARMUP_Z);
        g.visible = true;
      } else {
        g.visible = false;
        fase.current = 'hecho';
      }
      framesDibujando.current += 1;
      invalidate();
    }
  });

  return (
    <group ref={grupo} visible={false} scale={0.01} data-testid="shader-warmup">
      <mesh>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={mapa} alphaTest={0.5} toneMapped={false} fog={false} />
      </mesh>
      <mesh material={acrilico}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
