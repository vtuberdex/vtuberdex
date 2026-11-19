// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Reduce las imágenes que pesan mucho más de lo que se dibuja (`asset_remoto`).
 *
 * POR QUÉ: medido en producción (2026-11-19), una página del libro bajaba 9,9 MB y 5,8 de eso eran
 * EMBLEMAS y LOGOS. Los emblemas eran PNG de 512×512 (~180 KB) para un engarce de 88 px en una textura
 * de 1008, y los logos que subió el mantenedor medían 2.150 px de ancho de media (uno, 10.799) para
 * dibujarse dentro de esa misma textura de 1008. Los formularios y el mantenedor ya limitan lo NUEVO
 * (`EMBLEMA_MAX_LADO`, `LOGO_MAX_LADO` en `lib/imagen-cliente.ts`); esto arregla lo que ya está guardado.
 *
 * PERSONAJE Y FONDO no se achican (720×1008 en un lienzo de 1008: ahí no sobra resolución), solo se
 * RECODIFICAN: el mantenedor los exportaba a WebP 0,92 y a calidad 84 pesan ~36 % menos. Comparado
 * ampliado al doble contra el original, no se distingue. Los formularios y el mantenedor exportan ya a
 * `CALIDAD_ARTE` (`lib/imagen-cliente.ts`).
 *
 * REGLAS:
 *   · Antes de reescribir una fila guarda el ORIGINAL en `--respaldo` (obligatorio salvo `--seco`):
 *     los bytes de `asset_remoto` son la única copia de lo que subió el mantenedor.
 *   · Solo reemplaza si ahorra al menos `AHORRO_MINIMO`: re-codificar sin ganar nada es perder calidad.
 *   · Logos, personaje y fondo: la URL lleva `?v=` sacado de `actualizado` y se cachea un año (`immutable`), así que se
 *     actualiza `actualizado` o los navegadores seguirían con la copia grande. Emblemas: su `?v=` sale de
 *     la facción, no de la fila, y ya se sirven con caché corta + ETag (que cambia con el tamaño): no hace
 *     falta tocar la versión.
 *   · El emblema sigue en PNG (su ruta canónica es `.png`), pero CON PALETA: comparado a simple vista contra
 *     el PNG completo a 256 px no se distingue y pesa ~20 KB en vez de ~60.
 *
 *   node scripts/reducir-imagenes.mjs --db <archivo.db> --seco
 *   node scripts/reducir-imagenes.mjs --db <archivo.db> --respaldo <carpeta>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";

const sharp = createRequire(new URL("../server/package.json", import.meta.url))(
  "sharp",
);

/** Lado máximo del emblema (engarce de 88 px en la textura de 1008: 256 sobra en pantallas densas). */
export const EMBLEMA_LADO = 256;
/** Lado máximo del logo: el ancho de la textura de la carta. */
export const LOGO_LADO = 1008;
/** Calidad WebP del personaje y el fondo (misma resolución, solo se recodifica). */
export const CALIDAD_ARTE = 84;
/** Ahorro mínimo para reemplazar (fracción del tamaño original). */
export const AHORRO_MINIMO = 0.2;

/** Logo dentro del lado máximo que aún vale la pena recodificar (era WebP 0,92 del mantenedor). */
export const LOGO_PESADO_BYTES = 200 * 1024;

/**
 * ¿Ya está dentro de los límites? Entonces NO se vuelve a tocar: cada pasada lossy (cuantizar la paleta,
 * recodificar WebP) pierde algo, y el script tiene que poder correrse de nuevo sin degradar lo que ya
 * redujo (medido: una segunda pasada re-cuantizaba los emblemas de 23 a 18 KB). Personaje y fondo no
 * tienen marca de tamaño: los protege `AHORRO_MINIMO` (recodificar 84 sobre 84 apenas ahorra).
 */
export function yaReducida(kind, ancho, alto, peso) {
  const lado = Math.max(ancho ?? 0, alto ?? 0);
  if (kind === "faction") {
    return lado <= EMBLEMA_LADO;
  }
  if (kind === "logo") {
    return lado <= LOGO_LADO && peso <= LOGO_PESADO_BYTES;
  }
  return false;
}

/** Devuelve la versión reducida, o `null` si la imagen ya está dentro de los límites. */
export async function reducir(kind, bytes) {
  const img = sharp(Buffer.from(bytes), { failOn: "none" });
  const meta = await img.metadata();
  if (yaReducida(kind, meta.width, meta.height, bytes.length)) {
    return null;
  }
  const lado = kind === "faction" ? EMBLEMA_LADO : LOGO_LADO;
  const encaje = {
    width: lado,
    height: lado,
    fit: "inside",
    withoutEnlargement: true,
  };
  let salida;
  if (kind === "faction") {
    salida = await img
      .resize(encaje)
      .png({ compressionLevel: 9, palette: true, quality: 90, dither: 1 })
      .toBuffer({ resolveWithObject: true });
  } else if (kind === "logo") {
    salida = await img
      .resize(encaje)
      .webp({ quality: 86, alphaQuality: 90, effort: 6 })
      .toBuffer({ resolveWithObject: true });
  } else {
    salida = await img
      .webp({ quality: CALIDAD_ARTE, alphaQuality: 90, effort: 6 })
      .toBuffer({ resolveWithObject: true });
  }
  return {
    antes: { w: meta.width, h: meta.height },
    bytes: salida.data,
    w: salida.info.width,
    h: salida.info.height,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      db: { type: "string" },
      respaldo: { type: "string" },
      seco: { type: "boolean", default: false },
    },
  });
  if (!values.db) {
    throw new Error("falta --db <archivo.db>");
  }
  if (!values.seco && !values.respaldo) {
    throw new Error(
      "sin --seco hace falta --respaldo <carpeta> (los originales no están en otro sitio)",
    );
  }
  // Import diferido: el módulo también lo importan las pruebas (solo `reducir`), que no necesitan SQLite.
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(values.db);
  db.exec("PRAGMA busy_timeout = 10000");
  const filas = db
    .prepare(
      "SELECT slug, kind, origen, mime, length(bytes) AS peso FROM asset_remoto WHERE kind IN ('faction', 'logo') OR (kind IN ('character', 'background') AND mime = 'image/webp' AND origen = 'mantenedor') ORDER BY kind, slug",
    )
    .all();
  const leer = db.prepare(
    "SELECT bytes FROM asset_remoto WHERE slug = ? AND kind = ? AND origen = ?",
  );
  const actualizarLogo = db.prepare(
    "UPDATE asset_remoto SET bytes = ?, size = ?, width = ?, height = ?, actualizado = ? WHERE slug = ? AND kind = ? AND origen = ?",
  );
  const actualizarEmblema = db.prepare(
    "UPDATE asset_remoto SET bytes = ?, size = ?, width = ?, height = ? WHERE slug = ? AND kind = ? AND origen = ?",
  );

  const total = { filas: 0, cambiadas: 0, antes: 0, despues: 0 };
  for (const f of filas) {
    total.filas += 1;
    total.antes += f.peso;
    const { bytes } = leer.get(f.slug, f.kind, f.origen);
    let r;
    try {
      r = await reducir(f.kind, bytes);
    } catch (e) {
      console.warn(`omitida ${f.kind}/${f.slug} (${f.origen}): ${e.message}`);
      total.despues += f.peso;
      continue;
    }
    if (r === null) {
      total.despues += f.peso;
      continue;
    }
    if (r.bytes.length > f.peso * (1 - AHORRO_MINIMO)) {
      total.despues += f.peso;
      continue;
    }
    total.cambiadas += 1;
    total.despues += r.bytes.length;
    console.log(
      `${f.kind}/${f.slug} (${f.origen}) ${r.antes.w}x${r.antes.h} ${Math.round(f.peso / 1024)} KB -> ${r.w}x${r.h} ${Math.round(r.bytes.length / 1024)} KB`,
    );
    if (values.seco) {
      continue;
    }
    const ext = f.mime === "image/png" ? "png" : "webp";
    const destino = path.join(values.respaldo, f.origen, f.kind);
    mkdirSync(destino, { recursive: true });
    writeFileSync(path.join(destino, `${f.slug}.${ext}`), Buffer.from(bytes));
    if (f.kind !== "faction") {
      actualizarLogo.run(
        r.bytes,
        r.bytes.length,
        r.w,
        r.h,
        new Date().toISOString(),
        f.slug,
        f.kind,
        f.origen,
      );
    } else {
      actualizarEmblema.run(
        r.bytes,
        r.bytes.length,
        r.w,
        r.h,
        f.slug,
        f.kind,
        f.origen,
      );
    }
  }
  console.log(
    `${values.seco ? "[seco] " : ""}${total.cambiadas}/${total.filas} reducidas: ${Math.round(total.antes / 1048576)} MB -> ${Math.round(total.despues / 1048576)} MB`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
