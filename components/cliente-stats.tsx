"use client";
/** Latido anónimo de rendimiento (ver `lib/telemetria-cliente.ts`). No pinta nada. */
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { asegurarSesion, mantenerSesion } from "@/lib/sesion-cliente";
import { iniciarTelemetria, type Telemetria } from "@/lib/telemetria-cliente";

export function ClienteStats() {
  const pathname = usePathname();
  const telemetria = useRef<Telemetria | null>(null);

  // La sesión de visitante se abre al cargar (en segundo plano), para que la primera petición al
  // catálogo no espere la prueba de trabajo. Si falla, `request` la reintenta en la primera 401.
  useEffect(() => {
    asegurarSesion().catch(() => {});
    return mantenerSesion();
  }, []);

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
