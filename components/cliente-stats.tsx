// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/** Latido anónimo de rendimiento (ver `lib/telemetria-cliente.ts`). No pinta nada. */
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { asegurarSesion, mantenerSesion } from "@/lib/sesion-cliente";
import {
  categoriaDeRuta,
  iniciarTelemetria,
  type Telemetria,
} from "@/lib/telemetria-cliente";

export function ClienteStats() {
  const pathname = usePathname();
  const telemetria = useRef<Telemetria | null>(null);

  /**
   * La sesión de visitante (prueba de trabajo, ver `sesion-cliente.ts`) solo la piden `/api/vtubers*`, que
   * usan el CATÁLOGO y la FICHA. Se abre por adelantado al entrar en una de esas dos rutas (para que la
   * primera petición no espere la prueba) y desde ahí se mantiene viva. En el resto de páginas no se abre:
   * antes se resolvía en TODAS las cargas, aunque la página no fuera a usarla. Si otra pantalla la
   * necesita, `request` (`lib/api.ts`) la abre en la primera 401.
   */
  const sesionActiva = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (sesionActiva.current || categoriaDeRuta(pathname) === "otra") {
      return;
    }
    asegurarSesion().catch(() => {});
    sesionActiva.current = mantenerSesion();
  }, [pathname]);
  useEffect(() => () => sesionActiva.current?.(), []);

  useEffect(() => {
    telemetria.current = iniciarTelemetria();
    return () => telemetria.current?.detener();
  }, []);

  // Navegar dentro de la app (catálogo → ficha) no recarga la página: se avisa al cambiar la ruta, para que el
  // histórico mensual cuente cada página vista y no solo la que había abierta en el momento del latido.
  useEffect(() => {
    telemetria.current?.navegar();
  }, [pathname]);

  return null;
}

export default ClienteStats;
