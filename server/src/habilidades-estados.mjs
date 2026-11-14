// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * El CATÁLOGO de estados del RPG (datos puros): nombre, color oficial, polaridad, evolución con sus
 * efectos oficiales y facción exclusiva. Vive aparte de `habilidades.mjs` solo por tamaño: son ~550
 * líneas de datos y mezclarlas con las reglas dejaba un archivo de más de mil líneas. La fuente
 * pública sigue siendo `habilidades.mjs`, que lo reexporta: impórtalo desde allí.
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
  "font-weight:bold; background:linear-gradient(#fff 0%,#fff 45%,#aaa 85%,#555 100%); -webkit-background-clip:text; color:transparent;";

/**
 * El catálogo oficial. `color` es el del prompt maestro, copiado tal cual (mayúsculas incluidas: el
 * validador compara sin distinguirlas). `faccion` es el slug de la facción EXCLUSIVA, si la hay.
 * `efecto` son las líneas OFICIALES de la evolución: no se inventan efectos alternativos.
 */
/** @type {readonly Estado[]} */
export const ESTADOS = Object.freeze(
  [
    {
      nombre: "LionHeart",
      color: "#c57d05",
      polaridad: "positivo",
      evolucion: {
        nombre: "Anima Invicta",
        efecto: [
          "Obtiene +20 Defensa y +20 Crítico durante 2 turnos.",
          "Es inmune a Miedo durante la duración del efecto.",
        ],
      },
    },
    {
      nombre: "Fortissimo",
      color: "#d03e00",
      polaridad: "positivo",
      evolucion: {
        nombre: "Grand Finale",
        efecto: [
          "Obtiene +20 Velocidad y +20 Defensa Mágica durante 2 turnos.",
          "Las habilidades ofensivas infligen un 15% más de daño durante la duración del efecto.",
        ],
      },
    },
    {
      nombre: "Inspiratio",
      color: "#8a1f00",
      polaridad: "positivo",
      evolucion: {
        nombre: "Obra Magna",
        efecto: [
          "Obtiene +20 Defensa Mágica y +20 Crítico durante 2 turnos.",
          "Las habilidades ofensivas tienen +10% de probabilidad de crítico adicional.",
        ],
      },
    },
    {
      nombre: "Juramento",
      color: "#856800",
      polaridad: "positivo",
      faccion: "heaven-s-arbiter",
      evolucion: {
        nombre: "Sacramentum Aeternum",
        efecto: [
          "Obtiene +20 Defensa y +20 Defensa Mágica durante 2 turnos.",
          "Los efectos positivos obtenidos duran 1 turno adicional.",
        ],
      },
    },
    {
      nombre: "Requiem",
      color: "#38451c",
      polaridad: "positivo",
      faccion: "necrotic",
      evolucion: {
        nombre: "Dies Irae",
        efecto: [
          "Obtiene +20 Ataque Base y +20 Defensa durante 2 turnos.",
          "Las habilidades que dependan del Ataque Base infligen 15% más de daño durante la duración del efecto.",
        ],
      },
    },
    {
      nombre: "Epopeya",
      color: "#086208",
      polaridad: "positivo",
      faccion: "mythical-legacy",
      evolucion: {
        nombre: "Eternal Legend",
        efecto: [
          "Obtiene +20 Defensa y +20 Ataque Mágico Base durante 2 turnos.",
          "Las habilidades que dependan del Ataque Mágico Base infligen un 15% más de daño.",
        ],
      },
    },
    {
      nombre: "Deux ex Machina",
      alias: ["Deus ex Machina"],
      color: "#827d7d",
      polaridad: "positivo",
      evolucion: {
        nombre: "Omega Protocol",
        efecto: [
          "Obtiene +25 Ataque Base, +25 Velocidad y +25 Defensa durante 1 turno.",
          "Las habilidades ofensivas infligen un 20% más de daño durante la duración del efecto.",
        ],
      },
    },
    {
      nombre: "Mente Agil",
      color: "#b10260",
      polaridad: "positivo",
      evolucion: {
        nombre: "Hypercognition",
        efecto: [
          "Obtiene +40 Ataque Base o +40 Ataque Mágico Base durante 1 turno.",
          "La próxima habilidad ofensiva utilizada inflige un 25% más de daño.",
        ],
      },
    },
    {
      nombre: "Sangrado",
      color: "#b00101",
      polaridad: "negativo",
      evolucion: {
        nombre: "Hemorragia",
        efecto: [
          "El enemigo pierde 6% de su HP al inicio de cada turno durante 2 turnos.",
          "No puede recuperar HP durante la duración del efecto.",
        ],
      },
    },
    {
      nombre: "Radiactivo",
      color: "#b39903",
      polaridad: "negativo",
      evolucion: {
        nombre: "Contaminación Crítica",
        efecto: [
          "El enemigo pierde 6% de su HP al inicio de cada turno durante 2 turnos.",
          "Toda curación recibida se reduce en un 75%.",
          "El enemigo recibe un 15% más de daño de otros estados negativos.",
        ],
      },
    },
    {
      nombre: "Quemadura",
      color: "#c35a05",
      polaridad: "negativo",
      evolucion: {
        nombre: "Incineración",
        efecto: [
          "El enemigo pierde 8% de su HP al inicio de cada turno durante 2 turnos.",
          "Reduce Ataque Base y Ataque Mágico Base en 15.",
          "Toda curación recibida se reduce en un 25%.",
        ],
      },
    },
    {
      nombre: "Congelado",
      color: "#089dc0",
      polaridad: "negativo",
      evolucion: {
        nombre: "Crioestasis",
        efecto: [
          "El enemigo pierde 4% de su HP al inicio de cada turno.",
          "Reduce Velocidad en 30.",
          "No puede realizar habilidades ofensivas ni defensivas durante 2 turnos.",
          "Recibe un 15% más de daño.",
        ],
      },
    },
    {
      nombre: "Parálisis",
      color: "#ac9300",
      polaridad: "negativo",
      evolucion: {
        nombre: "Electrificado",
        efecto: [
          "El enemigo pierde 5% de su HP al inicio de cada turno durante 2 turnos.",
          "Recibe un 25% más de daño de habilidades que dependan del Ataque Mágico Base.",
          "Reduce Velocidad en 15.",
        ],
      },
    },
    {
      nombre: "Confusión",
      color: "#43408f",
      polaridad: "negativo",
      evolucion: {
        nombre: "Delirio",
        efecto: [
          "Al inicio de cada turno, el enemigo lanza 1d2.",
          "1: Se golpea a sí mismo causando daño equivalente a la mitad de su Ataque Base.",
          "2: Actúa normalmente.",
          "Al inicio de cada turno recibe daño equivalente al 25% de su Ataque Base.",
        ],
      },
    },
    {
      nombre: "Miedo",
      color: "#074fcc",
      polaridad: "negativo",
      evolucion: {
        nombre: "Terror Primordial",
        efecto: [
          "El enemigo no puede realizar habilidades defensivas durante 2 turnos.",
          "Reduce la Velocidad, Defensa y Defensa Mágica en 30.",
        ],
      },
    },
    {
      nombre: "Somnolencia",
      color: "#04abab",
      polaridad: "negativo",
      evolucion: {
        nombre: "Dreamfall",
        efecto: [
          "La próxima vez que intente realizar una acción, el enemigo lanza 1d2.",
          "1: Pierde la acción.",
          "2: Actúa normalmente.",
          "Después de resolver el efecto, Dreamfall no se elimina automáticamente.",
          "Reduce Velocidad en 15 mientras permanezca activo.",
        ],
      },
    },
    {
      nombre: "Vortex",
      color: "#9a029a",
      polaridad: "positivo",
      evolucion: {
        nombre: "Singularidad",
        efecto: [
          "Lanza 1d2.",
          "Durante X turnos reduce todo daño recibido en 90%.",
          "Las habilidades ofensivas utilizadas durante Singularidad infligen un 25% más de daño.",
        ],
      },
    },
    {
      nombre: "Potencial Evolutivo",
      color: "#233932",
      polaridad: "positivo",
      evolucion: {
        nombre: "Ascensión",
        efecto: [
          "Obtiene +10 a todos los atributos durante 2 turnos.",
          "Reduce en 1 turno la duración de los estados negativos recibidos.",
        ],
      },
    },
    {
      nombre: "Silencio",
      color: "#773705",
      polaridad: "negativo",
      evolucion: {
        nombre: "Arcane Seal",
        efecto: [
          "El enemigo no puede utilizar habilidades que dependan del Ataque Mágico Base durante 3 turnos.",
          "Reduce Ataque Mágico Base en 15.",
        ],
      },
    },
    {
      nombre: "Revitalia",
      color: "#038f39",
      polaridad: "positivo",
      evolucion: {
        nombre: "Renacimiento",
        efecto: [
          "Obtiene +20 Ataque Base.",
          "Obtiene +20 Ataque Mágico Base.",
          "Recupera 10% de HP al inicio de cada turno durante 2 turnos.",
          "Elimina un estado negativo al activarse.",
        ],
      },
    },
    {
      nombre: "Hackeo",
      estilo: ESTILO_HACKEO,
      polaridad: "ambos",
      evolucion: {
        nombre: "System Override",
        efecto: [
          "Replica una habilidad activa o Ultimate del enemigo durante 1 turno.",
          "La habilidad replicada inflige un 25% más de daño.",
        ],
      },
    },
    {
      nombre: "Soul Trader",
      color: "#4b27cf",
      polaridad: "ambos",
      faccion: "netherbane",
      evolucion: {
        nombre: "Pactum Profanum",
        efecto: [
          "Desactiva 1 habilidad pasiva aleatoria del enemigo durante 2 turnos y obtienes una habilidad desactivada.",
          "Obtiene +10 Ataque Mágico Base durante 2 turnos.",
        ],
      },
    },
    {
      nombre: "Fortificación",
      color: "#5e9700",
      polaridad: "positivo",
      faccion: "glovecaller",
      evolucion: {
        nombre: "Ancient Bastion",
        efecto: [
          "Obtiene +20 Ataque Base y +20 Velocidad durante 2 turnos.",
          "Reduce en un 15% el daño recibido durante la duración del efecto.",
        ],
      },
    },
    {
      nombre: "Fractura",
      color: "#ff0042",
      polaridad: "negativo",
      evolucion: {
        nombre: "Broken Arsenal",
        efecto: [
          "El enemigo no puede utilizar habilidades que dependan del Ataque Base durante 3 turnos.",
          "Reduce Ataque Base en 15.",
        ],
      },
    },
    {
      nombre: "Glotoneria",
      alias: ["Glotonería"],
      color: "#a20ae1",
      polaridad: "positivo",
      evolucion: {
        nombre: "Endless Feast",
        efecto: [
          "Se activa cuando realizas un golpe crítico.",
          "Lanza 1d3; aumentas X atributos en +10, donde X corresponde al resultado obtenido.",
          "Máximo de 3 atributos afectados.",
          "Recupera 5% de HP al activarse.",
        ],
      },
    },
    {
      nombre: "Agobio",
      color: "#7F5AF0",
      polaridad: "negativo",
      evolucion: {
        nombre: "Mana Collapse",
        efecto: [
          "Mientras este efecto permanezca activo, toda habilidad consume el triple de MP al ser utilizada.",
          "Las habilidades que consuman MP infligen un 15% menos de daño.",
        ],
      },
    },
    {
      nombre: "Dislexia",
      color: "#FF6F91",
      polaridad: "negativo",
      evolucion: {
        nombre: "Cognitive Breakdown",
        efecto: [
          "Lanza 1D4.",
          "Las próximas dos habilidades utilizadas por el enemigo se seleccionan aleatoriamente entre las habilidades que tenga disponibles.",
          "Los efectos positivos obtenidos duran 1 turno menos.",
        ],
      },
    },
    {
      nombre: "Disociación",
      color: "#00C2A8",
      polaridad: "negativo",
      evolucion: {
        nombre: "Existential Severance",
        efecto: [
          "Mientras este efecto permanezca activo, el enemigo no puede utilizar su Ultimate ni su Habilidad Única.",
          "Reduce Velocidad en 10.",
        ],
      },
    },
    {
      nombre: "Clarividencia",
      color: "#C77DFF",
      polaridad: "positivo",
      evolucion: {
        nombre: "Precognición",
        efecto: [
          "Obtiene +20 Velocidad.",
          "Esquiva las próximas dos habilidades ofensivas recibidas durante 2 turnos.",
          "La próxima habilidad ofensiva utilizada inflige un 50% más de daño.",
        ],
      },
    },
    {
      nombre: "Hemofagia",
      color: "#FF4D6D",
      polaridad: "ambos",
      evolucion: {
        nombre: "Banquete Carmesí",
        efecto: [
          "Absorbe 8% del HP actual del enemigo y lo recupera como HP propio.",
          "Inflige un 15% más de daño a objetivos afectados por Hemorragia.",
        ],
      },
    },
    {
      nombre: "Drenaje Arcano",
      color: "#4CC9F0",
      polaridad: "ambos",
      evolucion: {
        nombre: "Arcane Devourer",
        efecto: [
          "Roba el 30% del MP actual del enemigo y lo añade al usuario.",
          "Obtiene +10 Ataque Mágico Base durante 2 turnos.",
        ],
      },
    },
    {
      nombre: "Usurpación",
      color: "#F4A261",
      polaridad: "ambos",
      evolucion: {
        nombre: "Absolute Dominion",
        efecto: [
          "Reduce 30 puntos de un atributo seleccionado del enemigo y obtiene 30 puntos en ese mismo atributo durante 2 turnos.",
          "Mientras Absolute Dominion esté activo, el atributo robado no puede ser recuperado por medios externos.",
        ],
      },
    },
    {
      nombre: "Aegis Terminal",
      color: "#6C757D",
      polaridad: "positivo",
      evolucion: {
        nombre: "Prometheus Shield",
        efecto: [
          "Al descender por debajo del 30% de HP, genera automáticamente un escudo equivalente al doble de la suma de la Defensa y la Defensa Mágica durante 2 turnos.",
          "Mientras el escudo permanezca activo, obtiene +10 Defensa y +10 Defensa Mágica.",
        ],
      },
    },
    {
      nombre: "Overdrive",
      color: "#FF006E",
      polaridad: "positivo",
      evolucion: {
        nombre: "Limit Break",
        efecto: [
          "Al descender por debajo del 30% de HP, convierte toda la Defensa y Defensa Mágica en Ataque Base y Ataque Mágico Base durante 2 turnos.",
          "Mientras Limit Break esté activo, la Defensa y Defensa Mágica del usuario se consideran 0.",
          "Obtiene +15 Velocidad durante la duración del efecto.",
          "Al finalizar Limit Break, el usuario queda con Parálisis durante 1 turno.",
        ],
      },
    },
    {
      nombre: "Concentración",
      color: "#FFD166",
      polaridad: "positivo",
      evolucion: {
        nombre: "Focus Absolute",
        efecto: [
          "Obtiene +25 Ataque Base y +25 Velocidad durante 2 turnos.",
          "La próxima habilidad ofensiva utilizada inflige un 75% más de daño.",
          "Las habilidades ofensivas utilizadas mientras este efecto esté activo ignoran el 20% de la Defensa del enemigo.",
        ],
      },
    },
    {
      nombre: "Purificación",
      color: "#00F5D4",
      polaridad: "positivo",
      evolucion: {
        nombre: "Rite of Absolution",
        efecto: [
          "Al inicio de cada turno elimina 2 estados negativos del usuario.",
          "Recupera 5% de HP por cada estado negativo eliminado.",
          "Duración: 2 turnos.",
        ],
      },
    },
    {
      nombre: "Determinación",
      color: "#FFF3B0",
      polaridad: "positivo",
      evolucion: {
        nombre: "Voluntas Absoluta",
        efecto: [
          "Si el usuario recibe daño letal, sobrevive con 1 HP.",
          "El efecto se consume al activarse.",
          "Es inmune a Confusión, Dislexia y Delirio.",
        ],
      },
    },
    {
      nombre: "Vulnerabilidad",
      color: "#FF595E",
      polaridad: "negativo",
      evolucion: {
        nombre: "Exposed Weakness",
        efecto: [
          "El enemigo recibe un 40% más de daño durante 2 turnos.",
          "No puede beneficiarse de aumentos de Defensa ni Defensa Mágica.",
        ],
      },
    },
    {
      nombre: "Ruptura",
      color: "#9B2226",
      polaridad: "negativo",
      evolucion: {
        nombre: "Armor Collapse",
        efecto: [
          "Reduce Defensa y Defensa Mágica en 30 durante 2 turnos.",
          "Los escudos recibidos se reducen en un 50%.",
        ],
      },
    },
    {
      nombre: "Lentitud",
      color: "#3A86FF",
      polaridad: "negativo",
      evolucion: {
        nombre: "Temporal Stasis",
        efecto: [
          "Reduce Velocidad en 30 durante 2 turnos.",
          "Las habilidades de Velocidad o evasión no pueden beneficiar al objetivo.",
        ],
      },
    },
    {
      nombre: "Maldición",
      color: "#8338EC",
      polaridad: "negativo",
      evolucion: {
        nombre: "Damnatio Aeterna",
        efecto: [
          "Toda curación recibida por el enemigo se reduce en un 75% durante 2 turnos.",
          "Los efectos de recuperación de HP duran 1 turno menos.",
        ],
      },
    },
    {
      nombre: "Desesperación",
      color: "#800F2F",
      polaridad: "negativo",
      evolucion: {
        nombre: "Abyss of Despair",
        efecto: [
          "El enemigo no puede recuperar HP durante 3 turnos.",
          "Inflige un 15% menos de daño.",
        ],
      },
    },
  ].map((e) => Object.freeze(e)),
);
