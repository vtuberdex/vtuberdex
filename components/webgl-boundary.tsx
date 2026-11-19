// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/**
 * Frontera de error de las escenas 3D: si dibujar la escena lanza, se muestra `fallback`.
 *
 * Vive aparte de `holo-card.tsx` para que el libro (`card-binder.tsx`) la use SIN importar ese módulo,
 * que trae three y R3F: el JS del catálogo carga la escena en un chunk propio (`next/dynamic`).
 */
import { Component, type ReactNode } from "react";

export class WebGLBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[holo-card] fallo al dibujar la escena 3D", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
