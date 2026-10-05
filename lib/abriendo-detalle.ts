'use client';
/**
 * Estado global mínimo de «Accediendo al detalle».
 *
 * POR QUÉ NO ES ESTADO DEL LIBRO: al pulsar una carta, el catálogo navega a `/v/:slug` y se
 * DESMONTA al instante (Next entra al esqueleto de la ficha). Un modal que viviera en
 * `card-binder.tsx` se iba con él, antes de que la ficha cargara; se vio con la ruta
 * retrasada. Por eso el estado es de módulo, lo pinta `components/abriendo-detalle.tsx` desde
 * el layout (que NO se desmonta al navegar) y lo baja la ficha cuando ya tiene sus datos.
 */
import { useSyncExternalStore } from 'react';

/** Si la navegación nunca llega a la ficha, el aviso no puede quedarse para siempre. */
export const ABRIENDO_MAX_MS = 10_000;

let activo = false;
let temporizador: ReturnType<typeof setTimeout> | null = null;
const oyentes = new Set<() => void>();

function emitir(): void {
  oyentes.forEach((oyente) => oyente());
}

export function marcarAbriendo(): void {
  activo = true;
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(limpiarAbriendo, ABRIENDO_MAX_MS);
  emitir();
}

export function limpiarAbriendo(): void {
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
  if (!activo) return;
  activo = false;
  emitir();
}

export function useAbriendoDetalle(): boolean {
  return useSyncExternalStore(
    (oyente) => {
      oyentes.add(oyente);
      return () => oyentes.delete(oyente);
    },
    () => activo,
    () => false,
  );
}
