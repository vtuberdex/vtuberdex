/**
 * Cliente de la sesión de visitante (ver `lib/sesion-visitante.mjs`): pide un reto, lo resuelve y
 * deja la cookie. Una sola resolución a la vez aunque varias peticiones la pidan a la vez.
 */
let enCurso: Promise<void> | null = null;

async function sha256(texto: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)),
  );
}

function cerosIniciales(d: Uint8Array): number {
  let bits = 0;
  for (const byte of d) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/** Busca `n` con sha256(reto:n) de `bits` ceros. Por lotes, para no congelar la página. */
export async function resolverReto(
  reto: string,
  bits: number,
): Promise<string> {
  const LOTE = 512;
  for (let desde = 0; ; desde += LOTE) {
    const lote = await Promise.all(
      Array.from({ length: LOTE }, async (_, i) => {
        const n = desde + i;
        return cerosIniciales(await sha256(`${reto}:${n}`)) >= bits ? n : -1;
      }),
    );
    const hallado = lote.find((n) => n >= 0);
    if (hallado !== undefined) return String(hallado);
  }
}

async function abrir(): Promise<void> {
  const r = await fetch("/api/sesion", { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { reto, bits } = (await r.json()) as { reto: string; bits: number };
  const solucion = await resolverReto(reto, bits);
  const p = await fetch("/api/sesion", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reto, solucion }),
  });
  if (!p.ok) throw new Error(`HTTP ${p.status}`);
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
    if (document.visibilityState !== "visible") return;
    try {
      const r = await fetch("/api/sesion/renovar", { method: "POST" });
      if (r.status === 401) await asegurarSesion();
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
