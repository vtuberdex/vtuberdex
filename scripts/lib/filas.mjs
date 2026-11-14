// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Lectura de columnas de TEXTO de una fila de `@libsql/client`.
 *
 * El cliente tipa cada valor como `Value` (texto, número, bigint, `ArrayBuffer` o `null`), así que
 * meterlo en una plantilla o en `String()` podría escribir `[object ArrayBuffer]` sin avisar. Las
 * columnas que se leen con esto (slug, kind, nombres y SQL de `sqlite_master`) son TEXTO por
 * esquema: si llega otra cosa, la base no es la que el script cree y es mejor parar.
 */
export function texto(valor, columna = "columna") {
  if (typeof valor !== "string") {
    throw new TypeError(
      `se esperaba texto en ${columna}, llegó ${typeof valor}`,
    );
  }
  return valor;
}

/** Clave `kind/slug` de una fila de `asset_remoto` (la que usan el publicador y su guarda). */
export function claveDeAsset(fila) {
  return `${texto(fila.kind, "kind")}/${texto(fila.slug, "slug")}`;
}
