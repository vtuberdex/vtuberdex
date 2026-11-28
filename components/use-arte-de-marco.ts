// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

import { useEffect, useState } from "react";

import {
  cargarArteDeMarco,
  type ClaveDeArte,
} from "@/components/premium-marco-arte";

/**
 * Versión del arte de un marco: 0 mientras no está (o si el marco no pide ninguno) y +1 al terminar de bajar.
 * La hoja es un lienzo que no se redibuja solo al llegar una imagen: esta versión es dependencia del `useMemo`
 * de la textura (`premium-slab.tsx`) y la repinta. Si no baja, no sube: la hoja se queda negra, sin filigrana.
 */
export function useArteDeMarco(clave: ClaveDeArte | undefined): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!clave) {
      return;
    }
    let vigente = true;
    void cargarArteDeMarco(clave).then((lista) => {
      if (vigente && lista) {
        setVersion((v) => v + 1);
      }
    });
    return () => {
      vigente = false;
    };
  }, [clave]);
  return version;
}
