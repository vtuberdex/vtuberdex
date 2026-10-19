/**
 * `/.well-known/tdmrep.json` — reserva de derechos de minería de textos y datos (protocolo TDM del W3C).
 * Declara que el sitio NO autoriza la extracción automatizada para entrenar sistemas; la política
 * legible por personas está en la cláusula 18 de los términos.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(
    [
      {
        location: "/*",
        "tdm-reservation": 1,
        "tdm-policy": "/terminos#seguridad",
      },
    ],
    { headers: { "cache-control": "public, max-age=86400" } },
  );
}
