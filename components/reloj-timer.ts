// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/**
 * Reloj de las escenas R3F sobre `THREE.Timer`, no sobre `THREE.Clock`.
 *
 * POR QUÉ: `THREE.Clock` está OBSOLETO desde r183 (la guía de three para LLMs y la documentación
 * remiten a `THREE.Timer`) y avisa por consola en cada construcción. `@react-three/fiber` 9.8.2 (la
 * última estable a 2026-11) todavía crea `new THREE.Clock()` dentro de su store, uno por `<Canvas>`,
 * y su bucle lee `state.clock.getDelta()`/`elapsedTime`. No se puede impedir esa construcción sin
 * parchear la librería, así que:
 *   1. `usarTimer` (en el `onCreated` de cada `<Canvas>`) REEMPLAZA `state.clock` por `RelojTimer`, que
 *      expone la misma forma que `Clock` (lo que R3F y nuestro código tocan) pero mide con `Timer`.
 *      Todo `useFrame` (holo, libro, dados) y el descarte de delta de `render-governor.tsx` pasan a
 *      correr sobre `Timer` sin tocar cada escena.
 *   2. `Timer.connect(document)` usa la Page Visibility API: con la pestaña oculta el delta es 0 y al
 *      volver se reinicia, así que el primer frame tras volver no trae minutos de golpe.
 *   3. Se calla SOLO el aviso de construcción de `Clock` (el que provoca R3F por dentro), con
 *      `setConsoleFunction`, encadenando cualquier función previa. El resto de avisos de three sale igual.
 * Cuando R3F deje de construir `Clock` (v10), se borra el punto 3.
 */
import {
  getConsoleFunction,
  setConsoleFunction,
  Timer,
  type Clock,
} from "three";
import type { RootState } from "@react-three/fiber";

const AVISO_CLOCK = "Clock: This module has been deprecated";

let filtroInstalado = false;
/** Idempotente. Se llama al cargar el módulo: tiene que ir ANTES de que R3F cree su store. */
export function callarAvisoDeClockDeR3F(): void {
  if (filtroInstalado) {
    return;
  }
  filtroInstalado = true;
  const previa = getConsoleFunction() as
    | ((
        tipo: "log" | "warn" | "error",
        mensaje: string,
        ...p: unknown[]
      ) => void)
    | null;
  setConsoleFunction((tipo, mensaje, ...params) => {
    if (
      tipo === "warn" &&
      typeof mensaje === "string" &&
      mensaje.includes(AVISO_CLOCK)
    ) {
      return;
    }
    if (previa) {
      return previa(tipo, mensaje, ...params);
    }
    console[tipo](mensaje, ...params);
  });
}
callarAvisoDeClockDeR3F();

/**
 * La forma de `THREE.Clock` que usan R3F (`getDelta`, `elapsedTime`, `oldTime`, `start`, `stop`) y
 * nuestro código, medida con `THREE.Timer`. `elapsedTime` se acumula aquí (no se lee de `Timer`)
 * porque R3F lo ESCRIBE directamente en `frameloop="never"` y al cambiar de frameloop.
 */
export class RelojTimer {
  readonly timer = new Timer();
  autoStart = true;
  startTime = 0;
  oldTime = 0;
  elapsedTime = 0;
  running = false;

  constructor() {
    if (typeof document !== "undefined") {
      this.timer.connect(document);
    }
  }

  start(): void {
    this.timer.reset();
    this.startTime = performance.now();
    this.oldTime = this.startTime;
    this.elapsedTime = 0;
    this.running = true;
  }

  stop(): void {
    this.getElapsedTime();
    this.running = false;
    this.autoStart = false;
  }

  getElapsedTime(): number {
    this.getDelta();
    return this.elapsedTime;
  }

  /** Segundos desde la llamada anterior (0 con la pestaña oculta). */
  getDelta(): number {
    if (this.autoStart && !this.running) {
      this.start();
      return 0;
    }
    if (!this.running) {
      return 0;
    }
    this.timer.update();
    const delta = this.timer.getDelta();
    this.oldTime = performance.now();
    this.elapsedTime += delta;
    return delta;
  }

  dispose(): void {
    this.timer.dispose();
  }
}

/**
 * Para el `onCreated` de cada `<Canvas>`: cambia el reloj de la escena por uno sobre `Timer`. El
 * `Clock` que R3F creó queda sin uso. El `Timer` se suelta al perder el contexto (desmontar).
 */
export function usarTimer(state: RootState): void {
  const reloj = new RelojTimer();
  if (state.clock.running) {
    reloj.start();
  }
  state.set({ clock: reloj as unknown as Clock });
  state.gl.domElement.addEventListener(
    "webglcontextlost",
    () => reloj.dispose(),
    { once: true },
  );
}
