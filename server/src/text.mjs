// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Normalización de texto compartida por scraper y API.
 * (El servidor no depende del scraper: se duplica a propósito, y un test
 *  verifica que ambas implementaciones coinciden.)
 */
export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N},\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(value) {
  return (
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      // Tras el paso anterior no puede haber dos guiones seguidos, así que basta
      // con quitar UNO por extremo (y la regex queda lineal, sin `-+$`).
      .replace(/^-|-$/g, "")
  );
}
