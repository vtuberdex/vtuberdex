// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * HABILIDADES del RPG de VTubers: el catálogo de estados y las reglas del kit. UNA sola definición.
 *
 * QUÉ ES
 * ------
 * Las fichas traen un kit de habilidades (2 activas, 2 pasivas y una Ultimate) escrito en HTML con
 * los estados del sistema pintados en su color oficial. Hasta ahora las reglas vivían en un «prompt
 * maestro» que un agente tenía que respetar a ojo, y el resultado no las respetaba: al pasar este
 * validador por las 211 fichas con kit, ~100 Ultimates usaban el estado BASE en vez de su evolución,
 * varias «obtenían» un estado negativo y había colores que no eran los oficiales (`Soul Trader` en
 * `#960014`, `Confusión` en `#8b5cf6`, `Hackeo` en blanco liso).
 *
 * Aquí la parte MECÁNICA de esas reglas pasa a ser datos y comprobaciones: el catálogo (`ESTADOS`,
 * con color, polaridad, evolución, efecto oficial de la evolución y facción exclusiva), lo que se
 * pinta (`spanDeEstado`, `bloqueDeEvolucion`) y el validador (`validarKit`). Lo que NO cabe aquí es
 * interpretar el lore: eso lo decide una persona (o un generador) y este módulo solo dice si el
 * resultado cumple. Es JavaScript puro, sin Node ni DOM, para que el mantenedor lo use en el cliente.
 *
 * NOMBRES CANÓNICOS
 * -----------------
 * El nombre canónico es el de la lista oficial de colores, con sus particularidades (`Deux ex
 * Machina`, `Mente Agil`, `Glotoneria`): es lo que ya está escrito en las fichas. La tabla de
 * evoluciones del prompt los escribe distinto (`Deus ex`, `Mente Ágil`, `Glotonería`), así que la
 * búsqueda compara sin tildes ni mayúsculas y acepta esos alias; el validador avisa
 * (`nombre_no_canonico`) en vez de dar error.
 *
 * POLARIDAD
 * ---------
 * `positivo` se «obtiene», `negativo` se «aplica». Cinco estados son `ambos` a propósito: su
 * evolución describe un efecto sobre el usuario (System Override replica, Banquete Carmesí absorbe,
 * Arcane Devourer roba MP, Absolute Dominion roba un atributo, Pactum Profanum desactiva una pasiva y
 * te la quedas) y las fichas los usan de las dos formas (`aplicas Hackeo` 20 veces, `obtienes` 3).
 * Exigir un verbo sería inventar una regla que el sistema no tiene.
 *
 * EL COLOR DE LA EVOLUCIÓN ES EL DE SU BASE
 * ----------------------------------------
 * «El estado evolucionado debe conservar el color correspondiente al estado del que proviene», y así
 * están las fichas (`Incineración` en el `#c35a05` de `Quemadura`). Por eso la evolución no tiene
 * color propio en el catálogo.
 */

import { ESTADOS } from "./habilidades-estados.mjs";

// El catálogo vive en su propio archivo (solo datos); se reexporta para que todo siga importando de aquí.
export { ESTADOS };

/** @typedef {import("./habilidades-estados.mjs").Estado} Estado */

/** MP de cada pieza del kit (el HTML guardado no lleva el MP: lo pinta quien muestra la ficha). */
export const MP = Object.freeze({ activa1: 90, activa2: 85, ultimate: 300 });

/** Forma del kit: exactamente estas piezas. */
export const FORMA_DEL_KIT = Object.freeze({
  active: 2,
  passive: 2,
  ultimate: 1,
});

/** Cuántos estados entrega cada pieza. Las pasivas no tienen tope en el prompt. */
export const ESTADOS_MAXIMOS_ACTIVA = 1;
export const ESTADOS_DE_LA_ULTIMATE = 2;

/** Sin tildes, minúsculas y espacios colapsados: la clave con la que se compara un nombre. */
function clave(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Índice nombre → { estado, esEvolucion, canonico }, construido una vez. */
const INDICE = (() => {
  const mapa = new Map();
  for (const estado of ESTADOS) {
    for (const nombre of [estado.nombre, ...(estado.alias ?? [])]) {
      mapa.set(clave(nombre), {
        estado,
        esEvolucion: false,
        canonico: estado.nombre,
      });
    }
    mapa.set(clave(estado.evolucion.nombre), {
      estado,
      esEvolucion: true,
      canonico: estado.evolucion.nombre,
    });
  }
  return mapa;
})();

/**
 * Busca un estado (base o evolución) por nombre, sin tildes ni mayúsculas.
 * @returns {{ estado: Estado, esEvolucion: boolean, canonico: string } | null}
 */
export function buscarEstado(nombre) {
  return INDICE.get(clave(nombre)) ?? null;
}

/** El estilo oficial del `<span>` de un estado (o de su evolución, que hereda el de la base). */
export function estiloDeEstado(nombre) {
  const hallado = buscarEstado(nombre);
  if (!hallado) {
    return null;
  }
  const { estado } = hallado;
  return estado.estilo ?? `color:${estado.color}; font-weight:bold;`;
}

/** El `<span>` oficial de un estado, con su nombre canónico. */
export function spanDeEstado(nombre) {
  const hallado = buscarEstado(nombre);
  if (!hallado) {
    throw new Error(`estado_desconocido: ${nombre}`);
  }
  return `<span style="${estiloDeEstado(nombre)}">${hallado.canonico}</span>`;
}

/**
 * El bloque «Mientras X esté activo:» de una evolución con sus efectos OFICIALES, tal como lo pide la
 * Ultimate. Recibe la base o la evolución; si la base tiene evolución, pinta la evolución.
 */
export function bloqueDeEvolucion(nombre) {
  const hallado = buscarEstado(nombre);
  if (!hallado) {
    throw new Error(`estado_desconocido: ${nombre}`);
  }
  const { evolucion } = hallado.estado;
  const span = spanDeEstado(evolucion.nombre);
  const lineas = evolucion.efecto.map((l) => `${l}<br>`).join("\n");
  return `<br>Mientras ${span} esté activo:<br>\n${lineas}`;
}

/* ------------------------------------------------------------------------------------------------
 * LECTURA DEL HTML
 * ---------------------------------------------------------------------------------------------- */

const RE_SPAN = /<span\s+style\s*=\s*"([^"]*)"\s*>([^<]*)<\/span>/gi;

/** Cada `<span>` del HTML: nombre visible, estilo e índice. */
export function spansDe(html) {
  return [...String(html ?? "").matchAll(RE_SPAN)].map((m) => ({
    estilo: m[1],
    texto: m[2].trim(),
    indice: m.index,
  }));
}

/**
 * Los estados que la habilidad ENTREGA: los que siguen a «obtienes/aplicas» (o «obtiene/aplica»),
 * incluidas las enumeraciones «obtienes A y B». Un estado nombrado en una condición («si el enemigo
 * posee Confusión») NO cuenta: el tope de un estado por activa habla de lo que la habilidad aplica.
 * @returns {Array<{ verbo: 'obtienes'|'aplicas', texto: string }>}
 */
export function estadosEntregados(html) {
  const texto = String(html ?? "");
  const salida = [];
  // Antes era UNA regex (verbo + `(?:span …)+`) demasiado compleja de leer y de auditar. Ahora se
  // busca el verbo y, desde ahí, se encadenan los spans con una regex fija (`y`): mismo resultado,
  // porque el separador nunca empieza por `<` y consumirlo entero no puede impedir el span siguiente.
  const reVerbo = /\b(obtienes|obtiene|aplicas|aplica)\s+/gi;
  let m;
  while ((m = reVerbo.exec(texto)) !== null) {
    const fin = finDeSpansEncadenados(texto, reVerbo.lastIndex);
    if (fin === reVerbo.lastIndex) {
      // Sin ningún span detrás, ese verbo no entrega nada: se sigue buscando desde el siguiente carácter.
      reVerbo.lastIndex = m.index + 1;
      continue;
    }
    const verbo = m[1].toLowerCase().startsWith("obtien")
      ? "obtienes"
      : "aplicas";
    for (const s of spansDe(texto.slice(reVerbo.lastIndex, fin))) {
      salida.push({ verbo, texto: s.texto });
    }
    reVerbo.lastIndex = fin;
  }
  return salida;
}

/** Un `<span>` de estado seguido de su separador de enumeración («,», «y», «e»), anclado (`y`). */
const RE_SPAN_ENCADENADO =
  /<span\s+style\s*=\s*"[^"]*"\s*>[^<]*<\/span>\s*(?:(?:,|\by\b|\be\b)\s*)?/iy;

/** Posición donde acaba la tira de spans que empieza en `desde` (`desde` si no hay ninguno). */
function finDeSpansEncadenados(texto, desde) {
  let fin = desde;
  RE_SPAN_ENCADENADO.lastIndex = fin;
  while (RE_SPAN_ENCADENADO.exec(texto) !== null) {
    fin = RE_SPAN_ENCADENADO.lastIndex;
  }
  return fin;
}

/**
 * Sustituye cada etiqueta `<…>` por `reemplazo`, como `replace(/<[^>]+>/g, …)` (o `/<[^>]*>/g` con
 * `vacias`), pero recorriendo con `indexOf`: la regex reintentaba desde cada `<` sin cerrar y era
 * cuadrática con un texto lleno de `<`. Cada etiqueta va del `<` al PRIMER `>` que le sigue.
 */
function reemplazarEtiquetas(texto, reemplazo, { vacias = false } = {}) {
  let salida = "";
  let desde = 0;
  let abre = texto.indexOf("<");
  while (abre >= 0) {
    const cierra = texto.indexOf(">", abre + 1);
    if (cierra < 0) {
      // Sin un `>` posterior no queda ninguna etiqueta más.
      break;
    }
    if (vacias || cierra > abre + 1) {
      salida += texto.slice(desde, abre) + reemplazo;
      desde = cierra + 1;
    }
    abre = texto.indexOf("<", vacias || cierra > abre + 1 ? desde : abre + 1);
  }
  return salida + texto.slice(desde);
}

/** Texto plano comparable: sin etiquetas, sin tildes, minúsculas y sin la persona del verbo. */
function textoComparable(html) {
  return clave(reemplazarEtiquetas(String(html ?? ""), " "))
    .replace(/[•.,;:]/g, " ")
    .replace(/\bobtienes\b/g, "obtiene")
    .replace(/\btus\b/g, "las")
    .replace(/\btu\b/g, "la")
    .replace(/\s+/g, " ")
    .trim();
}

/** Color del estilo de un span, o `null` si no lleva (`Hackeo` lleva degradado). */
function colorDelEstilo(estilo) {
  const m = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(estilo);
  return m ? m[1].trim().toLowerCase() : null;
}

function estiloCoincide(estiloReal, estado) {
  if (estado.estilo) {
    return /linear-gradient\(\s*#fff 0%\s*,\s*#fff 45%\s*,\s*#aaa 85%\s*,\s*#555 100%\s*\)/i.test(
      estiloReal,
    );
  }
  return colorDelEstilo(estiloReal) === estado.color.toLowerCase();
}

/* ------------------------------------------------------------------------------------------------
 * VALIDACIÓN
 * ---------------------------------------------------------------------------------------------- */

/**
 * @typedef {{ category: 'active'|'passive'|'ultimate', name?: string, effectHtml: string }} Habilidad
 * @typedef {{ codigo: string, gravedad: 'error'|'aviso', pieza: string, estado?: string, detalle: string }} Problema
 */

function etiquetaDePieza(category, posicion) {
  if (category === "ultimate") {
    return "Ultimate";
  }
  return `${category === "active" ? "Activa" : "Pasiva"} ${posicion + 1}`;
}

/**
 * Slug canónico de una facción. Tras colapsar a guiones no puede haber dos seguidos, así que basta con
 * quitar UNO por extremo; las cifras finales se quitan con un bucle (`/\d+$/` sin ancla de inicio
 * reintenta desde cada cifra y es cuadrática).
 */
function faccionCanonica(v) {
  const conGuiones = String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  let fin = conGuiones.length;
  while (fin > 0 && conGuiones[fin - 1] >= "0" && conGuiones[fin - 1] <= "9") {
    fin -= 1;
  }
  return conGuiones
    .slice(0, fin)
    .replace(/-$/, "")
    .replace("lecagy", "legacy");
}

/**
 * ¿La ficha tiene esa facción? Una SUBFACCIÓN cuenta como su MADRE.
 *
 * La relación madre-hijo es un DATO (`faction.parent_id`): la guarda el mantenedor y aquí llega como
 * mapa `{ slug de la hija: slug de la madre }`. Antes se adivinaba del NOMBRE —se descartaba el
 * paréntesis de «Glovecaller (Elfs)» y se probaba el prefijo del slug (`glovecaller-elfs` valía para
 * `glovecaller`)—, lo que obligaba a escribir la madre dentro del nombre para que los estados
 * exclusivos se desbloquearan, y de paso daba por buena cualquier facción que empezara igual.
 *
 * Los nombres se siguen comparando canónicos: el formulario puede traer la etiqueta («Mythical
 * Legacy») en vez del slug, y el scrape dejó variantes con errata (`mythical-lecagy`).
 *
 * @param {string[]} facciones Slugs (o etiquetas) de las facciones de la ficha.
 * @param {string} slug Facción exclusiva del estado.
 * @param {Record<string, string>} [subfacciones] Mapa `{hija: madre}`; admite cadenas de varios niveles.
 */
export function tieneFaccion(facciones, slug, subfacciones = {}) {
  const canonico = faccionCanonica;
  const buscada = canonico(slug);
  if (!buscada) {
    return false;
  }
  // El mapa se compara canónico también: sus dos lados vienen de la base y de la interfaz.
  const madreDe = new Map();
  for (const [hija, madre] of Object.entries(subfacciones ?? {})) {
    const claveHija = canonico(hija);
    const claveMadre = canonico(madre);
    if (claveHija && claveMadre) {
      madreDe.set(claveHija, claveMadre);
    }
  }
  /** La facción y todas sus madres. Con tope y sin repetir: un ciclo en los datos no cuelga esto. */
  const conMadres = (inicial) => {
    const ascendencia = new Set();
    let actual = inicial;
    for (let saltos = 0; actual && saltos < 32; saltos += 1) {
      if (ascendencia.has(actual)) {
        break;
      }
      ascendencia.add(actual);
      actual = madreDe.get(actual);
    }
    return ascendencia;
  };
  return facciones.some((faccion) => conMadres(canonico(faccion)).has(buscada));
}

/**
 * Valida un kit completo contra las reglas mecánicas del prompt maestro.
 *
 * ERROR = rompe una regla escrita («obtienes» con un negativo, estado base en la Ultimate, color que
 * no es el oficial, estado exclusivo de otra facción, forma del kit). AVISO = algo que el prompt pide
 * evitar pero no prohíbe (repetir un estado) o que no se puede afirmar con certeza leyendo HTML
 * (efecto de evolución redactado distinto, `<span>` que no es un estado del catálogo).
 *
 * Lo que NO valida, porque no se puede leer en el HTML sin interpretar: si las habilidades salen del
 * lore, si hay frases narrativas, si la Habilidad Única copia otra o si el kit está balanceado.
 *
 * @param {{ habilidades: Habilidad[], facciones?: string[] | null, subfacciones?: Record<string, string> }} kit
 *   `facciones` son slugs; si es `null` no se comprueba la exclusividad (no se sabe).
 *   `subfacciones` es el mapa `{hija: madre}` del catálogo: sin él, una subfacción no acredita los
 *   estados exclusivos de su madre.
 * @returns {Problema[]}
 */
export function validarKit({ habilidades, facciones = null, subfacciones = {} }) {
  /** @type {Problema[]} */
  const problemas = [];
  const anotar = crearAnotador(problemas);

  revisarFormaDelKit(habilidades, anotar);

  const contadores = { active: 0, passive: 0, ultimate: 0 };
  /** base canónica → piezas que la entregan (para los repetidos). */
  const usoPorEstado = new Map();
  const ultimates = [];

  for (const h of habilidades) {
    const posicion = contadores[h.category];
    contadores[h.category] += 1;
    const pieza = etiquetaDePieza(h.category, posicion);
    const html = h.effectHtml ?? "";

    revisarSpans(h.category, pieza, html, anotar);
    const entregados = revisarEntregados(pieza, html, { facciones, subfacciones }, anotar);

    registrarUso(usoPorEstado, entregados, pieza);

    if (h.category === "active" && entregados.length > ESTADOS_MAXIMOS_ACTIVA) {
      anotar(
        "error",
        "activa_varios_estados",
        pieza,
        `entrega ${entregados.length} estados (${entregados.map((e) => e.hallado.canonico).join(", ")}); el máximo es 1`,
      );
    }
    if (h.category === "ultimate") {
      ultimates.push({ pieza, html, entregados });
    }
  }

  for (const ultimate of ultimates) {
    revisarUltimate(ultimate, anotar);
  }

  revisarRepetidos(usoPorEstado, anotar);

  return problemas;
}

/**
 * La función `anotar` del validador, que escribe en `problemas`. El mismo `<span>` mal coloreado suele
 * repetirse en la misma pieza: se anota una vez (mismo código, pieza y detalle).
 */
function crearAnotador(problemas) {
  return (gravedad, codigo, pieza, detalle, estado) => {
    if (
      problemas.some(
        (p) =>
          p.codigo === codigo && p.pieza === pieza && p.detalle === detalle,
      )
    ) {
      return;
    }
    problemas.push({
      codigo,
      gravedad,
      pieza,
      detalle,
      ...(estado ? { estado } : {}),
    });
  };
}

/** Anota en `usoPorEstado` (base canónica → piezas) los estados que entrega esta pieza. */
function registrarUso(usoPorEstado, entregados, pieza) {
  for (const { hallado } of entregados) {
    const lista = usoPorEstado.get(hallado.estado.nombre) ?? [];
    lista.push(pieza);
    usoPorEstado.set(hallado.estado.nombre, lista);
  }
}

/** Un estado (o su evolución) entregado en más de una pieza: aviso, el prompt pide evitarlo. */
function revisarRepetidos(usoPorEstado, anotar) {
  for (const [nombre, piezas] of usoPorEstado) {
    if (piezas.length > 1) {
      anotar(
        "aviso",
        "estado_repetido",
        piezas.join(", "),
        `«${nombre}» (o su evolución) se entrega en ${piezas.length} piezas`,
        nombre,
      );
    }
  }
}

/** Forma del kit: cuántas piezas de cada categoría. */
function revisarFormaDelKit(habilidades, anotar) {
  for (const [category, esperado] of Object.entries(FORMA_DEL_KIT)) {
    const n = habilidades.filter((h) => h.category === category).length;
    if (n !== esperado) {
      anotar(
        "error",
        "forma_del_kit",
        "Kit",
        `se esperaban ${esperado} ${category} y hay ${n}`,
      );
    }
  }
}

/**
 * Colores y nombres de cada span que sea un estado del catálogo. Los spans que no lo son pueden
 * ser la Habilidad Única: solo se avisa fuera de la Ultimate, donde no debería haber ninguno.
 */
function revisarSpans(category, pieza, html, anotar) {
  for (const s of spansDe(html)) {
    const hallado = buscarEstado(s.texto);
    if (!hallado) {
      if (category !== "ultimate") {
        anotar(
          "aviso",
          "estado_desconocido",
          pieza,
          `«${s.texto}» no es un estado del sistema`,
          s.texto,
        );
      }
      continue;
    }
    if (!estiloCoincide(s.estilo, hallado.estado)) {
      const oficial = hallado.estado.estilo
        ? "el degradado de Hackeo"
        : hallado.estado.color;
      anotar(
        "error",
        "color_incorrecto",
        pieza,
        `«${s.texto}» va en ${colorDelEstilo(s.estilo) ?? s.estilo} y el oficial es ${oficial}`,
        hallado.canonico,
      );
    }
    if (s.texto !== hallado.canonico) {
      anotar(
        "aviso",
        "nombre_no_canonico",
        pieza,
        `«${s.texto}» se escribe «${hallado.canonico}»`,
        hallado.canonico,
      );
    }
  }
}

/** «Obtienes» con un negativo o «aplicas» con un positivo: el verbo no casa con la polaridad. */
function revisarVerbo(pieza, hallado, verbo, anotar) {
  const { polaridad } = hallado.estado;
  if (polaridad === "positivo" && verbo === "aplicas") {
    anotar(
      "error",
      "verbo_invertido",
      pieza,
      `«${hallado.canonico}» es positivo: se obtiene, no se aplica`,
      hallado.canonico,
    );
  } else if (polaridad === "negativo" && verbo === "obtienes") {
    anotar(
      "error",
      "verbo_invertido",
      pieza,
      `«${hallado.canonico}» es negativo: se aplica, no se obtiene`,
      hallado.canonico,
    );
  } else {
    // `ambos`, o el verbo que corresponde: nada que anotar.
  }
}

/** Lo que la pieza entrega: verbo, facción y conteo. Devuelve los estados distintos entregados. */
function revisarEntregados(pieza, html, { facciones, subfacciones }, anotar) {
  const entregados = [];
  for (const { verbo, texto } of estadosEntregados(html)) {
    const hallado = buscarEstado(texto);
    if (!hallado) {
      continue;
    }
    const { estado } = hallado;
    if (!entregados.some((e) => e.hallado.estado === estado)) {
      entregados.push({ hallado, verbo });
    }

    revisarVerbo(pieza, hallado, verbo, anotar);
    if (
      estado.faccion &&
      facciones &&
      !tieneFaccion(facciones, estado.faccion, subfacciones)
    ) {
      anotar(
        "error",
        "faccion_exclusiva",
        pieza,
        `«${hallado.canonico}» es exclusivo de ${estado.faccion}`,
        hallado.canonico,
      );
    }
  }
  return entregados;
}

/** La Ultimate: exactamente 2 estados, ambos evoluciones y con sus efectos oficiales. */
function revisarUltimate({ pieza, html, entregados }, anotar) {
  if (entregados.length !== ESTADOS_DE_LA_ULTIMATE) {
    anotar(
      "error",
      "ultimate_estados",
      pieza,
      `entrega ${entregados.length} estados; deben ser exactamente 2`,
    );
  }
  const comparable = textoComparable(html);
  for (const { hallado } of entregados) {
    if (!hallado.esEvolucion) {
      anotar(
        "error",
        "ultimate_estado_base",
        pieza,
        `usa «${hallado.canonico}»: en la Ultimate va su evolución «${hallado.estado.evolucion.nombre}»`,
        hallado.canonico,
      );
      continue;
    }
    const faltan = hallado.estado.evolucion.efecto.filter(
      (l) => !comparable.includes(textoComparable(l)),
    );
    if (faltan.length) {
      anotar(
        "aviso",
        "efecto_no_oficial",
        pieza,
        `«${hallado.canonico}» no trae ${faltan.length} de sus ${hallado.estado.evolucion.efecto.length} líneas oficiales`,
        hallado.canonico,
      );
    }
  }
}

/** Descripción corta de cada código, para el informe y el mantenedor. */
export const CODIGOS = Object.freeze({
  forma_del_kit: "El kit no tiene 2 activas, 2 pasivas y 1 Ultimate",
  color_incorrecto: "Estado con un color que no es el oficial",
  nombre_no_canonico: "Estado escrito distinto del nombre oficial",
  estado_desconocido: "Texto destacado que no es un estado del sistema",
  verbo_invertido:
    "«Obtienes» con un estado negativo o «aplicas» con uno positivo",
  faccion_exclusiva: "Estado exclusivo de una facción que la ficha no tiene",
  activa_varios_estados: "Activa que entrega más de un estado",
  ultimate_estados: "Ultimate que no entrega exactamente 2 estados",
  ultimate_estado_base: "Ultimate con un estado base en vez de su evolución",
  efecto_no_oficial:
    "Evolución de la Ultimate sin sus efectos oficiales completos",
  estado_repetido: "Mismo estado en varias piezas del kit",
});

/* ------------------------------------------------------------------------------------------------
 * ESCRITURA: tokens, HTML seguro y texto plano
 * ---------------------------------------------------------------------------------------------- */

/**
 * Convierte `[[Miedo]]` en el `<span>` oficial del estado (o de la evolución que se nombre). Es lo que
 * deja escribir a mano una pasiva o una condición sin copiar colores: el color sale del catálogo.
 * Un token que no es un estado se deja tal cual para que se vea el error en la vista previa.
 */
export function expandirEstados(texto) {
  const fuente = String(texto ?? "");
  // Lo mismo que `replace(/\[\[([^\]]+)\]\]/g, …)` recorriendo con `indexOf`: la regex reintentaba
  // desde cada `[[` hasta el primer `]` y era cuadrática con muchos `[[` sin cerrar.
  let salida = "";
  let desde = 0;
  let abre = fuente.indexOf("[[");
  while (abre >= 0) {
    const cierra = fuente.indexOf("]", abre + 2);
    if (cierra < 0) {
      break;
    }
    if (cierra > abre + 2 && fuente[cierra + 1] === "]") {
      const nombre = fuente.slice(abre + 2, cierra);
      const entero = fuente.slice(abre, cierra + 2);
      salida +=
        fuente.slice(desde, abre) +
        (buscarEstado(nombre) ? spanDeEstado(nombre) : entero);
      desde = cierra + 2;
      abre = fuente.indexOf("[[", desde);
    } else {
      // Ningún `[[` anterior a ese `]` puede cerrar bien: todos llegarían al MISMO `]`.
      abre = fuente.indexOf("[[", cierra);
    }
  }
  return salida + fuente.slice(desde);
}

/** Escapa `<`, `>` y `&` de un texto escrito a mano antes de mezclarlo con el HTML del sistema. */
export function escaparHtml(texto) {
  return String(texto ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * El HTML que se inyecta de una habilidad. `effectHtml` ya pasó la lista blanca del servidor; el
 * respaldo `effect` es texto libre (hasta 2000 caracteres) y se ESCAPA: inyectarlo crudo era un XSS
 * almacenado en cuanto una habilidad llegaba sin `effectHtml`.
 * @param {{ effect?: string | null, effectHtml?: string | null } | null | undefined} habilidad
 * @returns {string}
 */
export function htmlDeEfecto(habilidad) {
  if (habilidad?.effectHtml) {
    return habilidad.effectHtml;
  }
  return escaparHtml(habilidad?.effect ?? "").replace(/\r?\n/g, "<br>");
}

/**
 * ¿El HTML de una habilidad usa SOLO lo que el sistema escribe? La ficha pública lo inyecta tal cual
 * (`SkillList`, `dangerouslySetInnerHTML`), así que el servidor no puede aceptar cualquier etiqueta:
 * se admiten `<br>`, `<span style="…">` con un estilo de solo color/negrita/degradado y el `<div
 * class="skill-effect-content">` que traen las fichas del scrape. Ningún atributo más (nada de `on*`,
 * `href` ni `url(` en el estilo). `<b>`/`<strong>`/`<i>`/`<em>` sin atributos y los comentarios
 * también pasan: 3 de las 1.055 habilidades del scrape los traen (`<b>`, un `<!--</td-->` suelto)
 * y rechazarlos haría que guardar CUALQUIER cambio de esas fichas diera 400 al reenviar su kit.
 */
export function htmlDeHabilidadSeguro(html) {
  const texto = String(html ?? "");
  for (const m of texto.matchAll(/<[^>]*>?/g)) {
    const etiqueta = m[0];
    if (/^<br\s*\/?>$/i.test(etiqueta)) {
      continue;
    }
    if (/^<\/?(b|strong|i|em)>$/i.test(etiqueta)) {
      continue;
    }
    if (/^<!--[^>]*-->$/.test(etiqueta)) {
      continue;
    }
    if (/^<\/(span|div)>$/i.test(etiqueta)) {
      continue;
    }
    if (/^<div class="skill-effect-content">$/i.test(etiqueta)) {
      continue;
    }
    const span = /^<span style="([^"<>]*)">$/i.exec(etiqueta);
    if (span && !/url\s*\(|expression|javascript:|@import|\\/i.test(span[1])) {
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Quita espacios y tabuladores del final de una línea. Es el `replace(/[ \t]+\n/g, "\n")` de antes,
 * línea a línea y sin regex: con una tira larga de blancos sin salto detrás era cuadrática.
 */
function sinBlancosFinales(linea) {
  let fin = linea.length;
  while (fin > 0 && (linea[fin - 1] === " " || linea[fin - 1] === "\t")) {
    fin -= 1;
  }
  return linea.slice(0, fin);
}

/** El texto plano de una habilidad (columna `effect`: búsqueda y respaldo sin formato). */
export function textoPlanoDe(html) {
  let sinEtiquetas = String(html ?? "").replace(/<br\s*\/?>\r?\n?/gi, "\n");
  // Hasta que no quede ninguna: quitar `<b>` de `<<b>script>` no debe dejar otra etiqueta armada.
  for (let previo = ""; previo !== sinEtiquetas;) {
    previo = sinEtiquetas;
    sinEtiquetas = reemplazarEtiquetas(sinEtiquetas, "", { vacias: true });
  }
  return (
    sinEtiquetas
      // Un `<` o `>` suelto que sobrevive al quitar etiquetas (`<<b>script>`) no es texto: fuera.
      .replace(/[<>]/g, "")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&")
      .split("\n")
      .map((linea, i, lineas) =>
        i < lineas.length - 1 ? sinBlancosFinales(linea) : linea,
      )
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
