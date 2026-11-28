// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

import { useEffect, useState } from "react";

import { cargarFuenteMinecraft } from "@/components/premium-minecraft";

/**
 * Versión de la fuente propia de un marco: 0 mientras no está lista (o si el marco no pide ninguna) y +1 cuando
 * el navegador la termina de cargar. La hoja interior es un lienzo y un lienzo NO se redibuja cuando llega una
 * fuente: se dibuja una vez con la de respaldo y, al subir esta versión (dependencia del `useMemo` de la textura),
 * se dibuja otra vez con la buena. Si no carga, la versión no sube: la hoja se queda con la de respaldo.
 */
export function useFuenteDeMarco(fuente: string | undefined): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!fuente) {
      return;
    }
    let vigente = true;
    void cargarFuenteMinecraft().then((lista) => {
      if (vigente && lista) {
        setVersion((v) => v + 1);
      }
    });
    return () => {
      vigente = false;
    };
  }, [fuente]);
  return version;
}
