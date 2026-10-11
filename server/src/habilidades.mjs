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

/**
 * @typedef {{
 *   nombre: string, alias?: string[], color?: string, estilo?: string,
 *   polaridad: 'positivo' | 'negativo' | 'ambos', faccion?: string,
 *   evolucion: { nombre: string, efecto: string[] },
 * }} Estado
 */

/** Estilo del texto de `Hackeo` (y su evolución): degradado, no un color plano. */
const ESTILO_HACKEO =
  'font-weight:bold; background:linear-gradient(#fff 0%,#fff 45%,#aaa 85%,#555 100%); -webkit-background-clip:text; color:transparent;';

/**
 * El catálogo oficial. `color` es el del prompt maestro, copiado tal cual (mayúsculas incluidas: el
 * validador compara sin distinguirlas). `faccion` es el slug de la facción EXCLUSIVA, si la hay.
 * `efecto` son las líneas OFICIALES de la evolución: no se inventan efectos alternativos.
 */
/** @type {readonly Estado[]} */
export const ESTADOS = Object.freeze([
  {
    nombre: 'LionHeart', color: '#c57d05', polaridad: 'positivo',
    evolucion: { nombre: 'Anima Invicta', efecto: ['Obtiene +20 Defensa y +20 Crítico durante 2 turnos.', 'Es inmune a Miedo durante la duración del efecto.'] },
  },
  {
    nombre: 'Fortissimo', color: '#d03e00', polaridad: 'positivo',
    evolucion: { nombre: 'Grand Finale', efecto: ['Obtiene +20 Velocidad y +20 Defensa Mágica durante 2 turnos.', 'Las habilidades ofensivas infligen un 15% más de daño durante la duración del efecto.'] },
  },
  {
    nombre: 'Inspiratio', color: '#8a1f00', polaridad: 'positivo',
    evolucion: { nombre: 'Obra Magna', efecto: ['Obtiene +20 Defensa Mágica y +20 Crítico durante 2 turnos.', 'Las habilidades ofensivas tienen +10% de probabilidad de crítico adicional.'] },
  },
  {
    nombre: 'Juramento', color: '#856800', polaridad: 'positivo', faccion: 'heaven-s-arbiter',
    evolucion: { nombre: 'Sacramentum Aeternum', efecto: ['Obtiene +20 Defensa y +20 Defensa Mágica durante 2 turnos.', 'Los efectos positivos obtenidos duran 1 turno adicional.'] },
  },
  {
    nombre: 'Requiem', color: '#38451c', polaridad: 'positivo', faccion: 'necrotic',
    evolucion: { nombre: 'Dies Irae', efecto: ['Obtiene +20 Ataque Base y +20 Defensa durante 2 turnos.', 'Las habilidades que dependan del Ataque Base infligen 15% más de daño durante la duración del efecto.'] },
  },
  {
    nombre: 'Epopeya', color: '#086208', polaridad: 'positivo', faccion: 'mythical-legacy',
    evolucion: { nombre: 'Eternal Legend', efecto: ['Obtiene +20 Defensa y +20 Ataque Mágico Base durante 2 turnos.', 'Las habilidades que dependan del Ataque Mágico Base infligen un 15% más de daño.'] },
  },
  {
    nombre: 'Deux ex Machina', alias: ['Deus ex Machina'], color: '#827d7d', polaridad: 'positivo',
    evolucion: { nombre: 'Omega Protocol', efecto: ['Obtiene +25 Ataque Base, +25 Velocidad y +25 Defensa durante 1 turno.', 'Las habilidades ofensivas infligen un 20% más de daño durante la duración del efecto.'] },
  },
  {
    nombre: 'Mente Agil', color: '#b10260', polaridad: 'positivo',
    evolucion: { nombre: 'Hypercognition', efecto: ['Obtiene +40 Ataque Base o +40 Ataque Mágico Base durante 1 turno.', 'La próxima habilidad ofensiva utilizada inflige un 25% más de daño.'] },
  },
  {
    nombre: 'Sangrado', color: '#b00101', polaridad: 'negativo',
    evolucion: { nombre: 'Hemorragia', efecto: ['El enemigo pierde 6% de su HP al inicio de cada turno durante 2 turnos.', 'No puede recuperar HP durante la duración del efecto.'] },
  },
  {
    nombre: 'Radiactivo', color: '#b39903', polaridad: 'negativo',
    evolucion: { nombre: 'Contaminación Crítica', efecto: ['El enemigo pierde 6% de su HP al inicio de cada turno durante 2 turnos.', 'Toda curación recibida se reduce en un 75%.', 'El enemigo recibe un 15% más de daño de otros estados negativos.'] },
  },
  {
    nombre: 'Quemadura', color: '#c35a05', polaridad: 'negativo',
    evolucion: { nombre: 'Incineración', efecto: ['El enemigo pierde 8% de su HP al inicio de cada turno durante 2 turnos.', 'Reduce Ataque Base y Ataque Mágico Base en 15.', 'Toda curación recibida se reduce en un 25%.'] },
  },
  {
    nombre: 'Congelado', color: '#089dc0', polaridad: 'negativo',
    evolucion: { nombre: 'Crioestasis', efecto: ['El enemigo pierde 4% de su HP al inicio de cada turno.', 'Reduce Velocidad en 30.', 'No puede realizar habilidades ofensivas ni defensivas durante 2 turnos.', 'Recibe un 15% más de daño.'] },
  },
  {
    nombre: 'Parálisis', color: '#ac9300', polaridad: 'negativo',
    evolucion: { nombre: 'Electrificado', efecto: ['El enemigo pierde 5% de su HP al inicio de cada turno durante 2 turnos.', 'Recibe un 25% más de daño de habilidades que dependan del Ataque Mágico Base.', 'Reduce Velocidad en 15.'] },
  },
  {
    nombre: 'Confusión', color: '#43408f', polaridad: 'negativo',
    evolucion: { nombre: 'Delirio', efecto: ['Al inicio de cada turno, el enemigo lanza 1d2.', '1: Se golpea a sí mismo causando daño equivalente a la mitad de su Ataque Base.', '2: Actúa normalmente.', 'Al inicio de cada turno recibe daño equivalente al 25% de su Ataque Base.'] },
  },
  {
    nombre: 'Miedo', color: '#074fcc', polaridad: 'negativo',
    evolucion: { nombre: 'Terror Primordial', efecto: ['El enemigo no puede realizar habilidades defensivas durante 2 turnos.', 'Reduce la Velocidad, Defensa y Defensa Mágica en 30.'] },
  },
  {
    nombre: 'Somnolencia', color: '#04abab', polaridad: 'negativo',
    evolucion: { nombre: 'Dreamfall', efecto: ['La próxima vez que intente realizar una acción, el enemigo lanza 1d2.', '1: Pierde la acción.', '2: Actúa normalmente.', 'Después de resolver el efecto, Dreamfall no se elimina automáticamente.', 'Reduce Velocidad en 15 mientras permanezca activo.'] },
  },
  {
    nombre: 'Vortex', color: '#9a029a', polaridad: 'positivo',
    evolucion: { nombre: 'Singularidad', efecto: ['Lanza 1d2.', 'Durante X turnos reduce todo daño recibido en 90%.', 'Las habilidades ofensivas utilizadas durante Singularidad infligen un 25% más de daño.'] },
  },
  {
    nombre: 'Potencial Evolutivo', color: '#233932', polaridad: 'positivo',
    evolucion: { nombre: 'Ascensión', efecto: ['Obtiene +10 a todos los atributos durante 2 turnos.', 'Reduce en 1 turno la duración de los estados negativos recibidos.'] },
  },
  {
    nombre: 'Silencio', color: '#773705', polaridad: 'negativo',
    evolucion: { nombre: 'Arcane Seal', efecto: ['El enemigo no puede utilizar habilidades que dependan del Ataque Mágico Base durante 3 turnos.', 'Reduce Ataque Mágico Base en 15.'] },
  },
  {
    nombre: 'Revitalia', color: '#038f39', polaridad: 'positivo',
    evolucion: { nombre: 'Renacimiento', efecto: ['Obtiene +20 Ataque Base.', 'Obtiene +20 Ataque Mágico Base.', 'Recupera 10% de HP al inicio de cada turno durante 2 turnos.', 'Elimina un estado negativo al activarse.'] },
  },
  {
    nombre: 'Hackeo', estilo: ESTILO_HACKEO, polaridad: 'ambos',
    evolucion: { nombre: 'System Override', efecto: ['Replica una habilidad activa o Ultimate del enemigo durante 1 turno.', 'La habilidad replicada inflige un 25% más de daño.'] },
  },
  {
    nombre: 'Soul Trader', color: '#4b27cf', polaridad: 'ambos', faccion: 'netherbane',
    evolucion: { nombre: 'Pactum Profanum', efecto: ['Desactiva 1 habilidad pasiva aleatoria del enemigo durante 2 turnos y obtienes una habilidad desactivada.', 'Obtiene +10 Ataque Mágico Base durante 2 turnos.'] },
  },
  {
    nombre: 'Fortificación', color: '#5e9700', polaridad: 'positivo', faccion: 'glovecaller',
    evolucion: { nombre: 'Ancient Bastion', efecto: ['Obtiene +20 Ataque Base y +20 Velocidad durante 2 turnos.', 'Reduce en un 15% el daño recibido durante la duración del efecto.'] },
  },
  {
    nombre: 'Fractura', color: '#ff0042', polaridad: 'negativo',
    evolucion: { nombre: 'Broken Arsenal', efecto: ['El enemigo no puede utilizar habilidades que dependan del Ataque Base durante 3 turnos.', 'Reduce Ataque Base en 15.'] },
  },
  {
    nombre: 'Glotoneria', alias: ['Glotonería'], color: '#a20ae1', polaridad: 'positivo',
    evolucion: { nombre: 'Endless Feast', efecto: ['Se activa cuando realizas un golpe crítico.', 'Lanza 1d3; aumentas X atributos en +10, donde X corresponde al resultado obtenido.', 'Máximo de 3 atributos afectados.', 'Recupera 5% de HP al activarse.'] },
  },
  {
    nombre: 'Agobio', color: '#7F5AF0', polaridad: 'negativo',
    evolucion: { nombre: 'Mana Collapse', efecto: ['Mientras este efecto permanezca activo, toda habilidad consume el triple de MP al ser utilizada.', 'Las habilidades que consuman MP infligen un 15% menos de daño.'] },
  },
  {
    nombre: 'Dislexia', color: '#FF6F91', polaridad: 'negativo',
    evolucion: { nombre: 'Cognitive Breakdown', efecto: ['Lanza 1D4.', 'Las próximas dos habilidades utilizadas por el enemigo se seleccionan aleatoriamente entre las habilidades que tenga disponibles.', 'Los efectos positivos obtenidos duran 1 turno menos.'] },
  },
  {
    nombre: 'Disociación', color: '#00C2A8', polaridad: 'negativo',
    evolucion: { nombre: 'Existential Severance', efecto: ['Mientras este efecto permanezca activo, el enemigo no puede utilizar su Ultimate ni su Habilidad Única.', 'Reduce Velocidad en 10.'] },
  },
  {
    nombre: 'Clarividencia', color: '#C77DFF', polaridad: 'positivo',
    evolucion: { nombre: 'Precognición', efecto: ['Obtiene +20 Velocidad.', 'Esquiva las próximas dos habilidades ofensivas recibidas durante 2 turnos.', 'La próxima habilidad ofensiva utilizada inflige un 50% más de daño.'] },
  },
  {
    nombre: 'Hemofagia', color: '#FF4D6D', polaridad: 'ambos',
    evolucion: { nombre: 'Banquete Carmesí', efecto: ['Absorbe 8% del HP actual del enemigo y lo recupera como HP propio.', 'Inflige un 15% más de daño a objetivos afectados por Hemorragia.'] },
  },
  {
    nombre: 'Drenaje Arcano', color: '#4CC9F0', polaridad: 'ambos',
    evolucion: { nombre: 'Arcane Devourer', efecto: ['Roba el 30% del MP actual del enemigo y lo añade al usuario.', 'Obtiene +10 Ataque Mágico Base durante 2 turnos.'] },
  },
  {
    nombre: 'Usurpación', color: '#F4A261', polaridad: 'ambos',
    evolucion: { nombre: 'Absolute Dominion', efecto: ['Reduce 30 puntos de un atributo seleccionado del enemigo y obtiene 30 puntos en ese mismo atributo durante 2 turnos.', 'Mientras Absolute Dominion esté activo, el atributo robado no puede ser recuperado por medios externos.'] },
  },
  {
    nombre: 'Aegis Terminal', color: '#6C757D', polaridad: 'positivo',
    evolucion: { nombre: 'Prometheus Shield', efecto: ['Al descender por debajo del 30% de HP, genera automáticamente un escudo equivalente al doble de la suma de la Defensa y la Defensa Mágica durante 2 turnos.', 'Mientras el escudo permanezca activo, obtiene +10 Defensa y +10 Defensa Mágica.'] },
  },
  {
    nombre: 'Overdrive', color: '#FF006E', polaridad: 'positivo',
    evolucion: { nombre: 'Limit Break', efecto: ['Al descender por debajo del 30% de HP, convierte toda la Defensa y Defensa Mágica en Ataque Base y Ataque Mágico Base durante 2 turnos.', 'Mientras Limit Break esté activo, la Defensa y Defensa Mágica del usuario se consideran 0.', 'Obtiene +15 Velocidad durante la duración del efecto.', 'Al finalizar Limit Break, el usuario queda con Parálisis durante 1 turno.'] },
  },
  {
    nombre: 'Concentración', color: '#FFD166', polaridad: 'positivo',
    evolucion: { nombre: 'Focus Absolute', efecto: ['Obtiene +25 Ataque Base y +25 Velocidad durante 2 turnos.', 'La próxima habilidad ofensiva utilizada inflige un 75% más de daño.', 'Las habilidades ofensivas utilizadas mientras este efecto esté activo ignoran el 20% de la Defensa del enemigo.'] },
  },
  {
    nombre: 'Purificación', color: '#00F5D4', polaridad: 'positivo',
    evolucion: { nombre: 'Rite of Absolution', efecto: ['Al inicio de cada turno elimina 2 estados negativos del usuario.', 'Recupera 5% de HP por cada estado negativo eliminado.', 'Duración: 2 turnos.'] },
  },
  {
    nombre: 'Determinación', color: '#FFF3B0', polaridad: 'positivo',
    evolucion: { nombre: 'Voluntas Absoluta', efecto: ['Si el usuario recibe daño letal, sobrevive con 1 HP.', 'El efecto se consume al activarse.', 'Es inmune a Confusión, Dislexia y Delirio.'] },
  },
  {
    nombre: 'Vulnerabilidad', color: '#FF595E', polaridad: 'negativo',
    evolucion: { nombre: 'Exposed Weakness', efecto: ['El enemigo recibe un 40% más de daño durante 2 turnos.', 'No puede beneficiarse de aumentos de Defensa ni Defensa Mágica.'] },
  },
  {
    nombre: 'Ruptura', color: '#9B2226', polaridad: 'negativo',
    evolucion: { nombre: 'Armor Collapse', efecto: ['Reduce Defensa y Defensa Mágica en 30 durante 2 turnos.', 'Los escudos recibidos se reducen en un 50%.'] },
  },
  {
    nombre: 'Lentitud', color: '#3A86FF', polaridad: 'negativo',
    evolucion: { nombre: 'Temporal Stasis', efecto: ['Reduce Velocidad en 30 durante 2 turnos.', 'Las habilidades de Velocidad o evasión no pueden beneficiar al objetivo.'] },
  },
  {
    nombre: 'Maldición', color: '#8338EC', polaridad: 'negativo',
    evolucion: { nombre: 'Damnatio Aeterna', efecto: ['Toda curación recibida por el enemigo se reduce en un 75% durante 2 turnos.', 'Los efectos de recuperación de HP duran 1 turno menos.'] },
  },
  {
    nombre: 'Desesperación', color: '#800F2F', polaridad: 'negativo',
    evolucion: { nombre: 'Abyss of Despair', efecto: ['El enemigo no puede recuperar HP durante 3 turnos.', 'Inflige un 15% menos de daño.'] },
  },
].map((e) => Object.freeze(e)));

/** MP de cada pieza del kit (el HTML guardado no lleva el MP: lo pinta quien muestra la ficha). */
export const MP = Object.freeze({ activa1: 90, activa2: 85, ultimate: 300 });

/** Forma del kit: exactamente estas piezas. */
export const FORMA_DEL_KIT = Object.freeze({ active: 2, passive: 2, ultimate: 1 });

/** Cuántos estados entrega cada pieza. Las pasivas no tienen tope en el prompt. */
export const ESTADOS_MAXIMOS_ACTIVA = 1;
export const ESTADOS_DE_LA_ULTIMATE = 2;

/** Sin tildes, minúsculas y espacios colapsados: la clave con la que se compara un nombre. */
function clave(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Índice nombre → { estado, esEvolucion, canonico }, construido una vez. */
const INDICE = (() => {
  const mapa = new Map();
  for (const estado of ESTADOS) {
    for (const nombre of [estado.nombre, ...(estado.alias ?? [])]) {
      mapa.set(clave(nombre), { estado, esEvolucion: false, canonico: estado.nombre });
    }
    mapa.set(clave(estado.evolucion.nombre), { estado, esEvolucion: true, canonico: estado.evolucion.nombre });
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
  if (!hallado) return null;
  const { estado } = hallado;
  return estado.estilo ?? `color:${estado.color}; font-weight:bold;`;
}

/** El `<span>` oficial de un estado, con su nombre canónico. */
export function spanDeEstado(nombre) {
  const hallado = buscarEstado(nombre);
  if (!hallado) throw new Error(`estado_desconocido: ${nombre}`);
  return `<span style="${estiloDeEstado(nombre)}">${hallado.canonico}</span>`;
}

/**
 * El bloque «Mientras X esté activo:» de una evolución con sus efectos OFICIALES, tal como lo pide la
 * Ultimate. Recibe la base o la evolución; si la base tiene evolución, pinta la evolución.
 */
export function bloqueDeEvolucion(nombre) {
  const hallado = buscarEstado(nombre);
  if (!hallado) throw new Error(`estado_desconocido: ${nombre}`);
  const { evolucion } = hallado.estado;
  const span = spanDeEstado(evolucion.nombre);
  return `<br>Mientras ${span} esté activo:<br>\n${evolucion.efecto.map((l) => `${l}<br>`).join('\n')}`;
}

/* ------------------------------------------------------------------------------------------------
 * LECTURA DEL HTML
 * ---------------------------------------------------------------------------------------------- */

const RE_SPAN = /<span\s+style\s*=\s*"([^"]*)"\s*>([^<]*)<\/span>/gi;

/** Cada `<span>` del HTML: nombre visible, estilo e índice. */
export function spansDe(html) {
  return [...String(html ?? '').matchAll(RE_SPAN)].map((m) => ({
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
  const texto = String(html ?? '');
  const salida = [];
  const RE_VERBO = /\b(obtienes|obtiene|aplicas|aplica)\s+((?:<span\s+style\s*=\s*"[^"]*"\s*>[^<]*<\/span>\s*(?:,|\by\b|\be\b)?\s*)+)/gi;
  for (const m of texto.matchAll(RE_VERBO)) {
    const verbo = m[1].toLowerCase().startsWith('obtien') ? 'obtienes' : 'aplicas';
    for (const s of spansDe(m[2])) salida.push({ verbo, texto: s.texto });
  }
  return salida;
}

/** Texto plano comparable: sin etiquetas, sin tildes, minúsculas y sin la persona del verbo. */
function textoComparable(html) {
  return clave(String(html ?? '').replace(/<[^>]+>/g, ' '))
    .replace(/[•.,;:]/g, ' ')
    .replace(/\bobtienes\b/g, 'obtiene')
    .replace(/\btus\b/g, 'las')
    .replace(/\btu\b/g, 'la')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Color del estilo de un span, o `null` si no lleva (`Hackeo` lleva degradado). */
function colorDelEstilo(estilo) {
  const m = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(estilo);
  return m ? m[1].trim().toLowerCase() : null;
}

function estiloCoincide(estiloReal, estado) {
  if (estado.estilo) return /linear-gradient\(\s*#fff 0%\s*,\s*#fff 45%\s*,\s*#aaa 85%\s*,\s*#555 100%\s*\)/i.test(estiloReal);
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
  if (category === 'ultimate') return 'Ultimate';
  return `${category === 'active' ? 'Activa' : 'Pasiva'} ${posicion + 1}`;
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
 * @param {{ habilidades: Habilidad[], facciones?: string[] | null }} kit
 *   `facciones` son slugs; si es `null` no se comprueba la exclusividad (no se sabe).
 * @returns {Problema[]}
 */
export function validarKit({ habilidades, facciones = null }) {
  /** @type {Problema[]} */
  const problemas = [];
  // El mismo `<span>` mal coloreado suele repetirse en la misma pieza: se anota una vez.
  const anotar = (gravedad, codigo, pieza, detalle, estado) => {
    if (problemas.some((p) => p.codigo === codigo && p.pieza === pieza && p.detalle === detalle)) return;
    problemas.push({ codigo, gravedad, pieza, detalle, ...(estado ? { estado } : {}) });
  };

  // Forma del kit.
  for (const [category, esperado] of Object.entries(FORMA_DEL_KIT)) {
    const n = habilidades.filter((h) => h.category === category).length;
    if (n !== esperado) {
      anotar('error', 'forma_del_kit', 'Kit', `se esperaban ${esperado} ${category} y hay ${n}`);
    }
  }

  const contadores = { active: 0, passive: 0, ultimate: 0 };
  /** base canónica → piezas que la entregan (para los repetidos). */
  const usoPorEstado = new Map();
  const ultimates = [];

  for (const h of habilidades) {
    const posicion = contadores[h.category]++;
    const pieza = etiquetaDePieza(h.category, posicion);
    const html = h.effectHtml ?? '';

    // Colores y nombres de cada span que sea un estado del catálogo. Los spans que no lo son pueden
    // ser la Habilidad Única: solo se avisa fuera de la Ultimate, donde no debería haber ninguno.
    for (const s of spansDe(html)) {
      const hallado = buscarEstado(s.texto);
      if (!hallado) {
        if (h.category !== 'ultimate') {
          anotar('aviso', 'estado_desconocido', pieza, `«${s.texto}» no es un estado del sistema`, s.texto);
        }
        continue;
      }
      if (!estiloCoincide(s.estilo, hallado.estado)) {
        const oficial = hallado.estado.estilo ? 'el degradado de Hackeo' : hallado.estado.color;
        anotar('error', 'color_incorrecto', pieza, `«${s.texto}» va en ${colorDelEstilo(s.estilo) ?? s.estilo} y el oficial es ${oficial}`, hallado.canonico);
      }
      if (s.texto !== hallado.canonico) {
        anotar('aviso', 'nombre_no_canonico', pieza, `«${s.texto}» se escribe «${hallado.canonico}»`, hallado.canonico);
      }
    }

    // Lo que la pieza entrega: verbo, facción y conteo.
    const entregados = [];
    for (const { verbo, texto } of estadosEntregados(html)) {
      const hallado = buscarEstado(texto);
      if (!hallado) continue;
      const { estado } = hallado;
      if (!entregados.some((e) => e.hallado.estado === estado)) entregados.push({ hallado, verbo });

      if (estado.polaridad === 'positivo' && verbo === 'aplicas') {
        anotar('error', 'verbo_invertido', pieza, `«${hallado.canonico}» es positivo: se obtiene, no se aplica`, hallado.canonico);
      } else if (estado.polaridad === 'negativo' && verbo === 'obtienes') {
        anotar('error', 'verbo_invertido', pieza, `«${hallado.canonico}» es negativo: se aplica, no se obtiene`, hallado.canonico);
      }
      if (estado.faccion && facciones && !facciones.includes(estado.faccion)) {
        anotar('error', 'faccion_exclusiva', pieza, `«${hallado.canonico}» es exclusivo de ${estado.faccion}`, hallado.canonico);
      }
    }

    for (const { hallado } of entregados) {
      const lista = usoPorEstado.get(hallado.estado.nombre) ?? [];
      lista.push(pieza);
      usoPorEstado.set(hallado.estado.nombre, lista);
    }

    if (h.category === 'active' && entregados.length > ESTADOS_MAXIMOS_ACTIVA) {
      anotar('error', 'activa_varios_estados', pieza, `entrega ${entregados.length} estados (${entregados.map((e) => e.hallado.canonico).join(', ')}); el máximo es 1`);
    }
    if (h.category === 'ultimate') ultimates.push({ pieza, html, entregados });
  }

  for (const { pieza, html, entregados } of ultimates) {
    if (entregados.length !== ESTADOS_DE_LA_ULTIMATE) {
      anotar('error', 'ultimate_estados', pieza, `entrega ${entregados.length} estados; deben ser exactamente 2`);
    }
    const comparable = textoComparable(html);
    for (const { hallado } of entregados) {
      if (!hallado.esEvolucion) {
        anotar('error', 'ultimate_estado_base', pieza, `usa «${hallado.canonico}»: en la Ultimate va su evolución «${hallado.estado.evolucion.nombre}»`, hallado.canonico);
        continue;
      }
      const faltan = hallado.estado.evolucion.efecto.filter((l) => !comparable.includes(textoComparable(l)));
      if (faltan.length) {
        anotar('aviso', 'efecto_no_oficial', pieza, `«${hallado.canonico}» no trae ${faltan.length} de sus ${hallado.estado.evolucion.efecto.length} líneas oficiales`, hallado.canonico);
      }
    }
  }

  for (const [nombre, piezas] of usoPorEstado) {
    if (piezas.length > 1) {
      anotar('aviso', 'estado_repetido', piezas.join(', '), `«${nombre}» (o su evolución) se entrega en ${piezas.length} piezas`, nombre);
    }
  }

  return problemas;
}

/** Descripción corta de cada código, para el informe y el mantenedor. */
export const CODIGOS = Object.freeze({
  forma_del_kit: 'El kit no tiene 2 activas, 2 pasivas y 1 Ultimate',
  color_incorrecto: 'Estado con un color que no es el oficial',
  nombre_no_canonico: 'Estado escrito distinto del nombre oficial',
  estado_desconocido: 'Texto destacado que no es un estado del sistema',
  verbo_invertido: '«Obtienes» con un estado negativo o «aplicas» con uno positivo',
  faccion_exclusiva: 'Estado exclusivo de una facción que la ficha no tiene',
  activa_varios_estados: 'Activa que entrega más de un estado',
  ultimate_estados: 'Ultimate que no entrega exactamente 2 estados',
  ultimate_estado_base: 'Ultimate con un estado base en vez de su evolución',
  efecto_no_oficial: 'Evolución de la Ultimate sin sus efectos oficiales completos',
  estado_repetido: 'Mismo estado en varias piezas del kit',
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
  return String(texto ?? '').replace(/\[\[([^\]]+)\]\]/g, (entero, nombre) =>
    buscarEstado(nombre) ? spanDeEstado(nombre) : entero,
  );
}

/** Escapa `<`, `>` y `&` de un texto escrito a mano antes de mezclarlo con el HTML del sistema. */
export function escaparHtml(texto) {
  return String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  const texto = String(html ?? '');
  for (const m of texto.matchAll(/<[^>]*>?/g)) {
    const etiqueta = m[0];
    if (/^<br\s*\/?>$/i.test(etiqueta)) continue;
    if (/^<\/?(b|strong|i|em)>$/i.test(etiqueta)) continue;
    if (/^<!--[^>]*-->$/.test(etiqueta)) continue;
    if (/^<\/(span|div)>$/i.test(etiqueta)) continue;
    if (/^<div class="skill-effect-content">$/i.test(etiqueta)) continue;
    const span = /^<span style="([^"<>]*)">$/i.exec(etiqueta);
    if (span && !/url\s*\(|expression|javascript:|@import|\\/i.test(span[1])) continue;
    return false;
  }
  return true;
}

/** El texto plano de una habilidad (columna `effect`: búsqueda y respaldo sin formato). */
export function textoPlanoDe(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>\r?\n?/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
