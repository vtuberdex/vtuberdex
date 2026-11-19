// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * La prueba de trabajo de la sesión de visitante (ver `lib/sesion-visitante.mjs`), PURA: sin DOM, para
 * que la use tanto el worker (`reto.worker.ts`) como el respaldo en el hilo principal (`sesion-cliente.ts`).
 */
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
    if (hallado !== undefined) {
      return String(hallado);
    }
  }
}
