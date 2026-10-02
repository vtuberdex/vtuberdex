'use client';
/**
 * ¿El catálogo va en modo de UNA hoja (celular)?
 *
 * Por debajo de `BINDER.singleMaxWidth` el libro muestra una sola hoja de 4 fundas y
 * cada PÁGINA del catálogo son 4 cartas: pasar de página gira esa hoja, como en el
 * escritorio gira la hoja de un libro de 8. La decisión vive aquí, fuera del libro,
 * porque la toma el CATÁLOGO: cambia cuántas cartas pide a la API (`perPage`), no solo
 * cómo se dibujan.
 *
 * Se lee por `matchMedia` en un efecto: el servidor no tiene viewport, así que el
 * primer render (y el HTML) asumen el libro entero y el cliente corrige al montar.
 */
import { useEffect, useState } from 'react';

import { BINDER } from '@/components/card3d-config';

export function useSingleSheet(): boolean {
  const [single, setSingle] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia(`(max-width: ${BINDER.singleMaxWidth - 1}px)`);
    const update = () => setSingle(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return single;
}
