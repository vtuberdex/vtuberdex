// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Cliente de la sesión de visitante (ver `lib/sesion-visitante.mjs`): pide un reto, lo resuelve y
 * deja la cookie. Una sola resolución a la vez aunque varias peticiones la pidan a la vez.
 */
import { resolverReto } from "./reto-pow";

export { resolverReto } from "./reto-pow";

let enCurso: Promise<void> | null = null;

/**
 * La prueba de trabajo se resuelve en un WEB WORKER (`reto.worker.ts`). En el hilo principal costaba
 * ~370 ms de CPU en un equipo rápido (perfil de CDP, 2026-11-19) en cada carga, justo mientras la página
 * hidrata; en un celular modesto, varias veces eso. Sin `Worker` (o si el worker falla) se resuelve aquí.
 */
function resolverEnSegundoPlano(reto: string, bits: number): Promise<string> {
  if (typeof Worker === "undefined") {
    return resolverReto(reto, bits);
  }
  return new Promise((resolver) => {
    let trabajador: Worker;
    try {
      trabajador = new Worker(new URL("./reto.worker.ts", import.meta.url));
    } catch {
      resolver(resolverReto(reto, bits));
      return;
    }
    const enHilo = () => {
      trabajador.terminate();
      resolver(resolverReto(reto, bits));
    };
    trabajador.onmessage = (evento: MessageEvent<{ solucion?: string }>) => {
      trabajador.terminate();
      if (evento.data.solucion === undefined) {
        resolver(resolverReto(reto, bits));
      } else {
        resolver(evento.data.solucion);
      }
    };
    trabajador.onerror = enHilo;
    trabajador.postMessage({ reto, bits });
  });
}

async function abrir(): Promise<void> {
  const r = await fetch("/api/sesion", { cache: "no-store" });
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}`);
  }
  const { reto, bits } = (await r.json()) as { reto: string; bits: number };
  const solucion = await resolverEnSegundoPlano(reto, bits);
  const p = await fetch("/api/sesion", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reto, solucion }),
  });
  if (!p.ok) {
    throw new Error(`HTTP ${p.status}`);
  }
}

/** Asegura una sesión vigente. Un fallo no se memoiza: la próxima llamada reintenta. */
export function asegurarSesion(): Promise<void> {
  enCurso ??= abrir().finally(() => {
    enCurso = null;
  });
  return enCurso;
}

/** Cada cuánto se renueva la cookie (vive 5 min): holgura para que no caduque entre dos renovaciones. */
const RENOVAR_CADA_MS = 3 * 60 * 1000;

/**
 * Mantiene viva la sesión mientras la pestaña está VISIBLE: renueva cada 3 min y al volver a verla.
 * Con la pestaña oculta no renueva (la cookie caduca sola); al volver, si ya caducó, la primera
 * petición recibe 401 y `request()` resuelve el reto de nuevo. Devuelve la función que lo detiene.
 */
export function mantenerSesion(): () => void {
  const renovar = async () => {
    if (document.visibilityState !== "visible") {
      return;
    }
    try {
      const r = await fetch("/api/sesion/renovar", { method: "POST" });
      if (r.status === 401) {
        await asegurarSesion();
      }
    } catch {
      /* sin red: se reintenta en el siguiente turno */
    }
  };
  const id = setInterval(renovar, RENOVAR_CADA_MS);
  document.addEventListener("visibilitychange", renovar);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", renovar);
  };
}
