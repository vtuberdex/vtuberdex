// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * ¿Tiene `texto` forma de correo? Es la MISMA regla que el regex que se repetía en cinco
 * módulos (`/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`), escrita sin regex a propósito: en ese patrón
 * `[^\s@]+` también acepta puntos, así que el motor probaba cada punto del dominio como el
 * separador y retrocedía en tiempo cuadrático (Sonar S8786). Por eso los llamadores ponían el
 * tope de largo DELANTE; aquí el coste es lineal y el tope se queda solo como regla de negocio.
 *
 * Qué se exige, igual que antes: sin espacios, UNA sola `@`, algo delante y, en el dominio, un
 * punto que tenga al menos un carácter antes y `tldMinimo` después (los puntos de más se
 * permiten: `a@b.co.uk`). `tldMinimo` = 1 reproduce la variante del panel de Minecraft.
 */
export function esCorreoBienFormado(texto, { tldMinimo = 2 } = {}) {
  if (typeof texto !== "string" || /\s/.test(texto)) {
    return false;
  }
  const partes = texto.split("@");
  if (partes.length !== 2) {
    return false;
  }
  const [local, dominio] = partes;
  // El primer punto con algo delante es el que deja más sitio detrás: si ese no basta, ninguno.
  const punto = dominio.indexOf(".", 1);
  return (
    local.length > 0 && punto !== -1 && dominio.length - punto - 1 >= tldMinimo
  );
}
