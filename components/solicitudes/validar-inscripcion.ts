// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Qué falta en cada paso de la inscripción, como función PURA (sin DOM ni i18n: devuelve claves).
 *
 * Por qué existe: la validación nativa (`required`) solo señala UN campo por vez con una burbuja que se
 * va sola, y no cubre lo que no es un `<input>` (idiomas, redes, términos). Esos faltantes solo aparecían
 * como un 400 del servidor al final de los cinco pasos, sin decir en cuál. Aquí se calcula la lista
 * completa del paso para mostrarla junta, marcar los campos y llevar el foco al primero.
 *
 * El espejo en el servidor es `inscripcionSchema` (`server/src/solicitudes.mjs`): lo que se exige aquí
 * tiene que ser lo mismo que allá, o el paso pasaría y el envío final rebotaría.
 */
import { CAMPOS_PERFIL, type ClavePerfil } from '@/components/solicitudes/campos-ficha';

export interface Falta {
  /** Valor de `data-campo` del control (o del grupo) donde está el problema. */
  campo: string;
  /** Clave de texto de la etiqueta del campo. */
  etiqueta: string;
  /** `vacio`: no hay nada; `invalido`: hay algo pero no sirve (enlace, correo). */
  motivo: 'vacio' | 'invalido';
}

export interface EstadoInscripcion {
  name: string;
  email: string;
  codigo: string;
  languages: string[];
  socials: Array<{ platform: string; url: string }>;
  /** Ids de las imágenes ya subidas (avatar y logo). */
  imageId: string;
  logoId: string;
  cardText: string;
  perfil: Record<ClavePerfil, string>;
  acepta: boolean;
}

const ESPACIO = /\s/;

/**
 * Lo mismo que pedía la expresión `^[^\s@]+@[^\s@]+\.[^\s@]+$`, sin expresión: una sola arroba con algo
 * delante, sin espacios, y un punto en el dominio que no sea ni el primer ni el último carácter. La
 * expresión retrocedía en tiempo cuadrático con dominios largos sin punto (los dos `+` se disputaban
 * los mismos caracteres); recorrer la cadena es lineal.
 */
const pareceCorreo = (valor: string): boolean => {
  const arroba = valor.indexOf('@');
  if (arroba < 1 || arroba !== valor.lastIndexOf('@') || ESPACIO.test(valor)) {
    return false;
  }
  return valor.slice(arroba + 1).slice(1, -1).includes('.');
};

export const esEnlaceHttp = (valor: string): boolean => {
  try {
    const url = new URL(valor.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const lleno = (valor: string) => valor.trim().length > 0;

/** Los pasos 3 y 4 de las claves de perfil: el servidor los exige todos. */
const faltasDePerfil = (paso: 2 | 3, perfil: Record<ClavePerfil, string>): Falta[] =>
  CAMPOS_PERFIL.filter((c) => c.paso === paso && !lleno(perfil[c.clave])).map((c) => ({
    campo: c.clave,
    etiqueta: `ficha.campo.${c.clave}`,
    motivo: 'vacio' as const,
  }));

export type PasoInscripcion = 1 | 2 | 3 | 4 | 5;

type Motivo = Falta['motivo'];

/** Vacío, mal escrito o bien (`null`). */
const motivoDelCorreo = (email: string): Motivo | null => {
  if (!lleno(email)) {
    return 'vacio';
  }
  return pareceCorreo(email.trim()) ? null : 'invalido';
};

/** El código del correo tiene al menos 20 caracteres: uno más corto está vacío o mal copiado. */
const motivoDelCodigo = (codigo: string): Motivo | null => {
  if (codigo.trim().length >= 20) {
    return null;
  }
  return lleno(codigo) ? 'invalido' : 'vacio';
};

/**
 * Hace falta al menos UNA red completa; una fila a medias (plataforma sin enlace o al revés) también molesta.
 * Sin nada escrito es «vacío»; con algo escrito pero sin todas completas, «inválido».
 */
const motivoDeLasRedes = (socials: EstadoInscripcion['socials']): Motivo | null => {
  const escritas = socials.filter((r) => lleno(r.platform) || lleno(r.url));
  const completas = escritas.filter((r) => lleno(r.platform) && esEnlaceHttp(r.url));
  if (completas.length > 0 && completas.length === escritas.length) {
    return null;
  }
  return escritas.length ? 'invalido' : 'vacio';
};

/** Una falta «vacío» si el texto no tiene nada. */
const siVacio = (valor: string, campo: string, etiqueta: string): Falta[] =>
  lleno(valor) ? [] : [{ campo, etiqueta, motivo: 'vacio' }];

/** Una falta con su motivo, o ninguna si el motivo es `null`. */
const siMotivo = (motivo: Motivo | null, campo: string, etiqueta: string): Falta[] =>
  motivo ? [{ campo, etiqueta, motivo }] : [];

/** Qué mira cada paso, en el orden en que aparecen los campos. */
const FALTAS_POR_PASO: Record<PasoInscripcion, (e: EstadoInscripcion) => Falta[]> = {
  1: (e) => [
    ...siVacio(e.name, 'name', 'ins.nombreArtistico'),
    ...siMotivo(motivoDelCorreo(e.email), 'email', 'ficha.correo'),
  ],
  2: (e) => siMotivo(motivoDelCodigo(e.codigo), 'codigo', 'ficha.codigoEtiqueta'),
  3: (e) => [
    ...(e.languages.length === 0
      ? [{ campo: 'languages', etiqueta: 'ficha.leyendaIdiomas', motivo: 'vacio' as const }]
      : []),
    ...siMotivo(motivoDeLasRedes(e.socials), 'socials', 'ins.redes'),
  ],
  4: (e) => [
    ...siVacio(e.imageId, 'imageId', 'ficha.avatar'),
    ...siVacio(e.logoId, 'logoId', 'ficha.logo'),
    ...faltasDePerfil(2, e.perfil),
    ...siVacio(e.cardText, 'cardText', 'ficha.lore'),
  ],
  5: (e) => [
    ...faltasDePerfil(3, e.perfil),
    ...(e.acepta ? [] : [{ campo: 'acepta', etiqueta: 'ins.falta.terminos', motivo: 'vacio' as const }]),
  ],
};

export function faltasDelPaso(paso: PasoInscripcion, e: EstadoInscripcion): Falta[] {
  return FALTAS_POR_PASO[paso](e);
}
