/**
 * Gestión de las imágenes de un VTuber desde el mantenedor.
 *
 * Cada tipo (carta, logo, personaje, miniatura, radar) se puede ver, reemplazar y
 * quitar. El archivo se manda tal cual: el servidor lo valida por CONTENIDO y lo
 * convierte a WebP optimizado, así que desde aquí se acepta cualquier imagen
 * (PNG, JPEG, WebP, GIF, AVIF, TIFF, SVG) sin filtrar por extensión.
 *
 * La vista previa se pide con un parámetro de caché porque la ruta del archivo no
 * cambia al reemplazarlo (es canónica por slug): sin eso el navegador seguiría
 * mostrando la imagen vieja.
 */
import { useRef, useState, type ChangeEvent } from 'react';

import { api } from '../../lib/api';
import type { UploadKind, VtuberDetail } from '../../lib/types';

/**
 * Imágenes que el mantenedor puede gestionar.
 *
 * Son las TRES imágenes FUENTE de un VTuber. Las que se derivan de ellas no se
 * listan porque no hay nada que decidir sobre ellas:
 *   - `character` → el PERSONAJE, recortado y normalizado al lienzo de carta
 *                   (720x1008). Es la base de la carta 3D y de los listados.
 *   - `logo`      → el logotipo, RECTANGULAR (se recorta el margen sobrante).
 *   - `card`      → la FICHA apaisada del sitio (legacy, respaldo del personaje).
 *
 * NO se listan:
 *   - `thumb` → miniatura: es una versión ligera del PERSONAJE y se regenera
 *               desde él, así que gestionarla aparte solo servía para dejarla
 *               desincronizada con la imagen de la que sale.
 *   - `radar` → gráfico de atributos: se genera desde los datos.
 */
const KINDS: Array<{ kind: ManagedKind; label: string; hint: string }> = [
  { kind: 'character', label: 'Personaje', hint: 'El personaje recortado, en proporción de carta (si viene más ancho, se recorta)' },
  { kind: 'logo', label: 'Logo', hint: 'Logotipo rectangular; se recorta el margen transparente' },
  { kind: 'card', label: 'Ficha', hint: 'La ficha apaisada del sitio (legacy); respaldo si no hay personaje' },
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
  logo: { ratio: 0, note: 'rectangular (natural)' },
  card: { ratio: 0.56, note: 'apaisada (legacy)' },
};

const ACCEPT = 'image/*,.png,.jpg,.jpeg,.webp,.gif,.avif,.tif,.tiff,.svg';

/**
 * Tipos gestionables desde el mantenedor: un subconjunto de `UploadKind`
 * (la API acepta más tipos de los que aquí se administran).
 */
type ManagedKind = Extract<UploadKind, 'character' | 'logo' | 'card'>;

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
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  /** Marca de tiempo por tipo para forzar la recarga de la vista previa. */
  const [versions, setVersions] = useState<Partial<Record<ManagedKind, number>>>({});
  const inputs = useRef<Partial<Record<ManagedKind, HTMLInputElement | null>>>({});

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
    setMessage(null);
    try {
      const result = await api.uploadImage(token, detail.id, kind, file);
      onUpdated(result.vtuber);
      setVersions((v) => ({ ...v, [kind]: Date.now() }));
      const a = result.asset;
      const aviso = a.alphaLost ? ' (el original no tenía transparencia)' : '';
      setMessage({
        kind: 'ok',
        text: `${kind}: reemplazado por un WebP de ${a.width}×${a.height} — ${human(a.bytes)}${aviso}`,
      });
    } catch (error) {
      setMessage({ kind: 'error', text: `${kind}: ${error instanceof Error ? error.message : 'error al subir'}` });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (kind: ManagedKind) => {
    setBusy(kind);
    setMessage(null);
    try {
      const result = await api.deleteImage(token, detail.id, kind);
      onUpdated(result.vtuber);
      setVersions((v) => ({ ...v, [kind]: Date.now() }));
      setMessage({ kind: 'ok', text: `${kind}: imagen eliminada` });
    } catch (error) {
      setMessage({ kind: 'error', text: `${kind}: ${error instanceof Error ? error.message : 'error al borrar'}` });
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
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-dex-text">Imágenes</h3>
        <p className="text-xs text-dex-muted">
          Cualquier formato se convierte a WebP optimizado; se conserva la transparencia.
        </p>
      </header>

      {message && (
        <p
          role="status"
          data-testid="admin-images-message"
          className={`rounded-lg px-3 py-2 text-xs ${
            message.kind === 'ok' ? 'bg-teal-500/15 text-teal-200' : 'bg-red-500/15 text-red-200'
          }`}
        >
          {message.text}
        </p>
      )}

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
