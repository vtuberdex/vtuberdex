'use client';
/** Paso 2: imágenes — reutiliza el gestor (arrastrar y soltar, vista previa) y avisa de lo que falta. */
import type { VtuberDetail } from '@/lib/types';
import { ImageManager } from '@/components/image-manager';

export function ImagesStep({ token, detail, onUpdated }: { token: string; detail: VtuberDetail; onUpdated: (detail: VtuberDetail) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-dex-muted">
        Sube el personaje (la imagen principal), el logo y, si quieres, un fondo. Puedes arrastrar los archivos sobre cada tarjeta. Este paso se puede omitir y volver después.
      </p>
      {!detail.images.character && (
        <p role="status" data-testid="no-character-warning" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
          Sin imagen de personaje la carta se verá vacía. Puedes seguir, pero conviene subirla.
        </p>
      )}
      <ImageManager token={token} detail={detail} onUpdated={onUpdated} />
    </div>
  );
}
