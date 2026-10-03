/**
 * Parser de «datos pegados»: el mantenedor tenía una hoja que convertía una fila de Excel en
 * bloques `<div class="dato"><div class="titulo">…</div><div class="contenido">…</div></div>`,
 * el mismo formato de la ficha original. Aquí se leen esos bloques y se funden con el perfil.
 *
 * Se usa DOMParser (navegador y jsdom) y NO regex sobre el HTML: el valor puede traer
 * entidades (`&amp;`) o etiquetas internas (`<br>`), y el parseo las resuelve igual que
 * el scraper. DOMParser no ejecuta scripts ni carga imágenes del texto pegado.
 */
import type { ProfileField } from '@/lib/types';

const norm = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Extrae los pares título/contenido; descarta los que vienen sin valor. */
export function parsearDatos(html: string): ProfileField[] {
  if (!html.trim()) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: ProfileField[] = [];
  doc.querySelectorAll('.dato').forEach((row) => {
    const label = (row.querySelector('.titulo')?.textContent ?? '').replace(/\s+/g, ' ').replace(/[:：]\s*$/, '').trim();
    const value = (row.querySelector('.contenido')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (label && value) out.push({ label, value });
  });
  return out;
}

/** Mezcla: un título ya existente (sin importar mayúsculas ni tildes) se actualiza; el resto se añade. */
export function fundirPerfil(actual: ProfileField[], nuevos: ProfileField[]): ProfileField[] {
  const result = actual.map((field) => ({ ...field }));
  for (const item of nuevos) {
    const i = result.findIndex((field) => norm(field.label) === norm(item.label));
    if (i >= 0) result[i] = { label: result[i].label, value: item.value };
    else result.push({ ...item });
  }
  return result;
}

/** Campos propios de la ficha que el scraper también deriva del perfil (mismas reglas). */
export function camposDerivados(items: ProfileField[]) {
  const find = (re: RegExp) => items.find((row) => re.test(norm(row.label)))?.value;
  return {
    birthday: find(/cumplea/),
    height: find(/altura/),
    hashtag: find(/hashtag/),
    favoriteColor: find(/color fav/),
  };
}
