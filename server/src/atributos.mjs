/**
 * ATRIBUTOS RPG DE LA FICHA (STR, DEX, CON, INT, WIS, CHA).
 *
 * REGLA
 * -----
 * Cada atributo parte de `ATRIBUTO_BASE` (40) y la ficha reparte `PUNTOS_DE_ATRIBUTOS` (200) entre
 * los seis. Los bonos de sus dos facciones se SUMAN encima, sin gastar puntos. Todo cuenta para el
 * mismo tope, `ATRIBUTO_MAXIMO` (100): con 40 de base y un bono de +20 solo caben 40 puntos más, y
 * sin bono caben 60.
 *
 * Los stats que ve la ficha y el plugin (HP, MP, ataques, defensas, velocidad, evasión, precisión,
 * crítico y suerte) son DERIVADOS de los atributos finales: no se guardan, se calculan, así que no
 * pueden desincronizarse. Se redondean al entero más cercano, como pidió el mantenedor.
 *
 * VISIBILIDAD
 * -----------
 * Solo se reparten en fichas SIN stats propios (una ficha nueva); una ficha que ya trae stats se
 * queda como está y ni siquiera ve el bloque. Una vez repartidos, la titular los ve en modo lectura
 * para que su build no cambie por un clic. El mantenedor (`admin`) puede retocar una build ya hecha.
 *
 * JS puro sobre un EJECUTOR `{ execute, exec }` (Turso/`file:` en producción, SQLite en los tests).
 */
import { preparadorDeTablas } from "./db/tablas.mjs";

const DDL = `
  CREATE TABLE IF NOT EXISTS atributo_ficha (
    vtuber_id  INTEGER NOT NULL,
    slug       TEXT NOT NULL,
    puntos     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (vtuber_id, slug)
  );
`;

const conTablas = preparadorDeTablas(DDL);

export class AtributoError extends Error {
  constructor(status, code, detail) {
    super(detail ?? code);
    this.name = "AtributoError";
    this.status = status;
    this.code = code;
    this.detail = detail ?? code;
  }
}

/** Los seis atributos, en el orden en que se muestran. */
export const ATRIBUTOS = Object.freeze([
  { slug: "str", label: "Fuerza" },
  { slug: "dex", label: "Destreza" },
  { slug: "con", label: "Constitución" },
  { slug: "int", label: "Inteligencia" },
  { slug: "wis", label: "Sabiduría" },
  { slug: "cha", label: "Carisma" },
]);

/** Puntos que reparte cada ficha y tope de cada atributo (bonos incluidos). */
export const PUNTOS_DE_ATRIBUTOS = 200;
export const ATRIBUTO_MAXIMO = 100;

/**
 * Bonos por facción (los fijó el mantenedor). La clave es el nombre canónico de la facción: se
 * comparan etiquetas y slugs con `canonico`, así que «Heaven's Arbiter» y `heavens-arbiter` valen.
 */
export const BONOS_DE_FACCION = Object.freeze({
  netherbane: { cha: 20, str: 15 },
  veilbreaker: { cha: 20, int: 15 },
  abyssal: { wis: 20, con: 15 },
  "aetherion-valor": { cha: 20, con: 15 },
  "apex-dualist": { dex: 20, str: 15 },
  "arcane-nexus": { int: 25, wis: 10 },
  dreamlike: { int: 20, con: 15 },
  "gaian-oracle": { wis: 20, int: 15 },
  glitchborn: { int: 25, dex: 15 },
  grovecaller: { str: 20, con: 15 },
  "heavens-arbiter": { cha: 25, wis: 10 },
  "chaos-ascendant": { cha: 20, str: 15 },
  "machina-revenant": { con: 20, str: 15 },
  mutant: { con: 15, str: 25 },
  "mythical-legacy": { str: 25, cha: 15 },
  necrotic: { int: 25, con: 15 },
  "primal-monarch": { str: 25, dex: 15 },
  resonantia: { cha: 25, dex: 10 },
  "star-wanderers": { cha: 20, int: 15 },
  terran: { str: 5, dex: 5, con: 5, int: 15, wis: 5, cha: 5 },
  inspirae: { int: 25, cha: 15 },
  feastlords: { int: 25, con: 25 },
});

/**
 * Stats que salen de los atributos: `de` son los atributos que suman y `factor` cuánto vale cada
 * punto. Los slugs son los MISMOS que ya usa la ficha y el plugin, así que el juego los lee sin
 * cambiar nada.
 */
export const DERIVADOS = Object.freeze([
  { slug: "hp", label: "HP", de: ["con"], factor: 15 },
  { slug: "mp", label: "MP", de: ["int"], factor: 10 },
  { slug: "attack", label: "Ataque", de: ["str"], factor: 2.2 },
  { slug: "defense", label: "Defensa", de: ["con"], factor: 1.5 },
  { slug: "magicAttack", label: "Ataque mágico", de: ["int"], factor: 2.2 },
  { slug: "magicDefense", label: "Defensa mágica", de: ["wis"], factor: 1.8 },
  { slug: "speed", label: "Velocidad", de: ["dex"], factor: 1.5 },
  { slug: "evasion", label: "Evasión", de: ["dex"], factor: 0.8 },
  { slug: "accuracy", label: "Precisión", de: ["dex"], factor: 1.2 },
  { slug: "critic", label: "Crítico", de: ["cha"], factor: 0.5 },
  // Suerte = REDONDEAR((WIS + CHA) / 2 / 10): un punto de cada 20 entre las dos.
  { slug: "luck", label: "Suerte", de: ["wis", "cha"], factor: 0.05 },
]);

/** Los slugs de atributo, para validar entradas. */
export const SLUGS_DE_ATRIBUTO = Object.freeze(ATRIBUTOS.map((a) => a.slug));

/** Nombre canónico de una facción: sin acentos, en minúsculas y con guiones. */
export function canonico(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\d+$/, "")
    .replace(/-+$/, "")
    .replace("lecagy", "legacy");
}

/** Bono total de las facciones de la ficha, atributo por atributo (0 donde no dé ninguna). */
export function bonosDeFacciones(facciones = []) {
  const bono = Object.fromEntries(SLUGS_DE_ATRIBUTO.map((s) => [s, 0]));
  for (const faccion of facciones ?? []) {
    const suyo = BONOS_DE_FACCION[canonico(faccion)];
    if (!suyo) continue;
    for (const [slug, puntos] of Object.entries(suyo))
      if (slug in bono) bono[slug] += puntos;
  }
  return bono;
}

/** Atributos finales: puntos repartidos + bono de facción, sin pasar del tope. */
export function atributosFinales(puntos = {}, bonos = {}) {
  return ATRIBUTOS.map(({ slug, label }) => {
    const puestos = Math.max(0, Math.trunc(Number(puntos[slug]) || 0));
    const bono = Math.max(0, Math.trunc(Number(bonos[slug]) || 0));
    return {
      slug,
      label,
      puntos: puestos,
      bono,
      valor: Math.min(ATRIBUTO_MAXIMO, puestos + bono),
      maximo: ATRIBUTO_MAXIMO,
    };
  });
}

/** Stats derivados (redondeados al entero) de unos atributos finales. */
export function statsDerivados(finales = []) {
  const valor = new Map(finales.map((a) => [a.slug, Number(a.valor) || 0]));
  return DERIVADOS.map(({ slug, label, de, factor }) => {
    const suma = de.reduce((total, clave) => total + (valor.get(clave) ?? 0), 0);
    return { slug, label, value: Math.round(suma * factor) };
  });
}

/**
 * Pone los stats derivados en la lista de stats de la ficha: reemplaza el valor de los que ya
 * existen (mismo slug) y añade los que falten, sin tocar los demás.
 */
export function aplicarAtributosAStats(stats = [], derivados = []) {
  const nuevos = new Map(derivados.map((d) => [d.slug, d]));
  const salida = (stats ?? []).map((stat) => {
    const nuevo = nuevos.get(stat.slug);
    if (!nuevo) return stat;
    nuevos.delete(stat.slug);
    return { ...stat, value: nuevo.value };
  });
  for (const { slug, label, value } of nuevos.values())
    salida.push({ slug, label, value });
  return salida;
}

/** Puntos repartidos guardados (solo los mayores que 0). */
export async function leerPuntosDeAtributos(ejecutor, vtuberId) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute(
    "SELECT slug, puntos FROM atributo_ficha WHERE vtuber_id = ? AND puntos > 0",
    [Number(vtuberId)],
  );
  return new Map(
    rows
      .filter((f) => SLUGS_DE_ATRIBUTO.includes(String(f.slug)))
      .map((f) => [String(f.slug), Number(f.puntos)]),
  );
}

/** ¿La ficha ya trae stats con valor? (las del scrape). Las fichas nuevas llegan vacías. */
function tieneStatsDeOrigen(stats) {
  return (stats ?? []).some(
    (s) => typeof s?.value === "number" && Number.isFinite(s.value) && s.value > 0,
  );
}

/**
 * Todo lo que necesita la pantalla: atributos, bonos, derivados y si se pueden tocar.
 * @param {{ vtuberId: number, facciones?: string[], stats?: Array<{slug: string, value: number|null}>, admin?: boolean }} entrada
 */
export async function estadoDeAtributos(
  ejecutor,
  { vtuberId, facciones = [], stats = [], admin = false },
) {
  const guardados = await leerPuntosDeAtributos(ejecutor, vtuberId);
  const puntos = Object.fromEntries(
    SLUGS_DE_ATRIBUTO.map((slug) => [slug, guardados.get(slug) ?? 0]),
  );
  const bonos = bonosDeFacciones(facciones);
  const finales = atributosFinales(puntos, bonos);
  const repartidos = finales.reduce((suma, a) => suma + a.puntos, 0);
  const conOrigen = tieneStatsDeOrigen(stats);
  // Los stats que ya trae la ficha NO se tocan: ni la titular ni el mantenedor reparten atributos
  // donde ya hay stats propios. En una ficha sin stats, la titular reparte una vez y después solo
  // mira (el mantenedor sí puede corregir una build ya repartida).
  const puedeEditar =
    !conOrigen && (Boolean(admin) || repartidos === 0);
  return {
    catalogo: ATRIBUTOS.map((a) => ({ ...a })),
    puntos,
    bonos,
    finales,
    derivados: statsDerivados(finales),
    total: PUNTOS_DE_ATRIBUTOS,
    maximo: ATRIBUTO_MAXIMO,
    repartidos,
    disponibles: Math.max(0, PUNTOS_DE_ATRIBUTOS - repartidos),
    tieneStatsDeOrigen: conOrigen,
    puedeEditar,
    /** `vacio` (nada repartido), `repartido` (ya tiene build) u `origen` (trae stats del scrape). */
    estado: repartidos > 0 ? "repartido" : conOrigen ? "origen" : "vacio",
  };
}

/** Valida una distribución completa y la devuelve como mapa de enteros. */
export function validarDistribucion(puntos) {
  if (!puntos || typeof puntos !== "object" || Array.isArray(puntos))
    throw new AtributoError(
      400,
      "payload_invalido",
      "Faltan los atributos que quieres guardar.",
    );
  const limpio = {};
  let suma = 0;
  for (const [slug, valor] of Object.entries(puntos)) {
    if (!SLUGS_DE_ATRIBUTO.includes(slug))
      throw new AtributoError(
        400,
        "atributo_desconocido",
        "Ese atributo no existe.",
      );
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0)
      throw new AtributoError(
        400,
        "atributo_invalido",
        "Los puntos de cada atributo tienen que ser un número entero de 0 o más.",
      );
    if (n > ATRIBUTO_MAXIMO)
      throw new AtributoError(
        400,
        "atributo_invalido",
        `Ningún atributo puede pasar de ${ATRIBUTO_MAXIMO} puntos.`,
      );
    limpio[slug] = n;
    suma += n;
  }
  if (suma > PUNTOS_DE_ATRIBUTOS)
    throw new AtributoError(
      400,
      "atributos_de_mas",
      `Repartiste ${suma} puntos y solo hay ${PUNTOS_DE_ATRIBUTOS}.`,
    );
  return limpio;
}

/**
 * Guarda la distribución COMPLETA (lo que no venga se queda en 0). Solo si la ficha puede
 * editarse: una build ya hecha no se cambia desde la web, y una ficha con stats del scrape
 * tampoco (los suyos mandan).
 */
export async function guardarAtributos(
  ejecutor,
  { vtuberId, facciones = [], stats = [], puntos, admin = false },
) {
  const e = await conTablas(ejecutor);
  const antes = await estadoDeAtributos(e, {
    vtuberId,
    facciones,
    stats,
    admin,
  });
  if (!antes.puedeEditar)
    throw new AtributoError(
      409,
      "atributos_bloqueados",
      antes.estado === "origen"
        ? "Tu ficha ya tiene stats propios: los atributos se rellenan solo en fichas nuevas."
        : "Tus atributos ya están repartidos. Pide al equipo que los ajuste si necesitas cambiarlos.",
    );
  const limpio = validarDistribucion(puntos);
  await e.execute("DELETE FROM atributo_ficha WHERE vtuber_id = ?", [
    Number(vtuberId),
  ]);
  for (const [slug, n] of Object.entries(limpio)) {
    if (n === 0) continue;
    await e.execute(
      "INSERT INTO atributo_ficha (vtuber_id, slug, puntos) VALUES (?, ?, ?)",
      [Number(vtuberId), slug, n],
    );
  }
  return estadoDeAtributos(e, { vtuberId, facciones, stats, admin });
}

/** Los stats derivados de una ficha (lista vacía si todavía no repartió atributos). */
export async function statsDeAtributosDe(
  ejecutor,
  { vtuberId, facciones = [], stats = [] },
) {
  const estado = await estadoDeAtributos(ejecutor, { vtuberId, facciones, stats });
  // Una ficha con stats propios nunca recibe los derivados: sus valores ya están creados y la web
  // no los reescribe (solo las fichas nuevas se calculan desde los atributos).
  return estado.repartidos > 0 && !estado.tieneStatsDeOrigen
    ? estado.derivados
    : [];
}
