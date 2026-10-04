/**
 * La FICHA DETERIORADA: lo que el público deja de ver de una carta en el grado 1 (la de las bajas).
 *
 * La cláusula de salida de los términos dice que una ficha dada de baja no se elimina: se degrada.
 * En el grado 1 la carta 3D ya es ilegible; esto cubre lo que NO es la carta: la API pública. Ocultar
 * los datos solo en la pantalla dejaría el nombre, las redes y la historia a un `curl` de distancia,
 * así que se quitan AQUÍ, antes de que salgan del servidor.
 *
 * SOLO PARA LECTURAS PÚBLICAS. El mantenedor pide `includeHidden` y recibe la ficha entera: tiene
 * que poder verla, editarla o devolverla a un grado normal. Nada se borra de la base.
 *
 * NO TIENE PÁGINA: `getVtuberBySlug` devuelve `null` para el público (404), `getNeighbors` y el sitemap
 * la saltan y el catálogo no la enlaza. Por eso el listado tampoco puede dejar el `slug` real: la URL
 * `/v/<slug>` delataría el nombre; sale un identificador genérico con el número de dex.
 *
 * JS puro (sin Node ni DOM), como `premium.mjs`: lo importan el buscador y, para saber de qué grado
 * se trata, también la interfaz.
 */
import { GRADO_DE_BAJA } from './premium.mjs';

/** Símbolos con los que se sustituyen las letras: ASCII, para que cualquier fuente los tenga. */
const SIMBOLOS = '#%&@*?/\\~=+<>';

/** ¿Es una ficha en el grado de las bajas? Sirve para una tarjeta ya mapeada o para un grado suelto. */
export function esFichaDeteriorada(cartaOGrado) {
  const grado = typeof cartaOGrado === 'string' ? cartaOGrado : cartaOGrado?.premium?.grade;
  return grado === GRADO_DE_BAJA;
}

/**
 * El nombre, ilegible: cada letra pasa a un símbolo y los espacios y dígitos se respetan (la silueta
 * de las palabras y el número de dex siguen ahí). Determinista por id: la misma ficha se ve siempre igual.
 */
export function nombreDeteriorado(nombre, id) {
  let estado = (Number(id) || 0) + 0x9e3779b9;
  return Array.from(String(nombre ?? ''), (c) => {
    if (/[\s\d#]/.test(c)) return c;
    estado = (Math.imul(estado, 1103515245) + 12345) >>> 0;
    return SIMBOLOS[estado % SIMBOLOS.length];
  }).join('');
}

/**
 * La TARJETA del listado tal como la ve el público si está deteriorada; la misma, sin tocar, si no.
 * Conserva lo que hace falta para pintar la carta rota (id, número de dex, color, personaje) y vacía
 * el resto. No muta la entrada.
 */
export function ocultarFichaDeteriorada(card) {
  if (!esFichaDeteriorada(card)) return card;
  const oculta = {
    ...card,
    name: nombreDeteriorado(card.name, card.id),
    slug: `deteriorada-${card.dexNumber}`,
    phrase: null,
    cardText: null,
    cardTextConfidence: null,
    palette: [],
    level: null,
    powerScore: 0,
    hasDetail: false,
    birthday: null,
    height: null,
    hashtag: null,
    favoriteColor: null,
    countries: [],
    groups: [],
    artists: [],
    factions: [],
    factionIcons: [],
    languages: [],
    statsPreview: [],
    socialCount: 0,
    // Sin logo: la marca del VTuber deja de aparecer en su carta.
    images: { ...card.images, logo: null, background: null },
  };
  return oculta;
}
