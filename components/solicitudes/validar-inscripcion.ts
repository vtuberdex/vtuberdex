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

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

export function faltasDelPaso(paso: 1 | 2 | 3 | 4 | 5, e: EstadoInscripcion): Falta[] {
  const faltas: Falta[] = [];

  if (paso === 1) {
    if (!lleno(e.name)) faltas.push({ campo: 'name', etiqueta: 'ins.nombreArtistico', motivo: 'vacio' });
    if (!lleno(e.email)) faltas.push({ campo: 'email', etiqueta: 'ficha.correo', motivo: 'vacio' });
    else if (!CORREO.test(e.email.trim())) faltas.push({ campo: 'email', etiqueta: 'ficha.correo', motivo: 'invalido' });
  }
  if (paso === 2 && e.codigo.trim().length < 20) {
    faltas.push({ campo: 'codigo', etiqueta: 'ficha.codigoEtiqueta', motivo: lleno(e.codigo) ? 'invalido' : 'vacio' });
  }
  if (paso === 3) {
    if (e.languages.length === 0) faltas.push({ campo: 'languages', etiqueta: 'ficha.leyendaIdiomas', motivo: 'vacio' });
    // Hace falta al menos UNA red completa; una fila a medias (plataforma sin enlace o al revés) también molesta.
    const escritas = e.socials.filter((r) => lleno(r.platform) || lleno(r.url));
    const completas = escritas.filter((r) => lleno(r.platform) && esEnlaceHttp(r.url));
    if (completas.length === 0) {
      faltas.push({ campo: 'socials', etiqueta: 'ins.redes', motivo: escritas.length ? 'invalido' : 'vacio' });
    } else if (completas.length < escritas.length) {
      faltas.push({ campo: 'socials', etiqueta: 'ins.redes', motivo: 'invalido' });
    }
  }
  if (paso === 4) {
    if (!lleno(e.imageId)) faltas.push({ campo: 'imageId', etiqueta: 'ficha.avatar', motivo: 'vacio' });
    if (!lleno(e.logoId)) faltas.push({ campo: 'logoId', etiqueta: 'ficha.logo', motivo: 'vacio' });
    faltas.push(...faltasDePerfil(2, e.perfil));
    if (!lleno(e.cardText)) faltas.push({ campo: 'cardText', etiqueta: 'ficha.lore', motivo: 'vacio' });
  }
  if (paso === 5) {
    faltas.push(...faltasDePerfil(3, e.perfil));
    if (!e.acepta) faltas.push({ campo: 'acepta', etiqueta: 'ins.falta.terminos', motivo: 'vacio' });
  }
  return faltas;
}
