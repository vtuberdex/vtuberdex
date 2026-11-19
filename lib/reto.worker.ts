// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/// <reference lib="webworker" />
/**
 * Resuelve la prueba de trabajo de la sesión FUERA del hilo principal (ver `sesion-cliente.ts`).
 * Recibe `{ reto, bits }` y responde `{ solucion }`; si algo falla responde `{}` y el cliente la
 * resuelve en el hilo principal.
 */
import { resolverReto } from "./reto-pow";

self.onmessage = async (
  evento: MessageEvent<{ reto: string; bits: number }>,
) => {
  // Un worker dedicado solo recibe de quien lo creó (origen vacío o el propio); cualquier otro se ignora.
  if (evento.origin && evento.origin !== self.location.origin) {
    return;
  }
  try {
    const solucion = await resolverReto(evento.data.reto, evento.data.bits);
    self.postMessage({ solucion });
  } catch {
    self.postMessage({});
  }
};
