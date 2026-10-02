'use client';
/**
 * El libro de cartas del catálogo: las 8 cartas de la página en UNA escena WebGL, como
 * un álbum abierto con dos hojas de 4 fundas, y el paso de página como una hoja que
 * gira alrededor del lomo.
 *
 * POR QUÉ UN SOLO CANVAS (y no la grilla de 8 `HoloCard`)
 * -----------------------------------------------------
 * Cada `HoloCard` creaba su propio contexto WebGL con renderer, framebuffers a DPR 1.8,
 * PMREM del entorno y copia del `metal-env.webp`; la memoria crecía por carta y el
 * navegador destruye contextos al pasar de 16. Aquí hay un contexto para las ocho: un
 * renderer, un entorno prefiltrado (`useSharedCardEnv`), una geometría del cuerpo, un
 * programa de shader (three lo cachea por fuente). Las cartas son `CardMeshes` con sus
 * propios uniforms, igual que en la ficha, así que el holograma es el mismo.
 *
 * CÓMO SE PASA DE PÁGINA
 * ----------------------
 * El estado de la página sigue siendo la URL (`?page=`): el libro solo pide `onPage`.
 * Cuando `page` cambia, se guarda qué cartas se estaban viendo (`outgoing`) y se arma
 * un giro: la hoja del lado de origen se levanta con esas cartas en su cara y las
 * entrantes en su dorso (`planPlacements`), y las hojas fijas muestran lo que queda
 * destapado. Las cartas entrantes ya se montan DURANTE el giro, en el dorso, con la
 * misma `key` que tendrán después en su funda fija: al terminar solo cambia qué matriz
 * las coloca, no se remontan ni regeneran texturas. Si la API aún no respondió, la hoja
 * se queda en pie (`holdProgress`) y sigue cuando llegan los datos.
 *
 * ENTRADA: flechas del teclado, botones a los lados y gesto horizontal (toque o
 * arrastre) sobre el libro. Un toque corto sobre una carta abre su ficha (lo decide
 * `delta` del evento de R3F: si el puntero se movió más de `tapSlopPx`, fue un gesto).
 *
 * ACCESIBILIDAD Y RESPALDO: el canvas no expone las cartas al lector de pantalla, así que
 * se añade una lista `sr-only` de enlaces. Sin WebGL (o con `prefers-reduced-motion`) el
 * libro se dibuja en 2D con la misma disposición de dos hojas y `CardTile`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Canvas, useFrame, useThree, type RootState, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

import type { VtuberCard } from '@/lib/types';
import * as CFG from '@/components/card3d-config';
import { BINDER } from '@/components/card3d-config';
import { CardTile } from '@/components/card-tile';
import { pickCardQuality } from '@/components/card-quality';
import { CardMeshes, Rig, WebGLBoundary, supportsWebGL, usePointerTilt } from '@/components/holo-card';
import { CardEnvContext, useCardMaterials, useSharedCardEnv, type SharedCardEnv } from '@/components/card-material';
import { buildCardBodyGeometry } from '@/components/card3d-geometry';
import {
  CARD_H,
  CARD_W,
  CARDS_PER_SPREAD,
  advanceFlip,
  bookDimensions,
  fitCameraZ,
  isStaticCardVisible,
  planPlacements,
  sheetAngle,
  sheetCardLocalMatrix,
  sheetMatrix,
  slotPosition,
  staticCardMatrix,
  turningSide,
  type FlipDir,
  type Placement,
} from '@/components/card-binder-layout';

export interface CardBinderProps {
  items: VtuberCard[];
  /** Página actual según la URL (cambia ANTES de que lleguen los datos). */
  page: number;
  pageCount: number;
  /** Hay una petición en vuelo: durante un giro, la hoja espera; sin giro, el libro se atenúa. */
  loading: boolean;
  onPage: (page: number) => void;
}

interface Flip {
  dir: FlipDir;
  outgoing: VtuberCard[];
  /**
   * El array de `items` que había al empezar: la página entrante «ha llegado» cuando
   * `items` es OTRO array. No sirve mirar `loading`: en el render en que cambia la URL
   * el hook aún no puso `loading = true`, así que por un render las cartas viejas se
   * leían como entrantes y la hoja arrancaba con las cartas equivocadas.
   */
  pending: VtuberCard[];
  token: number;
}

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
  sheet: THREE.Matrix4;
  book: { x: number; y: number };
  pointer: { x: number; y: number };
  advance: (state: RootState, delta: number) => void;
}

/* ----------------------------------------------------------------------------
 * Escena.
 * ------------------------------------------------------------------------- */

/**
 * Textura del papel de una hoja con sus 4 fundas, una vez por escena. Las dos hojas y
 * la que gira usan la MISMA: la disposición es simétrica respecto del centro de la
 * hoja, así que al verla por detrás (espejada) sigue coincidiendo con las cartas.
 */
function makePageTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const { pageW, pageH, pageCenterX } = bookDimensions();
  const width = 768;
  const height = Math.round((width * pageH) / pageW);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const scale = width / pageW;
  ctx.fillStyle = BINDER.pageColor;
  ctx.fillRect(0, 0, width, height);

  const pocketW = (CARD_W + 2 * BINDER.pocketPad) * scale;
  const pocketH = (CARD_H + 2 * BINDER.pocketPad) * scale;
  const radius = (CFG.GEOMETRY.cornerRadius + BINDER.pocketPad) * scale;
  for (let slot = BINDER.cardsPerPage; slot < CARDS_PER_SPREAD; slot += 1) {
    const { x, y } = slotPosition(slot);
    const cx = (x - pageCenterX + pageW / 2) * scale;
    const cy = (pageH / 2 - y) * scale;
    ctx.beginPath();
    ctx.roundRect(cx - pocketW / 2, cy - pocketH / 2, pocketW, pocketH, radius);
    const grad = ctx.createLinearGradient(0, cy - pocketH / 2, 0, cy + pocketH / 2);
    grad.addColorStop(0, BINDER.pocketColor);
    grad.addColorStop(1, BINDER.pageColor);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = BINDER.pocketLine;
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function BookBody({ env, pageTexture }: { env: SharedCardEnv; pageTexture: THREE.Texture | null }) {
  const { pageW, pageH, spreadW, pageCenterX } = bookDimensions();
  return (
    <>
      <mesh position={[0, 0, BINDER.coverZ]}>
        <planeGeometry args={[spreadW + 2 * BINDER.coverMargin, pageH + 2 * BINDER.coverMargin]} />
        <meshStandardMaterial color={BINDER.coverColor} roughness={0.92} metalness={0.05} />
      </mesh>
      {(['left', 'right'] as const).map((side) => (
        <mesh key={side} position={[side === 'left' ? -pageCenterX : pageCenterX, 0, 0]}>
          <planeGeometry args={[pageW, pageH]} />
          <meshStandardMaterial map={pageTexture} color={pageTexture ? '#ffffff' : BINDER.pageColor} roughness={0.85} />
        </mesh>
      ))}
      {BINDER.ringOffsets.map((offset) => (
        <mesh key={offset} position={[0, pageH * offset, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[BINDER.ringRadius, BINDER.ringTube, 12, 36]} />
          <meshStandardMaterial
            color="#cfd5e0"
            roughness={0.25}
            metalness={0.9}
            envMap={env.bodyEnvMap}
            envMapIntensity={CFG.BODY.envMapIntensity}
          />
        </mesh>
      ))}
    </>
  );
}

/** La hoja que gira: un plano de papel que acompaña a sus cartas. */
function TurningSheet({ frame, dir, pageTexture }: { frame: BinderFrame; dir: FlipDir; pageTexture: THREE.Texture | null }) {
  const mesh = useRef<THREE.Mesh>(null);
  const { pageW, pageH, pageCenterX } = bookDimensions();
  const local = useMemo(() => {
    const x = turningSide(dir) === 'left' ? -pageCenterX : pageCenterX;
    return new THREE.Matrix4().makeTranslation(x, 0, BINDER.sheetZ);
  }, [dir, pageCenterX]);

  useFrame((state, delta) => {
    frame.advance(state, delta);
    const m = mesh.current;
    if (!m) return;
    m.matrix.multiplyMatrices(frame.sheet, local);
    m.matrixWorldNeedsUpdate = true;
  });

  return (
    <mesh ref={mesh} matrixAutoUpdate={false}>
      <planeGeometry args={[pageW, pageH]} />
      <meshStandardMaterial
        map={pageTexture}
        color={pageTexture ? '#ffffff' : BINDER.pageColor}
        roughness={0.85}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

interface BinderCardProps {
  placement: Placement<VtuberCard>;
  frame: BinderFrame;
  textureWidth: number;
  bodyGeometry: THREE.BufferGeometry;
  onOpen: (card: VtuberCard) => void;
}

function BinderCard({ placement, frame, textureWidth, bodyGeometry, onOpen }: BinderCardProps) {
  const group = useRef<THREE.Group>(null);
  const hovered = useRef(false);
  const lift = useRef(0);
  const local = useMemo(() => new THREE.Matrix4(), []);
  const position = useMemo(() => slotPosition(placement.slot), [placement.slot]);
  const mats = useCardMaterials(placement.card, {
    holo: CFG.INTENSITY.holo.tile,
    gloss: CFG.INTENSITY.gloss.tile,
    textureWidth,
    bodyGeometry,
  });

  useEffect(
    () => () => {
      if (hovered.current) document.body.style.cursor = '';
    },
    [],
  );

  useFrame((state, delta) => {
    frame.advance(state, delta);
    const g = group.current;
    if (!g) return;
    const liftTarget = hovered.current && placement.role === 'static' ? BINDER.hoverLift : 0;
    lift.current += (liftTarget - lift.current) * (1 - Math.pow(BINDER.hoverDampingBase, delta));

    let visible = mats.ready;
    let tiltY = frame.book.y;
    if (placement.role === 'static') {
      staticCardMatrix(position, lift.current, g.matrix);
      visible = visible && isStaticCardVisible(placement.reveal, frame.theta);
    } else {
      sheetCardLocalMatrix(position, placement.role === 'sheet-front' ? 'front' : 'back', local);
      g.matrix.multiplyMatrices(frame.sheet, local);
      // El holograma «barre» la carta con el ángulo de su hoja: es lo que hace que el giro
      // se lea como una lámina real que cambia de brillo al moverse.
      tiltY += Math.sin(frame.theta) * BINDER.sheetTiltGain;
    }
    g.matrixWorldNeedsUpdate = true;
    g.visible = visible;
    mats.tick(frame.time, frame.pointer, { x: frame.book.x, y: tiltY });
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > BINDER.tapSlopPx) return;
    event.stopPropagation();
    onOpen(placement.card);
  };
  const onPointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    hovered.current = true;
    document.body.style.cursor = 'pointer';
  };
  const onPointerOut = () => {
    hovered.current = false;
    document.body.style.cursor = '';
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
      <CardMeshes mats={mats} />
    </group>
  );
}

interface BinderSceneProps {
  placements: Placement<VtuberCard>[];
  flip: Flip | null;
  ready: boolean;
  textureWidth: number;
  onFlipEnd: (token: number) => void;
  onOpen: (card: VtuberCard) => void;
}

function BinderScene({ placements, flip, ready, textureWidth, onFlipEnd, onOpen }: BinderSceneProps) {
  const env = useSharedCardEnv();
  const bodyGeometry = useMemo(() => buildCardBodyGeometry(), []);
  useEffect(() => () => bodyGeometry.dispose(), [bodyGeometry]);
  const pageTexture = useMemo(() => makePageTexture(), []);
  useEffect(() => () => pageTexture?.dispose(), [pageTexture]);

  const book = useRef<THREE.Group>(null);
  const pointer = usePointerTilt(book, {
    tiltY: BINDER.tiltY,
    tiltX: BINDER.tiltX,
    driftX: 0,
    dampingBase: BINDER.dampingBase,
  });

  const { camera, size } = useThree();
  const cameraZ = fitCameraZ(size.width / Math.max(1, size.height));
  useEffect(() => {
    camera.position.set(0, 0, cameraZ);
    camera.lookAt(0, 0, 0);
  }, [camera, cameraZ]);

  const frame = useRef<BinderFrame | null>(null);
  if (!frame.current) {
    const f: BinderFrame = {
      stamp: -1,
      time: 0,
      progress: 0,
      theta: 0,
      dir: 1,
      token: -1,
      ready: true,
      done: true,
      sheet: new THREE.Matrix4(),
      book: { x: 0, y: 0 },
      pointer: { x: 0, y: 0 },
      advance: (state, delta) => {
        const t = state.clock.elapsedTime;
        if (f.stamp === t) return;
        f.stamp = t;
        f.time = t;
        f.pointer = pointer.current;
        if (f.token >= 0 && !f.done) f.progress = advanceFlip(f.progress, delta, f.ready);
        f.theta = f.token >= 0 ? sheetAngle(f.dir, f.progress) : 0;
        sheetMatrix(f.theta, f.sheet);
        const b = book.current;
        f.book.x = b?.rotation.x ?? 0;
        f.book.y = b?.rotation.y ?? 0;
      },
    };
    frame.current = f;
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
    if (f.token >= 0 && !f.done && f.progress >= 1) {
      f.done = true;
      onFlipEnd(f.token);
    }
  });

  return (
    <CardEnvContext.Provider value={env}>
      <Rig accent="#9aa4b8" cameraZ={cameraZ} />
      <group ref={book}>
        <BookBody env={env} pageTexture={pageTexture} />
        {flip && <TurningSheet frame={f} dir={flip.dir} pageTexture={pageTexture} />}
        {placements.map((placement) => (
          <BinderCard
            key={placement.card.id}
            placement={placement}
            frame={f}
            textureWidth={textureWidth}
            bodyGeometry={bodyGeometry}
            onOpen={onOpen}
          />
        ))}
      </group>
    </CardEnvContext.Provider>
  );
}

/* ----------------------------------------------------------------------------
 * Respaldo 2D: el mismo libro, en CSS.
 * ------------------------------------------------------------------------- */

function FallbackPage({ cards, firstIndex }: { cards: VtuberCard[]; firstIndex: number }) {
  return (
    <div
      data-testid="binder-page"
      className="grid grid-cols-2 gap-3 rounded-xl p-3"
      style={{ background: BINDER.pageColor }}
    >
      {Array.from({ length: BINDER.cardsPerPage }, (_, i) => {
        const card = cards[i];
        return card ? (
          <CardTile key={card.id} card={card} index={firstIndex + i} />
        ) : (
          <div key={`empty-${i}`} aria-hidden className="aspect-[5/7] rounded-2xl" style={{ background: BINDER.pocketColor }} />
        );
      })}
    </div>
  );
}

function BinderFallback({ items }: { items: VtuberCard[] }) {
  return (
    <div
      data-testid="binder-fallback"
      className="grid grid-cols-[1fr_12px_1fr] gap-2 rounded-2xl p-3"
      style={{ background: BINDER.coverColor }}
    >
      <FallbackPage cards={items.slice(0, BINDER.cardsPerPage)} firstIndex={0} />
      <div aria-hidden className="rounded-full bg-black/60" />
      <FallbackPage cards={items.slice(BINDER.cardsPerPage, CARDS_PER_SPREAD)} firstIndex={BINDER.cardsPerPage} />
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Componente público.
 * ------------------------------------------------------------------------- */

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
};

export function CardBinder({ items, page, pageCount, loading, onPage }: CardBinderProps) {
  const router = useRouter();
  /**
   * La detección de WebGL se hace en un efecto, no en el estado inicial: el HTML del
   * servidor (y el primer render del cliente) tienen que coincidir, y en el servidor no
   * hay canvas. Un frame con el respaldo 2D es el precio de no romper la hidratación.
   */
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => setWebgl(supportsWebGL()), []);
  const [lost, setLost] = useState(false);
  const [quality] = useState(() => pickCardQuality());
  const textureWidth = Math.min(quality.textureWidth, BINDER.textureWidthCap);
  const threeD = webgl === true && !lost && quality.tier !== 'static';

  const [flip, setFlip] = useState<Flip | null>(null);
  const previousPage = useRef(page);
  const shown = useRef(items);
  const tokens = useRef(0);

  // Lo que el usuario está VIENDO: solo se actualiza con datos completos, así que al
  // cambiar de página sigue valiendo como «cartas salientes» aunque haya una carga a medias.
  useEffect(() => {
    if (!loading) shown.current = items;
  }, [items, loading]);

  useEffect(() => {
    if (page === previousPage.current) return;
    const dir: FlipDir = page > previousPage.current ? 1 : -1;
    previousPage.current = page;
    if (!threeD) return;
    tokens.current += 1;
    setFlip({ dir, outgoing: shown.current, pending: items, token: tokens.current });
  }, [page, threeD, items]);

  useEffect(() => {
    if (!threeD && flip) setFlip(null);
  }, [threeD, flip]);

  const onFlipEnd = useCallback((token: number) => {
    setFlip((current) => (current && current.token === token ? null : current));
  }, []);

  const go = useCallback(
    (dir: FlipDir) => {
      if (flip) return false;
      const next = page + dir;
      if (next < 1 || next > pageCount) return false;
      onPage(next);
      return true;
    },
    [flip, page, pageCount, onPage],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === 'ArrowRight' && go(1)) event.preventDefault();
      else if (event.key === 'ArrowLeft' && go(-1)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const gesture = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < BINDER.swipeMinPx || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
    go(dx < 0 ? 1 : -1);
  };
  const onPointerCancel = () => {
    gesture.current = null;
  };

  const onOpen = useCallback((card: VtuberCard) => router.push(`/v/${card.slug}`), [router]);

  // Durante un giro, la página entrante no se muestra hasta que sus datos llegan (otro
  // array de `items` y sin carga en vuelo); sin giro (cambio de filtros) se mantiene lo
  // visible, atenuado, para no parpadear.
  const arrived = !flip || (items !== flip.pending && !loading);
  const placements = useMemo(() => planPlacements(arrived ? items : [], flip), [arrived, items, flip]);
  const { spreadW, pageH } = bookDimensions();

  const arrowClass =
    'absolute top-1/2 z-10 -translate-y-1/2 rounded-full border border-dex-line bg-dex-void/70 p-2 text-xl leading-none text-dex-muted backdrop-blur transition-colors hover:border-dex-accent/60 hover:text-dex-ink disabled:cursor-not-allowed disabled:opacity-30';

  return (
    <section
      aria-label={`Libro de cartas, página ${page} de ${pageCount}`}
      data-testid="card-binder"
      data-flipping={flip ? 'true' : 'false'}
    >
      <div
        className="relative select-none"
        style={{ aspectRatio: `${spreadW} / ${pageH}`, touchAction: 'pan-y', opacity: loading && !flip ? 0.6 : 1, transition: 'opacity 200ms' }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {threeD ? (
          <WebGLBoundary fallback={<BinderFallback items={items} />}>
            {/* Caja posicionada: el canvas no puede participar del layout (ver `holo-card.tsx`). */}
            <div className="absolute inset-0">
              <Canvas
                dpr={quality.dpr}
                gl={{ antialias: true, alpha: true, powerPreference: quality.tier === 'lite' ? 'default' : 'high-performance' }}
                camera={{ fov: CFG.GEOMETRY.cameraFov, position: [0, 0, fitCameraZ(spreadW / pageH)] }}
                onCreated={({ gl }) => {
                  gl.domElement.addEventListener('webglcontextlost', (event) => {
                    event.preventDefault();
                    setLost(true);
                  });
                }}
              >
                <BinderScene
                  placements={placements}
                  flip={flip}
                  ready={arrived}
                  textureWidth={textureWidth}
                  onFlipEnd={onFlipEnd}
                  onOpen={onOpen}
                />
              </Canvas>
            </div>
            <ul className="sr-only">
              {items.map((card) => (
                <li key={card.id}>
                  <Link href={`/v/${card.slug}`}>
                    {card.name}, VTuber número {card.dexNumber}
                  </Link>
                </li>
              ))}
            </ul>
          </WebGLBoundary>
        ) : (
          <BinderFallback items={items} />
        )}

        <button
          type="button"
          className={`${arrowClass} left-1`}
          onClick={() => go(-1)}
          disabled={page <= 1}
          aria-label="Página anterior"
        >
          ‹
        </button>
        <button
          type="button"
          className={`${arrowClass} right-1`}
          onClick={() => go(1)}
          disabled={page >= pageCount}
          aria-label="Página siguiente"
        >
          ›
        </button>
      </div>
      <p className="mt-3 text-center font-mono text-xs text-dex-muted">
        Página {page} de {pageCount}
        <span className="hidden sm:inline"> · ← → o desliza para pasar de página</span>
      </p>
    </section>
  );
}

export default CardBinder;
