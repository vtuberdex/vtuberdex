// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/**
 * La ESCENA del libro de cartas: el `<Canvas>`, las cartas montadas en sus fundas y el giro de la hoja.
 *
 * Es el único módulo del libro que importa three y R3F, y `card-binder.tsx` lo carga con `next/dynamic`
 * para que vaya en un chunk propio y no en el JS de la ruta (ver allí). Qué cartas hay y en qué rol lo
 * decide el DOM (`planPlacements`); aquí solo se dibujan.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Canvas,
  useFrame,
  useThree,
  type RootState,
  type ThreeEvent,
} from "@react-three/fiber";
import { Group, Matrix4 } from "three";

import type { VtuberCard } from "@/lib/types";
import {
  BINDER,
  GEOMETRY,
  INTENSITY,
  RENDER,
} from "@/components/card3d-config";
import { CardMeshes, Rig, usePointerTilt } from "@/components/holo-card";
import { RenderGovernor } from "@/components/render-governor";
import { usarTimer } from "@/components/reloj-timer";
import { CANVAS_FUERA_DE_FLUJO } from "@/components/canvas-fuera-de-flujo";
import {
  CardEnvContext,
  useCardMaterials,
  useSharedCardEnv,
} from "@/components/card-material";
import {
  advanceFlip,
  bookDimensions,
  fitCameraZ,
  isStaticCardVisible,
  sheetAngle,
  slotPosition,
  type FlipDir,
  type Placement,
} from "@/components/card-binder-layout";
import {
  sheetCardLocalMatrix,
  sheetMatrix,
  staticCardMatrix,
} from "@/components/card-binder-matrices";
import { ShaderWarmup } from "@/components/shader-warmup";
import type { Flip, Focus } from "@/components/card-binder";

/**
 * Estado por frame compartido por la escena y sus cartas. Es un objeto mutable (no
 * estado de React) porque se escribe 60 veces por segundo; y lo calcula el PRIMERO que
 * lo pide en cada frame (`advance`), así da igual el orden en que R3F llame a los
 * `useFrame` de la escena y de las cartas: todas leen el mismo ángulo.
 */
interface BinderFrame {
  stamp: number;
  time: number;
  progress: number;
  theta: number;
  dir: FlipDir;
  token: number;
  ready: boolean;
  done: boolean;
  sheet: Matrix4;
  book: { x: number; y: number };
  pointer: { x: number; y: number };
  advance: (state: RootState, delta: number) => void;
}

/* ----------------------------------------------------------------------------
 * Escena.
 * ------------------------------------------------------------------------- */

/*
 * No hay cuerpo del libro: ni tapa, ni anillas, ni hojas con fundas. Las cartas flotan sobre el
 * fondo del sitio y el «giro de página» es solo el movimiento de las cartas de la hoja
 * (`frame.sheet`), sin papel que las acompañe. Las fundas (un contorno redondeado exterior
 * pintado en la hoja) se retiraron por ser un segundo marco detrás de la carta.
 */

interface BinderCardProps {
  placement: Placement<VtuberCard>;
  frame: BinderFrame;
  textureWidth: number;
  onOpen: (card: VtuberCard) => void;
}

function BinderCard({
  placement,
  frame,
  textureWidth,
  onOpen,
}: Readonly<BinderCardProps>) {
  const group = useRef<Group>(null);
  const hovered = useRef(false);
  const lift = useRef(0);
  const local = useMemo(() => new Matrix4(), []);
  const position = useMemo(
    () => slotPosition(placement.slot),
    [placement.slot],
  );
  const mats = useCardMaterials(placement.card, {
    holo: INTENSITY.holo.tile,
    gloss: INTENSITY.gloss.tile,
    textureWidth,
  });

  useEffect(
    () => () => {
      if (hovered.current) {
        document.body.style.cursor = "";
      }
    },
    [],
  );

  useFrame((state, delta) => {
    frame.advance(state, delta);
    const g = group.current;
    if (!g) {
      return;
    }
    const liftTarget =
      hovered.current && placement.role === "static" ? BINDER.hoverLift : 0;
    lift.current +=
      (liftTarget - lift.current) *
      (1 - Math.pow(BINDER.hoverDampingBase, delta));

    let visible = mats.ready;
    let tiltY = frame.book.y;
    if (placement.role === "static") {
      staticCardMatrix(position, lift.current, g.matrix);
      visible = visible && isStaticCardVisible(placement.reveal, frame.theta);
    } else {
      sheetCardLocalMatrix(
        position,
        placement.role === "sheet-front" ? "front" : "back",
        local,
      );
      g.matrix.multiplyMatrices(frame.sheet, local);
      // El holograma «barre» la carta con el ángulo de su hoja: es lo que hace que el giro
      // se lea como una lámina real que cambia de brillo al moverse.
      tiltY += Math.sin(frame.theta) * BINDER.sheetTiltGain;
    }
    g.matrixWorldNeedsUpdate = true;
    g.visible = visible;
    // Una carta oculta no se dibuja: actualizar sus uniforms en cada frame es trabajo perdido.
    // Al volver a ser visible se actualiza ese mismo frame, antes de pintarse.
    if (visible) {
      mats.tick(frame.time, frame.pointer, { x: frame.book.x, y: tiltY });
    }
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > BINDER.tapSlopPx) {
      return;
    }
    event.stopPropagation();
    onOpen(placement.card);
  };
  const onPointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    hovered.current = true;
    document.body.style.cursor = "pointer";
  };
  const onPointerOut = () => {
    hovered.current = false;
    document.body.style.cursor = "";
  };

  return (
    <group
      ref={group}
      matrixAutoUpdate={false}
      visible={false}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      <CardMeshes mats={mats} card={placement.card} />
    </group>
  );
}

interface BinderSceneProps {
  placements: Placement<VtuberCard>[];
  flip: Flip | null;
  ready: boolean;
  focus: Focus;
  textureWidth: number;
  onFlipEnd: (token: number) => void;
  onOpen: (card: VtuberCard) => void;
  /** DPR de partida del canvas y aviso del DPR adaptativo (ver `render-governor.tsx`). */
}

/** Distancia y centro de cámara para el encuadre pedido (libro entero o una hoja). */
function cameraTarget(focus: Focus, aspect: number) {
  const { pageW, pageH, pageCenterX } = bookDimensions();
  if (!focus) {
    return { x: 0, z: fitCameraZ(aspect) };
  }
  // Una hoja: mismo cálculo «contain» que el libro entero, con el ancho de la hoja.
  const halfFov = (GEOMETRY.cameraFov * Math.PI) / 180 / 2;
  const tan = Math.tan(halfFov);
  const byHeight = pageH / 2 / tan;
  const byWidth = pageW / 2 / (tan * Math.max(0.2, aspect));
  return {
    x: focus === "left" ? -pageCenterX : pageCenterX,
    z: Math.max(byHeight, byWidth) / BINDER.cameraFill,
  };
}

function BinderScene({
  placements,
  flip,
  ready,
  focus,
  textureWidth,
  onFlipEnd,
  onOpen,
}: Readonly<BinderSceneProps>) {
  const env = useSharedCardEnv();

  const book = useRef<Group>(null);
  const pointer = usePointerTilt(book, {
    tiltY: BINDER.tiltY,
    tiltX: BINDER.tiltX,
    driftX: 0,
    dampingBase: BINDER.dampingBase,
  });

  const { camera, size } = useThree();
  const target = cameraTarget(focus, size.width / Math.max(1, size.height));
  const cameraZ = target.z;
  /**
   * La cámara PERSIGUE su objetivo (amortiguación exponencial) en vez de saltar: en el
   * celular, pasar de la hoja izquierda a la derecha es una panorámica sobre el álbum.
   * Solo la primera colocación es directa, para no ver la cámara «llegar» al cargar.
   */
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current) {
      return;
    }
    placed.current = true;
    camera.position.set(target.x, 0, target.z);
    camera.lookAt(target.x, 0, 0);
  }, [camera, target.x, target.z]);
  const cameraGoal = useRef(target);
  cameraGoal.current = target;

  const frame = useRef<BinderFrame | null>(null);
  if (!frame.current) {
    const nuevo: BinderFrame = {
      stamp: -1,
      time: 0,
      progress: 0,
      theta: 0,
      dir: 1,
      token: -1,
      ready: true,
      done: true,
      sheet: new Matrix4(),
      book: { x: 0, y: 0 },
      pointer: { x: 0, y: 0 },
      advance: (state, delta) => {
        const t = state.clock.elapsedTime;
        if (nuevo.stamp === t) {
          return;
        }
        nuevo.stamp = t;
        nuevo.time = t;
        nuevo.pointer = pointer.current;
        if (nuevo.token >= 0 && !nuevo.done) {
          nuevo.progress = advanceFlip(nuevo.progress, delta, nuevo.ready);
        }
        nuevo.theta =
          nuevo.token >= 0 ? sheetAngle(nuevo.dir, nuevo.progress) : 0;
        sheetMatrix(nuevo.theta, nuevo.sheet);
        const b = book.current;
        nuevo.book.x = b?.rotation.x ?? 0;
        nuevo.book.y = b?.rotation.y ?? 0;
      },
    };
    frame.current = nuevo;
  }
  const f = frame.current;
  f.ready = ready;

  const token = flip?.token ?? -1;
  const dir = flip?.dir ?? 1;
  useEffect(() => {
    f.token = token;
    f.dir = dir;
    f.progress = 0;
    f.theta = 0;
    f.done = token < 0;
    sheetMatrix(0, f.sheet);
  }, [f, token, dir]);

  useFrame((state, delta) => {
    f.advance(state, delta);
    const goal = cameraGoal.current;
    const damp = 1 - Math.pow(BINDER.cameraDampingBase, delta);
    camera.position.x += (goal.x - camera.position.x) * damp;
    camera.position.z += (goal.z - camera.position.z) * damp;
    camera.lookAt(camera.position.x, 0, 0);
    if (f.token >= 0 && !f.done && f.progress >= 1) {
      f.done = true;
      onFlipEnd(f.token);
    }
  });

  // Un giro en curso o una página que aún no llegó no pasan por el puntero: sin esto el libro
  // los dibujaría a la cadencia de reposo.
  const busy = useCallback(() => (f.token >= 0 && !f.done) || !f.ready, [f]);

  return (
    <CardEnvContext.Provider value={env}>
      <RenderGovernor busy={busy} wake={placements} />
      <Rig accent="#9aa4b8" cameraZ={cameraZ} />
      <group ref={book}>
        <ShaderWarmup />
        {placements.map((placement) => (
          <BinderCard
            key={placement.card.id}
            placement={placement}
            frame={f}
            textureWidth={textureWidth}
            onOpen={onOpen}
          />
        ))}
      </group>
    </CardEnvContext.Provider>
  );
}

export interface BinderLienzoProps extends BinderSceneProps {
  /** Para `webgl-recovery` (`recovery.attach`): recibe el `<canvas>` recién creado. */
  alCrear: (canvas: HTMLCanvasElement) => void;
  /** Ancho / alto del encuadre (libro entero o una hoja): fija la cámara inicial. */
  aspecto: number;
}

/** El `<Canvas>` del libro con su escena. Lo monta `card-binder.tsx` (dinámico, solo en el cliente). */
export default function BinderLienzo({
  alCrear,
  aspecto,
  ...escena
}: Readonly<BinderLienzoProps>) {
  const onCreated = useCallback(
    (state: RootState) => {
      usarTimer(state);
      alCrear(state.gl.domElement);
    },
    [alCrear],
  );
  return (
    /* La caja de R3F va posicionada (`CANVAS_FUERA_DE_FLUJO`): el canvas no puede participar del layout (ver `holo-card.tsx`). */
    <Canvas
      style={CANVAS_FUERA_DE_FLUJO}
      frameloop="demand"
      dpr={[1, RENDER.dprMax]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      }}
      camera={{
        fov: GEOMETRY.cameraFov,
        position: [0, 0, fitCameraZ(aspecto)],
      }}
      onCreated={onCreated}
    >
      <BinderScene {...escena} />
    </Canvas>
  );
}
