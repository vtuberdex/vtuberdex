'use client';
/**
 * Gestión de las imágenes de un VTuber desde el mantenedor.
 *
 * Cada tipo (carta, logo, personaje, miniatura, radar) se puede ver, reemplazar y
 * quitar. El archivo se manda tal cual: el servidor lo valida por CONTENIDO y lo
 * convierte a WebP optimizado, así que desde aquí se acepta cualquier imagen
 * (PNG, JPEG, WebP, GIF, AVIF, TIFF, SVG) sin filtrar por extensión.
 *
 * POR QUÉ NO BASTA CON `onUpdated` DESDE EL PADRE
 * -----------------------------------------------
 * El componente padre (`admin-page.tsx`) hace `setSelected(vtuber)` cuando
 * `ImageManager` avisa, así que el detalle se actualiza. Pero la vista previa de
 * cada imagen usa una ruta CANÓNICA (`/images/<kind>/<slug>.webp`) que no cambia
 * al reemplazar el archivo. El navegador cachea esa URL, así que aunque el padre
 * reciba `images.character` actualizado, el <img> seguiría mostrando el buffer
 * viejo. Por eso se fuerza un parámetro `?v=<timestamp>` por tipo cada vez que
 * se completa una subida o un borrado.
 *
 * POR QUÉ NO RECARGAMOS LA PÁGINA
 * -------------------------------
 * Subir una imagen es una edición más del mantenedor. Recargar o desmontar el
 * editor haría perder el scroll, el foco y cualquier cambio no guardado del
 * formulario. El padre recibe el detalle nuevo, el gestor actualiza su propio
 * timestamp de caché y la imagen se redibuja sin salir de la ficha.
 */
import { useRef, useState, type ChangeEvent } from 'react';

import { api } from '@/lib/api';
import type { UploadKind, VtuberDetail } from '@/lib/types';
import { ToastContainer, useToasts } from '@/components/toast';

/**
 * Imágenes que el mantenedor puede gestionar.
 *
 * Son las imágenes FUENTE de un VTuber. Las que se derivan de ellas no se listan
 * porque no hay nada que decidir sobre ellas:
 *   - `character`  → el PERSONAJE, recortado y normalizado al lienzo de carta
 *                    (720x1008). Es la base de la carta 3D y de los listados.
 *   - `background` → el FONDO de la carta 3D, la capa que va POR DETRÁS del
 *                    personaje. Mismo lienzo que el personaje para que su encuadre
 *                    coincida y el paralaje entre las dos capas no se desajuste.
 *                    Es OPCIONAL: sin él la carta se dibuja como siempre.
 *   - `logo`       → el logotipo, RECTANGULAR (se recorta el margen sobrante).
 *   - `card`       → la FICHA apaisada del sitio (legacy, respaldo del personaje).
 *
 * NO se listan:
 *   - `thumb` → miniatura: es una versión ligera del PERSONAJE y se regenera
 *               desde él, así que gestionarla aparte solo servía para dejarla
 *               desincronizada con la imagen de la que sale.
 *   - `radar` → gráfico de atributos: se genera desde los datos.
 *   - la ficha apaisada (`card`) también quedó fuera: era el RESPALDO de
 *               `character` y hoy los 785 lo tienen, así que no se mostraba
 *               nunca. Se retiró con su carpeta para no publicar 33 MB inútiles.
 */
const KINDS: Array<{ kind: ManagedKind; label: string; hint: string }> = [
  { kind: 'character', label: 'Personaje', hint: 'El personaje recortado, en proporción de carta (si viene más ancho, se recorta)' },
  {
    kind: 'background',
    label: 'Fondo',
    hint: 'Capa que va POR DETRÁS del personaje, con su propio holograma más intenso. En las fichas cuyo personaje es un rectángulo opaco solo se ve por los bordes',
  },
  { kind: 'logo', label: 'Logo', hint: 'Logotipo rectangular; se recorta el margen transparente' },
];

/**
 * Proporción de cada tipo, para que la vista previa del admin muestre la imagen
 * con su forma real en vez de estirarla dentro de una caja genérica:
 *   - personaje → carta (1.4 de alto)
 *   - logo → rectangular (se muestra con su proporción natural)
 *   - carta → apaisada en la previsualización (0.56)
 */
const KIND_SHAPE: Record<ManagedKind, { ratio: number; note: string }> = {
  character: { ratio: 1.4, note: 'proporción de carta' },
  background: { ratio: 1.4, note: 'proporción de carta' },
  logo: { ratio: 0, note: 'rectangular (natural)' },
  card: { ratio: 0.56, note: 'apaisada (legacy)' },
};

const ACCEPT = 'image/*,.png,.jpg,.jpeg,.webp,.gif,.avif,.tif,.tiff,.svg';

/**
 * Tipos gestionables desde el mantenedor: un subconjunto de `UploadKind`
 * (la API acepta más tipos de los que aquí se administran).
 */
type ManagedKind = Extract<UploadKind, 'character' | 'background' | 'logo' | 'card'>;

/**
 * Lienzo de normalización por tipo, en píxeles. `null` = no se toca el encuadre.
 *
 * POR QUÉ EL CLIENTE NORMALIZA Y NO SOLO EL SERVIDOR
 * -------------------------------------------------
 * El Express local ajusta la proporción con `sharp`, pero en PRODUCCIÓN no hay
 * `sharp` (es un binario nativo que no viaja a la función) y la subida solo valida la
 * FIRMA WebP: la imagen se guarda con el encuadre que tenga el archivo. Eso dejaba dos
 * comportamientos distintos según dónde se subiera, y el fondo es justo la capa donde
 * se nota: su encuadre tiene que coincidir con el del personaje o el paralaje arrastra
 * un desajuste. Normalizando aquí, el resultado es el mismo en los dos backends.
 */
const TARGET: Partial<Record<ManagedKind, { w: number; h: number }>> = {
  character: { w: 720, h: 1008 },
  background: { w: 720, h: 1008 },
};

/**
 * Convierte lo elegido a WebP y, si el tipo lo pide, lo encuadra al lienzo de carta.
 *
 * Se hace SIEMPRE, incluso cuando el archivo ya es WebP: la ruta de producción exige
 * la firma RIFF/WEBP, y mandar un PNG/JPEG —lo más cómodo para el usuario— daba
 * `formato_invalido`. Si el navegador no supiera exportar WebP se devuelve el original
 * y decide el servidor, para no bloquear la subida por una capacidad del cliente.
 */
async function preparar(file: File, kind: ManagedKind): Promise<Blob> {
  const target = TARGET[kind];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  /**
   * `createImageBitmap` no existe en navegadores antiguos. Se comprueba ANTES de
   * llamarla: sin este guardia, invocarla lanzaría un TypeError SÍNCRONO y el
   * `.catch()` no llegaría a engancharse, así que la subida fallaría con un error
   * confuso en vez de degradar al original (que es lo correcto: el servidor ya
   * valida y convierte).
   */
  if (typeof createImageBitmap !== 'function') return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  if (target) {
    canvas.width = target.w;
    canvas.height = target.h;
    /** Encuadre `cover` anclado arriba: llena el lienzo y recorta el exceso. */
    const escala = Math.max(target.w / bitmap.width, target.h / bitmap.height);
    const dw = bitmap.width * escala;
    const dh = bitmap.height * escala;
    ctx.drawImage(bitmap, (target.w - dw) / 2, 0, dw, dh);
  } else {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
  }
  bitmap.close?.();

  const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
  return webp ?? file;
}

interface Props {
  token: string;
  detail: VtuberDetail;
  onUpdated: (vtuber: VtuberDetail) => void;
}

/** Formatea bytes para mostrarlos en la ficha. */
function human(bytes: number | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function ImageManager({ token, detail, onUpdated }: Props) {
  const [busy, setBusy] = useState<ManagedKind | null>(null);
  /** Marca de tiempo por tipo para forzar la recarga de la vista previa. */
  const [versions, setVersions] = useState<Partial<Record<ManagedKind, number>>>({});
  const inputs = useRef<Partial<Record<ManagedKind, HTMLInputElement | null>>>({});
  const { toasts, add: addToast, remove: removeToast } = useToasts();

  /**
   * Estado de un tipo de imagen. La fila de `asset` es la fuente principal, pero
   * si no existe se usa la ruta que expone `images`: un VTuber puede tener la
   * imagen en disco sin fila de asset (p. ej. el radar solo existe en 211 fichas),
   * y decir "sin imagen" cuando sí la hay confundiría al mantenedor.
   */
  const infoFor = (kind: ManagedKind): { path: string | null; width: number | null; height: number | null; bytes: number | null } => {
    const fromAssets = detail.assets?.find((a) => a.kind === kind);
    if (fromAssets) {
      return {
        path: fromAssets.path,
        width: fromAssets.width ?? null,
        height: fromAssets.height ?? null,
        bytes: fromAssets.bytes ?? null,
      };
    }
    return { path: detail.images[kind], width: null, height: null, bytes: null };
  };

  const upload = async (kind: ManagedKind, file: File) => {
    setBusy(kind);
    try {
      const result = await api.uploadImage(token, detail.id, kind, await preparar(file, kind));
      /**
       * `onUpdated` solo se llama si la respuesta trae el detalle.
       *
       * El contrato de los dos backends lo incluye, pero si un despliegue antiguo devolviera
       * `{ok, slug, kind, size}` —la forma que tenía la ruta de producción— pasar `undefined`
       * a `setSelected` borraba la ficha entera (la página se quedaba sin campos ni imágenes).
       * Preferimos un aviso visible a que la pantalla se vacíe: el fallo se ve y se puede
       * diagnosticar en vez de parecer que el dato desapareció.
       */
      if (!result?.vtuber) {
        addToast('error', `${kind}: el servidor no devolvió la ficha actualizada (respuesta incompleta). Recarga la página.`);
        return;
      }
      onUpdated(result.vtuber);
      setVersions((v) => ({ ...v, [kind]: Date.now() }));
      const a = result.asset;
      const aviso = a?.alphaLost ? ' (el original no tenía transparencia)' : '';
      addToast('ok', `${kind}: reemplazado por un WebP de ${a?.width ?? '?'}×${a?.height ?? '?'} — ${human(a?.bytes)}${aviso}`);
    } catch (error) {
      addToast('error', `${kind}: ${error instanceof Error ? error.message : 'error al subir'}`);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (kind: ManagedKind) => {
    setBusy(kind);
    try {
      const result = await api.deleteImage(token, detail.id, kind);
      if (!result?.vtuber) {
        addToast('error', `${kind}: el servidor no devolvió la ficha actualizada (respuesta incompleta). Recarga la página.`);
        return;
      }
      onUpdated(result.vtuber);
      setVersions((v) => ({ ...v, [kind]: Date.now() }));
      addToast('ok', `${kind}: imagen eliminada`);
    } catch (error) {
      addToast('error', `${kind}: ${error instanceof Error ? error.message : 'error al borrar'}`);
    } finally {
      setBusy(null);
    }
  };

  const onPick = (kind: ManagedKind) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Se limpia el input para poder volver a elegir el MISMO archivo después.
    event.target.value = '';
    if (file) void upload(kind, file);
  };

  return (
    <section className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/60 p-5" data-testid="admin-images">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-dex-text">Imágenes</h3>
        <p className="text-xs text-dex-muted">
          Cualquier formato se convierte a WebP optimizado; se conserva la transparencia.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {KINDS.map(({ kind, label, hint }) => {
          const info = infoFor(kind);
          const shape = KIND_SHAPE[kind];
          const version = versions[kind];
          const working = busy === kind;
          return (
            <li key={kind} className="space-y-2 rounded-xl border border-dex-line/70 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-dex-text">{label}</span>
                {info.width ? (
                  <span className="font-mono text-[10px] text-dex-muted">
                    {info.width}×{info.height} · {human(info.bytes ?? undefined)}
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-amber-300/80">sin imagen</span>
                )}
              </div>

              {/* Vista previa sobre damero: así se ve si la imagen tiene alfa real.
                  La caja respeta la PROPORCIÓN del tipo (carta, apaisada,
                  cuadrada o natural), para que se vea la forma real y no una
                  estirada dentro de una caja genérica. */}
              <div className="flex justify-center">
                <div
                  className="flex items-center justify-center overflow-hidden rounded-lg border border-dex-line/60"
                  style={{
                    backgroundImage:
                      'linear-gradient(45deg, #2a2a32 25%, transparent 25%), linear-gradient(-45deg, #2a2a32 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a32 75%), linear-gradient(-45deg, transparent 75%, #2a2a32 75%)',
                    backgroundSize: '12px 12px',
                    backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
                    height: '112px',
                    // ratio 0 = proporción natural (logos, muy variables).
                    aspectRatio: shape.ratio > 0 ? `1 / ${shape.ratio}` : undefined,
                    width: shape.ratio > 0 ? undefined : '100%',
                  }}
                >
                  {info.path ? (
                    <img
                      src={`${info.path}${info.path.includes('?') ? '&' : '?'}v=${version ?? '0'}`}
                      alt={label}
                      className="max-h-full max-w-full object-contain"
                      data-testid={`admin-image-${kind}`}
                    />
                  ) : (
                    <span className="text-xs text-dex-muted">Sin imagen</span>
                  )}
                </div>
              </div>

              <p className="text-[11px] leading-snug text-dex-muted">{hint}</p>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={(el) => {
                    inputs.current[kind] = el;
                  }}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={onPick(kind)}
                  data-testid={`admin-input-${kind}`}
                />
                <button
                  type="button"
                  disabled={working}
                  onClick={() => inputs.current[kind]?.click()}
                  className="rounded-lg bg-teal-500/20 px-3 py-1.5 text-xs font-semibold text-teal-100 transition hover:bg-teal-500/30 disabled:opacity-50"
                >
                  {working ? 'Subiendo…' : info.path ? 'Reemplazar' : 'Subir'}
                </button>
                {info.path && (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void remove(kind)}
                    className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/25 disabled:opacity-50"
                  >
                    Quitar
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
