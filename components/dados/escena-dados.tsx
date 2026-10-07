'use client';
/**
 * La bandeja de dados en 3D (UN solo canvas, regla 7): tapete, dados de cristal y su tumbo.
 *
 * CRISTAL: `MeshPhysicalMaterial` con transmisión (refracción real de lo que hay detrás), `ior` de
 * vidrio, `dispersion` (separa el espectro en los bordes, como un prisma) y un leve tinte por
 * atenuación. Para que la refracción SE VEA tiene que haber algo detrás que se deforme: por eso el
 * tapete lleva una trama, y el entorno de reflejos es un `RoomEnvironment` generado en local (no se
 * descarga ningún HDR). El número grabado y su esmerilado vienen del atlas (`atlas.ts`).
 *
 * TUMBO: no hay física. El resultado ya viene decidido (`tirar`), y el dado parte de la orilla de
 * la bandeja más cercana a la cámara con un giro grande alrededor de un eje al azar que se va
 * deshaciendo hasta la orientación final exacta (`orientacionFinal`), mientras rebota cada vez más
 * bajo. Al terminar, la cara de arriba es la del resultado sin aproximaciones.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  CanvasTexture,
  Color,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  MeshPhysicalMaterial,
  PMREMGenerator,
  type PointLight,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { crearAtlas } from '@/components/dados/atlas';
import {
  DADOS,
  alturaDeApoyo,
  geometriaBiselada,
  orientacionFinal,
  type TipoDeDado,
} from '@/components/dados/dados-geometria';
import { colorDelHumo, crearMaterialDeHumo } from '@/components/dados/humo';

/** Perillas de la escena. Calibradas mirando la bandeja renderizada. */
export const ESCENA = {
  separacion: 2.2,
  /** Entre filas va más holgado: la perspectiva acorta la profundidad y las filas se tocaban. */
  separacionFilas: 2.7,
  columnas: 4,
  camara: { posicion: [0, 8.2, 7.1] as [number, number, number], fov: 38 },
  cristal: {
    color: '#e4ecff',
    ior: 1.52,
    dispersion: 5,
    espesor: 1.6,
    atenuacion: '#b9cdfa',
    distanciaAtenuacion: 3.2,
    relieve: -7,
    brilloGrabado: 0.1,
    clearcoat: 0.6,
  },
  /** La luz del humo tiñe el tapete bajo el dado: es lo que más lo asienta en la mesa. */
  luzHumo: { intensidad: 22, distancia: 5 },
  /** Sombra difusa bajo cada dado: sin ella parecen flotar sobre el tapete. */
  sombra: { tamano: 2.7, opacidad: 0.75 },
  /** Altura y distancia desde donde se lanza (orilla delantera de la bandeja). */
  lanzamiento: { altura: 2.6, adelante: 4.2, vueltas: 3.2 },
} as const;

export interface DadoEnMesa {
  /** Cambia en cada tirada: remonta el dado y reinicia su tumbo. */
  clave: string;
  tipo: TipoDeDado;
  valor: number;
  /** Determina eje, giro y humo del dado: misma semilla, mismo tumbo. */
  semilla: number;
  /** `false` = ya está en reposo (vista previa de la bandeja antes de tirar). */
  animar: boolean;
}

/** Pseudoaleatorio determinista en [0,1) a partir de una semilla (mulberry32). */
function azar(semilla: number) {
  let a = Math.floor(semilla * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dónde queda cada dado: una rejilla centrada con un poco de desorden. */
export function posicionesEnMesa(n: number, semilla = 1): Array<[number, number]> {
  const columnas = Math.min(ESCENA.columnas, n);
  const filas = Math.ceil(n / columnas);
  const r = azar(semilla);
  return Array.from({ length: n }, (_, i) => {
    const fila = Math.floor(i / columnas);
    const enFila = fila === filas - 1 ? n - fila * columnas : columnas;
    const col = i % columnas;
    const x = (col - (enFila - 1) / 2) * ESCENA.separacion + (r() - 0.5) * 0.5;
    const z = (fila - (filas - 1) / 2) * ESCENA.separacionFilas + (r() - 0.5) * 0.4;
    return [x, z];
  });
}

const GEOMETRIAS = new Map<TipoDeDado, ReturnType<typeof geometriaBiselada>>();
const ATLAS = new Map<TipoDeDado, CanvasTexture>();
function recursosDe(tipo: TipoDeDado) {
  if (!GEOMETRIAS.has(tipo)) GEOMETRIAS.set(tipo, geometriaBiselada(tipo));
  if (!ATLAS.has(tipo)) ATLAS.set(tipo, crearAtlas(tipo));
  return { geometria: GEOMETRIAS.get(tipo)!, atlas: ATLAS.get(tipo)! };
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

let texturaSombra: CanvasTexture | null = null;
/** Mancha radial compartida por todas las sombras (las sombras reales con transmisión costarían otro pase). */
function sombraCompartida(): CanvasTexture {
  if (!texturaSombra) {
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = 128;
    const ctx = lienzo.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    texturaSombra = new CanvasTexture(lienzo);
  }
  return texturaSombra;
}

function Dado({ dado, x, z }: { dado: DadoEnMesa; x: number; z: number }) {
  const grupo = useRef<Group>(null);
  const sombra = useRef<Mesh>(null);
  const humo = useRef<Mesh>(null);
  const luz = useRef<PointLight>(null);
  const inicio = useRef<number | null>(null);
  const { geometria, atlas } = recursosDe(dado.tipo);
  const radio = DADOS.radio[dado.tipo];

  const material = useMemo(
    () =>
      new MeshPhysicalMaterial({
        color: ESCENA.cristal.color,
        metalness: 0,
        roughness: 1,
        roughnessMap: atlas,
        transmission: 1,
        thickness: ESCENA.cristal.espesor,
        ior: ESCENA.cristal.ior,
        dispersion: ESCENA.cristal.dispersion,
        attenuationColor: new Color(ESCENA.cristal.atenuacion),
        attenuationDistance: ESCENA.cristal.distanciaAtenuacion,
        bumpMap: atlas,
        bumpScale: ESCENA.cristal.relieve,
        emissive: new Color('#dbe8ff'),
        emissiveMap: atlas,
        emissiveIntensity: ESCENA.cristal.brilloGrabado,
        clearcoat: ESCENA.cristal.clearcoat,
        clearcoatRoughness: 0.06,
      }),
    [atlas],
  );
  const materialHumo = useMemo(() => crearMaterialDeHumo(dado.semilla, radio), [dado.semilla, radio]);
  useEffect(() => () => {
    material.dispose();
    materialHumo.dispose();
  }, [material, materialHumo]);

  const plan = useMemo(() => {
    const r = azar(dado.semilla);
    const final = orientacionFinal(dado.tipo, dado.valor, r() * Math.PI * 2);
    const eje = new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    return {
      final,
      eje,
      giro: (ESCENA.lanzamiento.vueltas + r() * 1.5) * Math.PI * 2,
      apoyo: alturaDeApoyo(dado.tipo, final),
      duracion: (DADOS.duracionMs + r() * DADOS.variacionMs) / 1000,
      desdeX: x + (r() - 0.5) * 3,
      rebotes: 2.2 + r() * 1.2,
    };
  }, [dado.semilla, dado.tipo, dado.valor, x]);

  const q = useMemo(() => new Quaternion(), []);
  const color = useMemo(() => new Color(), []);

  useFrame((state) => {
    const g = grupo.current;
    if (!g) return;
    const ahora = state.clock.elapsedTime;
    if (inicio.current === null) inicio.current = ahora;
    const t = dado.animar ? Math.min(1, (ahora - inicio.current) / plan.duracion) : 1;
    const e = easeOut(t);
    g.position.set(
      plan.desdeX + (x - plan.desdeX) * e,
      plan.apoyo + ESCENA.lanzamiento.altura * Math.pow(1 - t, 1.7) * Math.abs(Math.cos(Math.PI * plan.rebotes * t)),
      z + ESCENA.lanzamiento.adelante * (1 - e),
    );
    g.quaternion.copy(q.setFromAxisAngle(plan.eje, plan.giro * (1 - e)).multiply(plan.final));
    if (sombra.current) {
      // Más chica y tenue cuanto más alto va el dado.
      const altura = Math.max(0, g.position.y - plan.apoyo);
      sombra.current.position.set(g.position.x, 0.01, g.position.z);
      sombra.current.scale.setScalar(radio * ESCENA.sombra.tamano * (1 + altura * 0.25));
      (sombra.current.material as MeshBasicMaterial).opacity = ESCENA.sombra.opacidad / (1 + altura * 0.9);
    }

    const material = humo.current?.material as ReturnType<typeof crearMaterialDeHumo> | undefined;
    if (material) material.uniforms.uTiempo.value = ahora;
    if (luz.current) {
      luz.current.color.copy(colorDelHumo(dado.semilla, ahora, color));
      luz.current.intensity = ESCENA.luzHumo.intensidad * (0.85 + 0.15 * Math.sin(ahora * 2.3 + dado.semilla));
    }
  });

  return (
    <>
    <mesh ref={sombra} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={sombraCompartida()} transparent depthWrite={false} />
    </mesh>
    <group ref={grupo}>
      <mesh geometry={geometria} material={material} />
      <mesh ref={humo} material={materialHumo} renderOrder={10}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <pointLight ref={luz} distance={ESCENA.luzHumo.distancia} decay={2} />
    </group>
    </>
  );
}

/** Tapete con trama fina: sin algo detrás que se deforme, la refracción del cristal no se nota. */
function Tapete() {
  const textura = useMemo(() => {
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = 512;
    const ctx = lienzo.getContext('2d')!;
    ctx.fillStyle = '#0d1018';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(140, 160, 210, 0.16)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(140, 160, 210, 0.07)';
    ctx.lineWidth = 1;
    for (let i = 32; i <= 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
    const t = new CanvasTexture(lienzo);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(12, 12);
    t.anisotropy = 8;
    return t;
  }, []);
  useEffect(() => () => textura.dispose(), [textura]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial map={textura} roughness={0.85} metalness={0} />
    </mesh>
  );
}

/** Reflejos del cristal: una sala generada en local y prefiltrada (PMREM), sin descargar ningún HDR. */
function Entorno() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const sala = new RoomEnvironment();
    const mapa = pmrem.fromScene(sala, 0.04).texture;
    scene.environment = mapa;
    scene.environmentIntensity = 0.7;
    return () => {
      scene.environment = null;
      mapa.dispose();
      pmrem.dispose();
      sala.dispose?.();
    };
  }, [gl, scene]);
  return null;
}

/**
 * Cuánto se aleja la cámara según cuántos dados hay: el encuadre de 10 dados dejaba a 2 dados
 * diminutos (sobre todo en el celular). 1 → 0,62 del encuadre completo; 9 o más → el completo.
 */
export function distanciaDeCamara(n: number): number {
  return 0.62 + 0.38 * Math.min(1, Math.max(0, n - 1) / 8);
}

/** Acerca o aleja la cámara con suavidad cuando cambia la bandeja (sin saltos). */
function CamaraAjustada({ n }: { n: number }) {
  const destino = useMemo(() => new Vector3(...ESCENA.camara.posicion).multiplyScalar(distanciaDeCamara(n)), [n]);
  useFrame(({ camera }, delta) => {
    camera.position.lerp(destino, 1 - Math.exp(-delta * 4));
    camera.lookAt(0, 0, 0.4);
  });
  return null;
}

export function EscenaDados({ dados, semillaMesa }: { dados: DadoEnMesa[]; semillaMesa: number }) {
  const posiciones = posicionesEnMesa(dados.length, semillaMesa);
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{
        position: new Vector3(...ESCENA.camara.posicion).multiplyScalar(distanciaDeCamara(dados.length)).toArray() as [number, number, number],
        fov: ESCENA.camara.fov,
      }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0.4)}
      gl={{ antialias: true }}
      style={{ background: '#07080d' }}
    >
      <color attach="background" args={['#07080d']} />
      <fog attach="fog" args={['#07080d', 12, 24]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[-4, 9, 5]} intensity={1.3} />
      <Entorno />
      <CamaraAjustada n={dados.length} />
      <Tapete />
      {dados.map((dado, i) => (
        <Dado key={dado.clave} dado={dado} x={posiciones[i][0]} z={posiciones[i][1]} />
      ))}
    </Canvas>
  );
}
