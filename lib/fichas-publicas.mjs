// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Lo que devuelve el catálogo público, en UN sitio: lo usan las rutas de la API (`/api/vtubers`,
 * `/api/vtubers/[slug]`) y las PÁGINAS, que mandan la primera vista ya resuelta dentro del HTML.
 *
 * POR QUÉ LAS PÁGINAS TAMBIÉN: antes la primera vista esperaba HTML → JS → sesión (prueba de trabajo) →
 * API → imágenes; las cartas empezaban a bajar a ~1,3 s (medido 2026-11-19). Con los datos en el HTML,
 * las imágenes se piden en cuanto hidrata. La sesión y el CUPO de fichas siguen protegiendo la API; la
 * página gasta el MISMO cupo por red (`gastarFichas`) antes de incluir los datos.
 *
 * Aquí no se mira sesión ni cupo: eso lo decide quien llama.
 */
import {
  aplicarImagenesDelMantenedor,
  aplicarReemplazosALista,
  reemplazosDelMantenedor,
} from "./ediciones.mjs";
import { KINDS_GESTIONABLES } from "./carpetas.mjs";
import { conExperiencia, contarLikes, contarLikesVarios } from "./likes.mjs";
import { xpJuegoDe, xpJuegoDeVarias } from "./minecraft.mjs";
import { ejecutorDeSolicitudes } from "./solicitudes.mjs";
import { marcarSinCorreo } from "./sin-correo.mjs";
import { PER_PAGE_PUBLICO_MAX } from "./anti-scraping.mjs";
import { equilibrarStats } from "../server/src/equilibrio.mjs";
import {
  aplicarAtributosAStats,
  statsDeAtributosDe,
} from "../server/src/atributos.mjs";
import {
  aplicarPuntosAStats,
  claveDeHabilidad,
  leerPuntosDeStats,
  leerRangos,
} from "../server/src/mi-ficha.mjs";
import {
  facetCounts,
  getNeighbors,
  searchVtubers,
} from "../server/src/search.mjs";

/** El servidor Express acepta `?countries=a,b` además de `?countries=a&countries=b`. */
function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * La página pedida (ya validada con `listQuerySchema`), SIN completar: así quien llama puede gastar el
 * cupo de fichas con sus ids antes de pagar las facetas, las imágenes y los niveles.
 */
export function buscarPagina(db, data) {
  const {
    q,
    countries,
    languages,
    groups,
    artists,
    factions,
    sort,
    page,
    language,
    premium,
    facet,
  } = data;
  // El público nunca necesita más que una página del libro: 100 por petición volcaba el catálogo en 8.
  const perPage = Math.min(data.perPage, PER_PAGE_PUBLICO_MAX);
  const result = searchVtubers(db, {
    q,
    countries: splitCsv(countries),
    languages: splitCsv(languages),
    groups: splitCsv(groups),
    artists: splitCsv(artists),
    factions: splitCsv(factions),
    premium: Boolean(premium),
    sort,
    page,
    perPage,
  });
  return { result, language, q, facet };
}

/** Facetas, imágenes del mantenedor y nivel de cada carta: la respuesta pública del listado. */
export async function completarPagina(db, { result, language, q, facet }) {
  const facets = facet ? facetCounts(db, { language, q }) : null;
  /**
   * Las imágenes del mantenedor, al final: viven en Turso por slug y no en la base del catálogo.
   * Una sola consulta para toda la página (ver `reemplazosDePagina`).
   */
  const conImagenes = await aplicarReemplazosALista(result.items);
  /**
   * El nivel de cada carta sale de la fórmula de experiencia (likes, juego, antigüedad, premium), no de la
   * columna guardada. Dos consultas para toda la página; si el almacén falla se queda el nivel de fórmula con
   * 0 likes, nunca el manual.
   */
  const ids = conImagenes.map((c) => c.id);
  const [likes, juego] = await Promise.all([
    contarLikesVarios(ids).catch(() => new Map()),
    xpJuegoDeVarias(ids),
  ]);
  const conNivel = conImagenes.map((c) =>
    conExperiencia(c, likes.get(c.id) ?? 0, juego.get(c.id) ?? 0),
  );
  const items = await marcarSinCorreo(db, conNivel);
  return { ...result, items, facets };
}

/** La ficha pública completa (imágenes, likes, rangos, stats) con sus vecinas de dex. */
export async function completarFicha(db, card) {
  const { slug } = card;
  /**
   * Las IMÁGENES del mantenedor también ganan al catálogo, no solo los campos de texto.
   *
   * Sin esto, subir una imagen desde el mantenedor no se veía en el sitio público: el campo que
   * decide qué dibuja la carta 3D es `images[kind]`, y para `background` viene `null` en 784 de
   * las 785 fichas. El fondo se servía por HTTP con un 200 y la carta no lo pintaba, porque
   * `holo-card.tsx` solo entra en esa capa `if (card.images.background)`. Los `assets` sí traían
   * la ruta nueva, así que mirando la API parecía correcto.
   */
  const reemplazos = await reemplazosDelMantenedor(
    card.slug,
    KINDS_GESTIONABLES,
  );
  const conImagenes = aplicarImagenesDelMantenedor(card, reemplazos);
  /**
   * Likes y experiencia. La experiencia es función de los likes (`experienciaConLikes`), así que
   * se calcula aquí al leer. Si el almacén de likes falla NO se tumba la ficha: sale sin likes,
   * que es lo que había antes de que existieran.
   */
  let conLikes = { ...conImagenes, likes: 0 };
  try {
    // La XP de Minecraft (`lib/minecraft.mjs`) se suma como la de los likes; si su almacén falla, vale 0.
    const [likes, xpJuego] = await Promise.all([
      contarLikes(card.id),
      xpJuegoDe(card.id),
    ]);
    conLikes = conExperiencia(conImagenes, likes, xpJuego);
  } catch (error) {
    console.error(`[likes] la ficha ${slug} sale sin likes: ${error.message}`);
  }
  // Rango de cada habilidad (los puntos que su titular repartió al subir de nivel). Si el almacén falla, la
  // ficha sale sin rangos: es un adorno, no puede tumbarla.
  try {
    const rangos = await leerRangos(await ejecutorDeSolicitudes(), card.id);
    if (rangos.size) {
      conLikes = {
        ...conLikes,
        skills: conLikes.skills.map((s) => ({
          ...s,
          rank: rangos.get(claveDeHabilidad(s)) ?? 0,
        })),
      };
    }
  } catch (error) {
    console.error(
      `[mi-ficha] la ficha ${slug} sale sin rangos: ${error.message}`,
    );
  }
  // Los stats que la persona subió con sus puntos y el bono automático por niveles (velocidad, evasión…) se ven
  // en la ficha pública. Si el almacén falla, la ficha sale con sus valores base.
  conLikes = { ...conLikes, stats: equilibrarStats(conLikes.stats) };
  try {
    const puestos = await leerPuntosDeStats(
      await ejecutorDeSolicitudes(),
      card.id,
    );
    conLikes = {
      ...conLikes,
      stats: aplicarPuntosAStats(
        conLikes.stats,
        puestos,
        conLikes.levelsGained ?? 0,
      ),
    };
  } catch (error) {
    console.error(
      `[mi-ficha] la ficha ${slug} sale sin puntos de stats: ${error.message}`,
    );
  }
  // Si la ficha repartió sus seis atributos (STR, DEX, CON…), los stats que ve el juego salen de
  // ahí: se calculan, no se guardan. Si el almacén falla, la ficha sale con lo que tenía.
  try {
    const derivados = await statsDeAtributosDe(await ejecutorDeSolicitudes(), {
      vtuberId: card.id,
      facciones: card.factions ?? [],
      stats: card.stats,
    });
    if (derivados.length) {
      conLikes = {
        ...conLikes,
        stats: aplicarAtributosAStats(conLikes.stats, derivados),
      };
    }
  } catch (error) {
    console.error(
      `[mi-ficha] la ficha ${slug} sale sin atributos: ${error.message}`,
    );
  }
  return {
    ...(await marcarSinCorreo(db, [conLikes]))[0],
    neighbors: getNeighbors(db, card.dexNumber),
  };
}

/**
 * Lo mismo que recibiría el navegador de la API (`Response.json`), para pasarlo como prop a un
 * componente cliente. Hace falta: las filas de `node:sqlite` son objetos SIN prototipo y React se niega
 * a serializarlos («Only plain objects… can be passed to Client Components»); sin esto el render del
 * catálogo en el servidor fallaba y caía al cliente sin avisar (solo el log lo decía).
 */
export function comoJson(valor) {
  return JSON.parse(JSON.stringify(valor));
}
