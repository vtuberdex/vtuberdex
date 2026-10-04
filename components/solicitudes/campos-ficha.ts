/**
 * Los campos de la ficha que piden la inscripción y la modificación: una sola lista para que los dos
 * formularios pregunten lo mismo y con las mismas etiquetas. Su espejo en el servidor es `PERFIL_CAMPOS`
 * (`server/src/solicitudes.mjs`): al añadir un campo, tócalos a la vez.
 */

export const SIGNOS = ['Aries', 'Tauro', 'Géminis', 'Cáncer', 'Leo', 'Virgo', 'Libra', 'Escorpio', 'Sagitario', 'Capricornio', 'Acuario', 'Piscis'];

/**
 * Los datos que son TEXTO corto. La inscripción los exige todos y la modificación los deja opcionales. Una
 * sola lista alimenta el estado, el render y el envío: añadir uno es una línea aquí (y su entrada en
 * `PERFIL_CAMPOS` del servidor).
 */
export const CAMPOS_PERFIL = [
  // Paso 2: tu personaje (lo que más se quiere contar, con la cabeza fresca).
  { paso: 2, clave: 'modeler', etiqueta: 'Modelo (quién lo hizo)', ejemplo: 'Nombre de quien hizo tu modelo', max: 80 },
  { paso: 2, clave: 'hashtag', etiqueta: 'Hashtag de arte', ejemplo: '#MiHashtag', max: 120 },
  { paso: 2, clave: 'height', etiqueta: 'Estatura', ejemplo: '1,60 m', max: 40 },
  { paso: 2, clave: 'birthday', etiqueta: 'Cumpleaños', ejemplo: '12 de marzo', max: 80 },
  // Paso 3: gustos. Respuestas de una palabra, por eso van al final y juntas.
  { paso: 3, clave: 'favoriteFood', etiqueta: 'Comida favorita', ejemplo: '', max: 120 },
  { paso: 3, clave: 'dislikedFood', etiqueta: 'Comida que te desagrada', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteGame', etiqueta: 'Videojuego favorito', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteSeries', etiqueta: 'Serie favorita', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteMusic', etiqueta: 'Música favorita', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteAnime', etiqueta: 'Anime favorito', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteAnimal', etiqueta: 'Animal favorito', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteColor', etiqueta: 'Color favorito', ejemplo: '', max: 80 },
] as const;

export type ClavePerfil = (typeof CAMPOS_PERFIL)[number]['clave'];
