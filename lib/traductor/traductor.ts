/**
 * Traducción de textos libres (la historia de la ficha) EN EL DISPOSITIVO del visitante: el texto
 * no sale a ningún servicio de terceros y el servidor no gasta CPU en traducir.
 *
 * Dos motores, el primero que exista:
 *   1. La API nativa del navegador (`Translator`, Chrome 138+ de escritorio): el modelo lo gestiona
 *      el navegador, sin descargas por nuestra parte.
 *   2. Respaldo universal: Transformers.js con los modelos Marian `Xenova/opus-mt-*` (≈75-100 MB
 *      cada uno, cuantizados, en WASM), cargado SOLO al pulsar «Traducir». No hay modelo directo
 *      es↔ja: se pasa por inglés (es→en→ja, ja→en→es).
 *
 * La librería se importa por URL en tiempo de ejecución (`webpackIgnore`) en vez de añadirla al
 * `package.json`: pesa MB, la usa una fracción de visitantes y así NO entra en ningún bundle.
 */
import type { Locale } from '@/lib/i18n/locales';

export type Progreso = (porcentaje: number) => void;

const URL_TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';

/** Modelos por par directo. Un par que no está aquí se resuelve pasando por inglés. */
export const MODELOS: Readonly<Record<string, string>> = {
  'es>en': 'Xenova/opus-mt-es-en',
  'en>es': 'Xenova/opus-mt-en-es',
  'ja>en': 'Xenova/opus-mt-ja-en',
  'en>ja': 'Xenova/opus-mt-en-jap',
};

/** Ruta de pares directos origen→destino (con el pivote por inglés si hace falta). */
export function rutaDeTraduccion(origen: Locale, destino: Locale): Array<[Locale, Locale]> {
  if (origen === destino) return [];
  if (MODELOS[`${origen}>${destino}`]) return [[origen, destino]];
  return [
    [origen, 'en'],
    ['en', destino],
  ];
}

/**
 * Parte el texto en tramos que quepan en el modelo (Marian admite ~512 tokens): por frases y
 * agrupando hasta `max` caracteres. Los saltos de línea de la historia se conservan.
 */
export function trocear(texto: string, max = 380): string[] {
  const tramos: string[] = [];
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) {
      tramos.push('', '\n');
      continue;
    }
    const frases = linea.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [linea];
    let actual = '';
    for (const frase of frases) {
      if (actual && actual.length + frase.length > max) {
        tramos.push(actual.trim());
        actual = '';
      }
      // Una «frase» sin puntuación más larga que el máximo se corta en palabras.
      if (frase.length > max) {
        const palabras = frase.split(/(\s+)/);
        for (const palabra of palabras) {
          if (actual.length + palabra.length > max) {
            tramos.push(actual.trim());
            actual = '';
          }
          actual += palabra;
        }
      } else {
        actual += frase;
      }
    }
    if (actual.trim()) tramos.push(actual.trim());
    tramos.push('\n');
  }
  tramos.pop();
  return tramos;
}

/** Une los tramos traducidos respetando los saltos de línea que `trocear` marcó. */
function unir(tramos: string[]): string {
  let salida = '';
  for (const tramo of tramos) {
    if (tramo === '') continue;
    if (tramo === '\n') salida += '\n';
    else salida += (salida && !salida.endsWith('\n') ? ' ' : '') + tramo;
  }
  return salida.trim();
}

/* ── Motor 1: API nativa ─────────────────────────────────────────────────── */

interface TraductorNativo {
  translate(texto: string): Promise<string>;
}
interface FabricaNativa {
  availability(opciones: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(opciones: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<TraductorNativo>;
}

function fabricaNativa(): FabricaNativa | null {
  const fabrica = (globalThis as unknown as { Translator?: FabricaNativa }).Translator;
  return fabrica && typeof fabrica.create === 'function' ? fabrica : null;
}

async function conApiNativa(texto: string, origen: Locale, destino: Locale, alProgreso?: Progreso): Promise<string | null> {
  const fabrica = fabricaNativa();
  if (!fabrica) return null;
  try {
    const par = { sourceLanguage: origen, targetLanguage: destino };
    if ((await fabrica.availability(par)) === 'unavailable') return null;
    const traductor = await fabrica.create({
      ...par,
      monitor: (m) =>
        m.addEventListener('downloadprogress', (e) => alProgreso?.(Math.round(((e as Event & { loaded?: number }).loaded ?? 0) * 100))),
    });
    const salida: string[] = [];
    for (const tramo of trocear(texto, 1500)) salida.push(tramo === '' || tramo === '\n' ? tramo : await traductor.translate(tramo));
    return unir(salida);
  } catch {
    return null;
  }
}

/* ── Motor 2: Transformers.js + opus-mt ──────────────────────────────────── */

type Canal = (entrada: string, opciones?: Record<string, unknown>) => Promise<Array<{ translation_text: string }>>;
const canales = new Map<string, Promise<Canal>>();
let libreria: Promise<{ pipeline: (...args: unknown[]) => Promise<Canal> }> | null = null;

function cargarLibreria() {
  libreria ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${URL_TRANSFORMERS}/+esm`).catch((cause) => {
    libreria = null; // un fallo de red no se memoiza: se reintenta
    throw cause;
  });
  return libreria;
}

function canalDe(modelo: string, alProgreso?: Progreso): Promise<Canal> {
  let canal = canales.get(modelo);
  if (!canal) {
    const porArchivo = new Map<string, number>();
    canal = cargarLibreria()
      .then(({ pipeline }) =>
        pipeline('translation', modelo, {
          dtype: 'q8',
          progress_callback: (info: { status?: string; file?: string; progress?: number }) => {
            if (info.status !== 'progress' || !info.file) return;
            porArchivo.set(info.file, info.progress ?? 0);
            const valores = [...porArchivo.values()];
            alProgreso?.(Math.round(valores.reduce((a, b) => a + b, 0) / valores.length));
          },
        }),
      )
      .catch((cause) => {
        canales.delete(modelo);
        throw cause;
      });
    canales.set(modelo, canal);
  }
  return canal;
}

async function conModelosLocales(texto: string, origen: Locale, destino: Locale, alProgreso?: Progreso): Promise<string> {
  let actual = texto;
  for (const [de, a] of rutaDeTraduccion(origen, destino)) {
    const canal = await canalDe(MODELOS[`${de}>${a}`], alProgreso);
    const salida: string[] = [];
    for (const tramo of trocear(actual)) {
      salida.push(tramo === '' || tramo === '\n' ? tramo : (await canal(tramo, { max_new_tokens: 512 }))[0]?.translation_text ?? '');
    }
    actual = unir(salida);
  }
  return actual;
}

/* ── API pública ─────────────────────────────────────────────────────────── */

const memoria = new Map<string, string>();

/** ¿Hay un motor sin descarga propia? Sirve para decir «se descargará un modelo» solo cuando toca. */
export const hayTraductorNativo = (): boolean => fabricaNativa() !== null;

/**
 * Traduce `texto` de `origen` a `destino`. Lanza si ningún motor puede. El resultado se
 * memoiza por (destino, texto): volver a una ficha o alternar «ver original» no recalcula.
 */
export async function traducirTexto(texto: string, origen: Locale, destino: Locale, alProgreso?: Progreso): Promise<string> {
  if (origen === destino) return texto;
  const clave = `${origen}>${destino}\n${texto}`;
  const guardado = memoria.get(clave);
  if (guardado !== undefined) return guardado;
  const resultado = (await conApiNativa(texto, origen, destino, alProgreso)) ?? (await conModelosLocales(texto, origen, destino, alProgreso));
  memoria.set(clave, resultado);
  return resultado;
}

export const __vaciarMemoriaDeTraducciones = (): void => memoria.clear();
