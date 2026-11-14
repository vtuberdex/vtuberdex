// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Rutas del mantenedor de producción para las FACCIONES (catálogo cerrado: alta, edición, fusión y
 * emblema). Las enruta `route.js`; viven aparte para que ese archivo no pase de las mil líneas.
 */
import { NextResponse } from "next/server";

import { guardarAssetDelMantenedor } from "../../../../lib/ediciones.mjs";
import { aplicarYAnotar, dbConDiario } from "../../../../lib/diario.mjs";
import {
  factionCreateSchema,
  factionUpdateSchema,
  formatIssues,
} from "../../../../server/src/validation.mjs";
import { listarFacciones } from "../../../../server/src/mutations.mjs";
import { responderError } from "./respuestas.js";

/** `GET /api/admin/factions` — las facciones con su conteo real. */
export async function listaDeFacciones() {
  return NextResponse.json({ items: listarFacciones(await dbConDiario()) });
}

/** Aplica una operación de facción y devuelve la lista nueva (la UI repinta desde ella). */
async function mutarFaccion(operacion, usuario, status = 200) {
  try {
    const { db, resultado } = await aplicarYAnotar(operacion, usuario.username);
    return NextResponse.json(
      { faction: resultado, items: listarFacciones(db) },
      { status },
    );
  } catch (error) {
    return responderError(error);
  }
}

export async function crearFaccionRuta(request, usuario) {
  const parsed = factionCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "payload_invalido", issues: formatIssues(parsed.error) },
      { status: 400 },
    );
  }
  return mutarFaccion(
    { tipo: "faccion.crear", datos: parsed.data },
    usuario,
    201,
  );
}

export async function editarFaccionRuta(request, id, usuario) {
  const parsed = factionUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "payload_invalido", issues: formatIssues(parsed.error) },
      { status: 400 },
    );
  }
  return mutarFaccion(
    { tipo: "faccion.editar", id: Number(id), patch: parsed.data },
    usuario,
  );
}

/**
 * Medidas de un PNG leídas de su cabecera (IHDR), o `null` si los bytes no son un PNG.
 * JS puro: aquí no hay `sharp` (binario nativo que no viaja a la función).
 */
function leerMedidasPng(bytes) {
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || firma.some((valor, i) => bytes[i] !== valor)) {
    return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * `POST /api/admin/factions/:id/image` — sube el emblema de una facción (PNG).
 *
 * El cliente lo normaliza a PNG de hasta 512 px antes de enviarlo (en producción no hay `sharp`),
 * y aquí se valida la FIRMA, no la extensión. Se guarda como asset del mantenedor (`kind =
 * 'faction'`, por slug de la facción) y la facción pasa a apuntar a él con `?v=<ms>`: la ruta es
 * canónica y sin versión el navegador seguiría mostrando el emblema anterior.
 */
export async function subirEmblema(request, id, usuario) {
  try {
    const db = await dbConDiario();
    const faccion = db
      .prepare("SELECT id, slug FROM faction WHERE id = ?")
      .get(Number(id));
    if (!faccion) {
      return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
    }
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > 2 * 1024 * 1024) {
      return NextResponse.json(
        {
          error: "archivo_demasiado_grande",
          detail: "el emblema admite hasta 2 MB",
        },
        { status: 400 },
      );
    }
    const medidas = leerMedidasPng(bytes);
    if (!medidas) {
      return NextResponse.json(
        { error: "formato_invalido", detail: "se esperaba un PNG" },
        { status: 400 },
      );
    }
    await guardarAssetDelMantenedor(
      faccion.slug,
      "faction",
      bytes,
      "image/png",
      medidas,
    );
    const ruta = `images/faction/${faccion.slug}.png?v=${Date.now()}`;
    const { db: dbNueva, resultado } = await aplicarYAnotar(
      { tipo: "faccion.editar", id: faccion.id, patch: { icon: ruta } },
      usuario.username,
    );
    return NextResponse.json({
      faction: resultado,
      items: listarFacciones(dbNueva),
      asset: { path: ruta, ...medidas, bytes: bytes.length },
    });
  } catch (error) {
    return responderError(error);
  }
}

export async function eliminarFaccionRuta(request, id, usuario) {
  const bruto = new URL(request.url).searchParams.get("mergeInto");
  const destino = bruto === null ? null : Number(bruto);
  if (destino !== null && !Number.isInteger(destino)) {
    return NextResponse.json(
      { error: "fusion_invalida", detail: "mergeInto debe ser un id" },
      { status: 400 },
    );
  }
  return mutarFaccion(
    { tipo: "faccion.eliminar", id: Number(id), fusionarEn: destino },
    usuario,
  );
}
